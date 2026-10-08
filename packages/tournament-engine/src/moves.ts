import type { MoveReason, PlayerId, RemovalReason, SeatIndex, SeatPositionStats, TableId } from '@jpb/shared-types';
import { chooseSeatForIncoming } from '@jpb/seating-engine';
import type { Draft } from './draft';
import { alert, emit, fail, getPlayer, getTable, mustPlayer, mustTable, notify, putPlayer, putTable, tableCommand } from './draft';
import type { DirectorTable, PendingMove } from './types';

const RECENT_MOVES_KEPT = 16;

function removalReason(reason: MoveReason): RemovalReason {
  if (reason === 'TABLE_BREAK') return 'TABLE_BROKEN';
  if (reason === 'FINAL_TABLE') return 'FINAL_TABLE';
  return 'MOVED';
}

function setPending(d: Draft, move: PendingMove | null, moveId: string): void {
  const next = { ...d.s.pendingMoves };
  if (move) next[moveId] = move;
  else delete next[moveId];
  d.s.pendingMoves = next;
}

/** Players currently moving (any status). */
export function pendingMoveFor(d: Draft, playerId: PlayerId): PendingMove | null {
  for (const m of Object.values(d.s.pendingMoves)) if (m.playerId === playerId) return m;
  return null;
}

/**
 * Starts a move (normative protocol): REMOVE_PLAYER at the source (applied by
 * the table between hands — never mid-action); the source seat is flagged
 * movingOut and the destination seat reserved so nobody else is placed there.
 * When the source reports PLAYER_REMOVED with the exact stack the player is
 * IN_TRANSIT and SEAT_PLAYER is sent to the destination; PLAYER_SEATED
 * completes the move and the player is notified (TABLE CHANGE screen).
 * `toTableId` null = final-table pool (destination assigned when the final table is drawn).
 */
export function issueMove(
  d: Draft,
  m: { playerId: PlayerId; reason: MoveReason; fromTableId: TableId; toTableId: TableId | null; toSeat: SeatIndex | null; breakdown: Record<string, number> | null },
): PendingMove {
  if (pendingMoveFor(d, m.playerId)) fail('ALREADY_MOVING', 'This player is already being moved.');
  const source = mustTable(d, m.fromTableId);
  const seat = source.summary.seats.find((s) => s.playerId === m.playerId);
  if (!seat) fail('NOT_SEATED', `Player ${m.playerId} is not seated at table ${source.summary.tableNumber}.`);
  const moveNumber = d.s.seq.move + 1;
  d.s.seq = { ...d.s.seq, move: moveNumber };
  const move: PendingMove = {
    moveId: `${d.s.tournamentId}:M${moveNumber}`,
    playerId: m.playerId,
    reason: m.reason,
    fromTableId: m.fromTableId,
    fromSeat: seat.seat,
    toTableId: m.toTableId,
    toSeat: m.toSeat,
    status: 'REMOVING',
    stack: null,
    stats: null,
    requestedAt: d.now,
    scoreBreakdown: m.breakdown,
  };
  setPending(d, move, move.moveId);
  putTable(d, {
    ...source,
    summary: { ...source.summary, seats: source.summary.seats.map((s) => (s.playerId === m.playerId ? { ...s, movingOut: true } : s)) },
  });
  if (m.toTableId !== null && m.toSeat !== null) reserveSeat(d, m.toTableId, m.toSeat);
  tableCommand(d, m.fromTableId, { type: 'REMOVE_PLAYER', playerId: m.playerId, reason: removalReason(m.reason), moveId: move.moveId });
  return move;
}

function reserveSeat(d: Draft, tableId: TableId, seat: SeatIndex): void {
  const t = mustTable(d, tableId);
  if (t.summary.reservedSeats.includes(seat) || t.summary.seats.some((s) => s.seat === seat)) {
    fail('SEAT_UNAVAILABLE', `Seat ${seat} of table ${t.summary.tableNumber} is not free.`);
  }
  putTable(d, { ...t, summary: { ...t.summary, reservedSeats: [...t.summary.reservedSeats, seat] } });
}

function unreserveSeat(d: Draft, tableId: TableId | null, seat: SeatIndex | null): void {
  if (tableId === null || seat === null) return;
  const t = getTable(d, tableId);
  if (!t) return;
  putTable(d, { ...t, summary: { ...t.summary, reservedSeats: t.summary.reservedSeats.filter((r) => r !== seat) } });
}

/** Free seat for an incoming player at `table`, chosen by the documented blind-fairness formula. */
export function chooseSeat(d: Draft, table: DirectorTable, playerId: PlayerId, stats: SeatPositionStats): { seat: SeatIndex; breakdown: Record<string, number> } {
  const choice = chooseSeatForIncoming(table.summary, { playerId, stats }, d.s.config.balancing.weights);
  return { seat: choice.seat, breakdown: choice.breakdown };
}

