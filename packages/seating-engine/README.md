# @jpb/seating-engine

Deterministic seating mathematics for Johnny's Poker Bot: how many tables,
how big, which seats, the random initial seat draw, dead-button big-blind
prediction and the blind-fair seat choice for a player joining a table.

Pure functions over plain data (`TableSummary`, `SeatSummary`,
`SeatPositionStats`, `TableSizeConfig` from `@jpb/shared-types`). No clock, no
`Math.random()`, no input mutation; randomness only through an injected
`RandomSource` (type from `@jpb/randomness`). **No AI** — see
[docs/NO_AI.md](../../docs/NO_AI.md).

The full derivations and worked examples are in
[docs/SEATING_AND_BALANCING.md](../../docs/SEATING_AND_BALANCING.md); this file
states every rule precisely.

## API

| Export | Purpose |
| --- | --- |
| `computeTableCount(active, cfg, consolidateBy)` | Tables needed for `active` players. |
| `distributeSizes(total, tableCount, maxSize)` | Balanced sizes, descending; throws if impossible. |
| `spreadSeats(n, maxSeats)` | Evenly spaced seat indices. |
| `initialSeating({ playerIds, cfg, consolidateBy, rng, buttonSource? })` | Random initial seat draw + buttons. |
| `predictBigBlindOrder(table)` | Seats in the order they will post the BB, from the next hand. |
| `handsUntilBigBlind(table, seat)` | Hands before `seat` posts the BB (occupied or hypothetical seat). |
| `chooseSeatForIncoming(table, player, weights)` | Best free seat + score + breakdown. |
| `scoreSeatsForIncoming(table, player, weights)` | Every free seat scored, best first (admin "why this seat"). |
| `expectedHandsUntilBigBlind`, `skipPenalty`, `adjacencyPenalty` | The individual score terms. |
| `positionsForNextHand(state, participants)` | Button / SB position / BB for the next hand (dead-button rules). |
| `bigBlindOrderFor(state, participants)` | BB order for an explicit participant set. |
| `currentHandPositions(table)`, `planningBlindState(table)` | In-progress hand and the state the next hand derives from. |
| `statsAtDeparture(table, seat, stats)` | A mover's stats once they finish the current hand. |
| `nextHandParticipants`, `stayingPlayers`, `effectivePlayerCount`, `freeSeats`, `hasFreeSeat`, `seatedSeats`, `isMovingOut` | Table views. |
| `checkTableSummary(table)` | Structural invariants of a summary (empty array when healthy). |
| `drawIndex(rng, n)`, `shuffled(items, rng)`, `drawButtonSeat(seats, rng)`, `compareIds` | Normative draw primitives. |
| `assertTableSizeConfig`, `assertWeights`, `MAX_WEIGHT`, `MIN_TABLES_BEFORE_FINAL` | Guards and constants. |

## Rules

### Table count

```
active <= finalTableSize  → 1
otherwise T = max(2, ceil(active / maxSize), min(ceil(active / d), floor(active / minSize)))
          d = targetSize ('TARGET') or maxSize ('MAX')
```

`maxSize` is a hard bound, the two-table floor applies above the final-table
size, `minSize` is honoured whenever those allow it. Default config
(8 / 9 / 2 / 9): 5 → 1, 16 → 2, 24 → 3, 100 → 13 (8×9 + 7×4), 1,000 → 125,
10,000 → 1,250, 100,000 → 12,500, 1,000,000 → 125,000.

### Sizes and seats

- `distributeSizes`: `base = floor(total/T)`, the first `total mod T` tables
  get `base + 1`. Throws `RangeError` when `total > T * maxSize`.
- `spreadSeats`: `seat_i = floor(i * maxSeats / n)`; ascending, gaps differ by
  at most one seat.

### Draws (normative, identical to `@jpb/randomness`)

- `drawIndex(rng, n)` = `uniformInt`: `limit = floor(2^32/n)*n`, redraw while
  `u >= limit`, return `u mod n`; always consumes at least one value; throws
  on a source that returns a non-uint32.
- `shuffled` = Durstenfeld Fisher–Yates: `for i = n-1..1: j = drawIndex(i+1); swap`.
- `drawButtonSeat`: occupied seats sorted ascending, `seats[drawIndex(len)]`.

### Initial seating

