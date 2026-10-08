import type { BlindLevel } from './config';
import type { Chips, EntryId, EpochMs, HandId, MoneyMinor, PlayerId, SeatIndex, TableId, TournamentId } from './ids';
import type { HoldReason, SeatPositionStats } from './table';

/**
 * TOURNAMENT STATE MACHINE (normative). Pause and break remember the state to
 * return to (`resumeTo`), so the final table can also pause/break.
 */
export type TournamentStatus =
  | 'DRAFT'
  | 'REGISTRATION'
  | 'REGISTRATION_CLOSED'
  | 'STARTING'
  | 'RUNNING'
  | 'BREAK'
  | 'PAUSED'
  | 'FINAL_TABLE'
  | 'COMPLETED'
  | 'CANCELLED';

export const TOURNAMENT_TRANSITIONS: Readonly<Record<TournamentStatus, readonly TournamentStatus[]>> = {
  DRAFT: ['REGISTRATION', 'CANCELLED'],
  REGISTRATION: ['REGISTRATION_CLOSED', 'DRAFT', 'CANCELLED'],
  REGISTRATION_CLOSED: ['STARTING', 'REGISTRATION', 'CANCELLED'],
  STARTING: ['RUNNING', 'FINAL_TABLE', 'CANCELLED'],
  RUNNING: ['BREAK', 'PAUSED', 'FINAL_TABLE', 'COMPLETED', 'CANCELLED'],
  // A hand still running when a break or pause begins can decide the champion.
  BREAK: ['RUNNING', 'FINAL_TABLE', 'PAUSED', 'COMPLETED', 'CANCELLED'],
  PAUSED: ['RUNNING', 'BREAK', 'FINAL_TABLE', 'COMPLETED', 'CANCELLED'],
  FINAL_TABLE: ['BREAK', 'PAUSED', 'COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransitionTournament(from: TournamentStatus, to: TournamentStatus): boolean {
  return TOURNAMENT_TRANSITIONS[from].includes(to);
}

export type TournamentPlayerStatus =
  | 'PENDING_APPROVAL'
  | 'REGISTERED'
  | 'SEATED'
  | 'IN_TRANSIT'
  | 'ELIMINATED'
  | 'SUSPENDED'
  | 'DISQUALIFIED'
  | 'WITHDRAWN';

/** Compact per-seat data the director keeps for balancing/seating decisions. */
export interface SeatSummary {
  seat: SeatIndex;
  playerId: PlayerId;
  stack: Chips;
  stats: SeatPositionStats;
  /** handsPlayedTotal at the time of each of the player's recent moves (most recent last). */
  recentMovesAtHand: number[];
  /**
   * In-flight departure (optional, default false). True once the director has
   * ordered this player off the table (REMOVE_PLAYER with reason MOVED /
   * TABLE_BROKEN / FINAL_TABLE) but the table has not yet reported
   * PLAYER_REMOVED. The seat stays physically occupied (it is never assigned to
   * anyone else), but the player no longer counts toward this table's size, is
   * never selected to move again, and is assumed absent from the next hand
   * dealt at this table. See @jpb/seating-engine README.
   */
  movingOut?: boolean;
}

/** Director's view of one table, refreshed from every HAND_RESULT report and every seat/remove. */
export interface TableSummary {
  tableId: TableId;
  tableNumber: number;
  maxSeats: number;
  status: 'ACTIVE' | 'BREAKING' | 'CLOSED';
  seats: SeatSummary[];
  /** Seats reserved for players in transit to this table. */
  reservedSeats: SeatIndex[];
  buttonSeat: SeatIndex | null;
  lastSmallBlindSeat: SeatIndex | null;
  lastBigBlindSeat: SeatIndex | null;
  handNumber: number;
  /** Whether the table is currently between hands (moves out are applied immediately) or in a hand (queued). */
  inHand: boolean;
}

export type MoveReason = 'BALANCE' | 'TABLE_BREAK' | 'FINAL_TABLE' | 'ADMIN' | 'INITIAL_SEATING' | 'LATE_REGISTRATION';

export interface PlayerMovement {
  moveId: string;
  playerId: PlayerId;
  reason: MoveReason;
  fromTableId: TableId | null;
  fromSeat: SeatIndex | null;
  toTableId: TableId;
  toSeat: SeatIndex;
  stack: Chips;
  requestedAt: EpochMs;
  completedAt: EpochMs | null;
  /** Deterministic score breakdown that led to the choice (auditable). */
  scoreBreakdown: Record<string, number> | null;
}

export interface EliminationRecord {
  playerId: PlayerId;
  entryId: EntryId;
  finishPosition: number;
  /** Number of players sharing this finish position (1 = no tie). */
  tiedCount: number;
  eliminatedAt: EpochMs;
  handId: HandId;
  handNumber: number;
  tableId: TableId;
  startingStackOfHand: Chips;
  /** Elimination batch: all busts in one hand (or one hand-for-hand round) are ranked together. */
  batchId: string;
}

export interface Standing {
  playerId: PlayerId;
  displayName: string;
  publicId: string;
  finishPosition: number | null;
  tiedCount: number;
  prizeMinor: MoneyMinor;
  status: TournamentPlayerStatus;
  stack: Chips;
}

export interface BlindClockState {
  levelIndex: number;
  /** When the current level started (server time). Null while not running. */
  levelStartedAt: EpochMs | null;
  /** When the current level ends; null while paused. */
  levelEndsAt: EpochMs | null;
  /** Remaining ms in the level, captured when the clock was paused. */
  pausedRemainingMs: number | null;
  breakEndsAt: EpochMs | null;
  /** Level index after which the active/pending break applies. */
  pendingBreakAfterLevel: number | null;
}

export interface TournamentCounters {
  registered: number;
  active: number;
  eliminated: number;
  inTransit: number;
  tables: number;
  handsCompleted: number;
  totalChips: Chips;
  largestPot: Chips;
}

/** Real-time tournament events broadcast to players/spectators/displays/admins. */
export type TournamentEvent =
  | { kind: 'TOURNAMENT_STATUS_CHANGED'; from: TournamentStatus; to: TournamentStatus; reason: string | null }
  | { kind: 'BLIND_LEVEL_CHANGED'; from: BlindLevel | null; to: BlindLevel; levelEndsAt: EpochMs | null }
  | { kind: 'BREAK_STARTED'; endsAt: EpochMs; nextLevel: BlindLevel | null; message: string | null }
  | { kind: 'BREAK_ENDED' }
  | { kind: 'TOURNAMENT_PAUSED'; mode: 'AFTER_HAND' | 'EMERGENCY_FREEZE'; reason: string | null }
  | { kind: 'TOURNAMENT_RESUMED' }
  | { kind: 'PLAYER_REGISTERED'; playerId: PlayerId; displayName: string; registeredCount: number }
  | { kind: 'PLAYER_ELIMINATED'; record: EliminationRecord; displayName: string; playersRemaining: number }
  | { kind: 'TABLE_MOVE'; movement: PlayerMovement; fromTableNumber: number | null; toTableNumber: number }
  | { kind: 'TABLE_CREATED'; tableId: TableId; tableNumber: number }
  | { kind: 'TABLE_BROKEN'; tableId: TableId; tableNumber: number; playersMoved: number }
  | { kind: 'FINAL_TABLE_FORMED'; tableId: TableId; players: Array<{ playerId: PlayerId; displayName: string; seat: SeatIndex; stack: Chips }> }
  | { kind: 'HAND_FOR_HAND'; enabled: boolean }
  | { kind: 'MILESTONE'; code: string; text: string; playersRemaining: number }
  | { kind: 'ANNOUNCEMENT'; text: string; from: 'DIRECTOR' | 'ADMIN' }
  | { kind: 'COUNTERS'; counters: TournamentCounters }
  | { kind: 'TOURNAMENT_COMPLETED'; winnerId: PlayerId; winnerName: string; completedAt: EpochMs }
  | { kind: 'INTEGRITY_ALERT'; severity: 'WARNING' | 'CRITICAL'; code: string; detail: string; tableId: TableId | null };

export interface TournamentEventEnvelope {
  tournamentId: TournamentId;
  seq: number;
  at: EpochMs;
  event: TournamentEvent;
}

export type DirectorHoldReason = HoldReason;
