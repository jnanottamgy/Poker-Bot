import type { BlindLevel, BreakRule, PlayerId, SeatIndex, TableId, TimingConfig, TournamentConfig, TournamentStatus } from '@jpb/shared-types';
import type { Draft } from './draft';
import { emit, fail, getTable, holdAll, mustPlayer, mustTable, openTables, putPlayer, putTable, releaseAll, tableCommand, tableTiming, transition } from './draft';
import { endBreak, pauseClock, resumeClock, startBreak, startLevel } from './clock';
import { chooseSeat, issueMove, pendingMoveFor } from './moves';
import { balancingAllowed, rebalance } from './balance';
import { disableHandForHand, enableHandForHand, progressHandForHand } from './handForHand';
import { withdraw } from './registration';

const PLAYING: readonly string[] = ['RUNNING', 'FINAL_TABLE'];

/** PAUSE (after hand): every table holds once its current hand completes; the clock stops. */
export function pause(d: Draft): void {
  if (!['RUNNING', 'FINAL_TABLE', 'BREAK'].includes(d.s.status)) fail('ILLEGAL_STATE', `Cannot pause in ${d.s.status}.`);
  d.s.pausedFrom = d.s.status;
  transition(d, 'PAUSED', 'paused by admin');
  pauseClock(d);
  holdAll(d, 'PAUSE');
  emit(d, { kind: 'TOURNAMENT_PAUSED', mode: 'AFTER_HAND', reason: null });
}

export function resume(d: Draft): void {
  if (d.s.status !== 'PAUSED') fail('ILLEGAL_STATE', 'The tournament is not paused.');
  const back = d.s.pausedFrom ?? 'RUNNING';
  d.s.pausedFrom = null;
  transition(d, back, 'resumed by admin');
  if (!d.s.frozen) resumeClock(d);
  releaseAll(d, 'PAUSE');
  emit(d, { kind: 'TOURNAMENT_RESUMED' });
  progressHandForHand(d);
}

/** EMERGENCY FREEZE: every table stops processing actions immediately; timers and the clock are suspended. */
export function freeze(d: Draft): void {
  if (d.s.frozen) fail('ILLEGAL_STATE', 'Already frozen.');
  if (['DRAFT', 'COMPLETED', 'CANCELLED'].includes(d.s.status)) fail('ILLEGAL_STATE', `Cannot freeze in ${d.s.status}.`);
  d.s.frozen = true;
  pauseClock(d);
  for (const t of openTables(d)) tableCommand(d, t.summary.tableId, { type: 'FREEZE' });
  emit(d, { kind: 'TOURNAMENT_PAUSED', mode: 'EMERGENCY_FREEZE', reason: null });
}

export function unfreeze(d: Draft): void {
  if (!d.s.frozen) fail('ILLEGAL_STATE', 'Not frozen.');
  d.s.frozen = false;
  if (d.s.status !== 'PAUSED') resumeClock(d);
  for (const t of openTables(d)) tableCommand(d, t.summary.tableId, { type: 'UNFREEZE' });
  emit(d, { kind: 'TOURNAMENT_RESUMED' });
  progressHandForHand(d);
}

function requireClockState(d: Draft): void {
  if (![...PLAYING, 'PAUSED'].includes(d.s.status)) fail('ILLEGAL_STATE', `Level changes are not possible in ${d.s.status}.`);
}

/** Jumps to level index `index`; when paused the new level's full duration is kept for resume. */
function goToLevel(d: Draft, index: number): void {
  requireClockState(d);
  const paused = d.s.clock.pausedAt !== null;
  startLevel(d, index);
  if (paused) {
    const c = d.s.clock;
    d.s.clock = { ...c, pausedRemainingMs: c.levelEndsAt === null ? null : c.levelEndsAt - d.now, levelEndsAt: null };
  }
}

export function advanceLevel(d: Draft): void {
  if (d.s.clock.levelIndex >= d.s.config.blindSchedule.length - 1) fail('LAST_LEVEL', 'Already at the last blind level.');
  goToLevel(d, d.s.clock.levelIndex + 1);
}

export function setLevel(d: Draft, level: number): void {
  const index = d.s.config.blindSchedule.findIndex((l) => l.level === level);
  if (index < 0) fail('INVALID_LEVEL', `Level ${level} does not exist.`);
  goToLevel(d, index);
}

