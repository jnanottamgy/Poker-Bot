# @jpb/poker-engine

A pure, deterministic No-Limit Texas Hold'em **hand** engine (CONTRACTS.md §3).
It knows nothing about tournaments, tables, timers, sockets or databases. No AI,
no `Math.random()`, no wall clock: every output is a function of the input.

```ts
import { createHand, applyAction, getLegalActions, timeoutIntent, checkHandInvariants } from '@jpb/poker-engine';

let { state, events } = createHand(input);          // posts forced bets, deals, runs to first decision
const legal = getLegalActions(state);               // for the acting seat (null when nobody acts)
const r = applyAction(state, legal.seat, { type: 'RAISE', amount: 300 });
if (r.ok) ({ state, events } = r); else console.log(r.code);   // HandRejection: never thrown
```

## Modules

| File | Purpose |
| --- | --- |
| `cards.ts` | card parsing helpers: `rankValue` (2..14), `suitOf`, `isCardCode`, `isFullDeck` |
| `evaluator.ts` | 5–7 card evaluator (`handScore`, `evaluateHand`, `compareHands`) |
| `describe.ts` | deterministic hand descriptions |
| `dealing.ts` | the normative dealing order (`dealPlan`, `dealFromDeck`) shared with fairness verification |
| `seats.ts` | clockwise ordering helpers |
| `pots.ts` | `buildPots` (layers, merging, dead money) and `findUncalled` |
| `distribution.ts` | `distributePots`, `splitPot` (odd-chip rule) |
| `legal.ts` | legal actions, raise re-opening, intent validation, round completion, `timeoutIntent` |
| `showdown.ts` | reveal order and muck rules |
| `hand.ts` | the state machine: `createHand`, `applyAction`, `currentPots` |
| `invariants.ts` | `checkHandInvariants` |

## Public API

- `createHand(input: CreateHandInput): HandTransition` — throws `RangeError` on an
  invalid configuration (caller bug): fewer than 2 seats, duplicate seats/players,
  non-positive or fractional stacks, seat out of `[0, maxSeats)`, BB not dealt in,
  SB not dealt in (unless `null`) or equal to BB, `bigBlind < 1`,
  `smallBlind ∉ [0, bigBlind]`, negative ante, unknown `anteType`, deck not a
  permutation of the 52 cards. The input is never mutated.
- `applyAction(state, seat, intent, opts?: { timeout?: boolean }): HandTransition | HandRejection`
- `getLegalActions(state): LegalActions | null`, `computeLegalActions(state, player)`
- `timeoutIntent(state)` — `CHECK` if legal, else `FOLD` (`CHECK_ELSE_FOLD`).
- `checkHandInvariants(state): string[]` — empty when healthy.
- `currentPots(state)` — pots for the chips currently in the pot (for views), plus the currently uncalled amount.
- `evaluateHand(cards)`, `handScore(cards)`, `compareHands(a, b)`, `categoryOfScore`, `scoreRanks`, `describeHand`.
- `buildPots(contribs, { deadMoney? })`, `findUncalled(contribs)`.
- `distributePots({ pots, scores, buttonSeat, maxSeats })`, `splitPot(amount, winners, buttonSeat, maxSeats)`.
- `dealPlan(seats, buttonSeat, maxSeats)`, `dealFromDeck(deck, seats, buttonSeat, maxSeats)`, `dealingSeatOrder`, `cardsNeeded`.
- `resolveShowdown`, `revealOrder`, `isRaiseOpen`, `isRoundComplete`, `needsToAct`, `canAct`, `livePlayers`, `isBettingPhase`.
- Types: `CreateHandInput`, `HandState`, `HandPlayerState`, `Pot`, `HandLogEntry`, `HandResult`, `AwardedPot`, `HandTransition`, `HandRejection`.

## Hand evaluation

### Algorithm

`handScore(cards)` accepts 5, 6 or 7 cards and makes one pass building:

