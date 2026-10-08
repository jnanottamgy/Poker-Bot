import type { Draft } from './draft';
import { emit, fail, getPlayer, getTable, mustPlayer, putPlayer, putTable, tableCommand, ZERO_STATS } from './draft';
import { lateRegistrationOpen, newPlayerRecord, reentryOpen } from './registration';
import { chooseSeat, seatMove } from './moves';
import { createTable } from './start';
import type { DirectorPlayer, DirectorTable, PendingMove } from './types';

/**
 * LATE REGISTRATION / RE-ENTRY (normative): a new entry brings exactly
 * startingStack new chips into play (explicitly added to the expected chip
 * total), sits at the table with the fewest players (seat by the
 * blind-fairness formula), or at a new table when every table is full;
 * balancing then evens the tables out.
 */
export function lateRegister(d: Draft, input: Parameters<typeof newPlayerRecord>[0]): void {
  if (!lateRegistrationOpen(d.s)) fail('REGISTRATION_CLOSED', 'Registration is closed.');
  if (getPlayer(d, input.playerId)) fail('DUPLICATE', 'Player already registered.');
  if (d.s.counters.registered >= d.s.config.maxPlayers) fail('TOURNAMENT_FULL', 'The tournament is full.');
  const p = newPlayerRecord(input);
  if (p.status === 'PENDING_APPROVAL') {
    putPlayer(d, p);
    return;
  }
  seatNewEntry(d, p);
}

export function reenter(d: Draft, playerId: string, entryId: string): void {
  if (!reentryOpen(d.s)) fail('REENTRY_CLOSED', 'Re-entry is closed.');
  const p = mustPlayer(d, playerId);
  if (p.status !== 'ELIMINATED') fail('NOT_ELIMINATED', 'Only eliminated players can re-enter.');
  if (p.entries >= d.s.config.reentry.maxEntriesPerPlayer) fail('MAX_ENTRIES', 'No re-entries left for this player.');
  const past = p.elimination ? [...p.pastEliminations, p.elimination] : p.pastEliminations;
  d.s.counters = { ...d.s.counters, eliminated: d.s.counters.eliminated };
  seatNewEntry(d, {
    ...p,
    entryId,
    entries: p.entries + 1,
    status: 'REGISTERED',
    finishPosition: null,
    tiedCount: 1,
    prizeMinor: 0,
    elimination: null,
    pastEliminations: past,
    pendingBustOrder: null,
    stats: { ...ZERO_STATS, handsPlayedTotal: p.stats.handsPlayedTotal },
  });
}

function smallestOpenTable(d: Draft): DirectorTable | null {
  const min = d.index.minCount();
  if (min === null) return null;
  const id = d.index.firstWithCount(min);
  const t = id ? getTable(d, id) : undefined;
  if (!t || t.summary.status !== 'ACTIVE') return null;
  return t.summary.seats.length + t.summary.reservedSeats.length < Math.min(t.summary.maxSeats, d.s.config.tables.maxSize) ? t : null;
}

function seatNewEntry(d: Draft, p: DirectorPlayer): void {
  const stack = d.s.config.startingStack;
  let dest = smallestOpenTable(d);
  if (!dest) {
    dest = createTable(d, d.s.config.tables.maxSize, null, false);
    if (d.s.status === 'PAUSED') tableCommand(d, dest.summary.tableId, { type: 'HOLD', reason: 'PAUSE' });
    if (d.s.status === 'BREAK') tableCommand(d, dest.summary.tableId, { type: 'HOLD', reason: 'BREAK' });
    if (d.s.status !== 'STARTING') tableCommand(d, dest.summary.tableId, { type: 'START' });
  }
  const { seat, breakdown } = chooseSeat(d, dest, p.playerId, p.stats);
  putTable(d, { ...dest, summary: { ...dest.summary, reservedSeats: [...dest.summary.reservedSeats, seat] } });
  const moveNumber = d.s.seq.move + 1;
  d.s.seq = { ...d.s.seq, move: moveNumber };
  const move: PendingMove = {
    moveId: `${d.s.tournamentId}:M${moveNumber}`,
    playerId: p.playerId,
    reason: 'LATE_REGISTRATION',
    fromTableId: null,
    fromSeat: null,
    toTableId: dest.summary.tableId,
    toSeat: seat,
    status: 'SEATING',
    stack,
    stats: p.stats,
    requestedAt: d.now,
    scoreBreakdown: breakdown,
  };
  d.s.pendingMoves = { ...d.s.pendingMoves, [move.moveId]: move };
  putPlayer(d, { ...p, status: 'IN_TRANSIT', stack });
  d.s.counters = {
    ...d.s.counters,
    registered: d.s.counters.registered + 1,
    active: d.s.counters.active + 1,
    inTransit: d.s.counters.inTransit + 1,
    totalChips: d.s.counters.totalChips + stack,
  };
  emit(d, { kind: 'PLAYER_REGISTERED', playerId: p.playerId, displayName: p.displayName, registeredCount: d.s.counters.registered });
  seatMove(d, move);
}
