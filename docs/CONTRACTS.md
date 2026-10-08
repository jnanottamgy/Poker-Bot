# Module Contracts (normative)

This document pins down the public API and the exact rules of every core
package. Each package is implemented, tested and documented against this
contract. If an implementation finds the contract ambiguous or wrong, it fixes
this document in the same change — the code and this file never disagree.

Shared types live in `@jpb/shared-types` (`packages/shared-types/src`). They are
the vocabulary of the whole system; read them first.

> **NO AI IN GAME LOGIC.** Every function below is a deterministic algorithm,
> a mathematical calculation, or a call to the platform CSPRNG. See
> [NO_AI.md](./NO_AI.md).

Conventions used by every package:

- Pure functions where possible. Reducers take `(state, input, ctx)` and return
  a **new** state plus emitted events/effects; they never mutate their input,
  never read the wall clock (`Date.now()`), and never call `Math.random()`.
  Time comes from `ctx.now` or the command envelope `at`; randomness comes from
  an injected `RandomSource`.
- All state objects are plain JSON-serializable data (no classes, Maps, Sets,
  Dates or functions inside state) so that snapshots and replays are exact.
- Chips are non-negative safe integers. Money is integer minor units.
- Errors that a client can trigger are returned as typed result objects with a
  code (never thrown). Thrown errors indicate programmer bugs / invariant breaks.
- Every package exports from `src/index.ts`, has tests in `test/`, and a
  `README.md` explaining its algorithms.

---

## 1. `@jpb/randomness`

Platform-supplied cryptographic randomness plus a deterministic, verifiable
byte stream. Uses only `node:crypto` (`randomBytes`, `randomInt`,
`createHmac`, `createHash`). Must also work in the browser for the public
verifier: isolate Node-only code in `src/node.ts`; keep the HMAC-DRBG,
uniform-int and shuffle algorithms in portable modules that accept a
`RandomSource`. (Browser verification may use a small pure-JS SHA-256/HMAC
implementation included in the package — tested against node:crypto vectors.)

```ts
interface RandomSource { nextUint32(): number }           // uniformly distributed 32-bit unsigned
secureRandomSource(): RandomSource                         // CSPRNG-backed (node:crypto)
secureRandomBytes(n: number): Uint8Array
secureRandomInt(maxExclusive: number): number              // crypto.randomInt
generateSeedHex(bytes?: number /* default 32 */): string   // lowercase hex
sha256Hex(data: string | Uint8Array): string               // strings are UTF-8 encoded
hmacSha256(key: Uint8Array, message: string | Uint8Array): Uint8Array
hexToBytes(hex: string): Uint8Array; bytesToHex(b: Uint8Array): string

class HmacDrbgSource implements RandomSource              // deterministic stream, see below
uniformInt(src: RandomSource, maxExclusive: number): number
fisherYatesShuffle<T>(items: readonly T[], src: RandomSource): T[]   // returns a new array
```

### HMAC-SHA256 counter-mode stream (normative)

```
key      = raw key bytes (e.g. the 32-byte server seed)
label    = UTF-8 string (the domain-separated context, see fairness-engine)
block(i) = HMAC-SHA256(key, label || "|" || decimal(i))      i = 0, 1, 2, ...
stream   = block(0) || block(1) || block(2) || ...
nextUint32() consumes the next 4 bytes of the stream, big-endian.
```

### Unbiased integers (normative)

```
uniformInt(n):  require 1 <= n <= 2^32
  limit = floor(2^32 / n) * n
  repeat u = nextUint32() until u < limit
  return u mod n
```

### Shuffle (normative)

Durstenfeld Fisher–Yates: `for i = n-1 down to 1: j = uniformInt(i+1); swap(a[i], a[j])`.

Required tests: known-answer vectors for the stream; uniformInt never returns
out-of-range values and rejects the biased tail; chi-square uniformity smoke
test of shuffles (seeded, deterministic); shuffles are permutations; identical
seeds give identical shuffles; different labels give different streams.

---

## 2. `@jpb/fairness-engine`

Commit–reveal scheme and deterministic deck derivation.

