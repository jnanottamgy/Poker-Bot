import {
  assertWeights,
  chooseSeatForIncoming,
  computeTableCount,
  effectivePlayerCount,
  hasFreeSeat,
  predictBigBlindOrder,
  statsAtDeparture,
  stayingPlayers,
} from '@jpb/seating-engine';
import { TABLE_SIZE_LIMITS } from '@jpb/shared-types';
import type { BalancingConfig, PlayerId, SeatSummary, TableId, TableSummary } from '@jpb/shared-types';
import { rankPlayersToMove } from './selectPlayerToMove';
import { TableCountIndex } from './tableCountIndex';
import type { IndexEntry } from './tableCountIndex';
import type { BalanceAction, BalancePlan, MoveAction, PlanAfterHandInput, PlanBalanceInput, PlanContext } from './types';

/** A balancing move never leaves its source with fewer seated players than this (unless the table is broken). */
export const MIN_PLAYERS_AFTER_MOVE_OUT = TABLE_SIZE_LIMITS.MIN_PLAYERS_PER_TABLE;

function prefixed(prefix: string, record: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(record)) out[`${prefix}${k}`] = v;
  return out;
}

function assertBalancingConfig(cfg: BalancingConfig): void {
  if (!Number.isSafeInteger(cfg.maxImbalance) || cfg.maxImbalance < 0) {
    throw new RangeError(`maxImbalance must be a non-negative integer, got ${cfg.maxImbalance}`);
  }
  if (!Number.isSafeInteger(cfg.recentMoveWindowHands) || cfg.recentMoveWindowHands < 0) {
    throw new RangeError(`recentMoveWindowHands must be a non-negative integer, got ${cfg.recentMoveWindowHands}`);
  }
  if (cfg.consolidateBy !== 'TARGET' && cfg.consolidateBy !== 'MAX') {
    throw new RangeError(`consolidateBy must be TARGET or MAX, got ${String(cfg.consolidateBy)}`);
  }
  assertWeights(cfg.weights);
}

/**
 * One planning run. Works on a TableCountIndex plus "working views" of the few
 * tables it touches. Every mutation is journaled so the run can be rolled back
 * (used to make a table break all-or-nothing, and to hand the caller's index
 * back untouched in planAfterHand).
 */
class PlanRun {
  private readonly views = new Map<TableId, TableSummary>();
  private readonly lookedUp = new Map<TableId, TableSummary>();
  private readonly moved = new Set<PlayerId>();
  private readonly journal: Array<() => void> = [];
  private readonly actions: BalanceAction[] = [];

  constructor(
    private readonly index: TableCountIndex,
    private readonly lookup: (tableId: TableId) => TableSummary,
    private readonly ctx: PlanContext,
  ) {}

  // ---------------------------------------------------------------- lookups

  private table(tableId: TableId): TableSummary {
    const view = this.views.get(tableId);
    if (view !== undefined) return view;
    let summary = this.lookedUp.get(tableId);
    if (summary === undefined) {
      summary = this.lookup(tableId);
      if (summary.tableId !== tableId) throw new Error(`lookup(${tableId}) returned table ${summary.tableId}`);
      this.assertInSync(summary);
      this.lookedUp.set(tableId, summary);
    }
    return summary;
  }

  private assertInSync(summary: TableSummary): void {
    const entry = this.index.get(summary.tableId);
    const expected = summary.status === 'CLOSED' ? undefined : summary.status;
    if (entry?.state !== expected) {
      throw new Error(`TableCountIndex out of sync: ${summary.tableId} is ${summary.status} but indexed as ${entry?.state ?? 'absent'}`);
    }
    if (entry !== undefined && entry.state === 'ACTIVE' && entry.count !== effectivePlayerCount(summary)) {
      throw new Error(`TableCountIndex out of sync: ${summary.tableId} has ${effectivePlayerCount(summary)} players, indexed ${entry.count}`);
    }
  }

  private entry(tableId: TableId): Readonly<IndexEntry> {
    const e = this.index.get(tableId);
    if (e === undefined) throw new Error(`table ${tableId} is not indexed`);
    return e;
  }

  // ---------------------------------------------------------------- journaled mutations

  checkpoint(): number {
    return this.journal.length;
  }

  rollback(to = 0): void {
    while (this.journal.length > to) (this.journal.pop() as () => void)();
  }

  private setView(tableId: TableId, view: TableSummary): void {
    const prev = this.views.get(tableId);
    this.views.set(tableId, view);
    this.journal.push(() => {
      if (prev === undefined) this.views.delete(tableId);
      else this.views.set(tableId, prev);
    });
  }

