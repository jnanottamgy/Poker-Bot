import type {
  BlindClockState,
  BlindLevel,
  BreakRule,
  Chips,
  CurrentBlinds,
  EliminationRecord,
  EpochMs,
  HandResultReport,
  HoldReason,
  MoveReason,
  PlayerId,
  PlayerNotice,
  RemovalReason,
  SeatIndex,
  SeatPositionStats,
  TableCommand,
  TableId,
  TableStatus,
  TableSummary,
  TableTimingState,
  TimingConfig,
  TournamentConfig,
  TournamentCounters,
  TournamentEvent,
  TournamentId,
  TournamentPlayerStatus,
  TournamentStatus,
} from '@jpb/shared-types';
import type { RandomSource } from '@jpb/randomness';
import type { TableCountIndex } from '@jpb/balancing-engine';
import type { BucketMap } from './bucketMap';

// ---------------------------------------------------------------- state

export interface DirectorPlayer {
  playerId: PlayerId;
  entryId: string;
  displayName: string;
  publicId: string;
  registrationSeq: number;
  clientSeed: string | null;
  status: TournamentPlayerStatus;
  tableId: TableId | null;
  seat: SeatIndex | null;
  /** Last known stack (authoritative only between hands; tables own live stacks). */
  stack: Chips;
  stats: SeatPositionStats;
  recentMovesAtHand: number[];
  suspended: boolean;
  /** Entries used (1 + re-entries). */
  entries: number;
  finishPosition: number | null;
  tiedCount: number;
  prizeMinor: number;
  elimination: EliminationRecord | null;
  /** Earlier entries' eliminations (re-entry). */
  pastEliminations: EliminationRecord[];
  /** Bust order while late registration / re-entry is open (positions assigned at close). */
  pendingBustOrder: number | null;
}

export type PendingMoveStatus = 'REMOVING' | 'SEATING';

export interface PendingMove {
  moveId: string;
  playerId: PlayerId;
  reason: MoveReason;
  fromTableId: TableId | null;
  fromSeat: SeatIndex | null;
  toTableId: TableId | null;
  toSeat: SeatIndex | null;
  status: PendingMoveStatus;
  /** Known once the source reported PLAYER_REMOVED. */
  stack: Chips | null;
  stats: SeatPositionStats | null;
  requestedAt: EpochMs;
  scoreBreakdown: Record<string, number> | null;
}

export interface DirectorTable {
  summary: TableSummary;
  /** Last status reported by the table actor. */
  status: TableStatus;
  holds: HoldReason[];
  frozen: boolean;
  isFinalTable: boolean;
  /** Chips at this table: last HAND_RESULT total adjusted by seats/removals/adjustments since. */
  chips: Chips;
  lastHandAt: EpochMs | null;
  handsCompleted: number;
}

export interface HandForHandState {
  enabled: boolean;
  /** Enabled by an admin (not by the automatic bubble rule). */
  manual: boolean;
  phase: 'SYNCING' | 'PLAYING' | 'OFF';
  round: number;
  /** Tables that must still report a HAND_RESULT in the current round. */
  awaiting: TableId[];
  /** Busts of the current round (ranked together when the round completes). */
  roundBusts: Array<{ playerId: PlayerId; tableId: TableId; startingStack: Chips; handId: string; handNumber: number }>;
}

export interface FinalTableState {
  formed: boolean;
  forming: boolean;
  tableId: TableId | null;
  formedAt: EpochMs | null;
  /** Players removed from their tables and waiting to be seated at the final table. */
  pool: Array<{ playerId: PlayerId; stack: Chips; stats: SeatPositionStats }>;
}

export interface IntegrityState {
  ok: boolean;
  expectedTotal: Chips;
  actualTotal: Chips;
  checkedAt: EpochMs | null;
  offendingTables: TableId[];
}

export interface DirectorClock extends BlindClockState {
  /** STARTING: when tables receive START (countdown end). */
  startAt: EpochMs | null;
  /** Remaining break time captured on pause. */
  pausedBreakRemainingMs: number | null;
  /** Total time spent in PAUSED/frozen (for elapsed-time reporting). */
  pausedTotalMs: number;
  pausedAt: EpochMs | null;
}