```ts
createSeedCommitment(): { serverSeed: string; serverSeedHash: string }
commitmentFor(serverSeedHex: string): string        // sha256Hex(hexToBytes(serverSeed))
computePublicEntropy(input: { clientSeeds: string[]; adminEntropy: string | null }): string
deckLabel(p: { tournamentId; tableId; handNumber; publicEntropy }): string
deriveDeck(p: { serverSeed; tournamentId; tableId; handNumber; publicEntropy }): CardCode[]  // 52 cards
drawSource(p: { serverSeed; tournamentId; purpose: string; publicEntropy }): RandomSource    // seat draws etc.
deckHash(deck: readonly CardCode[]): string          // sha256Hex(deck.join(''))
verifyHand(record: HandFairnessRecord, revealedServerSeed: string): HandVerificationResult
buildVerificationBundle(...): FairnessExport         // JSON export for independent verification
```

Normative constructions:

- `serverSeed` = 32 bytes from the CSPRNG, hex encoded. Published commitment:
  `serverSeedHash = SHA-256(serverSeedBytes)` (hex). The seed is generated when
  the tournament is created, its hash is published before registration opens,
  and the seed is revealed only after the tournament is COMPLETED/CANCELLED.
- `publicEntropy = SHA-256( "JPB/v1/entropy|" || sorted(clientSeeds).join(",") || "|" || (adminEntropy ?? "") )`.
  Each registering player's browser contributes a random `clientSeed`; the
  director freezes `publicEntropy` at START and publishes it. This prevents the
  organizer from precomputing deck orders before registration closes.
- Deck for a hand: start from `CANONICAL_DECK`, shuffle with
  `HmacDrbgSource(key = serverSeedBytes, label = "JPB/v1/deck|{tournamentId}|{tableId}|{handNumber}|{publicEntropy}")`.
- Other draws (initial seating, final-table seat draw, button draws) use label
  `"JPB/v1/{purpose}|{tournamentId}|{publicEntropy}"`; purposes are fixed
  strings such as `seating`, `final-table`, `button:{tableId}`.
- Dealing order from the deck (consumed by the poker engine, deck[0] is the
  top): one card to each dealt-in seat clockwise starting with the first seat
  after the button, then a second round; burn 1, flop 3; burn 1, turn 1;
  burn 1, river 1.

`HandFairnessRecord` contains: tournamentId, tableId, handId, handNumber,
publicEntropy, serverSeedHash, deckHash, dealt hole cards per seat (dealing
order), board, burn cards. `verifyHand` recomputes everything from the revealed
seed and reports each check (commitment, deck hash, hole cards, board) as
VERIFIED/FAILED. Never claim "provably fair" for anything this function cannot
independently recompute; document the trust assumptions and limitations
(e.g. organizer collusion with fake registrations) in the README.

---

## 3. `@jpb/poker-engine`

A pure No-Limit Texas Hold'em **hand** engine. It knows nothing about
tournaments, tables, timers, sockets or databases.

```ts
// cards & evaluation
rankValue(card): number /* 2..14 */; suitOf(card): SuitChar
evaluateHand(cards: readonly CardCode[]): EvaluatedHand        // 5, 6 or 7 cards, best 5
compareHands(a: EvaluatedHand, b: EvaluatedHand): number       // >0 a wins, 0 tie, <0 b wins

// pots
buildPots(contribs: ReadonlyArray<{ seat; amount; folded }>): { pots: Pot[]; uncalled: { seat; amount } | null }
distributePots(...)  // see odd-chip rule

// hand state machine
createHand(input: CreateHandInput): HandTransition
applyAction(state: HandState, seat: SeatIndex, intent: PlayerActionIntent, opts?: { timeout?: boolean }): HandTransition | HandRejection
getLegalActions(state: HandState): LegalActions | null          // for the acting seat
timeoutIntent(state: HandState): PlayerActionIntent             // CHECK if legal else FOLD
checkHandInvariants(state: HandState): string[]                 // empty when healthy
```

