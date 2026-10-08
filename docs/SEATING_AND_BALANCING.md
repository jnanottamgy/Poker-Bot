# Seating and Balancing

This is the authoritative explanation of how Johnny decides **how many tables**
to run, **where every player sits**, **who moves** when tables get uneven,
**which table breaks**, and **how the final table is drawn**. The code lives in
`@jpb/seating-engine` (`packages/seating-engine`) and `@jpb/balancing-engine`
(`packages/balancing-engine`). The API shapes are fixed by
[CONTRACTS.md](./CONTRACTS.md) §5–§6; this document fixes the exact maths.

> **No AI.** Every decision below is integer arithmetic, a documented score
> with deterministic tie-breaks, or a draw from the audited random stream
> (`RandomSource`, CONTRACTS §1). Same inputs ⇒ same outputs, always. See
> [NO_AI.md](./NO_AI.md).

All functions are pure: they never mutate their inputs, never read the clock,
and never call `Math.random()`. The only mutable object is the
`TableCountIndex`, a derived cache that the director rebuilds from its plain
JSON state at any time and that is never stored in state.

---

## 0. Vocabulary

| Term | Meaning |
| --- | --- |
| Clockwise | Ascending seat index, wrapping at `maxSeats` (seat `maxSeats-1` is followed by seat 0). |
| "After s" | Strictly after `s`, clockwise, wrapping around (so `s` itself is reached last). |
| Seated | A `SeatSummary` exists for the seat; the seat is physically taken. |
| Moving out | `SeatSummary.movingOut === true`: the director has ordered the player off this table, but the table has not reported `PLAYER_REMOVED` yet. The seat stays taken; the player no longer counts here. |
| Reserved | `TableSummary.reservedSeats`: seats held for players in transit **to** this table. |
| Staying players | Seated players that are not moving out. |
| Participants | Seats expected to be dealt into the next hand = staying seats ∪ reserved seats. |
| Effective size | `staying + reserved` — the number balancing works with. |
| Free seat | Not seated (by anyone, including movers) and not reserved. Only free seats are ever assigned. |
| In a hand | `TableSummary.inHand`: a hand is being played. The summary still describes the last **completed** hand. |

---

## 1. How many tables — `computeTableCount`

```
if active <= finalTableSize:  T = 1
else:
  d         = targetSize   (consolidateBy = 'TARGET')   or   maxSize ('MAX')
  preferred = ceil(active / d)
  hardLower = ceil(active / maxSize)        // no table may exceed maxSize
  softUpper = floor(active / minSize)       // tables at least minSize when possible
  T = max( 2, hardLower, min(preferred, softUpper) )
```

Precedence, highest first: the final-table rule; **never more than `maxSize`
players at a table**; never a single table above `finalTableSize`; `minSize`
(honoured whenever the first three allow it); the preferred size. With the
default configuration (target 8, max 9, min 2, final 9) the formula is exactly
the contract's `max(2, ceil(active / 8))`.

| Active players | Tables | Sizes (`distributeSizes`) |
| ---: | ---: | --- |
| 5 | 1 | 5 |
| 9 | 1 | 9 |
| 10 | 2 | 5, 5 |
| 16 | 2 | 8, 8 |
| 17 | 3 | 6, 6, 5 |
| 24 | 3 | 8, 8, 8 |
| 100 | 13 | 8 × 9 tables + 7 × 4 tables |
| 1,000 | 125 | 8 × 125 |
| 10,000 | 1,250 | 8 × 1,250 |
| 100,000 | 12,500 | 8 × 12,500 |
| 1,000,000 | 125,000 | 8 × 125,000 |

`MAX` mode packs tables tighter: 100 players → `ceil(100/9) = 12` tables
(9 × 4 + 8 × 8); 1,000,000 → 111,112 tables.

