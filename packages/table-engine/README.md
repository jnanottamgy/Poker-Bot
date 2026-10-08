# @jpb/table-engine

One poker table as an **actor**: a pure, deterministic reducer over a plain-JSON
`TableState`, fed `TableCommandEnvelope`s strictly in order (CONTRACTS.md §4).
It wraps `@jpb/poker-engine` across many hands and adds everything a table
needs around a hand: seats, dead-button blinds, timers, holds, freezes,
idempotent actions, versioning, per-audience views, hand history and fairness
records. No AI, no `Math.random()`, no wall clock.

```ts
import { createTable, reduceTable, playerView, checkTableInvariants } from '@jpb/table-engine';

let { state, events } = createTable({ tableId, tournamentId, tableNumber, maxSeats, timing, blinds, initialButtonSeat, createdAt });
const ctx = { deckFor: createDeckProvider({ serverSeed, tournamentId, tableId, publicEntropy }) }; // @jpb/fairness-engine
const t = reduceTable(state, { commandId, tableId, at: Date.now() /* host clock, logged */, command }, ctx);
// persist envelope + t.state, schedule t.timers, publish t.events (filtered per audience), answer with t.reply
```

## Modules

| File | Purpose |
| --- | --- |
| `types.ts` | `TableState`, `TurnState`, `HandMeta`, `HandHistoryRecord`, `TableContext`, `TableTransition` |
| `constants.ts` | capacities and limits (`RECENT_ACTION_CAPACITY = 512`, …) |
| `create.ts` | `createTableState`, `createTable` (+ TABLE_CREATED) |
| `reduce.ts` | `reduceTable`: envelope validation, idempotency, dispatch, versioning |
| `commands/seating.ts` | SEAT_PLAYER, REMOVE_PLAYER, PLAYER_CONNECTION, ADMIN_ADJUST_STACK |
| `commands/control.ts` | SET_BLINDS, SET_TIMING, HOLD, RELEASE, SET_HAND_FOR_HAND, FREEZE, UNFREEZE, ADMIN_FORCE_TIMEOUT, ADMIN_ADD_TIME, START, CLOSE |
| `commands/play.ts` | PLAYER_ACTION, TIMER_FIRED |
| `lifecycle.ts` | dealing, turns/timers, end-of-hand processing, idle status (`settle`) |
| `positions.ts` | dead-button blind positions (`computePositions`) |
| `draft.ts` | copy-on-write working copy, event emission (gap-free seq), status announcements, timer tokens |
| `queries.ts` | read-only helpers (`handInProgress`, `eligibleSeats`, `isAway`, `canDeal`, `chipsAtTable`, …) |
| `views.ts` | `playerView`, `spectatorView`, `adminView` |
| `history.ts` | `lastHandHistory`, `handFairnessRecord`, hand summaries |
| `invariants.ts` | `checkTableInvariants` |
| `validate.ts` | structural validation of untrusted command payloads |

## Public API

- `createTableState(input): TableState` — empty table, `WAITING`, `version 0`,
  `nextEventSeq 1`. Throws `RangeError` on invalid host input (maxSeats ∉ [2, 10],
  bad timing/blinds, bad initial button…).
- `createTable(input): { state, events }` — the same plus the `TABLE_CREATED`
  event (seq 1, version 0); `state.nextEventSeq` is then 2.
- `reduceTable(state, envelope, ctx): { state, events, timers, reply }`.
- `playerView(state, playerId, now)`, `spectatorView(state, now)`,
  `adminView(state, now, { includeHoleCards })`.
- `checkTableInvariants(state): string[]` (empty when healthy; never throws).
- `lastHandHistory(state): HandHistoryRecord | null` — deep copy of the last completed hand.
- `handFairnessRecord(state, { publicEntropy, serverSeedHash }, history?)` —
  `HandFairnessRecord` of the last completed hand (or of a stored history record).
- Helpers: `computePositions`, `nextHandPositions`, `eligibleSeats`, `canDeal`,
  `handInProgress`, `isAway`, `chipsAtTable`, `participantAfter/Before`.

## Reducer contract

- **Purity.** The input state is never mutated (the tests deep-freeze every input
  state). Copy-on-write: the top level, seat occupants and small records are
  copied; large values (hand state, history, recent actions) are shared and only
  ever replaced. Time is `envelope.at`, clamped so the table clock never goes
  backwards: `now = max(envelope.at, state.clock)`.
