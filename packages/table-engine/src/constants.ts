import type { HoldReason, RemovalReason } from '@jpb/shared-types';
import { TABLE_SIZE_LIMITS } from '@jpb/shared-types';

/** Number of processed PLAYER_ACTION ids (with their replies) remembered for idempotency (CONTRACTS §4: >= 512). */
export const RECENT_ACTION_CAPACITY = 512;

/** Number of completed-hand summaries kept for the admin "recent hands" list. */
export const RECENT_HANDS_CAPACITY = 20;

/** Seats per table: 2..10. */
export const MIN_TABLE_SEATS = TABLE_SIZE_LIMITS.MIN_PLAYERS_PER_TABLE;
export const MAX_TABLE_SEATS = TABLE_SIZE_LIMITS.ABSOLUTE_MAX_SEATS;

/** Players needed to deal a hand. */
export const MIN_PLAYERS_TO_DEAL = 2;

/** Upper bound of one ADMIN_ADD_TIME grant (one hour). */
export const MAX_ADD_TIME_MS = 3_600_000;

/** Upper bound for any configured timer (one day): rejects absurd values that would freeze a table. */
export const MAX_TIMER_MS = 86_400_000;

export const HOLD_REASONS: readonly HoldReason[] = [
  'PAUSE',
  'BREAK',
  'HAND_FOR_HAND',
  'CONSOLIDATION',
  'FINAL_TABLE',
  'ADMIN',
  'INTEGRITY',
];

export const REMOVAL_REASONS: readonly RemovalReason[] = [
  'MOVED',
  'ELIMINATED',
  'DISQUALIFIED',
  'ADMIN',
  'TABLE_BROKEN',
  'FINAL_TABLE',
];

/** Format tag of hand-history records produced by this package. */
export const HAND_HISTORY_FORMAT = 'JPB-HAND-HISTORY';
export const HAND_HISTORY_FORMAT_VERSION = 1;

/** Version of the TableState layout (snapshots carry it). */
export const TABLE_STATE_SCHEMA = 1;
