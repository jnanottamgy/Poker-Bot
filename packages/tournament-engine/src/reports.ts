import type { HandResultReport, HoldReason, PlayerId, RemovalReason, SeatIndex, SeatPositionStats, TableCommand, TableId, TableStatus } from '@jpb/shared-types';
import type { Draft } from './draft';
import { alert, emit, getPlayer, getTable, mustTable, putPlayer, putTable, tableCommand } from './draft';
import { cancelMove, onMoveRemoved, onMoveSeated, pendingMoveFor, reroute, seatMove } from './moves';
import { disqualified, processBusts } from './eliminations';
import type { Bust } from './eliminations';
import { checkGlobal, checkTableReport } from './integrity';
import { rebalance } from './balance';
import { progressFinalTable } from './finalTable';
import { autoHandForHand, progressHandForHand, recordRoundHand } from './handForHand';
import { fireMilestones } from './commentary';

/** HAND_RESULT: refresh the table summary, rank busts, check chips, then balance. */
export function onHandResult(d: Draft, r: HandResultReport): void {
  const t = getTable(d, r.tableId);
  if (!t || t.summary.status === 'CLOSED') {
    alert(d, 'WARNING', 'UNKNOWN_TABLE_REPORT', `Hand result from unknown or closed table ${r.tableId}.`, r.tableId);
    return;
  }
  const consistent = checkTableReport(d, r.tableId, r.totalChipsAtTable);
  const byPlayer = new Map(r.players.map((p) => [p.playerId, p]));
  // Busted players leave the summary now: the table removes them right after
  // this report, and planning must never try to move them (their later
  // PLAYER_REMOVED with reason ELIMINATED is then a no-op).
  const bustedIds = new Set(r.busted.map((b) => b.playerId));
  // A busted player's pending move is void (the table drops the queued removal when it eliminates them).
  for (const id of bustedIds) {
    const move = pendingMoveFor(d, id);
    if (move) cancelMove(d, move);
  }
  const seats = t.summary.seats
    .filter((s) => !bustedIds.has(s.playerId))
    .map((s) => {
      const rp = byPlayer.get(s.playerId);
      return rp ? { ...s, stack: rp.finalStack, stats: rp.stats ?? s.stats } : s;
    });
  putTable(d, {
    ...t,
    chips: consistent ? r.totalChipsAtTable : t.chips,
    lastHandAt: r.completedAt,
    handsCompleted: t.handsCompleted + 1,
    summary: {
      ...t.summary,
      seats,
      buttonSeat: r.buttonSeat,
      lastSmallBlindSeat: r.smallBlindPosition ?? r.smallBlindSeat,
      lastBigBlindSeat: r.bigBlindSeat,
      handNumber: r.handNumber,
      inHand: false,
    },
  });
  for (const rp of r.players) {
    const p = getPlayer(d, rp.playerId);
    if (p && p.tableId === r.tableId) putPlayer(d, { ...p, stack: rp.finalStack, stats: rp.stats ?? p.stats });
  }
  d.s.counters = {
    ...d.s.counters,
    handsCompleted: d.s.counters.handsCompleted + 1,
    largestPot: Math.max(d.s.counters.largestPot, r.largestPot),
  };

  const busts: Bust[] = r.busted.map((b) => ({ playerId: b.playerId, tableId: r.tableId, startingStack: b.startingStack, handId: r.handId, handNumber: r.handNumber }));
  if (!recordRoundHand(d, r.tableId, busts)) processBusts(d, busts);
  if (d.s.status === 'COMPLETED') return;
  autoHandForHand(d);
  if (d.s.handForHand.enabled) progressHandForHand(d);
  else rebalance(d);
  progressFinalTable(d);
  checkGlobal(d, consistent ? [] : [r.tableId]);
}

export function onPlayerRemoved(
  d: Draft,
  i: { tableId: TableId; playerId: PlayerId; seat: SeatIndex; stack: number; reason: RemovalReason; moveId: string | null; stats?: SeatPositionStats },
): void {
  const t = mustTable(d, i.tableId);
  const p = getPlayer(d, i.playerId);
  const remaining = t.summary.seats.filter((s) => s.playerId !== i.playerId);
  putTable(d, { ...t, chips: t.chips - i.stack, summary: { ...t.summary, seats: remaining } });
  d.s.chipsAtTables -= i.stack;
  const stats = i.stats ?? p?.stats;
  const move = i.moveId ? d.s.pendingMoves[i.moveId] : pendingMoveFor(d, i.playerId);

  if (i.reason === 'ELIMINATED') {
    // Ranking happens on HAND_RESULT (or at the end of a hand-for-hand round); any move is void.
    if (move) cancelMove(d, move);
  } else if (i.reason === 'DISQUALIFIED') {
    disqualified(d, i.playerId, i.tableId, i.stack);
  } else if (move && stats) {
    const inTransit = onMoveRemoved(d, move, i.stack, stats);
    if (inTransit.toTableId !== null) seatMove(d, inTransit);
  } else {
    alert(d, 'WARNING', 'UNEXPECTED_REMOVAL', `Player ${i.playerId} left table ${t.summary.tableNumber} without a pending move.`, i.tableId);
  }
  closeIfBroken(d, i.tableId);
  progressFinalTable(d);
  progressHandForHand(d);
  checkGlobal(d);
}

