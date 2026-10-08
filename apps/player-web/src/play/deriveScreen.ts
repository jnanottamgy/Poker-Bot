import type { GameState } from '@jpb/client-sdk';

export type ScreenKind =
  | 'session-expired'
  | 'replaced'
  | 'another-device'
  | 'connecting'
  | 'pending'
  | 'suspended'
  | 'removed'
  | 'eliminated'
  | 'spectating'
  | 'completed'
  | 'break'
  | 'paused'
  | 'lobby'
  | 'moving'
  | 'table';

/** Gateway refusals that mean "this browser has no valid player session". */
export const AUTH_ERROR_CODES: ReadonlySet<string> = new Set(['UNAUTHORIZED', 'FORBIDDEN', 'PLAYER_NOT_FOUND']);

const PRE_START = new Set(['DRAFT', 'REGISTRATION', 'REGISTRATION_CLOSED', 'STARTING']);

/**
 * Which screen to show, decided only from server state held in the store
 * (plus the local "watch the tournament" choice). Pure and tested.
 */
export function deriveScreen(s: GameState, opts: { spectate: boolean }): ScreenKind {
  if (s.lastError && AUTH_ERROR_CODES.has(s.lastError.code)) return 'session-expired';
  if (s.connection === 'replaced') return 'replaced';
  if (s.anotherDevice) return 'another-device';
  const self = s.self;
  const t = s.tournament;
  if (!self || !t) return 'connecting';
  switch (self.status) {
    case 'PENDING_APPROVAL':
      return 'pending';
    case 'SUSPENDED':
      return 'suspended';
    case 'DISQUALIFIED':
    case 'WITHDRAWN':
      return 'removed';
    case 'ELIMINATED':
      return opts.spectate ? 'spectating' : 'eliminated';
    default:
      break;
  }
  if (t.status === 'COMPLETED' || t.status === 'CANCELLED') return 'completed';
  if (t.status === 'BREAK') return 'break';
  const table = s.table && s.table.audience === 'PLAYER' && s.table.tableId === self.tableId ? s.table : null;
  const handLive = !!table?.hand && table.hand.phase !== 'HAND_COMPLETE';
  // A pause waits for the current hand: keep the table on screen until it ends.
  if ((t.status === 'PAUSED' && !handLive) || table?.frozen) return 'paused';
  if (PRE_START.has(t.status) || self.status === 'REGISTERED') return 'lobby';
  if (!table) return 'moving';
  return 'table';
}