/** Adds (or removes, if negative) time to the current level or break. Never moves the end before now. */
export function addTime(d: Draft, ms: number): void {
  if (!Number.isSafeInteger(ms) || ms === 0 || Math.abs(ms) > 6 * 3_600_000) fail('INVALID', 'Time must be a non-zero whole number of ms within 6 hours.');
  const c = d.s.clock;
  if (c.pausedAt !== null) {
    if (c.pausedRemainingMs !== null) d.s.clock = { ...c, pausedRemainingMs: Math.max(0, c.pausedRemainingMs + ms) };
    else if (c.pausedBreakRemainingMs !== null) d.s.clock = { ...c, pausedBreakRemainingMs: Math.max(0, c.pausedBreakRemainingMs + ms) };
    else fail('NO_CLOCK', 'The clock is not running.');
    return;
  }
  if (d.s.status === 'BREAK' && c.breakEndsAt !== null) d.s.clock = { ...c, breakEndsAt: Math.max(d.now, c.breakEndsAt + ms) };
  else if (c.levelEndsAt !== null) d.s.clock = { ...c, levelEndsAt: Math.max(d.now, c.levelEndsAt + ms) };
  else fail('NO_CLOCK', 'The clock is not running (last level or not started).');
}

export function adminStartBreak(d: Draft, durationSeconds: number): void {
  if (!PLAYING.includes(d.s.status)) fail('ILLEGAL_STATE', `Cannot start a break in ${d.s.status}.`);
  if (!Number.isSafeInteger(durationSeconds) || durationSeconds < 10 || durationSeconds > 7200) fail('INVALID', 'Break duration must be 10–7200 seconds.');
  // An ad-hoc break keeps the current level: remember its remaining time and restore it afterwards.
  const remaining = d.s.clock.levelEndsAt === null ? null : Math.max(0, d.s.clock.levelEndsAt - d.now);
  startBreak(d, durationSeconds, null, d.now);
  d.s.clock = { ...d.s.clock, pendingBreakAfterLevel: null, pausedRemainingMs: remaining };
}

export function adminEndBreak(d: Draft): void {
  if (d.s.status !== 'BREAK') fail('ILLEGAL_STATE', 'No break is running.');
  if (d.s.clock.pendingBreakAfterLevel === null) {
    // ad-hoc break: resume the same level with the time it had left
    const remaining = d.s.clock.pausedRemainingMs;
    const back = d.s.resumeTo ?? 'RUNNING';
    d.s.resumeTo = null;
    transition(d, back, 'break ended by admin');
    d.s.clock = { ...d.s.clock, breakEndsAt: null, pausedRemainingMs: null, levelEndsAt: remaining === null ? null : d.now + remaining };
    emit(d, { kind: 'BREAK_ENDED' });
    releaseAll(d, 'BREAK');
    return;
  }
  endBreak(d);
}

export function setHandForHand(d: Draft, enabled: boolean): void {
  if (enabled) {
    if (d.s.status !== 'RUNNING') fail('ILLEGAL_STATE', 'Hand-for-hand needs a running tournament with several tables.');
    if (d.s.counters.tables < 2) fail('ILLEGAL_STATE', 'Hand-for-hand needs at least two tables.');
    enableHandForHand(d, true);
    progressHandForHand(d);
  } else disableHandForHand(d);
}

export function movePlayer(d: Draft, playerId: PlayerId, toTableId: TableId, toSeat: SeatIndex | null): void {
  const p = mustPlayer(d, playerId);
  if (p.status !== 'SEATED' && p.status !== 'SUSPENDED') fail('NOT_SEATED', 'Only seated players can be moved.');
  if (pendingMoveFor(d, playerId)) fail('ALREADY_MOVING', 'This player is already being moved.');
  if (!p.tableId) fail('NOT_SEATED', 'Player has no table.');
  if (p.tableId === toTableId) fail('SAME_TABLE', 'The player is already at that table.');
  if (d.s.finalTable.forming) fail('ILLEGAL_STATE', 'The final table is being formed.');
  const dest = mustTable(d, toTableId);
  if (dest.summary.status !== 'ACTIVE') fail('TABLE_NOT_ACTIVE', 'The destination table is not active.');
  const free = dest.summary.maxSeats - dest.summary.seats.length - dest.summary.reservedSeats.length;
  if (free <= 0) fail('TABLE_FULL', 'The destination table is full.');
  let seat = toSeat;
  let breakdown: Record<string, number> | null = null;
  if (seat === null) ({ seat, breakdown } = chooseSeat(d, dest, playerId, p.stats));
  else if (seat < 0 || seat >= dest.summary.maxSeats) fail('SEAT_UNAVAILABLE', 'No such seat.');
  issueMove(d, { playerId, reason: 'ADMIN', fromTableId: p.tableId, toTableId, toSeat: seat, breakdown });
}

export function adminRebalance(d: Draft): void {
  if (!balancingAllowed(d)) fail('ILLEGAL_STATE', 'Balancing is not possible right now (final table, frozen, or mid hand-for-hand round).');
  rebalance(d);
}

