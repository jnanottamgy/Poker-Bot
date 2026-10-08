import type { CardCode } from './cards';
import type { AnteType, BlindLevel } from './config';
import type { ActionId, Chips, EpochMs, HandId, PlayerId, SeatIndex, TableId, TournamentId } from './ids';
import type { ActionType, HandEvent, HandPhase, IllegalActionCode, LegalActions, PlayerActionIntent } from './hand';

/**
 * TABLE LIFECYCLE (normative):
 *
 *   WAITING        fewer than 2 players seated, or tournament not started
 *   BETWEEN_HANDS  a NEXT_HAND timer is pending
 *   IN_HAND        a hand is being played
 *   HELD           director hold active (pause / break / hand-for-hand / consolidation); no new hand starts
 *   CLOSED         table broken or tournament finished (terminal)
 *
 * Emergency freeze is orthogonal (`frozen`): while frozen no player action or
 * timer is processed, and the remaining action time is preserved.
 */
export type TableStatus = 'WAITING' | 'BETWEEN_HANDS' | 'IN_HAND' | 'HELD' | 'CLOSED';

export type HoldReason = 'PAUSE' | 'BREAK' | 'HAND_FOR_HAND' | 'CONSOLIDATION' | 'FINAL_TABLE' | 'ADMIN' | 'INTEGRITY';

export type RemovalReason = 'MOVED' | 'ELIMINATED' | 'DISQUALIFIED' | 'ADMIN' | 'TABLE_BROKEN' | 'FINAL_TABLE';

/** Positional bookkeeping used by blind-fairness and movement scoring. */
export interface SeatPositionStats {
  handsDealtAtTable: number;
  /** Hands dealt to this player (any table) since they last posted a big blind. */
  handsSinceBigBlind: number;
  handsSinceSmallBlind: number;
  /** Total hands dealt to this player in the tournament (a per-player clock). */
  handsPlayedTotal: number;
}

export interface SeatOccupant {
  playerId: PlayerId;
  displayName: string;
  publicId: string;
  stack: Chips;
  connected: boolean;
  consecutiveTimeouts: number;
  /** Player was seated while a hand was running; dealt in from the next hand. */
  waitingForNextHand: boolean;
  /** Removal requested while in a hand; applied when the hand completes. */
  pendingRemoval: { reason: RemovalReason; moveId: string | null } | null;
  stats: SeatPositionStats;
}

export interface TableTimingState {
  actionTimerMs: number;
  awayActionTimerMs: number;
  awayAfterTimeouts: number;
  actionGraceMs: number;
  betweenHandsDelayMs: number;
  showdownDelayMs: number;
}

export interface CurrentBlinds {
  level: number;
  smallBlind: Chips;
  bigBlind: Chips;
  ante: Chips;
  anteType: AnteType;
}

export type TableTimerKind = 'ACTION_TIMEOUT' | 'NEXT_HAND';

/** Timer requested by the reducer; the host schedules it and later submits TIMER_FIRED with the same token. */
export interface TableTimerRequest {
  kind: TableTimerKind;
  /** Absolute server time at which the timer should fire. */
  at: EpochMs;
  /** Opaque token; TIMER_FIRED with a stale token is ignored (idempotent). */
  token: string;
}

/** Commands are the ONLY way to change table state. Processed strictly sequentially per table (actor model). */
export type TableCommand =
  | {
      type: 'SEAT_PLAYER';
      playerId: PlayerId;
      displayName: string;
      publicId: string;
      seat: SeatIndex;
      stack: Chips;
      stats: SeatPositionStats;
      moveId: string | null;
    }
  | { type: 'REMOVE_PLAYER'; playerId: PlayerId; reason: RemovalReason; moveId: string | null }
  | { type: 'SET_BLINDS'; blinds: CurrentBlinds }
  | { type: 'SET_TIMING'; timing: TableTimingState }
  | { type: 'HOLD'; reason: HoldReason }
  | { type: 'RELEASE'; reason: HoldReason }
  | { type: 'SET_HAND_FOR_HAND'; enabled: boolean }
  | { type: 'FREEZE' }
  | { type: 'UNFREEZE' }
  | {
      type: 'PLAYER_ACTION';
      actionId: ActionId;
      playerId: PlayerId;
      intent: PlayerActionIntent;
      /** The turnVersion the client saw in ACTION_REQUESTED. Stale versions are rejected. */
      tableStateVersion: number | null;
    }
  | { type: 'TIMER_FIRED'; kind: TableTimerKind; token: string }
  | { type: 'PLAYER_CONNECTION'; playerId: PlayerId; connected: boolean }
  | { type: 'ADMIN_FORCE_TIMEOUT' }
  | { type: 'ADMIN_ADJUST_STACK'; playerId: PlayerId; newStack: Chips }
  | { type: 'START' }
  | { type: 'CLOSE' };

/** A command plus the server metadata recorded in the command log (enables deterministic replay). */
export interface TableCommandEnvelope {
  commandId: string;
  tableId: TableId;
  /** Server time at which the actor processed the command. Replay re-uses this exact value. */
  at: EpochMs;
  command: TableCommand;
}