- a 13-bit rank mask per suit (bit `i` = rank value `i + 2`), and
- four "rank seen at least k times" masks (k = 1..4).

Categories are then tested strongest-first with bit operations only (no lookup
tables, no allocation in the hot path):

1. **Straight flush** — a suit mask with ≥ 5 bits that contains a straight.
2. **Four of a kind** — `seen4 ≠ 0`; kicker = highest other rank.
3. **Full house** — highest exactly-three rank; pair = highest of the remaining
   trips/pairs (two trips → the lower trips plays as the pair).
4. **Flush** — top five ranks of the flush suit.
5. **Straight** — on the `seen1` mask.
6. **Three of a kind**, **two pair** (a third pair can be the kicker),
   **one pair**, **high card**.

Straight detection: `ext = (mask << 1) | aceBit` so bit `k` of `ext` represents
value `k + 1` (ace low = 1 … ace high = 14);
`runs = ext & ext>>1 & ext>>2 & ext>>3 & ext>>4`; the highest set bit `b` of
`runs` gives a straight with high card `b + 5`. A wheel (A-2-3-4-5) therefore
has high card 5; there is no wrap-around (Q-K-A-2-3 is not a straight).

Invalid codes, duplicate cards and wrong card counts throw `RangeError`
(duplicates are detected by suit-mask collisions at no extra cost). Measured
throughput is about 2.8 million 7-card `handScore` calls per second on the
development container; the test suite asserts a conservative floor of
200,000/s.

### Score encoding (stable)

```
score = categoryCode·2^20 + r1·2^16 + r2·2^12 + r3·2^8 + r4·2^4 + r5
```

