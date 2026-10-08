import { planFinalTable } from '@jpb/balancing-engine';
import type { Draft } from './draft';
import { emit, getPlayer, holdAll, openTables, putTable, tableCommand, transition } from './draft';
import { issueMove, seatMove } from './moves';
import { createTable } from './start';
import type { PendingMove } from './types';

/**
 * FINAL TABLE (normative): when active players <= finalTableSize and more
 * than one table is open, every table is HELD (hands in progress finish);
 * once every table is between hands and no move is half-done, every player
 * is removed (reason FINAL_TABLE) into a pool; when the pool holds every
 * remaining player, a new table is created, seats are drawn with
 * drawSource('final-table') (planFinalTable — stacks never influence the
 * draw), the old tables close and play resumes.
 */
export function beginFinalTable(d: Draft): void {
  if (d.s.finalTable.formed || d.s.finalTable.forming) return;
  d.s.finalTable = { ...d.s.finalTable, forming: true };
  if (d.s.handForHand.enabled) {
    d.s.handForHand = { ...d.s.handForHand, enabled: false, manual: false, phase: 'OFF', awaiting: [] };
    for (const t of openTables(d)) tableCommand(d, t.summary.tableId, { type: 'SET_HAND_FOR_HAND', enabled: false });
    emit(d, { kind: 'HAND_FOR_HAND', enabled: false });
  }
  holdAll(d, 'FINAL_TABLE');
  progressFinalTable(d);
}

/** Advances final-table formation as far as current table states allow. */
export function progressFinalTable(d: Draft): void {
  if (!d.s.finalTable.forming) return;
  const tables = openTables(d).filter((t) => !t.isFinalTable || t.summary.tableId !== d.s.finalTable.tableId);
  const settled = tables.every((t) => t.status === 'HELD' || t.status === 'WAITING' || t.status === 'CLOSED');
  const moves = Object.values(d.s.pendingMoves);
  if (!settled || moves.some((m) => m.status === 'REMOVING')) return;
  if (moves.some((m) => m.status === 'SEATING' && m.reason !== 'FINAL_TABLE')) return;
  // Phase 1: pull every seated player into the pool.
  let issued = false;
  for (const t of tables) {
    for (const s of t.summary.seats) {
      if (s.movingOut) continue;
      issueMove(d, { playerId: s.playerId, reason: 'FINAL_TABLE', fromTableId: t.summary.tableId, toTableId: null, toSeat: null, breakdown: null });
      issued = true;
    }
  }
  if (issued) return;
  const pool = Object.values(d.s.pendingMoves).filter((m) => m.reason === 'FINAL_TABLE' && m.status === 'SEATING');
  if (pool.length < d.s.counters.active) return;
  seatFinalTable(d, pool);
}

function seatFinalTable(d: Draft, pool: PendingMove[]): void {
  const maxSeats = Math.max(d.s.config.tables.finalTableSize, Math.min(d.s.config.tables.maxSize, pool.length));
  const plan = planFinalTable({
    players: pool.map((m) => ({ playerId: m.playerId, stack: m.stack ?? 0 })),
    maxSeats,
    rng: d.ctx.drawSource('final-table'),
  });
  // Old tables close (they are empty and held).
  for (const t of openTables(d)) {
    putTable(d, { ...t, summary: { ...t.summary, status: 'CLOSED', seats: [], reservedSeats: [] }, chips: 0 });
    tableCommand(d, t.summary.tableId, { type: 'CLOSE' });
    d.s.counters = { ...d.s.counters, tables: Math.max(0, d.s.counters.tables - 1) };
  }
  const table = createTable(d, maxSeats, plan.buttonSeat, true);
  putTable(d, { ...table, summary: { ...table.summary, reservedSeats: plan.seats.map((s) => s.seat) } });
  for (const { playerId, seat } of plan.seats) {
    const move = pool.find((m) => m.playerId === playerId)!;
    seatMove(d, { ...move, toTableId: table.summary.tableId, toSeat: seat });
  }
  d.s.finalTable = { formed: true, forming: false, tableId: table.summary.tableId, formedAt: d.now, pool: [] };
  if (d.s.status === 'RUNNING') transition(d, 'FINAL_TABLE', 'final table formed');
  else if (d.s.status === 'BREAK') d.s.resumeTo = 'FINAL_TABLE';
  else if (d.s.status === 'PAUSED' && d.s.pausedFrom === 'RUNNING') d.s.pausedFrom = 'FINAL_TABLE';
  else if (d.s.status === 'PAUSED' && d.s.pausedFrom === 'BREAK') d.s.resumeTo = 'FINAL_TABLE';
  if (d.s.status === 'PAUSED') tableCommand(d, table.summary.tableId, { type: 'HOLD', reason: 'PAUSE' });
  if (d.s.status === 'BREAK' || (d.s.status === 'PAUSED' && d.s.pausedFrom === 'BREAK')) tableCommand(d, table.summary.tableId, { type: 'HOLD', reason: 'BREAK' });
  if (d.s.frozen) tableCommand(d, table.summary.tableId, { type: 'FREEZE' });
  tableCommand(d, table.summary.tableId, { type: 'START' });
  emit(d, {
    kind: 'FINAL_TABLE_FORMED',
    tableId: table.summary.tableId,
    players: plan.seats.map(({ playerId, seat }) => ({
      playerId,
      displayName: getPlayer(d, playerId)?.displayName ?? playerId,
      seat,
      stack: pool.find((m) => m.playerId === playerId)?.stack ?? 0,
    })),
  });
}