`minSize` example: target 8, max 9, **min 6**, 17 players. Preferred
`ceil(17/8) = 3` tables would give 6, 6, 5 (a table below 6), but
`floor(17/6) = 2` tables fit under maxSize (9, 8), so T = 2. If instead
target = max = min = 6 and 13 players: two tables would need 7 seats, so
maxSize wins and T = 3 (5, 4, 4).

## 2. Table sizes — `distributeSizes(total, T, maxSize)`

```
base = floor(total / T);  r = total - base * T
sizes = [base + 1] * r  ++  [base] * (T - r)          // descending
```

So `max - min <= 1` and `Σ sizes = total` by construction. It throws if
`total > T * maxSize` (impossible request). Example: 100 players at 13 tables:
base 7, r = 9 → nine tables of 8, four of 7.

## 3. Even seat spacing — `spreadSeats(n, maxSeats)`

```
seat_i = floor(i * maxSeats / n),   i = 0 .. n-1
```

Exact integer arithmetic; strictly ascending; every gap between neighbours
(including the wrap-around gap) is `floor(maxSeats/n)` or `ceil(maxSeats/n)`.

| n at 9 seats | seats |
| --- | --- |
| 9 | 0 1 2 3 4 5 6 7 8 |
| 8 | 0 1 2 3 4 5 6 7 |
| 5 | 0 1 3 5 7 |
| 3 | 0 3 6 |
| 2 | 0 4 |

## 4. Random draws

Every draw consumes the `RandomSource` (in production the HMAC-SHA256 stream of
`@jpb/fairness-engine` `drawSource(...)`, which the public verifier can
recompute). The two primitives are the normative ones from CONTRACTS §1,
re-implemented byte-for-byte in `seating-engine/src/random.ts`:

```
uniformInt(n):  limit = floor(2^32 / n) * n
                repeat u = nextUint32() until u < limit;   return u mod n
                (one value is consumed even when n = 1)
shuffle(a):     for i = n-1 down to 1:  j = uniformInt(i+1);  swap(a[i], a[j])
```

### 4.1 Initial seating — `initialSeating`

1. `ids` = player ids sorted by UTF-16 code units (input order never matters).
2. `order = shuffle(ids)` — consumes `n − 1` draws (plus rare rejections).
3. `T = computeTableCount(n)`, `sizes = distributeSizes(n, T, maxSize)`.
4. Table `k` (1-based) takes the next `sizes[k−1]` players of `order`; its
   `i`-th player sits in `spreadSeats(sizes[k−1], maxSize)[i]`.
5. For `k = 1..T`: `buttonSeat = occupied[uniformInt(size)]` (occupied seats
   ascending), drawn from `buttonSource(k)` when supplied (the director passes
   `drawSource('button:{tableId}')`), otherwise from the same stream after the
   shuffle.

Because `order` is a uniformly random permutation, every player is equally
likely to land at every table and seat (verified by chi-square smoke tests).

Worked example (scripted stream `5, 1, 4`; players `c, a, b`): sorted
`[a, b, c]`; `i=2: j = 5 mod 3 = 2` (no swap); `i=1: j = 1 mod 2 = 1` (no
swap) → order `a, b, c`; one table of 3 at seats `0, 3, 6`; button draw
`4 mod 3 = 1` → button on seat 3.

### 4.2 Final table — `planFinalTable`

Same procedure for one table of `maxSeats` seats: sort ids, shuffle, the
`i`-th player takes `spreadSeats(n, maxSeats)[i]`, then
`button = occupied[uniformInt(n)]` from the same stream. Stacks never
influence the draw. Example (stream `0, 1, 5`, players p0..p2): `i=2: j = 0` →
`[p2, p1, p0]`; `i=1: j = 1` → unchanged; seats `p2→0, p1→3, p0→6`; button
`5 mod 3 = 2` → seat 6.

---

## 5. Dead-button blind positions

These rules mirror the table engine (CONTRACTS §4) exactly; the seating engine
only **predicts** them.