export function onPlayerSeated(d: Draft, i: { tableId: TableId; playerId: PlayerId; seat: SeatIndex; stack: number; moveId: string | null }): void {
  const move = i.moveId ? d.s.pendingMoves[i.moveId] : undefined;
  if (move) {
    onMoveSeated(d, move, i.tableId, i.seat, i.stack);
    checkGlobal(d);
  }
  // Initial seating (moveId null) was accounted for at START.
  progressFinalTable(d);
  progressHandForHand(d);
}

export function onStatusChanged(d: Draft, i: { tableId: TableId; status: TableStatus; holds: HoldReason[]; frozen: boolean }): void {
  const t = getTable(d, i.tableId);
  if (!t) return;
  putTable(d, { ...t, status: i.status, holds: i.holds, frozen: i.frozen, summary: { ...t.summary, inHand: i.status === 'IN_HAND' } });
  if ((d.s.status === 'COMPLETED' || d.s.status === 'CANCELLED') && i.status !== 'CLOSED' && i.status !== 'IN_HAND' && t.status === 'IN_HAND') {
    // A hand was still running when the tournament ended: close the table now that it finished.
    tableCommand(d, i.tableId, { type: 'CLOSE' });
  }
  progressFinalTable(d);
  progressHandForHand(d);
}

export function onStackAdjusted(d: Draft, i: { tableId: TableId; playerId: PlayerId; before: number; after: number }): void {
  const t = mustTable(d, i.tableId);
  const delta = i.after - i.before;
  putTable(d, { ...t, chips: t.chips + delta, summary: { ...t.summary, seats: t.summary.seats.map((s) => (s.playerId === i.playerId ? { ...s, stack: i.after } : s)) } });
  d.s.chipsAtTables += delta;
  d.s.chipsAdjusted += delta;
  d.s.counters = { ...d.s.counters, totalChips: d.s.counters.totalChips + delta };
  const p = getPlayer(d, i.playerId);
  if (p) putPlayer(d, { ...p, stack: i.after });
  checkGlobal(d);
}

export function onCommandFailed(d: Draft, i: { tableId: TableId; command: TableCommand; code: string }): void {
  const c = i.command;
  if (c.type === 'SEAT_PLAYER' && c.moveId && d.s.pendingMoves[c.moveId]) {
    reroute(d, d.s.pendingMoves[c.moveId]!);
    return;
  }
  if (c.type === 'CLOSE' && (i.code === 'HAND_IN_PROGRESS' || i.code === 'TABLE_CLOSED')) return; // retried on the next status change / already closed
  if (c.type === 'REMOVE_PLAYER' && c.moveId && d.s.pendingMoves[c.moveId]) {
    // The player already left this table (e.g. busted in the hand that just ended): the move is void.
    const move = d.s.pendingMoves[c.moveId]!;
    cancelMove(d, move);
    const t = getTable(d, i.tableId);
    if (t) putTable(d, { ...t, summary: { ...t.summary, seats: t.summary.seats.filter((s) => s.playerId !== move.playerId || !s.movingOut) } });
    if (getPlayer(d, move.playerId)?.status !== 'ELIMINATED') {
      alert(d, 'WARNING', 'MOVE_CANCELLED', `Move ${move.moveId} cancelled: ${i.code}.`, i.tableId);
    }
    closeIfBroken(d, i.tableId);
    progressFinalTable(d);
    progressHandForHand(d);
    return;
  }
  alert(d, 'WARNING', 'TABLE_COMMAND_FAILED', `Table ${i.tableId} rejected ${c.type}: ${i.code}`, i.tableId);
}

/** A BREAKING table with nobody left (and nobody inbound) closes. */
export function closeIfBroken(d: Draft, tableId: TableId): void {
  const t = getTable(d, tableId);
  if (!t || t.summary.status !== 'BREAKING') return;
  if (t.summary.seats.length > 0 || t.summary.reservedSeats.length > 0) return;
  putTable(d, { ...t, summary: { ...t.summary, status: 'CLOSED' } });
  tableCommand(d, tableId, { type: 'CLOSE' });
  d.s.counters = { ...d.s.counters, tables: Math.max(0, d.s.counters.tables - 1) };
  if (d.s.featuredTableId === tableId) d.s.featuredTableId = null;
  emit(d, { kind: 'MILESTONE', code: `TABLES_${d.s.counters.tables}_${t.summary.tableNumber}`, text: `TABLES REDUCED TO ${d.s.counters.tables}`, playersRemaining: d.s.counters.active });
  fireMilestones(d);
}