export function breakTable(d: Draft, tableId: TableId): void {
  if (!balancingAllowed(d)) fail('ILLEGAL_STATE', 'Tables cannot be broken right now.');
  const t = mustTable(d, tableId);
  if (t.summary.status !== 'ACTIVE') fail('TABLE_NOT_ACTIVE', 'Table is not active.');
  if (d.s.counters.tables < 2) fail('LAST_TABLE', 'The last table cannot be broken.');
  const others = openTables(d).filter((x) => x.summary.tableId !== tableId && x.summary.status === 'ACTIVE');
  const freeElsewhere = others.reduce((n, x) => n + x.summary.maxSeats - x.summary.seats.length - x.summary.reservedSeats.length, 0);
  const leaving = t.summary.seats.filter((s) => !s.movingOut).length;
  if (freeElsewhere < leaving) fail('NO_ROOM', 'Other tables do not have enough free seats.');
  putTable(d, { ...t, summary: { ...t.summary, status: 'BREAKING' } });
  // Seat each player at the currently smallest table, by the blind-fairness formula.
  for (const s of t.summary.seats) {
    if (s.movingOut) continue;
    const dest = openTables(d)
      .filter((x) => x.summary.tableId !== tableId && x.summary.status === 'ACTIVE' && x.summary.seats.length + x.summary.reservedSeats.length < x.summary.maxSeats)
      .sort((a, b) => a.summary.seats.length + a.summary.reservedSeats.length - (b.summary.seats.length + b.summary.reservedSeats.length) || a.summary.tableNumber - b.summary.tableNumber)[0]!;
    const { seat, breakdown } = chooseSeat(d, dest, s.playerId, s.stats);
    issueMove(d, { playerId: s.playerId, reason: 'TABLE_BREAK', fromTableId: tableId, toTableId: dest.summary.tableId, toSeat: seat, breakdown });
  }
  emit(d, { kind: 'TABLE_BROKEN', tableId, tableNumber: t.summary.tableNumber, playersMoved: leaving });
}

export function tableAdmin(d: Draft, tableId: TableId, command: 'HOLD' | 'RELEASE' | 'FREEZE' | 'UNFREEZE' | 'FORCE_TIMEOUT', ms?: number): void {
  const t = getTable(d, tableId);
  if (!t || t.summary.status === 'CLOSED') fail('TABLE_NOT_FOUND', 'No such open table.');
  if (command === 'HOLD') tableCommand(d, tableId, { type: 'HOLD', reason: 'ADMIN' });
  else if (command === 'RELEASE') tableCommand(d, tableId, { type: 'RELEASE', reason: 'ADMIN' });
  else if (command === 'FREEZE') tableCommand(d, tableId, { type: 'FREEZE' });
  else if (command === 'UNFREEZE') tableCommand(d, tableId, { type: 'UNFREEZE' });
  else if (ms !== undefined) tableCommand(d, tableId, { type: 'ADMIN_ADD_TIME', ms });
  else tableCommand(d, tableId, { type: 'ADMIN_FORCE_TIMEOUT' });
}

export function tableAddTime(d: Draft, tableId: TableId, ms: number): void {
  if (!Number.isSafeInteger(ms) || ms < 1000 || ms > 600_000) fail('INVALID', 'Extra time must be 1–600 seconds.');
  tableAdmin(d, tableId, 'FORCE_TIMEOUT', ms);
}

/** SUSPEND: the player stays seated (blinds keep being posted) but every decision is auto-timed-out immediately. */
export function suspend(d: Draft, playerId: PlayerId, suspended: boolean): void {
  const p = mustPlayer(d, playerId);
  if (!['SEATED', 'SUSPENDED', 'IN_TRANSIT'].includes(p.status)) fail('NOT_ACTIVE', 'Only active players can be suspended or restored.');
  if (p.suspended === suspended) fail('NO_CHANGE', suspended ? 'Already suspended.' : 'Not suspended.');
  const status = p.status === 'IN_TRANSIT' ? 'IN_TRANSIT' : suspended ? 'SUSPENDED' : 'SEATED';
  putPlayer(d, { ...p, suspended, status });
  if (p.tableId) tableCommand(d, p.tableId, { type: 'SET_SUSPENDED', playerId, suspended });
  d.effects.push({ type: 'NOTIFY_PLAYER', playerId, notice: suspended ? { kind: 'SUSPENDED', reason: null } : { kind: 'RESTORED' } });
}