**After a hand has been played** (`lastBigBlindSeat !== null`):

```
BB     = first participant after lastBigBlindSeat
SB     = position lastBigBlindSeat         (posted only if a participant sits there, else dead SB)
button = position lastSmallBlindSeat       (may be empty: dead button)
heads-up (exactly 2 participants): BB as above; the other participant is button and posts SB
```

**First hand** (`lastBigBlindSeat === null`):

```
button = buttonSeat ?? lowest participant seat
SB = first participant after button;   BB = first participant after SB
heads-up: SB = button = buttonSeat if a participant sits there, else the first participant after it;
          BB = the other participant
```

**Fallback** when `lastSmallBlindSeat` is unknown but `lastBigBlindSeat` is
set: button = `buttonSeat`, else the participant before the SB position. (The
director should always store the last SB **position**, even when the SB was
dead.)

Worked example — 6 seats, A..E in seats 0..4, seat 5 empty, initial button 0:

| Hand | Button | SB | BB | Note |
| --- | --- | --- | --- | --- |
| 1 | 0 (A) | 1 (B) | 2 (C) | first-hand rule |
| 2 | 1 (B) | 2 (C) | 3 (D) | C busts in this hand |
| 3 | 2 (dead) | 3 (D) | 4 (E) | button on C's empty seat |
| 4 | 3 (D) | 4 (E) | 0 (A) | seat 5 empty, BB wraps |
| 5 | 4 (E) | 0 (A) | 1 (B) | |

Every remaining player posts exactly one big blind per orbit; nobody posts it
twice in a row while two or more players are dealt in.

### 5.1 Tables in a hand

The summary describes the last **completed** hand, but a player seated now
waits for the next hand and a player removed now leaves after the current
hand. So when `inHand` is true all predictions skip the hand in progress:

1. The in-progress hand's positions are derived with the rules above from the
   summary, using everyone currently seated (movers included, reservations
   excluded).
2. Those positions become the planning state (`lastBigBlindSeat` = its BB,
   `lastSmallBlindSeat` = its SB position, `buttonSeat` = its button) and the
   next hand is predicted from them with the next-hand participants.

In the example, while hand 3 is being played the summary still says
`lastBB = 3, lastSB = 2`; the current BB is seat 4, so the predicted order
starts at hand 4: `[0, 1, 3, 4]`.

`statsAtDeparture` applies the same idea to a player who is moved out of a
table that is in a hand: they finish that hand first, so their counters
advance by one and `handsSinceBigBlind` (`handsSinceSmallBlind`) resets to 0 if
they are that hand's big blind (posting small blind).

## 6. Predicting the big blind

```
predictBigBlindOrder(table) = participants rotated to start at the next hand's BB
handsUntilBigBlind(table, s) = index of s in that order, where s is first added
                               to the participants if it is an empty seat
```

`0` means "posts the big blind in the next hand dealt". Assuming nobody joins
or leaves, the BB advances one participant per hand, so the order lists the
next `n` big blinds exactly (this is property-tested against an independent
literal implementation of the table-engine rules, including churn, heads-up,
first hands, dead buttons and in-hand tables).

Example — 9 seats, players at 0, 2, 4, 6, last SB 0, last BB 2:
order `[4, 6, 0, 2]`. Hypothetical seats: 3 → 0 (it lies between the last BB
and the next BB, so it would be the next BB), 5 → 1, 7 → 2, 8 → 2, 1 → 3.

## 7. Seat choice for an incoming player — `chooseSeatForIncoming`

Candidates: every free seat. For each candidate `s` (lower score is better):