`r1..r5` are rank values (2..14; 5 for a wheel's high card) in significance
order, zero-filled:

| Category | code | tie-break ranks |
| --- | --- | --- |
| HIGH_CARD | 0 | five ranks high→low |
| ONE_PAIR | 1 | pair, 3 kickers |
| TWO_PAIR | 2 | high pair, low pair, kicker |
| THREE_OF_A_KIND | 3 | trips, 2 kickers |
| STRAIGHT | 4 | high card |
| FLUSH | 5 | five ranks high→low |
| FULL_HOUSE | 6 | trips, pair |
| FOUR_OF_A_KIND | 7 | quads, kicker |
| STRAIGHT_FLUSH | 8 | high card |

`ROYAL_FLUSH` is reported as its own category for display but encodes as an
ace-high straight flush (code 8, r1 = 14), so it compares as the best straight
flush. Higher score wins; equal scores are exact ties. Suits never break ties.
`compareHands(a, b) = a.score − b.score`.

### Best five and descriptions

`bestFive` lists the five cards in significance order (pair cards, then
kickers; straights high→low with the wheel as 5-4-3-2-A). Among cards of equal
rank, higher suits (s > h > d > c) are chosen first, so the result does not
depend on input order.

Descriptions (fixed templates): `High Card, Ace` · `One Pair, Kings` ·
`Two Pair, Kings and Sevens` · `Three of a Kind, Sevens` · `Straight, Nine High`
(wheel: `Straight, Five High`) · `Flush, Ace High` ·
`Full House, Kings full of Sevens` · `Four of a Kind, Aces` ·
`Straight Flush, Nine High` · `Royal Flush`. Plural of Six is "Sixes".

## Dealing order (normative, shared with fairness verification)

`deck[0]` is the top card. With N dealt-in seats ordered clockwise starting at
the first seat after the button seat (the button seat may be empty — dead
button; if occupied it is dealt last in each round):

```
hole card 1 of the k-th seat = deck[k]          k = 0..N−1
hole card 2 of the k-th seat = deck[N + k]
burn 1 = deck[2N],   flop  = deck[2N+1 .. 2N+3]
burn 2 = deck[2N+4], turn  = deck[2N+5]
burn 3 = deck[2N+6], river = deck[2N+7]
```

`dealPlan` returns these indices; `dealFromDeck` maps them to cards. A hand that
ends early leaves later positions undealt; positions never shift.
`HandState.deck` holds the undealt remainder (`deck[0]` = next card).

## The hand state machine

Phases follow `HAND_PHASE_TRANSITIONS` (shared-types). Every phase change goes
through `transitionPhase`, which throws on an illegal transition (programmer
bug):

```
HAND_CREATED → DEAL_HOLE_CARDS → PREFLOP → FLOP → TURN → RIVER → SHOWDOWN → POT_DISTRIBUTION → HAND_COMPLETE
                                    └──────┴──────┴──────┴→ POT_DISTRIBUTION (fold win)
```

Externally visible states are only betting phases (with an acting seat) and
`HAND_COMPLETE`: `createHand` and `applyAction` run forward through forced
bets, dealing, street changes, run-outs, showdown and distribution until the
next decision.

### Forced bets (rules 1–2)

Order: antes, then SB, then BB (all in the `HAND_CREATED` phase).

- `ALL_PLAYERS`: every dealt-in player posts `ante`, in dealing order.
- `BB_ANTE`: the big blind posts `ante` once. **Blind priority**: the BB first
  reserves `min(bigBlind, stack)` and posts `min(ante, stack − reserved)` as
  ante; the ante event is still emitted first.
- `NONE`: no ante (a configured ante is ignored; `state.ante` is 0).
- SB (if `smallBlindSeat !== null`) posts `min(smallBlind, stack)`, BB posts
  `min(bigBlind, stack)`. A player who cannot cover a forced bet posts all they
  have and is all-in. Zero-amount posts are skipped (no event).
- Antes are dead money: they count in `totalContribution` (and
  `anteContribution`) but never in `streetContribution` or the current bet.
- After posting, `currentBet = bigBlind` (the full nominal big blind even if
  the BB is all-in for less) and `minRaiseIncrement = bigBlind`.

### Action order (rules 3–4)

Seat order is clockwise = ascending index wrapping at `maxSeats`. Preflop the
first actor is the first seat after the BB that can act; postflop the first
seat after the button (dead or not) that can act. A player can act if not
folded and not all-in. Heads-up is expressed as `smallBlindSeat = buttonSeat`,
which makes the button act first preflop and last postflop. After an action,
the next actor is the next seat clockwise that **needs to act**:
`canAct && (!actedThisStreet || streetContribution < currentBet)`.

### Legal actions (rule 5)

For the acting player with `contribution` (this street) and `stack`:

- `toCall = max(0, currentBet − contribution)`, `callAmount = min(toCall, stack)`,
  `allInTo = contribution + stack`.
- FOLD: always legal (even when checking is possible).
- CHECK iff `toCall == 0`; CALL iff `toCall > 0` (a call of the whole stack is an all-in call).
- BET iff `currentBet == 0`: `minTo = min(bigBlind, allInTo)`, `maxTo = allInTo`.
- RAISE iff `currentBet > 0`, `stack > toCall` and raising is **open** (rule 6):
  `minTo = min(currentBet + minRaiseIncrement, allInTo)`, `maxTo = allInTo`.
- ALL_IN iff `stack > 0` and it is a call (`allInTo ≤ currentBet`), a bet
  (`canBet`) or an open raise (`canRaise`). It resolves to CALL, BET or RAISE
  to `allInTo`.
- BET/RAISE amounts are the street **total** ("to"). Validation order:
  missing → `AMOUNT_REQUIRED`; not a safe integer (NaN, ±Infinity, fractions,
  strings, > 2^53) → `AMOUNT_NOT_INTEGER`; `< minTo` (incl. negatives) →
  `AMOUNT_BELOW_MINIMUM`; `> maxTo` (e.g. 999999999) → `AMOUNT_ABOVE_MAXIMUM`.
  Never clamped. Amounts on FOLD/CHECK/CALL/ALL_IN are ignored.

`applyAction` rejection precedence: `HAND_NOT_IN_BETTING` (no acting seat /
not a betting phase, e.g. after completion) → `PLAYER_NOT_IN_HAND` →
`PLAYER_FOLDED` → `PLAYER_ALL_IN` → `NOT_YOUR_TURN` → `UNKNOWN_ACTION`
(malformed intent or type) → action-specific codes. A rejection never changes
state; `applyAction` never throws for client input.

### Bet sizing and incomplete raises (rule 6, TDA)

A bet/raise to `T` over `currentBet` has increment `T − currentBet`.

- **Full** if `increment ≥ minRaiseIncrement`: `minRaiseIncrement = increment`.
- **Incomplete** otherwise (only possible all-in): `minRaiseIncrement`
  unchanged. Either way `currentBet = T` and the player becomes the street's
  last aggressor.
- Every voluntary action records `betLevelAtLastAction = currentBet` (after
  the action). Raising is open to a player iff they have not acted on this
  street, or `currentBet − betLevelAtLastAction ≥ minRaiseIncrement`.

Because `minRaiseIncrement` only changes on full raises (and never decreases),
any full raise since a player's last action makes the cumulative increase at
least the current increment, so full raises always re-open; a series of
incomplete raises re-opens exactly when it adds up to a full raise.
`minRaiseIncrement` resets to the big blind at each street, so an all-in bet
below the big blind is incomplete (it does not re-open betting for players who
already checked) and the next full raise is to `bet + bigBlind`.

Examples (blinds 50/100): A bets 100, B all-in 150, C calls → A may only call
or fold. A bets 100, B all-in 150, C all-in 210 → A may raise (210 − 100 ≥ 100),
minimum to 310.

### Round completion and run-outs (rule 7)

The round is complete when no live player needs to act, or when at most one
player can still act and that player has matched the current bet (nobody is
left to bet against). If only one non-folded player remains, it is a fold win.
Otherwise the next street is dealt (burn + cards, `STREET_STARTED`), the
street state resets (`currentBet = 0`, `minRaiseIncrement = bigBlind`,
contributions/`actedThisStreet`/`lastAction` cleared) and, if a betting round
opens, the first actor is prompted. If betting is already closed, the next
street is dealt immediately (run-out) — every street in order, never skipped.
`allInRunOut` is set when a round ends before the river with ≥ 2 live players
and ≤ 1 who can act. A player facing a bet always acts, even if every opponent
is all-in.

### Fold win (rule 8)

When only one non-folded player remains: `POT_DISTRIBUTION` directly, no more
cards, no `SHOWDOWN` event, `winningHand: null`.

### Uncalled bets (rule 9)

At the end of the hand (after any run-out, before showdown/awarding), if a
single player has the highest contribution, the excess over the second-highest
contribution is returned (`UNCALLED_BET_RETURNED`), even if that player folded.
Contributions are measured at pot level (see below). The return comes off the
street contribution first, then earlier streets, then (only possible under
ALL_PLAYERS when every opponent posted a partial ante) the player's own
unmatched ante.

### Pots (rule 10)

`buildPots(contribs, { deadMoney })` with `contribs[i].amount` = total
contribution at pot level:

1. remove the uncalled excess;
2. cut contributions at each distinct level `L1 < L2 < …`; layer `i` holds
   `Σ min(a, Li) − min(a, Li−1)`; eligible = non-folded players with `a ≥ Li`;
3. a layer with no eligible player (all contributors folded) merges into the
   next lower layer; adjacent layers with the same eligible set merge into one
   pot (they are always won by the same players);
4. `deadMoney` is added to the main pot.

Pot 0 is `MAIN`, the rest `SIDE`, in ascending level. In the hand engine,
pot-level amounts are `totalContribution` (ALL_PLAYERS antes included — a
partial ante only entitles a player to that share of other antes), except under
`BB_ANTE`, where the big blind's ante is **dead money in the main pot** (TDA)
and is excluded from levels and from uncalled-bet detection.

### Showdown (rule 11)

- **All-in showdown** (`allInRunOut`): every live hand is revealed, clockwise
  from the first live seat after the button.
- **Otherwise**: the last aggressor of the river shows first (no river bet →
  the first live seat after the button), then clockwise. Each later player
  shows only if their hand wins or ties at least one **contested** pot (≥ 2
  eligible) they are eligible for, compared with the hands already shown among
  that pot's eligible players; otherwise they muck (`cards: null`,
  `mucked: true`, `hand: null`).