export interface DirectorState {
  version: 1;
  tournamentId: TournamentId;
  config: TournamentConfig;
  serverSeedHash: string;
  publicEntropy: string | null;
  createdAt: EpochMs;
  startedAt: EpochMs | null;
  completedAt: EpochMs | null;
  status: TournamentStatus;
  /** State to return to after a BREAK. */
  resumeTo: TournamentStatus | null;
  /** State to return to after PAUSED (may itself be BREAK). */
  pausedFrom: TournamentStatus | null;
  /** Emergency freeze active (orthogonal to status; every table frozen). */
  frozen: boolean;
  clock: DirectorClock;
  players: BucketMap<DirectorPlayer>;
  tables: BucketMap<DirectorTable>;
  pendingMoves: Record<string, PendingMove>;
  counters: TournamentCounters;
  /** Σ chips at tables (incremental) — chip-conservation numerator. */
  chipsAtTables: Chips;
  /** Chips removed from play by disqualification. */
  chipsRemoved: Chips;
  /** Net chips added/removed by audited stack adjustments. */
  chipsAdjusted: Chips;
  handForHand: HandForHandState;
  finalTable: FinalTableState;
  integrity: IntegrityState;
  /** Bust counter while positions are pending (late registration / re-entry open). */
  bustSeq: number;
  seq: { table: number; move: number; batch: number; effect: number };
  milestonesFired: string[];
  winnerId: PlayerId | null;
  featuredTableId: TableId | null;
}

// ---------------------------------------------------------------- inputs

/** Who performed an admin override (audit metadata travels with the input). */
export interface AdminMeta {
  adminId: string;
  reason: string | null;
}

export type DirectorInput =
  // registration / lifecycle
  | { type: 'OPEN_REGISTRATION'; admin?: AdminMeta }
  | { type: 'CLOSE_REGISTRATION'; admin?: AdminMeta }
  | { type: 'REOPEN_REGISTRATION'; admin?: AdminMeta }
  | {
      type: 'REGISTER_PLAYER';
      playerId: PlayerId;
      entryId: string;
      displayName: string;
      publicId: string;
      registrationSeq: number;
      clientSeed: string | null;
      approved: boolean;
    }
  | { type: 'APPROVE_PLAYER'; playerId: PlayerId; admin?: AdminMeta }
  | { type: 'REJECT_PLAYER'; playerId: PlayerId; admin?: AdminMeta }
  | { type: 'WITHDRAW_PLAYER'; playerId: PlayerId; admin?: AdminMeta }
  | { type: 'REENTER_PLAYER'; playerId: PlayerId; entryId: string; admin?: AdminMeta }
  /** publicEntropy is computed by the host from the registered client seeds + admin entropy (fairness-engine). */
  | { type: 'START'; publicEntropy: string; admin?: AdminMeta }
  | { type: 'TICK' }
  // table reports
  | { type: 'TABLE_HAND_RESULT'; report: HandResultReport }
  | {
      type: 'TABLE_PLAYER_REMOVED';
      tableId: TableId;
      playerId: PlayerId;
      seat: SeatIndex;
      stack: Chips;
      reason: RemovalReason;
      moveId: string | null;
      stats?: SeatPositionStats;
    }
  | { type: 'TABLE_PLAYER_SEATED'; tableId: TableId; playerId: PlayerId; seat: SeatIndex; stack: Chips; moveId: string | null }
  | { type: 'TABLE_STATUS_CHANGED'; tableId: TableId; status: TableStatus; holds: HoldReason[]; frozen: boolean }
  | { type: 'TABLE_STACK_ADJUSTED'; tableId: TableId; playerId: PlayerId; before: Chips; after: Chips }
  /** A table rejected a director command (e.g. SEAT_UNAVAILABLE). */
  | { type: 'TABLE_COMMAND_FAILED'; tableId: TableId; command: TableCommand; code: string }
  // admin overrides
  | { type: 'PAUSE'; admin: AdminMeta }
  | { type: 'RESUME'; admin: AdminMeta }
  | { type: 'FREEZE'; admin: AdminMeta }
  | { type: 'UNFREEZE'; admin: AdminMeta }
  | { type: 'ADVANCE_LEVEL'; admin: AdminMeta }
  | { type: 'SET_LEVEL'; level: number; admin: AdminMeta }
  | { type: 'ADD_TIME'; ms: number; admin: AdminMeta }
  | { type: 'START_BREAK'; durationSeconds: number; admin: AdminMeta }
  | { type: 'END_BREAK'; admin: AdminMeta }
  | { type: 'SET_HAND_FOR_HAND'; enabled: boolean; admin: AdminMeta }
  | { type: 'MOVE_PLAYER'; playerId: PlayerId; toTableId: TableId; toSeat: SeatIndex | null; admin: AdminMeta }
  | { type: 'REBALANCE'; admin: AdminMeta }
  | { type: 'BREAK_TABLE'; tableId: TableId; admin: AdminMeta }
  | { type: 'HOLD_TABLE'; tableId: TableId; admin: AdminMeta }
  | { type: 'RELEASE_TABLE'; tableId: TableId; admin: AdminMeta }
  | { type: 'FREEZE_TABLE'; tableId: TableId; admin: AdminMeta }
  | { type: 'UNFREEZE_TABLE'; tableId: TableId; admin: AdminMeta }
  | { type: 'FORCE_TIMEOUT'; tableId: TableId; admin: AdminMeta }
  | { type: 'TABLE_ADD_TIME'; tableId: TableId; ms: number; admin: AdminMeta }
  | { type: 'SUSPEND_PLAYER'; playerId: PlayerId; admin: AdminMeta }
  | { type: 'RESTORE_PLAYER'; playerId: PlayerId; admin: AdminMeta }
  | { type: 'DISQUALIFY_PLAYER'; playerId: PlayerId; admin: AdminMeta }
  | { type: 'ADJUST_STACK'; playerId: PlayerId; newStack: Chips; admin: AdminMeta }
  | { type: 'ANNOUNCE'; text: string; admin: AdminMeta }
  | { type: 'SET_FEATURED_TABLE'; tableId: TableId | null; admin: AdminMeta }
  | { type: 'UPDATE_SCHEDULE'; blindSchedule: BlindLevel[]; breaks: BreakRule[]; admin: AdminMeta }
  | { type: 'UPDATE_TIMING'; timing: TimingConfig; admin: AdminMeta }
  | { type: 'CANCEL'; admin: AdminMeta };