```
orbit       = |participants| + 1                       // the destination's orbit including the newcomer
expected    = max(0, orbit - 1 - handsSinceBigBlind)    // expectedHandsUntilBB
deviation   = |handsUntilBigBlind(table + s, s) - expected|
skip(s)     = 1 if s lies strictly between the next hand's button and SB position, else 0
              (0 before the table's first hand and when the next hand would be heads-up)
adjacency(s)= occupied distinct neighbours of s (s-1, s+1 mod maxSeats) / number of distinct neighbours
              → 0 (both empty), 0.5, or 1 (both occupied)

score(s) = W.blindFairness * deviation + W.position * skip(s) + W.seatCompatibility * adjacency(s)
tie-break: lowest seat index
```

**Why `orbit − 1 − handsSinceBigBlind`.** At a stable table of `n` players a
player who posted the BB `h` hands ago will post it again after `n − 1 − h`
more hands: `h + handsUntilBB + 1 = n` (the BB hand itself closes the orbit).
Choosing a seat whose `handsUntilBigBlind` equals `expected` keeps the moved
player paying exactly one big blind per orbit — no free ride, no double
payment. A player who has gone a full orbit or more without posting
(`expected = 0`) is placed to post the BB next.

**Why the skip penalty.** TDA: a player may be dealt in anywhere except
between the small blind and the button — there they would play hands before
ever posting a blind.

Worked example — table above (players 0, 2, 4, 6; last SB 0, last BB 2; free
seats 1, 3, 5, 7, 8; next hand: button 0, SB 2, BB 4), weights all 1:

| Seat | handsUntilBB | skip | adjacency | score, h = 0 (just posted BB, expected 4) | score, h = 20 (overdue, expected 0) |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 3 | 1 | 1 | 1 + 1 + 1 = 3 | 3 + 1 + 1 = 5 |
| 3 | 0 | 0 | 1 | 4 + 0 + 1 = 5 | 0 + 0 + 1 = **1** |
| 5 | 1 | 0 | 1 | 3 + 0 + 1 = 4 | 1 + 0 + 1 = 2 |
| 7 | 2 | 0 | 0.5 | 2 + 0 + 0.5 = **2.5** | 2 + 0 + 0.5 = 2.5 |
| 8 | 2 | 0 | 0.5 | 2.5 (tie → seat 7 wins) | 2.5 |

The player who just posted the big blind is **not** put in the big blind
(seat 7); the overdue player posts it next hand (seat 3).

The full breakdown (`handsUntilBigBlind`, `expectedHandsUntilBigBlind`,
`blindFairnessDeviation`, `skipPenalty`, `adjacencyPenalty`, the three weighted
terms and `score`) is returned and stored with the move.

## 8. Who moves — `selectPlayerToMove`

For every staying player of the source table:

```
handsUntilBB      = position in predictBigBlindOrder(source)
movesWithinWindow = #{ m in recentMovesAtHand : handsPlayedTotal - m < window }
h                 = handsPlayedTotal - max(recentMovesAtHand)      (no recency term if never moved)
recency           = h < window ? (window - h) / window : 0

movementScore = W.position   * handsUntilBB                // TDA: the player due the BB next moves
              + W.recentMove * movesWithinWindow
              + W.recentMove * recency
```

Ordering: **(1) protection tier** — a player with `movesWithinWindow > 0` is
only chosen when every candidate was moved within the window (protection is
absolute, independent of the weights); **(2)** `movementScore` ascending;
**(3)** seat ascending; **(4)** playerId. `window = recentMoveWindowHands`.

Example: 9-handed table, last BB seat 0, so seat 1 is due the BB. If the seat-1
player was moved 2 hands ago (window 10, `W.recentMove = 10`): their score is
`0 + 10·1 + 10·0.8 = 18` and they are protected; the seat-2 player (score
`W.position · 1`) moves instead.

## 9. The planner — `planBalance` / `planAfterHand`

Input: all table summaries (or an index + lookup), the size config, the
balancing config, `activePlayers` (players still in the tournament, seated or
in transit) and `finalTableFormed`. Output: `targetTableCount` plus an ordered
list of actions. Phases:

1. **Guard.** `finalTableFormed` or `activePlayers < 2` → no actions.
2. **Final table.** `activePlayers <= finalTableSize` → `[FORM_FINAL_TABLE]`
   if more than one table is open (ACTIVE or BREAKING), else nothing. The
   director then seats everyone with `planFinalTable`.
3. **Finish breaks.** Staying players at a BREAKING table (e.g. an admin
   "break table now" that only flipped the status) are moved out like a break
   (below), all-or-nothing per table.
4. **Break surplus tables.** `k = activeTables − computeTableCount(active)`.
   Candidates in `selectTableToBreak` order — fewest effective players, ties
   → highest tableNumber, skipping tables with inbound reservations (their
   in-transit players would be stranded). The first `k` are all marked
   BREAKING **first** (so none of them receives players) and a `BREAK_TABLE`
   is emitted for each; then each table's staying players are moved in
   big-blind order (next BB first) to the destination with the fewest players
   (ties → lowest tableNumber), seat by `chooseSeatForIncoming`. If someone
   cannot be placed, everything is rolled back and the attempt is repeated
   with `k − 1` tables. A break is never emitted partially.
5. **Balance.** Repeat:
   - destination = ACTIVE table with the fewest players (ties → lowest
     tableNumber) that is below `maxSize` and has a free seat;
   - source = ACTIVE table with the most players (ties → lowest tableNumber)
     with `count > destCount + max(1, maxImbalance)` that keeps at least 2
     staying players after the move;
   - stop when either does not exist; otherwise move `selectPlayerToMove(source)`
     to `chooseSeatForIncoming(destination)`.

Each move marks the player `movingOut` at the source and reserves the seat at
the destination in the planner's working state, so later decisions in the same
plan see it.

**Guarantees** (each is property-tested on random states):

- never assigns an occupied, moving-out or reserved seat;
- never produces a destination above `maxSize`;
- never moves a player twice in one plan (moved players become reservations,
  which are never candidates);
- a balancing move never leaves its source with fewer than 2 staying players;
- terminates: every balancing move changes counts `(a, b)` with `a − b ≥ 2`
  into `(a − 1, b + 1)`, strictly lowering `Σ count²`;
- from a settled state (no transfers in flight) the result after completion
  has exactly `min(currentTables, target)` tables, sizes within
  `max(1, maxImbalance)` of each other, and **re-planning yields no actions** —
  both on the completed state and on the in-flight state (idempotency);
- deterministic and independent of the order of the input array.

### 9.1 Worked examples (default config: target 8, max 9, maxImbalance 1)

**8 / 8 / 5 / 8** (29 players, target 4 tables): T3 is smallest (5); the
largest with more than 6 is T1 (8, lowest number) → move T1's next big blind
to T3 → 7/8/6/8. Smallest T3 (6); largest with more than 7 is T2 → 7/7/7/8.
Smallest is now 7; nobody has more than 8 → done. Two moves.

**9 / 6**: one move T1 → T2 gives 8/7.

**9 / 9 / 9 / 5**: T1 → T4, T2 → T4, T3 → T4 → 8/8/8/8.

**Breaking 10 → 9 tables** (sizes 8, 8, 7 × 8 = 72 players, target
`ceil(72/8) = 9`): the candidate is a 7-player table with the highest number,
T10. Its seven players leave in big-blind order to the smallest tables, ties
lowest number: T3, T4, …, T9 → nine tables of 8.

**5 / 5 / 5** (15 players, target 2): break T3; its players go to T1, T2, T1,
T2, T1 → 8/7.

**Final table**: 9 players at 5 + 4 or 3 + 3 + 3 → `FORM_FINAL_TABLE`; 10
players at 5 + 5 → nothing (two tables are still required).

## 10. Moves in flight (director protocol)