- **Accepted command** ⇒ `version + 1`; every emitted event carries the next
  gap-free `seq`, the new `version`, `at = now`, `tableId`, `tournamentId`,
  `visibility` (`HOLE_CARDS_DEALT` is `PRIVATE` with `privateTo = playerId`;
  everything else `PUBLIC`).
- **Rejected command** ⇒ the state is returned unchanged (same object), no
  events, `reply = { ok: false, code, message, duplicate: false }`. Exception: a
  rejected `PLAYER_ACTION` is still remembered for idempotency (only
  `recentActions` changes; `version` does not).
- **TIMER_FIRED** ⇒ `reply: null`. A stale token, a frozen or closed table: the
  state is returned unchanged. A timer delivered before it is due: unchanged
  state and the same timer is requested again.
- **Never throws on bad input**: malformed envelopes/commands get
  `INVALID_COMMAND`. Throws only on internal bugs (e.g. chip conservation broken
  at hand end, a hand seat no longer holding its player). A deck provider that
  throws or returns something other than the 52 distinct cards is a host
  problem: `INTEGRITY_VIOLATION` event + `HOLD(INTEGRITY)`; the hand number is not
  consumed and the deal is retried after `RELEASE(INTEGRITY)`.
- **Determinism.** `handId = "{tableId}:{handNumber}"`; timer tokens are
  `"{tableId}/A/{n}"` (action) and `"{tableId}/N/{n}"` (next hand) from a
  counter in the state. Same initial state + same envelopes + same deck
  provider ⇒ identical states and events (tested over 250+ hands, also from a
  JSON snapshot taken mid-run).

## State (`TableState`, plain JSON)

`seats` (`SeatOccupant | null` per seat), `status`, `started`, `holds` (unique,
in placement order), `frozen` (`since`, `turnRemainingMs`,
`nextHandRemainingMs`), `timing`, `blinds`, `pendingBlinds`, `handForHand`,
`handNumber` (last dealt), `hand` (the poker-engine `HandState` in progress, or
the last completed one until the next deal), `handMeta` (start time, deck hash,
blinds, SB position, starting chips, names), `buttonSeat` /
`lastSmallBlindSeat` (POSITION, even if dead) / `lastBigBlindSeat` of the last
dealt hand, `turn` (`seat`, `playerId`, `turnVersion`, `requestedAt`, `deadline`,
`timerMs`, `graceMs`, `timerToken`, `away`, `addedMs`), `nextHand` (`dueAt`,
`token`), `timerSeq`, `version`, `nextEventSeq`, `clock`, `recentActions`
(≤ 512 `{playerId, actionId, reply}`, oldest first; idempotency is scoped per player), `lastProgressAt`, `counters`
(hands played, largest pot, total pot chips, showdowns, timeouts, hand
duration, seated/removed/eliminated), `lastHand` (full history record),
`recentHands` (≤ 20 summaries).

During a hand a dealt-in occupant's `stack` stays at its **starting** stack;
live stacks are in `hand.players` (views show live stacks). Stacks are synced
when the hand completes.

## Commands