```ts
interface CreateHandInput {
  handId: HandId; handNumber: number; maxSeats: number;
  seats: HandSeatInput[];             // dealt-in players only, stack > 0, any order
  buttonSeat: SeatIndex;              // may be an EMPTY seat (dead button)
  smallBlindSeat: SeatIndex | null;   // null = dead small blind (none posted)
  bigBlindSeat: SeatIndex;
  smallBlind: Chips; bigBlind: Chips; ante: Chips; anteType: AnteType;
  deck: CardCode[];                   // 52 unique cards; deck[0] is the top
}
type HandTransition = { ok: true; state: HandState; events: HandEvent[] }
type HandRejection  = { ok: false; code: IllegalActionCode; message: string }
```

`createHand` posts antes and blinds, deals hole cards and runs the machine
forward to the first `TURN_TO_ACT` (or all the way to HAND_COMPLETE when no
betting is possible, e.g. everyone all-in from the blinds). `applyAction`
likewise runs forward through street changes, run-outs, showdown and pot
distribution until the next decision or HAND_COMPLETE. Events are emitted in
the exact order things happen.

### Rules (normative)

Seat order is clockwise = ascending seat index wrapping at `maxSeats`.

1. **Antes** (`ALL_PLAYERS`: every dealt-in player posts `ante`;
   `BB_ANTE`: the big-blind player posts `ante` once for the table). Antes are
   dead money: they go to the pot and do not count toward the current bet.
   Posting order: antes first, then SB, then BB. Exception for BB_ANTE: if the
   big blind cannot cover both, the **blind takes priority** over the ante.
   A player who cannot cover a forced bet posts all they have and is all-in.
2. **Blinds.** The SB seat posts `smallBlind`, the BB seat posts `bigBlind`
   (or all they have). The preflop current bet is the **full nominal big
   blind** even if the BB is all-in for less; the initial minimum raise
   increment is the big blind.
3. **Heads-up** is expressed by the table engine passing
   `smallBlindSeat = buttonSeat`; the generic action-order rules below then
   give the button first action preflop and last action postflop.
4. **Action order.** Preflop: first seat after the BB that can act. Postflop:
   first seat after the button (dead or not) that can act. A player can act if
   not folded and not all-in.