  private restoreEntry(tableId: TableId, prev: IndexEntry | undefined): void {
    if (prev === undefined) this.index.remove(tableId);
    else if (prev.state === 'ACTIVE') this.index.setActive(tableId, prev.tableNumber, prev.count);
    else this.index.setBreaking(tableId, prev.tableNumber);
  }

  private indexUpdate(tableId: TableId, apply: () => void): void {
    const e = this.index.get(tableId);
    const prev = e === undefined ? undefined : { ...e };
    apply();
    this.journal.push(() => this.restoreEntry(tableId, prev));
  }

  private push(action: BalanceAction): void {
    this.actions.push(action);
    this.journal.push(() => this.actions.pop());
  }

  private markMoved(playerId: PlayerId): void {
    if (this.moved.has(playerId)) throw new Error(`planner invariant: ${playerId} would move twice in one plan`);
    this.moved.add(playerId);
    this.journal.push(() => this.moved.delete(playerId));
  }

  // ---------------------------------------------------------------- searches

  /** Smallest ACTIVE table (ties → lowest tableNumber) below maxSize with a free seat. */
  private findDestination(): TableId | null {
    const min = this.index.minCount();
    const max = this.index.maxCount();
    if (min === null || max === null) return null;
    for (let c = min; c <= max && c < this.ctx.tableCfg.maxSize; c += 1) {
      for (const id of this.index.tablesWithCount(c, 'ASC')) {
        if (hasFreeSeat(this.table(id))) return id;
      }
    }
    return null;
  }

  private canGive(table: TableSummary): boolean {
    const staying = stayingPlayers(table);
    return staying.length - 1 >= MIN_PLAYERS_AFTER_MOVE_OUT && staying.some((s) => !this.moved.has(s.playerId));
  }

  /** Largest ACTIVE table (ties → lowest tableNumber) with more than `floor` players that can give a player. */
  private findSource(floor: number): TableId | null {
    const max = this.index.maxCount();
    if (max === null) return null;
    for (let c = max; c > floor; c -= 1) {
      for (const id of this.index.tablesWithCount(c, 'ASC')) {
        if (this.canGive(this.table(id))) return id;
      }
    }
    return null;
  }