| Command | Rule | Rejections |
| --- | --- | --- |
| `SEAT_PLAYER` | Seat must be free, player not already here, `stack ≥ 1`, valid stats. During a hand the player is `waitingForNextHand`. `connected` defaults to `true`. Emits `PLAYER_SEATED`. May move WAITING → BETWEEN_HANDS. | `SEAT_UNAVAILABLE`, `PLAYER_ALREADY_SEATED`, `INVALID_COMMAND` |
| `REMOVE_PLAYER` | Dealt into the hand in progress (even folded) → `pendingRemoval` (a later REMOVE replaces it), applied right after the hand. Otherwise immediate. `PLAYER_REMOVED` carries the exact stack and the position stats. | `PLAYER_NOT_SEATED`, `INVALID_COMMAND` |
| `SET_BLINDS` | During a hand → `pendingBlinds`, applied when it completes; otherwise replaces `blinds` (used by the next deal). Emits `BLINDS_SCHEDULED`. Never changes a running hand. | `INVALID_COMMAND` |
| `SET_TIMING` | Applies to turns and NEXT_HAND timers created afterwards; a running turn keeps its deadline and grace. | `INVALID_COMMAND` |
| `HOLD` / `RELEASE` | Holds take effect between hands; a hand in progress completes. Releasing the last hold schedules NEXT_HAND (`betweenHandsDelayMs`). Duplicates are accepted no-ops. | `INVALID_COMMAND` |
| `SET_HAND_FOR_HAND` | On: adds `HAND_FOR_HAND` after every hand (at once if no hand is running). Off: also lifts that hold. | `INVALID_COMMAND` |
| `FREEZE` / `UNFREEZE` | See *Freeze*. Idempotent. | — |
| `PLAYER_ACTION` | See *Actions*. | see below |
| `TIMER_FIRED` | See *Timers*. | (ignored, reply null) |
| `PLAYER_CONNECTION` | Sets `connected`; a reconnect resets `consecutiveTimeouts`. Emits `PLAYER_CONNECTION_CHANGED` when it changes. | `PLAYER_NOT_SEATED` |
| `ADMIN_FORCE_TIMEOUT` | Applies the timeout action to the acting player now (counts as a timeout). | `TABLE_FROZEN`, `NO_ACTIVE_HAND` |
| `ADMIN_ADD_TIME {ms}` | `deadline = max(deadline, now) + ms`, fresh token, `ACTION_REQUESTED` re-emitted with the **same** `turnVersion`. While frozen, added to the preserved time. `1 ≤ ms ≤ 3,600,000`. | `NO_ACTIVE_HAND`, `INVALID_COMMAND` |
| `ADMIN_ADJUST_STACK` | Between hands only, `newStack ≥ 1` (remove a player with REMOVE_PLAYER). Emits `STACK_ADJUSTED {before, after}`. | `HAND_IN_PROGRESS`, `PLAYER_NOT_SEATED`, `INVALID_COMMAND` |
| `START` | The table may deal. Deals the first hand **immediately** when possible; otherwise WAITING/HELD (or a zero-delay NEXT_HAND kept while frozen). Repeated START is an accepted no-op. | — |
| `CLOSE` | Terminal. Only between hands. Seats are kept as the final snapshot (the director removes players first when breaking a table). Every later command → `TABLE_CLOSED` (duplicate action ids are still answered); timers are ignored. | `HAND_IN_PROGRESS` |

Any command on a CLOSED table → `TABLE_CLOSED`.

### Actions (`PLAYER_ACTION`)

1. Same `(playerId, actionId)` already processed (accepted **or rejected**, among the last
   512) → the original reply with `duplicate: true`; nothing changes. Checked
   before anything else, even on a closed table.
2. Rejection order: `INVALID_COMMAND` (empty actionId/playerId, not remembered)
   → `TABLE_CLOSED` → `PLAYER_NOT_SEATED` → `TABLE_FROZEN` → `NO_ACTIVE_HAND` →
   `PLAYER_NOT_IN_HAND` / `PLAYER_FOLDED` / `PLAYER_ALL_IN` / `NOT_YOUR_TURN` →
   `STALE_STATE_VERSION` (`tableStateVersion !== turn.turnVersion`) →
   `ACTION_DEADLINE_PASSED` (`now > deadline + graceMs`) → poker-engine codes
   (`CHECK_NOT_ALLOWED`, `AMOUNT_BELOW_MINIMUM`, `UNKNOWN_ACTION`, …).
3. On success `consecutiveTimeouts = 0` and the hand runs forward
   (`applyAction`), possibly to completion.

`turnVersion` is the table `version` of the command that requested the
decision (unique per turn; unchanged by UNFREEZE / ADMIN_ADD_TIME).

### Turns and timers

Every poker-engine `TURN_TO_ACT` becomes `ACTION_REQUESTED {seat, playerId,
legal, deadline, timerMs, turnVersion}` (TURN_TO_ACT itself is never emitted):

```
away     = !connected || consecutiveTimeouts >= awayAfterTimeouts
timerMs  = away ? awayActionTimerMs : actionTimerMs        (fixed when the turn starts)
deadline = now + timerMs
timer    = ACTION_TIMEOUT at deadline + actionGraceMs, fresh token
```

The grace is pinned in the turn (`graceMs`). An action is accepted while
`now ≤ deadline + graceMs` (boundary inclusive). `TIMER_FIRED(ACTION_TIMEOUT)`
with the current token at/after the due time applies `timeoutIntent` (CHECK if
legal, else FOLD) with `timeout: true`, `consecutiveTimeouts + 1`.
A different token is stale → ignored. A voluntary action resets the counter;
so does a reconnect.

