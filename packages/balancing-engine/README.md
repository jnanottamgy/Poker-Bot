# @jpb/balancing-engine

Deterministic table balancing, table breaking, final-table formation and the
final-table seat draw for Johnny's Poker Bot, built to run after every hand of
a 1,000,000-player / 125,000-table tournament.

Pure planning over `TableSummary` data: the planner returns a `BalancePlan`
(actions with auditable score breakdowns) and never mutates its inputs. **No
AI** — see [docs/NO_AI.md](../../docs/NO_AI.md). Full derivations and worked
examples: [docs/SEATING_AND_BALANCING.md](../../docs/SEATING_AND_BALANCING.md).

## API

| Export | Purpose |
| --- | --- |
| `planBalance({ tables, tableCfg, balancing, activePlayers, finalTableFormed })` | Full planner (admin "rebalance now", recovery, tests). O(T) to build its index. |
| `planAfterHand({ index, getTable, tableCfg, balancing, activePlayers, finalTableFormed })` | Same algorithm and output, driven by the caller's `TableCountIndex`; touches only the tables it inspects. |
| `TableCountIndex` | Size index of open tables (see below). `fromTables`, `upsert`, `setActive`, `setBreaking`, `remove`, `minCount`, `maxCount`, `firstWithCount`, `lastWithCount`, `tablesWithCount`, `breakingTables`, `snapshot`, `clone`, `checkInvariants`. |
| `selectTableToBreak(tables)` | Next table to break, or `null`. |
| `selectPlayerToMove(source, cfg, exclude?)`, `rankPlayersToMove`, `movementScore` | Who moves out of a table, with the score breakdown. |
| `planFinalTable({ players, maxSeats, rng })` | Final-table seat draw and button. |
| `markPlanInFlight(tables, plan)`, `completePlan(tables, plan)` | Apply a plan to summaries (moves issued / moves completed). O(T): for tests, simulation and small fields. |
| `OrderedIntSet`, `MAX_ORDERED_INT` | Hierarchical-bitset ordered integer set used by the index (values 0..2^24−1). |
| `MIN_PLAYERS_AFTER_MOVE_OUT`, `MAX_INDEXED_COUNT`, `MAX_RECENT_MOVES_KEPT` | Named constants (2 staying players; 1024 max indexed size; 16 recent moves kept by `completePlan`). |
| Types | `BalancePlan`, `BalanceAction`, `MoveAction`, `PlanBalanceInput`, `PlanAfterHandInput`, `PlanContext`, `PlayerToMove`, `FinalTablePlan`, `IndexEntry`, … |

```ts
type BalanceAction =
  | { type: 'FORM_FINAL_TABLE' }
  | { type: 'BREAK_TABLE'; tableId }
  | { type: 'MOVE'; reason: 'BALANCE' | 'TABLE_BREAK'; playerId; fromTableId; fromSeat; toTableId; toSeat; breakdown };
```

## Effective size and in-flight moves

A table's **effective size** = staying players (seated, not `movingOut`) +
`reservedSeats`. When the director issues a MOVE it flags the player
`movingOut` at the source and reserves `toSeat` at the destination, so the
player is counted once, at the destination. BREAKING tables are neither
sources nor destinations; CLOSED tables are ignored.

## Planner algorithm (normative)

1. `finalTableFormed` or `activePlayers < 2` → no actions.
2. `activePlayers <= finalTableSize` → `[FORM_FINAL_TABLE]` if more than one
   table is open (ACTIVE or BREAKING), else nothing.
3. **Finish breaks**: staying players at a BREAKING table are moved out
   (reason `TABLE_BREAK`, no new `BREAK_TABLE` action) — this is how an admin
   "break table X" is executed: set the status to BREAKING and plan.
4. **Surplus breaks**: `k = activeTables − computeTableCount(activePlayers)`.
   Candidates: ACTIVE tables without inbound reservations, fewest effective
   players first, ties → highest tableNumber. The first `k` are all marked
   BREAKING (one `BREAK_TABLE` each), then each is emptied in big-blind order
   (next BB first), every player going to the ACTIVE destination with the fewest
   players (ties → lowest tableNumber) that is below `maxSize` and has a free
   seat, seat by `chooseSeatForIncoming`. If a player cannot be placed the whole
   attempt is rolled back and retried with `k − 1` tables (never partial).
5. **Balance**: repeat — destination as above; source = the largest ACTIVE
   table (ties → lowest tableNumber) with `count > destCount + max(1, maxImbalance)`
   keeping ≥ 2 staying players after the move; move
   `selectPlayerToMove(source)` to `chooseSeatForIncoming(destination)` — until
   no such pair exists. Each move strictly lowers Σ count², so it terminates.