export type TableLevelEvent =
  | { kind: 'TABLE_CREATED'; tableNumber: number; maxSeats: number }
  | { kind: 'PLAYER_SEATED'; seat: SeatIndex; playerId: PlayerId; displayName: string; publicId: string; stack: Chips; moveId: string | null }
  | { kind: 'PLAYER_REMOVED'; seat: SeatIndex; playerId: PlayerId; reason: RemovalReason; stack: Chips; moveId: string | null }
  | { kind: 'BLINDS_SCHEDULED'; blinds: CurrentBlinds }
  | { kind: 'TABLE_STATUS_CHANGED'; status: TableStatus; holds: HoldReason[]; frozen: boolean }
  | {
      kind: 'ACTION_REQUESTED';
      seat: SeatIndex;
      playerId: PlayerId;
      legal: LegalActions;
      deadline: EpochMs;
      timerMs: number;
      turnVersion: number;
    }
  | { kind: 'PLAYER_CONNECTION_CHANGED'; seat: SeatIndex; playerId: PlayerId; connected: boolean }
  | { kind: 'STACK_ADJUSTED'; seat: SeatIndex; playerId: PlayerId; before: Chips; after: Chips }
  | { kind: 'HAND_RESULT'; result: HandResultReport }
  | { kind: 'INTEGRITY_VIOLATION'; code: string; detail: string };

export type TableEventPayload = HandEvent | TableLevelEvent;

export interface TableEvent {
  tableId: TableId;
  tournamentId: TournamentId;
  /** Monotonic per-table event sequence number (gap-free). */
  seq: number;
  /** Table state version after the command that produced this event. */
  version: number;
  at: EpochMs;
  /** PRIVATE events must only be delivered to `privateTo` (and authorized admins). */
  visibility: 'PUBLIC' | 'PRIVATE';
  privateTo: PlayerId | null;
  event: TableEventPayload;
}

/** Summary the table reports to the tournament director after every completed hand. */
export interface HandResultReport {
  tableId: TableId;
  handId: HandId;
  handNumber: number;
  completedAt: EpochMs;
  buttonSeat: SeatIndex;
  smallBlindSeat: SeatIndex | null;
  bigBlindSeat: SeatIndex;
  players: Array<{
    playerId: PlayerId;
    seat: SeatIndex;
    startingStack: Chips;
    finalStack: Chips;
  }>;
  /** Players with 0 chips after pot distribution, with the stack they started the hand with (rank tie-break). */
  busted: Array<{ playerId: PlayerId; seat: SeatIndex; startingStack: Chips }>;
  largestPot: Chips;
  totalChipsAtTable: Chips;
}

export type ActionRejectCode =
  | IllegalActionCode
  | 'DUPLICATE_ACTION'
  | 'STALE_STATE_VERSION'
  | 'ACTION_DEADLINE_PASSED'
  | 'TABLE_FROZEN'
  | 'NO_ACTIVE_HAND'
  | 'PLAYER_NOT_SEATED'
  | 'TABLE_CLOSED'
  | 'RATE_LIMITED'
  | 'INVALID_COMMAND';

export interface CommandReply {
  ok: boolean;
  code: ActionRejectCode | null;
  message: string | null;
  /** True when this actionId was already processed; the original reply is returned. */
  duplicate: boolean;
}

/** Public (no hole cards) projection of one seat. */
export interface PublicSeatView {
  seat: SeatIndex;
  playerId: PlayerId;
  displayName: string;
  publicId: string;
  stack: Chips;
  connected: boolean;
  inHand: boolean;
  folded: boolean;
  allIn: boolean;
  /** Chips put in on the current street. */
  streetContribution: Chips;
  lastAction: { action: ActionType; amount: Chips; toAmount: Chips } | null;
  isButton: boolean;
  isSmallBlind: boolean;
  isBigBlind: boolean;
  /** Cards shown at showdown (public). */
  shownCards: [CardCode, CardCode] | null;
  away: boolean;
}

export interface PublicHandView {
  handId: HandId;
  handNumber: number;
  phase: HandPhase;
  board: CardCode[];
  pots: Array<{ amount: Chips; eligibleSeats: SeatIndex[] }>;
  totalPot: Chips;
  currentBet: Chips;
  actingSeat: SeatIndex | null;
  actionDeadline: EpochMs | null;
  turnVersion: number | null;
}

/** Base table projection shared by all audiences. */
export interface TableViewBase {
  tableId: TableId;
  tournamentId: TournamentId;
  tableNumber: number;
  version: number;
  lastEventSeq: number;
  status: TableStatus;
  holds: HoldReason[];
  frozen: boolean;
  maxSeats: number;
  seats: Array<PublicSeatView | null>;
  buttonSeat: SeatIndex | null;
  blinds: CurrentBlinds;
  hand: PublicHandView | null;
  serverTime: EpochMs;
}

/** What a seated player receives: public view + their own private data only. */
export interface PlayerTableView extends TableViewBase {
  audience: 'PLAYER';
  you: {
    playerId: PlayerId;
    seat: SeatIndex;
    holeCards: [CardCode, CardCode] | null;
    legal: LegalActions | null;
  };
}

/** Spectators never receive any private card. */
export interface SpectatorTableView extends TableViewBase {
  audience: 'SPECTATOR';
}

/** Admin projection; hole cards present only when the admin holds VIEW_HOLE_CARDS. */
export interface AdminTableView extends TableViewBase {
  audience: 'ADMIN';
  holeCards: Record<SeatIndex, [CardCode, CardCode]> | null;
  seatDetails: Array<
    | (SeatOccupant & {
        seat: SeatIndex;
      })
    | null
  >;
  timing: TableTimingState;
  handForHand: boolean;
  pendingBlinds: CurrentBlinds | null;
  lastProgressAt: EpochMs;
  handsPlayed: number;
}

export type BlindLevelSnapshot = Pick<BlindLevel, 'level' | 'smallBlind' | 'bigBlind' | 'ante'>;