### Freeze

`FREEZE` stores `turnRemainingMs = max(0, deadline − now)` and
`nextHandRemainingMs = max(0, dueAt − now)`; while frozen, actions and
`ADMIN_FORCE_TIMEOUT` get `TABLE_FROZEN`, every timer is ignored and no hand is
dealt. `UNFREEZE`: `deadline = now + turnRemainingMs` with a new token (and
`ACTION_REQUESTED` re-emitted with the same turnVersion), pending NEXT_HAND at
`now + nextHandRemainingMs` with a new token. Seating, removal, holds, blinds and
timing commands still work while frozen.

### Status (normative order, recomputed after every change while no hand runs)

```
CLOSED stays CLOSED
hand in progress                  -> IN_HAND
any hold                          -> HELD           (pending NEXT_HAND cancelled)
not started or < 2 eligible       -> WAITING        (pending NEXT_HAND cancelled)
otherwise                         -> BETWEEN_HANDS  (NEXT_HAND scheduled if none pending)
```

`TABLE_STATUS_CHANGED {status, holds, frozen}` is emitted when that triple
changes: once just before a deal (IN_HAND, before HAND_STARTED) and once at the
end of the command.

## Dead-button blind positions (TDA, CONTRACTS §4)

Participants = seated players with chips and no pending removal, ascending.
"After s" = strictly clockwise after s, wrapping.

- **Previous hand known**: BB = first participant after the last BB seat; SB
  POSITION = the last BB seat (posted only if a participant sits there, else
  **dead small blind**); button = the last SB POSITION (may be empty: **dead
  button**).
- **Heads-up** (exactly two participants): BB as above; the other player is the
  button and posts the small blind (acts first preflop, last postflop).
- **First hand**: button = `initialButtonSeat` (or the lowest occupied seat);
  SB = next participant; BB = the one after. Heads-up: SB = button = the button
  seat if occupied, else the next participant; BB = the other.

The previous BB seat is reached last when searching for the next BB, so nobody
posts the big blind twice in a row while two or more players are dealt in
(property-tested). These rules are mirrored literally by
`@jpb/seating-engine.positionsForNextHand` (agreement is property-tested), which
the balancer uses to predict BB order.

## After every hand (normative order)

1. Chip conservation check (Σ final stacks = Σ starting stacks, else throw).
2. Sync stacks; update position stats of every dealt-in player:
   `handsDealtAtTable + 1`, `handsPlayedTotal + 1`, `handsSinceBigBlind = 0` if
   they were the BB else `+ 1`, `handsSinceSmallBlind = 0` if they posted the SB
   else `+ 1`.
3. Record `lastHand` (history) and the summary; update counters.
4. Emit `HAND_RESULT` (HandResultReport, below).
5. In seat order: remove busted players (`ELIMINATED`, even if a removal was
   pending) and pending removals (their reason and moveId), each with
   `PLAYER_REMOVED {stack, stats}`; clear `waitingForNextHand`.
6. Apply `pendingBlinds`.
7. Hand-for-hand → add hold `HAND_FOR_HAND`.
8. Status: HELD / WAITING / BETWEEN_HANDS with NEXT_HAND at
   `now + betweenHandsDelayMs (+ showdownDelayMs after a showdown)`.

`HAND_RESULT`: `tableId, handId, handNumber, completedAt, buttonSeat,
smallBlindSeat (posted, null = dead), bigBlindSeat, smallBlindPosition,
startedAt, showdown, players [{playerId, seat, startingStack, finalStack,
stats}], busted [{playerId, seat, startingStack}], largestPot (= the hand's
total awarded pot, uncalled chips excluded), totalChipsAtTable (all seated
stacks after distribution, before removals)`.

## Views

- **Player**: public table + own hole cards + `legal` (only on their own turn and
  not frozen). Never another player's cards unless revealed at showdown.
- **Spectator**: public table; hole cards only as `shownCards` revealed at
  showdown (mucked hands and fold wins show nothing).
- **Admin**: public table + `seatDetails` (full occupants, live stacks), timing,
  hand-for-hand, pending blinds, last progress, hands played, and the optional
  admin detail fields: `started`, `nextHandAt`, `freeze`, `turn` (deadline, hard
  deadline, timer, away, added time), `positions` (last and **next** hand's
  button/SB/BB), `counters`, `handActionLog`, `handDeckHash`, `recentHands`,
  `clock`. Every hole card of the displayed hand only with `includeHoleCards`
  (`VIEW_HOLE_CARDS`).