Every planned move updates the planner's working state (mover flagged,
destination seat reserved) before the next decision. A mover's stats are
projected with `statsAtDeparture` when the source is in a hand.

### Who moves

```
movementScore = W.position   * handsUntilBigBlind(source, seat)
              + W.recentMove * #{ moves m : handsPlayedTotal − m < window }
              + W.recentMove * (h < window ? (window − h) / window : 0)    h = hands since the last move
order: protected tier (moved within window) last, then score, then seat, then playerId
```

### Final table draw

Sort ids, Fisher–Yates with `rng`, the i-th player takes
`spreadSeats(n, maxSeats)[i]`, then `button = occupied[uniformInt(n)]` from the
same stream. Stacks never influence the draw. Throws on 0 players, more players
than seats, duplicate ids or a non-positive stack.

### Guarantees (property-tested)

Never assigns an occupied/moving-out/reserved seat; never exceeds `maxSize`;
never moves a player twice in one plan; balancing moves keep ≥ 2 staying
players at the source; deterministic and input-order independent;
`planAfterHand` ≡ `planBalance`; from a settled state, completion yields
`min(tables, target)` tables within tolerance and re-planning (on the
completed **or** in-flight state) yields no actions.

## TableCountIndex

ACTIVE tables bucketed by effective size; each bucket is an `OrderedIntSet` of
table numbers (32-ary hierarchical bitset over `Uint32Array`, values up to
2^24 − 1). `minCount`/`maxCount` O(1) (cached); first/last/next table in a
bucket and every update O(log32 T) (≤ 4 word steps per level up to 1M tables);
memory ≈ T/8 bytes per bucket plus one map entry per table. The index is a
derived cache: rebuild it with `TableCountIndex.fromTables(summaries)` after
recovery, `upsert(summary)` after each summary change, and never put it in
serialisable state. Table numbers must be unique (throws otherwise).

`planAfterHand` journals its temporary index updates and rolls them back before
returning (also when it throws). It verifies every table it looks up against the
index and throws `TableCountIndex out of sync` on a mismatch (a director bug).

Measured (CI container, Node 22): 125,000 balanced tables via `planBalance`
≈ 0.5–0.7 s; 62,500 balancing moves ≈ 3 s; 1,000 consecutive `planAfterHand`
calls on 125,000 tables ≈ 0.3 s with at most a few dozen lookups per call.

## Contract notes

Clarifications of CONTRACTS §6 (additive; see docs/SEATING_AND_BALANCING.md §12):

1. Effective size counts reservations and excludes `movingOut` players (new
   optional `SeatSummary.movingOut` in shared-types).
2. `selectTableToBreak` returns `TableId | null`, counts effective players and
   skips tables with inbound reservations.
3. Surplus tables are selected up front and broken together, all-or-nothing
   (falling back to fewer tables); BREAKING tables with staying players are
   evacuated without a new `BREAK_TABLE` (admin breaks).
4. Balancing requires `count(source) − count(dest) > max(1, maxImbalance)`
   (`maxImbalance = 0` acts as 1) and ≥ 2 staying players left at the source;
   destinations must be below `maxSize` and have a free physical seat.
5. Recent-move protection is an absolute tier before `movementScore`.
6. `MOVE` carries `fromSeat`; breakdown keys: `player.*` (selection),
   `seat.*` (seat choice), `source.count`, `destination.count`
   (`player.breakOrder`/`player.seat` for table-break moves).
7. FORM_FINAL_TABLE counts open (ACTIVE + BREAKING) tables.
8. `planAfterHand` is the per-hand incremental API (contract: "per-hand
   incremental use via TableCountIndex").
9. `activePlayers` must be the director's count of players still in the
   tournament (seated + in transit); it drives the target table count and the
   final-table rule. `index.totalActivePlayers` plus staying players at
   BREAKING tables should equal it — a useful director-side integrity check.

## Tests

`npx vitest run packages/balancing-engine` — OrderedIntSet and TableCountIndex
against naive models; selection rules (TDA due-BB, recent-move protection,
in-hand sources); scenarios (8/8/5/8, 9/6, cascades, 10 → 9 breaks, multi-table
breaks, final table from 2–3 tables, deferred breaks, admin breaks, reserved
seats, out-of-sync index); fast-check properties on sparse, dense and in-flight
random states; performance at 125,000 tables.