/** Sends SEAT_PLAYER for an in-transit move to its destination. */
export function seatMove(d: Draft, move: PendingMove): void {
  if (move.toTableId === null || move.toSeat === null || move.stack === null) return;
  const p = mustPlayer(d, move.playerId);
  tableCommand(d, move.toTableId, {
    type: 'SEAT_PLAYER',
    playerId: p.playerId,
    displayName: p.displayName,
    publicId: p.publicId,
    seat: move.toSeat,
    stack: move.stack,
    stats: move.stats ?? p.stats,
    moveId: move.moveId,
  });
  setPending(d, { ...move, status: 'SEATING' }, move.moveId);
}

/** Cancels a move (e.g. the player busted before it applied). Releases the reservation. */
export function cancelMove(d: Draft, move: PendingMove): void {
  unreserveSeat(d, move.toTableId, move.toSeat);
  setPending(d, null, move.moveId);
  if (move.status === 'SEATING') d.s.counters = { ...d.s.counters, inTransit: Math.max(0, d.s.counters.inTransit - 1) };
}

/** PLAYER_REMOVED for a move: the player is in transit with an exact stack. */
export function onMoveRemoved(d: Draft, move: PendingMove, stack: number, stats: SeatPositionStats): PendingMove {
  const p = mustPlayer(d, move.playerId);
  putPlayer(d, { ...p, status: 'IN_TRANSIT', tableId: null, seat: null, stack, stats });
  const updated: PendingMove = { ...move, stack, stats, status: 'SEATING' };
  setPending(d, updated, move.moveId);
  d.s.counters = { ...d.s.counters, inTransit: d.s.counters.inTransit + 1 };
  return updated;
}

/** PLAYER_SEATED for a move: completes it. */
export function onMoveSeated(d: Draft, move: PendingMove, tableId: TableId, seat: SeatIndex, stack: number): void {
  const p = mustPlayer(d, move.playerId);
  const table = mustTable(d, tableId);
  const stats = move.stats ?? p.stats;
  const recent = [...p.recentMovesAtHand, stats.handsPlayedTotal].slice(-RECENT_MOVES_KEPT);
  putTable(d, {
    ...table,
    chips: table.chips + stack,
    summary: {
      ...table.summary,
      reservedSeats: table.summary.reservedSeats.filter((r) => r !== seat),
      seats: [...table.summary.seats.filter((s) => s.seat !== seat), { seat, playerId: p.playerId, stack, stats, recentMovesAtHand: recent }].sort((a, b) => a.seat - b.seat),
    },
  });
  d.s.chipsAtTables += stack;
  putPlayer(d, { ...p, status: p.suspended ? 'SUSPENDED' : 'SEATED', tableId, seat, stack, stats, recentMovesAtHand: recent });
  setPending(d, null, move.moveId);
  d.s.counters = { ...d.s.counters, inTransit: Math.max(0, d.s.counters.inTransit - 1) };
  const fromNumber = move.fromTableId ? (getTable(d, move.fromTableId)?.summary.tableNumber ?? null) : null;
  const movement = {
    moveId: move.moveId,
    playerId: p.playerId,
    reason: move.reason,
    fromTableId: move.fromTableId,
    fromSeat: move.fromSeat,
    toTableId: tableId,
    toSeat: seat,
    stack,
    requestedAt: move.requestedAt,
    completedAt: d.now,
    scoreBreakdown: move.scoreBreakdown,
  };
  emit(d, { kind: 'TABLE_MOVE', movement, fromTableNumber: fromNumber, toTableNumber: table.summary.tableNumber });
  notify(d, p.playerId, { kind: 'TABLE_MOVE', fromTableNumber: fromNumber, fromSeat: move.fromSeat, toTableNumber: table.summary.tableNumber, toSeat: seat, stack });
  if (p.suspended) tableCommand(d, tableId, { type: 'SET_SUSPENDED', playerId: p.playerId, suspended: true });
}

/** The destination refused SEAT_PLAYER (seat taken / table closed): pick another seat or table. */
export function reroute(d: Draft, move: PendingMove): void {
  unreserveSeat(d, move.toTableId, move.toSeat);
  const target = move.toTableId ? getTable(d, move.toTableId) : undefined;
  const p = getPlayer(d, move.playerId);
  if (!p || move.stack === null) return;
  const candidates = [target, ...[d.index.firstWithCount(d.index.minCount() ?? 0)].map((id) => (id ? getTable(d, id) : undefined))].filter(
    (t): t is DirectorTable => !!t && t.summary.status === 'ACTIVE' && t.summary.seats.length + t.summary.reservedSeats.length < t.summary.maxSeats,
  );
  const dest = candidates[0];
  if (!dest) {
    alert(d, 'CRITICAL', 'MOVE_STUCK', `No free seat for ${p.displayName} (move ${move.moveId}).`, move.toTableId);
    return;
  }
  const { seat, breakdown } = chooseSeat(d, dest, p.playerId, move.stats ?? p.stats);
  reserveSeat(d, dest.summary.tableId, seat);
  const next = { ...move, toTableId: dest.summary.tableId, toSeat: seat, scoreBreakdown: { ...(move.scoreBreakdown ?? {}), ...breakdown } };
  seatMove(d, next);
}