The displayed hand is the hand in progress, or the last completed hand until
the next deal (board, pots and showdown stay visible between hands). Views are
fresh objects: mutating a view never affects the state.

## Hand history and fairness

`HandHistoryRecord` (`format "JPB-HAND-HISTORY"`, version 1): ids, table number,
start/complete times, button / SB (posted) / SB position / BB, heads-up flag,
blinds, `deckHash = sha256Hex(deck.join(''))`, dealing order, players (names,
starting/final stacks, hole cards, folded, won, uncalled returned, shown cards,
busted), board, burns, the full poker-engine action log (forced bets and every
action with intent/resolution/timeout flag), win type, uncalled bet, pots with
winners (award order), reveals, total pot, busted list. It contains every hole
card: persist it, never broadcast it.

`handFairnessRecord` builds the CONTRACTS §2 `HandFairnessRecord` from what was
actually dealt (dealing order = first seat clockwise after the button). With
the fairness-engine deck provider it verifies with `verifyHand` (tested).
Redact with `redactHandFairnessRecord` before publication.

## Invariants (`checkTableInvariants`)

No duplicate players; `seats.length = maxSeats`; occupant stacks are positive
integers (busted players are removed); stats valid; `waitingForNextHand` and
`pendingRemoval` only during a hand (pending only for dealt-in players; every
seated player is either dealt in or waiting); holds unique and known; status
consistent with hand/holds/NEXT_HAND; freeze bookkeeping consistent;
`pendingBlinds` only during a hand; valid blinds/timing; poker-engine
invariants of the hand; during a hand Σ stacks + pot = chips at hand start and
each dealt-in seat stack = the hand's starting stack; a turn exists iff a seat
is acting, matches it, and that player is live and not all-in; valid
deadline/grace/turnVersion; bounded unique recent actions; positions recorded
once a hand was dealt; counters consistent.

## Tests

`npx vitest run packages/table-engine` (≈100 tests, ~7 s):

- `positions.test.ts` — pure rules, seat-by-seat dead-button scenarios through
  the reducer (bust in BB / SB / on the button, two busts in one hand, arrival
  right after the BB, arrival between button and SB, 3-handed → heads-up from
  each position, heads-up → 3-handed both ways, removal of the player due the
  BB), property "nobody posts the BB twice in a row" under random churn, and
  agreement with `@jpb/seating-engine` on 2,000 random states.
- `hands.test.ts` — full hands with rigged decks: event order, privacy flags,
  ACTION_REQUESTED/timer math, HAND_RESULT, stats, heads-up order, immediate
  completion, busts, hand history, fairness record verified by
  `@jpb/fairness-engine.verifyHand` (and tampering detected), antes.
- `timers.test.ts` — check-or-fold timeouts, stale/premature tokens, away timer
  after N timeouts / on disconnect, reconnect reset, deadline + grace boundary,
  force timeout, add time, SET_TIMING pinning, freeze/unfreeze of turns and
  NEXT_HAND, START while frozen.
- `idempotency.test.ts` — duplicates (accepted and rejected), 512-entry FIFO,
  stale `tableStateVersion`, illegal inputs, versioning, envelope validation,
  clock clamping.
- `lifecycle.test.ts` — creation, seating validation, START, removal (pending
  with exact stack, busted + pending, waiting players), holds, hand-for-hand,
  SET_BLINDS timing, stack adjustment, CLOSE, integrity holds, status events.
- `views.test.ts` — player/spectator/admin content, showdown reveals vs mucks,
  fold wins, live stacks, no aliasing, privacy property.
- `invariants.test.ts` — corruption detection.
- `replay.property.test.ts` — 250 hands of seeded random play (legal and illegal
  actions, timeouts, forced timeouts, added time, disconnects, seat changes,
  busts, blind and timing changes, holds, hand-for-hand, freezes, stale /
  duplicate / late commands) replayed from the initial state and from a JSON
  snapshot to the identical state and event stream; gap-free seqs; public
  events never leak unrevealed hole cards; a fast-check property over random
  tables (2–10 seats) checking invariants after every command, chip accounting,
  view privacy and replay. The test harness deep-freezes every input state by default (proving the reducer never mutates its input).