export function disqualify(d: Draft, playerId: PlayerId): void {
  const p = mustPlayer(d, playerId);
  if (p.status === 'REGISTERED' || p.status === 'PENDING_APPROVAL') {
    withdraw(d, playerId);
    putPlayer(d, { ...mustPlayer(d, playerId), status: 'DISQUALIFIED' });
    return;
  }
  if (p.status === 'IN_TRANSIT') fail('IN_TRANSIT', 'The player is changing tables; try again in a moment.');
  if (p.status !== 'SEATED' && p.status !== 'SUSPENDED') fail('NOT_ACTIVE', 'Only active players can be disqualified.');
  if (pendingMoveFor(d, playerId)) fail('ALREADY_MOVING', 'The player is being moved; try again in a moment.');
  tableCommand(d, p.tableId!, { type: 'REMOVE_PLAYER', playerId, reason: 'DISQUALIFIED', moveId: null });
}

export function adjustStack(d: Draft, playerId: PlayerId, newStack: number): void {
  if (!Number.isSafeInteger(newStack) || newStack < 0) fail('INVALID', 'Stack must be a non-negative whole number.');
  const p = mustPlayer(d, playerId);
  if ((p.status !== 'SEATED' && p.status !== 'SUSPENDED') || !p.tableId) fail('NOT_SEATED', 'Stacks can only be adjusted for seated players (between hands).');
  tableCommand(d, p.tableId, { type: 'ADMIN_ADJUST_STACK', playerId, newStack });
}

export function announce(d: Draft, text: string): void {
  const clean = text.trim();
  if (clean.length < 1 || clean.length > 280) fail('INVALID', 'Announcements must be 1–280 characters.');
  emit(d, { kind: 'ANNOUNCEMENT', text: clean, from: 'ADMIN' });
}

export function setFeatured(d: Draft, tableId: TableId | null): void {
  if (tableId !== null) {
    const t = getTable(d, tableId);
    if (!t || t.summary.status === 'CLOSED') fail('TABLE_NOT_FOUND', 'No such open table.');
  }
  d.s.featuredTableId = tableId;
}

/** Only levels after the current one (and the break rules) may change while running. */
export function updateSchedule(d: Draft, schedule: BlindLevel[], breaks: BreakRule[]): void {
  const cur = d.s.clock.levelIndex;
  const old = d.s.config.blindSchedule;
  if (schedule.length <= cur) fail('INVALID', 'The schedule must keep the current level.');
  for (let i = 0; i <= cur; i++) {
    const a = old[i]!;
    const b = schedule[i]!;
    if (a.level !== b.level || a.smallBlind !== b.smallBlind || a.bigBlind !== b.bigBlind || a.ante !== b.ante || a.durationSeconds !== b.durationSeconds) {
      fail('INVALID', 'Past and current levels cannot be changed.');
    }
  }
  d.s.config = { ...d.s.config, blindSchedule: schedule, breaks };
  const c = d.s.clock;
  // The current level may stop being the last one (or become the last one).
  if (c.levelStartedAt !== null && c.pausedAt === null && d.s.status !== 'BREAK') {
    const isLast = cur >= schedule.length - 1;
    const end = isLast ? null : Math.max(d.now, c.levelStartedAt + schedule[cur]!.durationSeconds * 1000);
    d.s.clock = { ...c, levelEndsAt: end };
  }
}

const PRE_START: readonly TournamentStatus[] = ['DRAFT', 'REGISTRATION', 'REGISTRATION_CLOSED'];

export function setConfig(d: Draft, config: TournamentConfig): void {
  if (!PRE_START.includes(d.s.status)) fail('CONFIG_LOCKED', 'The configuration is locked once the tournament starts.');
  if (config.maxPlayers < d.s.counters.registered) fail('INVALID', `${d.s.counters.registered} players are already registered; the maximum cannot be lower.`);
  d.s.config = config;
}

export function setPolicies(d: Draft, spectators: TournamentConfig['spectators'], features: TournamentConfig['features']): void {
  d.s.config = { ...d.s.config, spectators, features };
}

export function updateTiming(d: Draft, timing: TimingConfig): void {
  d.s.config = { ...d.s.config, timing };
  const t = tableTiming(d);
  for (const table of openTables(d)) tableCommand(d, table.summary.tableId, { type: 'SET_TIMING', timing: t });
}

export function cancel(d: Draft): void {
  if (['COMPLETED', 'CANCELLED'].includes(d.s.status)) fail('ILLEGAL_STATE', 'The tournament is already over.');
  d.s.pausedFrom = null;
  transition(d, 'CANCELLED', 'cancelled by admin');
  d.s.completedAt = d.now;
  for (const t of openTables(d)) {
    tableCommand(d, t.summary.tableId, { type: 'HOLD', reason: 'ADMIN' });
    tableCommand(d, t.summary.tableId, { type: 'CLOSE' });
  }
}