5. **Legal actions.** FOLD is always legal for the acting player. CHECK iff
   contribution == current bet. CALL iff current bet > contribution (amount
   capped at stack; calling all of one's stack is an all-in call). BET iff
   current bet == 0: `minTo = min(bigBlind, stack)` (a bet smaller than the big
   blind is only possible as all-in), `maxTo = contribution + stack`. RAISE iff
   current bet > 0, the player has more chips than needed to call, and raising
   is **open** to them (rule 6): `minTo = currentBet + minRaiseIncrement`
   (if the stack can't reach it, the only raise is all-in), `maxTo = all-in
   total`. ALL_IN is legal whenever the player has chips; it is classified as a
   call, bet or raise by amount. Amounts must be safe integers; out-of-range
   amounts are rejected with a code (never clamped silently).
6. **Incomplete raises (TDA).** A raise is *full* if its increment over the
   current bet is >= `minRaiseIncrement`; a full raise sets
   `minRaiseIncrement = increment` and re-opens raising for everyone. An all-in
   that raises by less than a full raise does **not** re-open betting for
   players who already acted on this street: such a player may only call or
   fold, unless the cumulative increase since their last action
   (`currentBet - betLevelWhenTheyLastActed`) is itself >= the full raise size.
7. **Round completion.** A betting round ends when every player who can act has
   acted since the last full/incomplete raise and all non-all-in contributions
   equal the current bet. If at most one player can still act and that player
   has matched the current bet (or folded), betting is closed and remaining
   streets are dealt without action (run-out).
8. **Fold win.** When only one non-folded player remains, the hand goes to
   POT_DISTRIBUTION without dealing further cards; no hand is shown.
9. **Uncalled bets.** The portion of the highest contribution not matched by
   any other player is returned to its owner (`UNCALLED_BET_RETURNED`) before
   pots are awarded.
10. **Pots.** Built from total contributions (antes + blinds + bets) by
    contribution level. Folded players' chips stay in the pots they contributed
    to but folded players are never eligible. A layer whose contributors have
    all folded is merged into the next lower layer. Pot 0 is MAIN, others SIDE.
11. **Showdown reveal (TDA).** If any player was all-in and betting closed
    before the river action completed, all live hands are revealed. Otherwise
    the first to show is the last aggressor of the final betting round (or, if
    no bet on the river, the first live seat after the button); then clockwise
    each player reveals only if their hand can win or tie at least one pot they
    are eligible for against the hands already shown; otherwise they muck
    (cards stay private). Players who win a pot are always revealed.
12. **Awarding.** Pots are awarded from the last side pot down to the main pot.
    Each pot is split equally among the best hands among its eligible players.
13. **Odd chips (documented rule).** When a pot does not divide evenly, the
    remaining chips are given one at a time to the tied winners in clockwise
    order starting from the first seat after the button. Same input ⇒ same
    output; never random.
14. **Chip conservation.** Sum of stacks + pot is constant throughout the hand
    and equals the sum of starting stacks; asserted by `checkHandInvariants`.

Required tests (extensive): evaluator categories, wheel (A-2-3-4-5) and
broadway straights, steel wheel, flush vs straight, full house comparisons,
kickers at every category, board plays, exact ties, 7-card best-of selection
(compare against a brute-force 21-combination reference evaluator in tests);
2/3/many-player all-ins, side pots with folded contributors, tied side pots,
odd-chip splits, uncalled bets, incomplete raises, re-open by cumulative
incomplete raises, BB short all-in, SB short, BB-ante priority, heads-up order,
dead button/dead SB inputs, timeouts, illegal amounts (999999999, negative,
fractional, NaN), acting out of turn, acting after fold. Property-based
(fast-check): random legal action sequences never break invariants, no
duplicate cards, chips conserved, pot distribution equals pot, winners hold a
best hand among eligible, folded players never win.

---

## 4. `@jpb/table-engine`

One table as an **actor**: a pure reducer over a serializable `TableState`,
fed by `TableCommandEnvelope`s strictly in order (see `table.ts` in
shared-types). Wraps the poker engine across many hands.

```ts
createTableState(input: {
  tableId; tournamentId; tableNumber; maxSeats; timing: TableTimingState;
  blinds: CurrentBlinds; initialButtonSeat: SeatIndex | null; createdAt: EpochMs;
}): TableState

reduceTable(state: TableState, envelope: TableCommandEnvelope, ctx: TableContext): TableTransition
interface TableContext { deckFor(handNumber: number): CardCode[] }   // from fairness-engine
interface TableTransition {
  state: TableState; events: TableEvent[]; timers: TableTimerRequest[];
  reply: CommandReply | null;          // for PLAYER_ACTION and admin commands
}
playerView(state, playerId, now): PlayerTableView | null
spectatorView(state, now): SpectatorTableView
adminView(state, now, opts: { includeHoleCards: boolean }): AdminTableView
checkTableInvariants(state): string[]
handFairnessRecord(state, ...)        // data needed by fairness verification for the last hand
```

Rules (normative):

- **Determinism.** `handId = "{tableId}:{handNumber}"`. Same initial state +
  same envelopes (+ same deck provider) ⇒ identical states and events. Every
  accepted command increments `version`; every emitted event gets the next
  gap-free `seq`.
- **Idempotency.** A `PLAYER_ACTION` whose `actionId` was already processed
  returns the original reply with `duplicate: true` and changes nothing.
  Remember at least the last 512 action ids (persisted in state).
- **Turn validation.** Reject when: table frozen, no hand, not the acting
  player, `tableStateVersion` !== current `turnVersion` (STALE_STATE_VERSION),
  `envelope.at > actionDeadline + actionGraceMs` (ACTION_DEADLINE_PASSED), or
  the poker engine rejects the intent.
- **Timers.** On every `ACTION_REQUESTED` the reducer requests an
  `ACTION_TIMEOUT` timer at `deadline + grace` with a fresh token. A
  `TIMER_FIRED` with a stale token is ignored. On timeout it applies
  `timeoutIntent` (CHECK if legal, else FOLD) with `timeout: true` and
  increments `consecutiveTimeouts`; a voluntary action resets it. A player is
  *away* when disconnected or `consecutiveTimeouts >= awayAfterTimeouts`; away
  players get `awayActionTimerMs`.
- **Freeze.** FREEZE stores the remaining action time and ignores timers;
  UNFREEZE sets a new deadline = now + remaining and a new timer token.
- **Dead-button blinds (TDA).** Track the seats that had the BB and SB last
  hand. Next hand: BB = first seat clockwise after last hand's BB occupied by
  a player to be dealt in; SB position = last hand's BB seat (posted only if
  that seat still holds a dealt-in player, otherwise dead SB = none); button =
  last hand's SB position (may be empty = dead button). **Heads-up** (exactly
  two dealt in): BB chosen as above, the other player is button and posts SB.
  First hand at a table: button = `initialButtonSeat` (or the first occupied
  seat), SB = next occupied seat, BB = next occupied after SB (heads-up:
  button = SB). These rules guarantee nobody posts the BB twice in a row
  unless only that is possible.
- **Seating/removal.** SEAT_PLAYER during a hand marks the player
  `waitingForNextHand`. REMOVE_PLAYER during a hand in which the player is
  dealt in sets `pendingRemoval`, applied right after HAND_COMPLETED (moves
  never happen mid-action). Removal emits PLAYER_REMOVED carrying the exact
  stack (the director uses it to seat the player elsewhere).
- **After each hand:** emit HAND_RESULT; remove busted players
  (reason ELIMINATED) and pending removals; apply scheduled blinds; update
  position stats. Then: if holds exist or hand-for-hand mode is on → HELD
  (hand-for-hand adds hold `HAND_FOR_HAND` automatically); else if ≥2 players →
  BETWEEN_HANDS with NEXT_HAND at `now + betweenHandsDelayMs (+ showdownDelayMs
  if there was a showdown)`; else WAITING.
- **Holds** take effect between hands; a hand in progress always completes.
  RELEASE of the last hold schedules NEXT_HAND.
- **SET_BLINDS** is applied at the start of the next hand, never mid-hand.
- **ADMIN_ADJUST_STACK** only between hands; emits STACK_ADJUSTED.
- **Invariants** (`checkTableInvariants`): no duplicate players/seats, stacks
  non-negative integers, at most one acting seat, acting player is in the hand
  and not folded/all-in, chips at table (stacks + pot) == chips at hand start
  during a hand, deadline set iff a player is acting.
- **Views** never leak another player's hole cards; spectators never see any
  hole cards except those revealed at showdown.

---

## 5. `@jpb/seating-engine`

Deterministic seating mathematics. Pure functions over plain data.

```ts
computeTableCount(activePlayers: number, cfg: TableSizeConfig, consolidateBy: 'TARGET' | 'MAX'): number
  // active <= finalTableSize -> 1; else max(2, ceil(active / (TARGET ? targetSize : maxSize)))
distributeSizes(totalPlayers: number, tableCount: number, maxSize: number): number[]
  // balanced (max-min <= 1), descending; throws if impossible
spreadSeats(playerCount: number, maxSeats: number): SeatIndex[]   // evenly spaced, deterministic
initialSeating(input: { playerIds: PlayerId[]; cfg: TableSizeConfig; consolidateBy; rng: RandomSource }): {
  tables: Array<{ tableNumber: number; maxSeats: number; seats: Array<{ seat; playerId }>; buttonSeat: SeatIndex }>;
}
  // playerIds are first sorted (deterministic), then permuted with Fisher–Yates using rng
predictBigBlindOrder(table: TableSummary): SeatIndex[]       // seats in the order they will post the BB
handsUntilBigBlind(table: TableSummary, seat: SeatIndex): number   // for occupied or hypothetical seat
chooseSeatForIncoming(table: TableSummary, player: { playerId; stats: SeatPositionStats }, weights): {
  seat: SeatIndex; score: number; breakdown: Record<string, number>;
}
```

`chooseSeatForIncoming` documented formula (lower is better):

```
expectedHandsUntilBB = max(0, (expected orbit) - handsSinceBigBlind)
seatScore(seat) =
    W.blindFairness * |handsUntilBigBlind(table+seat) - expectedHandsUntilBB|
  + W.position      * skipPenalty(seat)      // 1 if seat lies strictly between next button and next SB (would skip blinds), else 0
  + W.seatCompatibility * adjacencyPenalty   // prefer seats with an empty neighbour (spread), 0..1
tie-break: lowest seat index
```

---

## 6. `@jpb/balancing-engine`

Deterministic balancing/breaking/consolidation over `TableSummary` data.

```ts
class TableCountIndex  // O(1) min/max table size lookup; add/update/remove tables
planBalance(input: {
  tables: TableSummary[]; tableCfg: TableSizeConfig; balancing: BalancingConfig;
  activePlayers: number; finalTableFormed: boolean;
}): BalancePlan
selectTableToBreak(tables: TableSummary[]): TableId     // fewest players, then highest tableNumber
selectPlayerToMove(source: TableSummary, cfg: BalancingConfig): { playerId; score; breakdown }
planFinalTable(input: { players: Array<{ playerId; stack }>; maxSeats: number; rng: RandomSource }): {
  seats: Array<{ playerId; seat }>; buttonSeat: SeatIndex;
}
type BalancePlan = {
  targetTableCount: number;
  actions: Array<
    | { type: 'FORM_FINAL_TABLE' }
    | { type: 'BREAK_TABLE'; tableId: TableId }
    | { type: 'MOVE'; reason: 'BALANCE' | 'TABLE_BREAK'; playerId; fromTableId; toTableId; toSeat; breakdown: Record<string, number> }
  >;
}
```

Algorithm (normative):

1. If `activePlayers <= finalTableSize` and more than one table → FORM_FINAL_TABLE.
2. Else if current tables > `computeTableCount(...)` → BREAK_TABLE for
   `selectTableToBreak`, and MOVE each of its players (ordered by
   `predictBigBlindOrder`) to the destination with the fewest players (ties →
   lowest tableNumber), seat via `chooseSeatForIncoming`.
3. Else while `max - min > maxImbalance`: move one player from the largest
   table (ties → lowest tableNumber) to the smallest (ties → lowest
   tableNumber).
4. Player to move (`selectPlayerToMove`), lower score moves first:
   ```
   movementScore =
       W.position    * handsUntilBigBlind(source, seat)        // TDA: the player due the BB next moves
     + W.recentMove  * movesWithinWindow(player)               // recent-move protection
     + W.recentMove  * (handsSinceLastMove < window ? (window - handsSinceLastMove) / window : 0)
   tie-break: lowest seat index, then playerId
   ```
   The breakdown of every term is returned and stored with the movement.
5. Never produces a destination above `maxSize`, never moves a player twice in
   one plan, and is idempotent (re-planning on the post-plan state yields no
   actions).

Must handle 125,000 tables efficiently (no O(T²); per-hand incremental use via
`TableCountIndex`).

---

## 7. `@jpb/tournament-engine` — **Johnny, the Tournament Director**

Johnny is a deterministic rules engine (NOT AI). A pure reducer:

```ts
createDirectorState(input: { tournamentId; config: TournamentConfig; createdAt; serverSeedHash }): DirectorState
directorReduce(state: DirectorState, input: DirectorInput, ctx: DirectorContext): DirectorTransition
interface DirectorContext { now: EpochMs; drawSource(purpose: string): RandomSource }
interface DirectorTransition {
  state: DirectorState;
  effects: DirectorEffect[];         // commands for table actors, notifications, timers
  events: TournamentEvent[];         // broadcast to clients (envelopes are added by the host)
  reply: { ok: boolean; code: string | null; message: string | null } | null;
}
```

Inputs cover: registration (open/close/register/approve/withdraw/late
registration/re-entry), START, TICK (clock), every table report (HAND_RESULT,
PLAYER_REMOVED, PLAYER_SEATED, TABLE_STATUS_CHANGED), and every admin override
(pause-after-hand, resume, emergency freeze/unfreeze, advance/set level, add
time, start/end break, move player, rebalance, break table, suspend/restore,
disqualify, adjust stack, hand-for-hand toggle, announce, cancel, edit future
levels/timing).

Effects: `CREATE_TABLE`, `TABLE_COMMAND {tableId, command}`, `CLOSE_TABLE`,
`NOTIFY_PLAYER {playerId, notice}`, `SCHEDULE_TICK {at}`, `INTEGRITY_ALERT`.

Rules (normative):

- Tournament status changes only via `TOURNAMENT_TRANSITIONS`; illegal
  transitions are rejected with a code.
- Deterministic ids: tables `"{tournamentId}:T{tableNumber}"`, moves
  `"{tournamentId}:M{seq}"`, elimination batches `"{tournamentId}:B{seq}"`.
- **Start:** sort registered entries, compute table count, `initialSeating`
  with `drawSource('seating')`; buttons from `drawSource('button:{tableId}')`.
  If entrants <= finalTableSize, go straight to FINAL_TABLE.
- **Blind clock:** levels advance at `levelEndsAt` (via TICK); the new level is
  sent to tables with SET_BLINDS and applies from each table's next hand —
  hands are never interrupted. Pause preserves remaining level time.
- **Breaks:** at the end of a level that matches a BreakRule, HOLD(BREAK) all
  tables; break time runs from the scheduled moment; at `breakEndsAt`, start
  the next level and RELEASE(BREAK).
- **Pause** = HOLD(PAUSE) on all tables (current hands finish). **Emergency
  freeze** = FREEZE all tables immediately (state preserved, timers suspended).
- **After every HAND_RESULT:** update the table summary, process eliminations,
  then run the balancing planner and emit the resulting moves/breaks/final table
  formation. Moves: REMOVE_PLAYER(reason MOVED) to the source; when the source
  reports PLAYER_REMOVED with the exact stack, SEAT_PLAYER at the reserved
  destination seat, then NOTIFY_PLAYER(TABLE_MOVE).
- **Final table:** HOLD(FINAL_TABLE) every table; when every table is HELD,
  remove all players, create the final table, seat with `planFinalTable`
  (seat draw via `drawSource('final-table')`), RELEASE, emit FINAL_TABLE_FORMED.
- **Eliminations & ranking:** busts in the same hand form one batch; in
  hand-for-hand mode, all busts in the same hand-for-hand round form one batch.
  Within a batch, the player who started the hand with more chips finishes
  higher; equal starting stacks share the finish position (`tiedCount`) and
  split the combined prizes for the covered positions equally — leftover minor
  units go one each to the tied players in ascending registration order.
  Batches are ranked in processing order (later batches finish higher).
  The last remaining player is 1st and the tournament COMPLETES.
- **Hand-for-hand** (auto at the bubble when enabled, or by admin): every
  table holds after each hand; when all tables have completed their hand, all
  are released together.
- **Prizes** come only from the fixed prize structure (locked at start). Chips
  are never money. No wallet/balance/transfer concepts exist in the engine.
- **Chip conservation:** `totalChips = Σ startingStack per entry + Σ explicit
  adjustments − chips removed by disqualification`. After every HAND_RESULT
  the director checks Σ reported table chips + chips in transit == totalChips;
  violation → INTEGRITY_ALERT(CRITICAL) + HOLD(INTEGRITY) on affected tables.
- **Milestones/commentary** use fixed templates only (e.g. "{N} players
  remain", "Final table reached", "{PLAYER} has been eliminated in {POS}").
- **Scale:** per-input work is O(affected tables), never O(all players);
  counters are maintained incrementally.

---

## 8. Runtime (services/game-server) — summary

Detailed in `docs/ARCHITECTURE.md` once built. The host:

- persists every table command envelope and director input (command log) plus
  periodic snapshots in PostgreSQL inside one transaction per command;
- replays snapshot + log through the same pure reducers on recovery;
- owns timers (re-derived from state after recovery);
- routes commands to the single owner of each table (actor), using a lease
  when running multiple nodes;
- serializes per-audience views (player / spectator / admin) — the only place
  where private data is filtered.
