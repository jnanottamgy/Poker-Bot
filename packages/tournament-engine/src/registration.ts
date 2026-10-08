import type { DirectorPlayer, DirectorState } from './types';
import type { Draft } from './draft';
import { emit, fail, getPlayer, mustPlayer, putPlayer, transition, ZERO_STATS } from './draft';
import { currentLevel } from './clock';

/** Late registration is open while the tournament runs and the current level is <= untilLevel. */
export function lateRegistrationOpen(state: DirectorState): boolean {
  const lr = state.config.lateRegistration;
  if (!lr.enabled || !state.config.features.lateRegistration) return false;
  if (!['STARTING', 'RUNNING', 'BREAK', 'PAUSED'].includes(state.status)) return false;
  if (state.finalTable.formed || state.finalTable.forming) return false;
  return (currentLevel(state)?.level ?? 1) <= lr.untilLevel;
}

export function reentryOpen(state: DirectorState): boolean {
  const re = state.config.reentry;
  if (!re.enabled) return false;
  if (!['RUNNING', 'BREAK', 'PAUSED'].includes(state.status)) return false;
  if (state.finalTable.formed || state.finalTable.forming) return false;
  return (currentLevel(state)?.level ?? 1) <= re.untilLevel;
}

/** Finishing positions are deferred while new entries can still join (they would shift positions). */
export function positionsDeferred(state: DirectorState): boolean {
  return lateRegistrationOpen(state) || reentryOpen(state);
}

export function newPlayerRecord(input: {
  playerId: string;
  entryId: string;
  displayName: string;
  publicId: string;
  registrationSeq: number;
  clientSeed: string | null;
  approved: boolean;
}): DirectorPlayer {
  return {
    playerId: input.playerId,
    entryId: input.entryId,
    displayName: input.displayName,
    publicId: input.publicId,
    registrationSeq: input.registrationSeq,
    clientSeed: input.clientSeed,
    status: input.approved ? 'REGISTERED' : 'PENDING_APPROVAL',
    tableId: null,
    seat: null,
    stack: 0,
    stats: { ...ZERO_STATS },
    recentMovesAtHand: [],
    suspended: false,
    entries: 1,
    finishPosition: null,
    tiedCount: 1,
    prizeMinor: 0,
    elimination: null,
    pastEliminations: [],
    pendingBustOrder: null,
  };
}

export function openRegistration(d: Draft): void {
  transition(d, 'REGISTRATION', 'registration opened');
}

export function closeRegistration(d: Draft): void {
  transition(d, 'REGISTRATION_CLOSED', 'registration closed');
}

export function reopenRegistration(d: Draft): void {
  transition(d, 'REGISTRATION', 'registration reopened');
}

/** Registration before the start (REGISTRATION). Late registration is handled by lateRegister. */
export function register(d: Draft, input: Parameters<typeof newPlayerRecord>[0]): void {
  if (d.s.status !== 'REGISTRATION') fail('REGISTRATION_CLOSED', 'Registration is closed.');
  if (getPlayer(d, input.playerId)) fail('DUPLICATE', 'Player already registered.');
  const counted = d.s.counters.registered;
  if (counted >= d.s.config.maxPlayers) fail('TOURNAMENT_FULL', 'The tournament is full.');
  const p = newPlayerRecord(input);
  putPlayer(d, p);
  if (p.status === 'REGISTERED') {
    d.s.counters = { ...d.s.counters, registered: counted + 1 };
    emit(d, { kind: 'PLAYER_REGISTERED', playerId: p.playerId, displayName: p.displayName, registeredCount: counted + 1 });
  }
}

export function approve(d: Draft, playerId: string): void {
  const p = mustPlayer(d, playerId);
  if (p.status !== 'PENDING_APPROVAL') fail('NOT_PENDING', 'This registration is not awaiting approval.');
  if (d.s.counters.registered >= d.s.config.maxPlayers) fail('TOURNAMENT_FULL', 'The tournament is full.');
  const live = d.s.status === 'REGISTRATION' || d.s.status === 'REGISTRATION_CLOSED';
  if (!live) fail('ILLEGAL_STATE', 'Approvals are only possible before the start (late entries are approved at registration).');
  putPlayer(d, { ...p, status: 'REGISTERED' });
  const registered = d.s.counters.registered + 1;
  d.s.counters = { ...d.s.counters, registered };
  emit(d, { kind: 'PLAYER_REGISTERED', playerId: p.playerId, displayName: p.displayName, registeredCount: registered });
}

/** Reject a pending registration or withdraw a registered player before the start. */
export function withdraw(d: Draft, playerId: string): void {
  const p = mustPlayer(d, playerId);
  if (!['PENDING_APPROVAL', 'REGISTERED'].includes(p.status)) fail('ILLEGAL_STATE', 'Only players who have not been seated can be withdrawn.');
  if (!['REGISTRATION', 'REGISTRATION_CLOSED', 'DRAFT'].includes(d.s.status)) fail('ILLEGAL_STATE', 'Withdrawals are only possible before the start.');
  if (p.status === 'REGISTERED') d.s.counters = { ...d.s.counters, registered: d.s.counters.registered - 1 };
  putPlayer(d, { ...p, status: 'WITHDRAWN' });
}