## Contract notes

Clarifications of CONTRACTS §4 (and additive shared-types changes):

1. **turnVersion** = the table version of the command that requested the
   decision. UNFREEZE and ADMIN_ADD_TIME keep it (same decision, new deadline).
   `tableStateVersion: null` (internal callers only; the wire protocol always
   sends a number) skips the version check.
2. **Version** counts accepted commands, including accepted no-ops (repeated
   HOLD, FREEZE when frozen, …). Rejected commands and ignored timers do not
   change it. A rejected PLAYER_ACTION is still remembered in `recentActions`
   so a retry of the same actionId gets the same answer.
3. **Clock**: `now = max(envelope.at, state.clock)`; the deadline check uses this
   clamped envelope time.
4. **Premature timers** (delivered before due) are not applied; the reducer
   re-requests them (state unchanged).
5. **Away / timers**: the timer length is chosen when the turn starts; a
   disconnect mid-turn does not shorten it. A reconnect resets
   `consecutiveTimeouts`. ADMIN_FORCE_TIMEOUT counts as a timeout.
6. **Grace pinning**: `actionGraceMs` is captured per turn, so SET_TIMING never
   changes the cutoff of a running turn.
7. **START** deals the first hand immediately (countdowns belong to the
   director). Players seated after START trigger NEXT_HAND after
   `betweenHandsDelayMs` once two are present.
8. **SET_BLINDS between hands** replaces `blinds` immediately (the next deal uses
   them); during a hand it is pending until HAND_COMPLETED.
9. **SET_HAND_FOR_HAND(true) between hands** holds the table at once; disabling
   lifts the `HAND_FOR_HAND` hold.
10. **HOLD before START** keeps the table HELD after START.
11. **CLOSE** is rejected during a hand (`HAND_IN_PROGRESS`) and keeps seats as a
    final snapshot.
12. **ADMIN_ADJUST_STACK** requires `newStack ≥ 1`.
13. **REMOVE_PLAYER** of a dealt-in player who already folded is still pending
    (moves never happen mid-hand); a bust overrides a pending removal (reason
    ELIMINATED, moveId null).
14. **HAND_RESULT.largestPot** is the hand's total awarded pot (uncalled chips
    excluded); `totalChipsAtTable` counts every seated player after distribution
    and before removals (players seated mid-hand included).
15. **Integrity**: a failing/invalid deck provider yields `INTEGRITY_VIOLATION`
    and `HOLD(INTEGRITY)` instead of an exception.
16. **Heads-up → 3-handed** when the newcomer sits between the previous button
    and BB: the literal rule (button = last SB position = the previous button,
    BB = first participant after the last BB) puts the button on the same seat
    as the BB for that one hand. Nobody posts the BB twice and the poker engine
    handles it (that player is dealt last and acts last in every round); the
    next hand is normal. Kept literal so `@jpb/seating-engine` predictions stay
    exact.
17. **Displayed hand**: `state.hand` keeps the completed hand until the next
    deal so views can show the board and showdown between hands.
18. **Shared-types additions** (all additive/optional): `TableCommand`
    `ADMIN_ADD_TIME {ms}` and `SEAT_PLAYER.connected?`; `PLAYER_REMOVED.stats?`;
    `HandResultReport.smallBlindPosition?`, `startedAt?`, `showdown?`,
    `players[].stats?`; reject codes `SEAT_UNAVAILABLE`, `PLAYER_ALREADY_SEATED`,
    `HAND_IN_PROGRESS`; `AdminTableView` optional detail fields (`started`,
    `nextHandAt`, `freeze`, `turn`, `positions`, `counters`, `handActionLog`,
    `handDeckHash`, `recentHands`, `clock`) with the new types `AdminFreezeView`,
    `AdminTurnView`, `AdminPositionsView`, `TableCounters`, `TableHandSummary`,
    `HandActionLogEntry`.

## Contract notes (orchestrator fixes after adversarial review)

- Idempotency is keyed by `(playerId, actionId)`: one player's actionId can
  never swallow another player's action.
- FREEZE stores both the time left to the visible deadline and the grace
  left beyond it; UNFREEZE restores exactly that hard cutoff, so a freeze
  never grants a fresh grace window.
- Re-arming a turn (UNFREEZE, ADMIN_ADD_TIME) keeps the grace pinned when the
  turn started; SET_TIMING only affects turns started afterwards.