1. Issue the plan: for each MOVE send `REMOVE_PLAYER(MOVED | TABLE_BROKEN)` to
   the source and, in the director's summaries, set `movingOut = true` on the
   player and add `toSeat` to the destination's `reservedSeats`; set broken
   tables to BREAKING (`markPlanInFlight` computes exactly this state).
2. On `PLAYER_REMOVED` from the source: remove the seat from the source
   summary and `SEAT_PLAYER` at the reserved seat; on `PLAYER_SEATED` replace
   the reservation with the seat (`completePlan` computes the end state).
3. After every summary change call `index.upsert(summary)`.

Effective sizes therefore never double count a player: a mover counts at the
destination (reservation), not at the source.

## 11. Scale: incremental planning

`TableCountIndex` buckets ACTIVE tables by effective size. Each bucket is an
`OrderedIntSet` of table numbers — a hierarchical bitset (a 32-ary summary
tree of `Uint32Array` words) with `add / delete / first / last / next / prev`
in `O(log32 T)`: at most 4 word operations per level for up to 1,048,576
tables. `minCount()` / `maxCount()` are cached (`O(1)`); "the table with
count `c` and the lowest/highest number" is `O(log32 T)`; an update is
`O(log32 T)`. Memory is about `T/8` bytes per bucket plus a small map entry per
table.

`planAfterHand` runs the **same** algorithm as `planBalance` (they produce
identical plans — property-tested) but reads the caller's index instead of
building one, and only looks up the tables it inspects: the min/max buckets,
the chosen sources/destinations, break candidates and BREAKING tables. Its
temporary index updates are journaled and rolled back before it returns, so
the caller's index is unchanged. Per-hand cost is therefore
`O(actions · log32 T)` — independent of the number of players.

Measured in the CI container (Node 22): `planBalance` on 125,000 balanced
tables (1,000,000 players) ≈ 0.7 s including index construction; 62,500
balancing moves on 125,000 tables ≈ 3 s; 1,000 consecutive `planAfterHand`
calls on a 125,000-table field, each after 1–3 busts at one table (≈ 250 table
breaks and ≈ 2,100 moves, ≈ 675 of them balancing moves) ≈ 0.3 s, never
inspecting more than a few dozen tables per call.

## 12. Clarifications of the contract

These refine CONTRACTS §5–§6 without changing any signature (additive only):

1. `computeTableCount` adds the `maxSize` hard bound and the `minSize` soft
   bound described in §1 (identical to the contract formula for the default
   configuration).
2. Participants include reserved seats and exclude `movingOut` players
   (new optional `SeatSummary.movingOut` in shared-types).
3. Predictions on a table in a hand skip the hand in progress (§5.1); the
   planner projects a mover's stats with `statsAtDeparture`.
4. `expectedHandsUntilBB = max(0, orbit − 1 − handsSinceBigBlind)` with
   `orbit` = destination participants + 1 (the contract's "expected orbit"
   counts the hands strictly before the next BB).
5. `skipPenalty` uses the next hand's button and SB **position** (dead button
   and dead SB included); it is 0 before a table's first hand and when the
   next hand is heads-up. `adjacencyPenalty` is the occupied fraction of
   distinct neighbours.
6. Recent-move protection is an absolute tier ahead of `movementScore`.
7. `selectTableToBreak` returns `TableId | null`, counts effective players and
   skips tables with inbound reservations; surplus tables are broken together
   and all-or-nothing.
8. A balancing move requires `count(source) − count(dest) > max(1, maxImbalance)`
   (a move between tables that differ by one never helps; `maxImbalance = 0`
   behaves like 1) and at least 2 staying players left at the source.
9. MOVE actions carry `fromSeat` in addition to the contract fields; the
   breakdown keys are prefixed `player.`, `seat.`, plus `source.count` and
   `destination.count`.
10. `initialSeating` accepts an optional `buttonSource(tableNumber)` so the
    director can draw each button from `drawSource('button:{tableId}')`.