Sort ids (UTF-16 code units) → `shuffled` → `T = computeTableCount(n)`,
`sizes = distributeSizes(n, T, maxSize)` → table k takes the next `sizes[k-1]`
players, the i-th in `spreadSeats(size, maxSize)[i]`, `maxSeats = maxSize` →
buttons for k = 1..T from `buttonSource(k)` if given, else from `rng` after
the shuffle. Throws on an empty or duplicated player list.

### Blind positions (mirror of the table engine, CONTRACTS §4)

Participants = staying seats (not `movingOut`) ∪ `reservedSeats`. "After s" =
strictly clockwise after s, wrapping.

- Previous hand known: BB = first participant after `lastBigBlindSeat`;
  SB position = `lastBigBlindSeat` (posted iff a participant sits there);
  button = `lastSmallBlindSeat` (fallback: `buttonSeat`, else the participant
  before the SB position). Heads-up: the non-BB participant is button and SB.
- First hand: button = `buttonSeat ?? lowest participant`; SB = first
  participant after it; BB = first after SB. Heads-up: SB = button = the
  button seat if occupied, else the first participant after it; BB = the other.
- `inHand`: the in-progress hand is derived from the summary with every seated
  player (movers included, reservations excluded) and predictions start with
  the hand after it.
- `predictBigBlindOrder` = participants rotated to start at the next BB.
  `handsUntilBigBlind(table, s)` = index of `s` after adding `s` to the
  participants when it is empty.

### Seat choice (lower is better; ties → lowest seat)

```
orbit    = |participants| + 1
expected = max(0, orbit - 1 - handsSinceBigBlind)
score(s) = W.blindFairness     * |handsUntilBigBlind(table + s) - expected|
         + W.position          * skipPenalty(s)      // 1 if strictly between next button and next SB position
         + W.seatCompatibility * adjacencyPenalty(s) // occupied fraction of distinct neighbours: 0, 0.5, 1
```

`skipPenalty` is 0 before the table's first hand and when the next hand is
heads-up. Candidates are free seats only (never occupied — even by a mover —
and never reserved); a table without a free seat throws (planner bug). Weights
must be finite numbers in `[0, 1e9]`.

## Contract notes

Clarifications of CONTRACTS §5 (all additive; see also
docs/SEATING_AND_BALANCING.md §12):

1. `computeTableCount` adds the `maxSize` hard bound and the `minSize` soft
   bound; identical to `max(2, ceil(active/targetSize))` for the defaults.
2. Participants for every prediction = staying players ∪ reserved seats. The
   optional `SeatSummary.movingOut` flag was added to shared-types for
   in-flight departures (the seat stays taken, the player no longer counts).
3. Predictions on a table that is in a hand skip the hand in progress
   (`planningBlindState`).
4. "Expected orbit" is finalised as `orbit − 1` with `orbit` = destination
   participants + 1, i.e. `expectedHandsUntilBB = max(0, orbit − 1 − handsSinceBigBlind)`
   (steady state: `handsSinceBB + handsUntilBB + 1 = n`).
5. `skipPenalty` uses the next hand's button and SB **position** (dead ones
   included), strictly between, clockwise; 0 before the first hand or when
   heads-up. `adjacencyPenalty` = occupied distinct neighbours / distinct
   neighbours.
6. `TableSummary.lastSmallBlindSeat` must hold the SB **position** of the last
   hand even when the SB was dead; `buttonSeat` is the first-hand button until a
   hand has been played.
7. `initialSeating` takes an optional `buttonSource(tableNumber)` so buttons can
   come from `drawSource('button:{tableId}')` as CONTRACTS §7 describes.
8. `drawIndex`/`shuffled` re-implement the normative CONTRACTS §1 algorithms
   (only the `RandomSource` type is imported from `@jpb/randomness`); they must
   stay byte-for-byte identical to `uniformInt`/`fisherYatesShuffle`.

## Tests

`npx vitest run packages/seating-engine` — table-count table for 5…1,000,000
players; fast-check distribution properties up to 1,000,000 players and random
configs; normative draw vectors and chi-square smoke tests; initial-seating
determinism/validity/unbiasedness; blind-order predictions property-tested
against an independent literal model of the table-engine rules (churn,
heads-up, first hands, dead buttons, in-hand tables, hypothetical seats);
seat-choice examples and properties; a cross-check proving `drawIndex`/`shuffled`
equal `uniformInt`/`fisherYatesShuffle` of `@jpb/randomness` (skipped until that
package exists).