  /**
   * Up to `k` tables to break, in selectTableToBreak order: fewest players
   * (ties → highest tableNumber) among ACTIVE tables with no inbound
   * reservations (breaking those would strand players already in transit).
   */
  private breakCandidates(k: number): TableId[] {
    const out: TableId[] = [];
    const min = this.index.minCount();
    const max = this.index.maxCount();
    if (min === null || max === null || k <= 0) return out;
    for (let c = min; c <= max; c += 1) {
      for (const id of this.index.tablesWithCount(c, 'DESC')) {
        if (this.table(id).reservedSeats.length > 0) continue;
        out.push(id);
        if (out.length === k) return out;
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- actions

  private move(sourceId: TableId, player: SeatSummary, destId: TableId, reason: MoveAction['reason'], why: Record<string, number>): void {
    const source = this.table(sourceId);
    const dest = this.table(destId);
    const stats = statsAtDeparture(source, player.seat, player.stats);
    const choice = chooseSeatForIncoming(dest, { playerId: player.playerId, stats }, this.ctx.balancing.weights);
    const breakdown = {
      ...why,
      'source.count': effectivePlayerCount(source),
      'destination.count': effectivePlayerCount(dest),
      ...prefixed('seat.', choice.breakdown),
    };
    this.markMoved(player.playerId);
    this.setView(sourceId, {
      ...source,
      seats: source.seats.map((s) => (s.playerId === player.playerId ? { ...s, movingOut: true } : s)),
    });
    const sourceEntry = this.entry(sourceId);
    if (sourceEntry.state === 'ACTIVE') {
      this.indexUpdate(sourceId, () => this.index.setActive(sourceId, sourceEntry.tableNumber, sourceEntry.count - 1));
    }
    this.setView(destId, { ...dest, reservedSeats: [...dest.reservedSeats, choice.seat] });
    const destEntry = this.entry(destId);
    this.indexUpdate(destId, () => this.index.setActive(destId, destEntry.tableNumber, destEntry.count + 1));
    this.push({
      type: 'MOVE',
      reason,
      playerId: player.playerId,
      fromTableId: sourceId,
      fromSeat: player.seat,
      toTableId: destId,
      toSeat: choice.seat,
      breakdown,
    });
  }

  /** Move every staying player of a (BREAKING) table, in big-blind order. False when someone cannot be placed. */
  private evacuate(tableId: TableId): boolean {
    const table = this.table(tableId);
    const bySeat = new Map(stayingPlayers(table).map((s) => [s.seat, s]));
    let position = 0;
    for (const seat of predictBigBlindOrder(table)) {
      const player = bySeat.get(seat);
      if (player === undefined) continue; // a reserved seat: nobody to move
      const dest = this.findDestination();
      if (dest === null) return false;
      this.move(tableId, player, dest, 'TABLE_BREAK', { 'player.breakOrder': position, 'player.seat': seat });
      position += 1;
    }
    return true;
  }

  /**
   * Break all `tableIds` at once: every one is marked BREAKING first (so none
   * of them receives players), then each is evacuated in turn. False when some
   * player cannot be placed.
   */
  private breakTables(tableIds: readonly TableId[]): boolean {
    for (const tableId of tableIds) {
      const table = this.table(tableId);
      this.setView(tableId, { ...table, status: 'BREAKING' });
      this.indexUpdate(tableId, () => this.index.setBreaking(tableId, table.tableNumber));
      this.push({ type: 'BREAK_TABLE', tableId });
    }
    return tableIds.every((tableId) => this.evacuate(tableId));
  }

  /** BREAKING tables whose players have not all been sent away yet (e.g. an admin-initiated break). */
  private finishBreaks(): void {
    for (const tableId of [...this.index.breakingTables()]) {
      if (stayingPlayers(this.table(tableId)).length === 0) continue;
      const cp = this.checkpoint();
      if (!this.evacuate(tableId)) this.rollback(cp);
    }
  }

  /**
   * Break (activeTables - target) tables in one go. If their players cannot all
   * be placed (no capacity / no free physical seat), retry with one table fewer;
   * a break is never emitted partially.
   */
  private breakSurplusTables(target: number): void {
    const candidates = this.breakCandidates(this.index.activeTableCount - target);
    for (let n = candidates.length; n >= 1; n -= 1) {
      const cp = this.checkpoint();
      if (this.breakTables(candidates.slice(0, n))) return;
      this.rollback(cp);
    }
  }

  private balance(): void {
    // A move from a to b (a - b = 1) never improves balance; maxImbalance 0 is treated as 1.
    const tolerance = Math.max(1, this.ctx.balancing.maxImbalance);
    for (;;) {
      const destId = this.findDestination();
      if (destId === null) return;
      const sourceId = this.findSource(this.entry(destId).count + tolerance);
      if (sourceId === null) return;
      const source = this.table(sourceId);
      const pick = rankPlayersToMove(source, this.ctx.balancing, this.moved)[0];
      if (pick === undefined) return; // unreachable: canGive guarantees a candidate
      const player = source.seats.find((s) => s.playerId === pick.playerId) as SeatSummary;
      this.move(sourceId, player, destId, 'BALANCE', prefixed('player.', pick.breakdown));
    }
  }

  run(): BalancePlan {
    const { tableCfg, balancing, activePlayers, finalTableFormed } = this.ctx;
    assertBalancingConfig(balancing);
    const target = computeTableCount(activePlayers, tableCfg, balancing.consolidateBy);
    if (finalTableFormed || activePlayers < 2) return { targetTableCount: target, actions: [] };
    if (activePlayers <= tableCfg.finalTableSize) {
      return { targetTableCount: target, actions: this.index.openTableCount > 1 ? [{ type: 'FORM_FINAL_TABLE' }] : [] };
    }
    this.finishBreaks();
    this.breakSurplusTables(target);
    this.balance();
    return { targetTableCount: target, actions: this.actions.slice() };
  }
}

/**
 * Full planner (admin "rebalance now", recovery, tests): builds a private
 * TableCountIndex from `tables` (O(T)) and runs the algorithm. Never mutates
 * its inputs.
 */
export function planBalance(input: PlanBalanceInput): BalancePlan {
  const byId = new Map<TableId, TableSummary>();
  for (const t of input.tables) {
    if (byId.has(t.tableId)) throw new Error(`duplicate table ${t.tableId}`);
    byId.set(t.tableId, t);
  }
  const index = TableCountIndex.fromTables(input.tables);
  const lookup = (tableId: TableId): TableSummary => {
    const t = byId.get(tableId);
    if (t === undefined) throw new Error(`unknown table ${tableId}`);
    return t;
  };
  return new PlanRun(index, lookup, input).run();
}

/**
 * Incremental planner for the director's per-hand loop: the same algorithm as
 * planBalance (identical output for the same state) but driven by the
 * caller's TableCountIndex, so it only looks up the tables it actually
 * inspects (min/max buckets, the move sources/destinations, any BREAKING
 * table). The index is temporarily updated while planning and restored before
 * returning, so callers observe no mutation; apply the plan to the summaries
 * and `index.upsert` the changed tables afterwards.
 */
export function planAfterHand(input: PlanAfterHandInput): BalancePlan {
  const run = new PlanRun(input.index, input.getTable, input);
  try {
    return run.run();
  } finally {
    run.rollback();
  }
}