- By construction every winner of a contested pot is revealed (the engine also
  asserts it). Winning an uncontested pot never requires a show.
- `HandResult.evaluated` holds every live hand including mucked ones; it is
  server-side data and must never be sent to other players.

### Awarding and odd chips (rules 12–13)

Pots are awarded from the last side pot down to the main pot. Each pot goes to
the best score among its eligible players (a single eligible player wins
without a score). Ties split equally; the remainder `amount mod winners` is
given one chip at a time to the tied winners in clockwise order starting from
the first seat after the button (the button seat itself, if a winner, is last).
`POT_AWARDED.winners` lists winners in that order with `oddChips` (0/1).
`winningHand` is the winners' hand for contested pots and `null` for
uncontested ones.

### Events (exact chronological order)

```
HAND_STARTED
FORCED_BET_POSTED*            antes, then SB, then BB
HOLE_CARDS_DEALT × N          dealing order (PRIVATE to the seat)
( TURN_TO_ACT, PLAYER_ACTED )*
BETTING_ROUND_COMPLETE        for every street whose betting round opened
STREET_STARTED …              (more rounds, or run-out streets back to back)
UNCALLED_BET_RETURNED?
SHOWDOWN?                     not on a fold win
POT_AWARDED*                  last side pot first … main pot last
HAND_COMPLETED
```