export type DirectorInputType = DirectorInput['type'];

// ---------------------------------------------------------------- outputs

export type DirectorEffect =
  | {
      type: 'CREATE_TABLE';
      tableId: TableId;
      tableNumber: number;
      maxSeats: number;
      initialButtonSeat: SeatIndex | null;
      blinds: CurrentBlinds;
      timing: TableTimingState;
      isFinalTable: boolean;
    }
  /** `key` is a deterministic idempotency key: re-delivery after a crash must not apply the command twice. */
  | { type: 'TABLE_COMMAND'; tableId: TableId; command: TableCommand; key: string }
  | { type: 'NOTIFY_PLAYER'; playerId: PlayerId; notice: PlayerNotice }
  /** The single next moment the director needs a TICK (null = none). Replaces any previous schedule. */
  | { type: 'SCHEDULE_TICK'; at: EpochMs | null }
  | { type: 'INTEGRITY_ALERT'; severity: 'WARNING' | 'CRITICAL'; code: string; detail: string; tableId: TableId | null }
  /** The player's projection changed (status, table, seat, stack, finish, prize). */
  | { type: 'PLAYER_CHANGED'; player: DirectorPlayer };

export interface DirectorReply {
  ok: boolean;
  code: string | null;
  message: string | null;
}

export interface DirectorTransition {
  state: DirectorState;
  effects: DirectorEffect[];
  events: TournamentEvent[];
  reply: DirectorReply;
}

export interface DirectorContext {
  now: EpochMs;
  /**
   * Deterministic draw stream (fairness-engine drawSource) for seat/button
   * draws, bound to the tournament's frozen public entropy (passed explicitly:
   * START freezes it in the same transition that performs the seat draw).
   */
  drawSource(purpose: string, publicEntropy: string): RandomSource;
  /**
   * Optional cache of the table-count index, kept by the host in sync with
   * state (rebuild with buildTableIndex(state) after recovery or any failed
   * transition). When absent it is rebuilt from state (O(tables)).
   */
  index?: TableCountIndex;
}
