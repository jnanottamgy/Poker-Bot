import type { AdminId, EpochMs, TournamentId } from './ids';

/** Every administrative override produces one immutable audit entry (spec §57). */
export interface AuditEntry {
  id: string;
  at: EpochMs;
  tournamentId: TournamentId | null;
  adminId: AdminId | 'SYSTEM';
  adminUsername: string;
  action: string;
  /** e.g. "player:JPN-7A42", "table:37", "tournament" */
  target: string;
  reason: string | null;
  beforeState: unknown;
  afterState: unknown;
  ip: string | null;
  /** SHA-256 hash chaining each entry to the previous one (tamper evidence). */
  prevHash: string;
  hash: string;
}

export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export type AlertCode =
  | 'TABLE_STALLED'
  | 'CHIP_CONSERVATION_FAILED'
  | 'INVARIANT_VIOLATION'
  | 'PLAYER_CANNOT_ACT'
  | 'WS_FAILURE_SPIKE'
  | 'DB_ERROR_SPIKE'
  | 'TOURNAMENT_STALLED'
  | 'ACTION_LATENCY_HIGH'
  | 'TABLE_CRASHED'
  | 'WORKER_LOST';

export interface Alert {
  id: string;
  at: EpochMs;
  tournamentId: TournamentId | null;
  severity: AlertSeverity;
  code: AlertCode;
  message: string;
  target: string | null;
  acknowledgedBy: AdminId | null;
  acknowledgedAt: EpochMs | null;
  resolvedAt: EpochMs | null;
}

export type PaymentStatus = 'UNPAID' | 'PROCESSING' | 'PAID';