`PLAYER_ACTED.action` is the **resolved** action (an `ALL_IN` intent appears
as `CALL`/`BET`/`RAISE` with `allIn: true`); `amount` is the chips moved and
`toAmount` the street total. The action log (`state.actionLog`) keeps both the
intent type and the resolved action, so a hand can be replayed exactly by
re-applying `{ type: intent, amount: toAmount }`.

### State

`HandState` is plain JSON: configuration, phase, players (ascending seat, with
`startingStack`, `stack`, `holeCards`, `folded`, `allIn`, `streetContribution`,
`totalContribution`, `anteContribution`, `actedThisStreet`,
`betLevelAtLastAction`, `lastAction`, `won`, `uncalledReturned`), the undealt
`deck`, `board`, `burns`, `pot`, `currentBet`, `minRaiseIncrement`,
`lastAggressorSeat`, `aggressorByStreet`, `actingSeat`, `bettingRoundOpen`,
`allInRunOut`, `actionLog` and the final `result`. `applyAction` works on a
`structuredClone` of its input, so inputs are never mutated; the same state +
action always yields the identical next state and events.

### Invariants (`checkHandInvariants`)

Seats unique, in range and ascending; deck + board + burns + hole cards are
exactly 52 distinct valid cards; board/burn sizes match the phase; all chip
fields are non-negative safe integers; `streetContribution + anteContribution
≤ totalContribution`; **chip conservation** `Σ stack + pot = Σ startingStack`;
`pot = Σ totalContribution` before completion, `pot = 0` and
`Σ won = Σ totalContribution` after; at least one live player; never folded
and all-in; `allIn ⇔ stack = 0` for live players during betting; an acting seat
exists iff the phase is a betting phase, and it is a live, non-all-in player;
no street contribution above the current bet; `minRaiseIncrement ≥ bigBlind`.

## Tests

`npx vitest run packages/poker-engine` — unit tests per topic plus property
tests:

- evaluator vs an independent brute-force reference (best of all 21 five-card
  subsets) on 60,000 seeded random 7-card hands, 5- and 6-card hands, fast-check
  random hands, every straight flush, and a throughput floor;
- categories, kickers at every category, wheel/steel wheel, board plays, ties;
- pots (2/3/4-player all-ins, folded contributors, merging, dead money,
  uncalled), odd chips, dealing order;
- forced bets (antes of both types, BB-ante priority, short SB/BB, dead SB, dead
  button, heads-up), legal actions, min-raise tracking, incomplete raises and
  cumulative re-opening, run-outs, fold wins, timeouts, illegal inputs,
  immutability/serialization/determinism;
- showdown reveal/muck order, side-pot reveals, tied side pots with odd chips;
- a fast-check property playing 4,000 random hands (2–10 seats, random seat
  layouts, dead buttons/SBs, tiny stacks, random blinds/antes, random legal
  actions incl. all-ins and timeouts, garbage intents) asserting invariants
  after every step, chip conservation, awarded = pot, folded players never win,
  winners hold the best hand among each pot's eligible players, phases follow
  the transition table, the event stream replays to the final state, dealing
  follows `dealFromDeck`, and exact replay determinism.

## Contract notes

Clarifications of CONTRACTS.md §3 (no contract conflicts; these pin down
behaviour the contract leaves open):

1. **ALL_IN when raising is closed.** ALL_IN is legal only when it would be a
   call, a bet, or a raise that is open to the player. After an incomplete
   raise that does not re-open betting, an ALL_IN for more than the call is
   rejected with `RAISE_NOT_ALLOWED` (`canAllIn: false`); the player may CALL
   (all-in call if short) or FOLD. Otherwise rule 6 could be bypassed.
2. **Resolved actions in events.** `PLAYER_ACTED.action` is the resolved
   CALL/BET/RAISE for an ALL_IN intent (`allIn: true`); the log keeps the intent.
3. **Raising with no opponent able to respond** is allowed (rule 5 literally);
   the excess comes back as an uncalled bet.
4. **Under-big-blind all-in bets** are incomplete bets: with
   `minRaiseIncrement = bigBlind` at the start of each street, rule 6 makes a
   player who already checked call-or-fold only.
5. **Uncalled bets** are returned at the end of the hand (after the run-out),
   matching the required event order, and are returned even to a player who
   folded (possible because FOLD is legal when checking is).
6. **BB_ANTE** antes are dead money in the main pot (TDA), not a contribution
   level; otherwise an unmatched BB ante would be "returned" to the big blind.
7. **Pot merging.** Besides merging all-folded layers downward (rule 10),
   adjacent layers with identical eligible sets are merged into one pot. This
   is standard and affects only odd-chip placement.
8. **Empty pot.** If the only chips were an uncalled bet (dead small blind, no
   antes, everyone folds to the big blind), the bet is returned and no
   `POT_AWARDED` event is emitted (`totalPot = 0`).
9. **BETTING_ROUND_COMPLETE** is emitted only for streets whose betting round
   actually opened (not for run-out streets, nor when betting is closed right
   after the forced bets).
10. **Showdown**: only contested pots count for "can win or tie"; an all-in that
    is called on the river is not an all-in run-out (betting completed on the
    river), so the normal order applies; all-in reveal order is clockwise from
    the first live seat after the button.
11. **Forced bets**: ALL_PLAYERS antes post in dealing order; zero-amount posts
    are skipped; with `anteType: 'NONE'` a configured ante is ignored. Because
    the current bet is always the nominal big blind, a player may have to call
    it even when both blinds are all-in for less (the excess is returned).
12. **Royal flush** shares the score of an ace-high straight flush.
13. **Pot type** `Pot`, `HandState`, `CreateHandInput` and the result types are
    defined in this package (the contract names them in §3). `distributePots`
    takes `{ pots, scores, buttonSeat, maxSeats }`. No shared-types changes.
