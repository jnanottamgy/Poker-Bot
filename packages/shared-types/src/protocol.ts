import type { ActionType } from './hand';
import type { ActionId, Chips, EpochMs, PlayerId, SeatIndex, TableId, TournamentId } from './ids';
import type { AdminTableView, PlayerTableView, SpectatorTableView, TableEvent, ActionRejectCode } from './table';
import type { TournamentEventEnvelope, TournamentStatus, TournamentPlayerStatus, BlindClockState, TournamentCounters } from './tournament';
import type { BlindLevel } from './config';

/**
 * WEBSOCKET PROTOCOL v1 (JSON text frames).
 *
 * The client only ever sends intentions. All authoritative state flows from
 * the server. Every server frame carries `st` (server time, epoch ms) so the
 * client can estimate clock offset for visual timers only.
 */
export const PROTOCOL_VERSION = 1;

export type ClientAudience = 'PLAYER' | 'SPECTATOR' | 'ADMIN' | 'DISPLAY';

export type ClientMessage =
  | { t: 'hello'; v: number; audience: ClientAudience; tournamentId: TournamentId; resume: ResumeCursor | null }
  | {
      t: 'action';
      actionId: ActionId;
      tableId: TableId;
      type: ActionType;
      amount?: Chips;
      tableStateVersion: number;
    }
  | { t: 'takeover' }
  | { t: 'ping'; ct: EpochMs }
  | { t: 'watch'; tableId: TableId | null }
  | { t: 'snapshot_request' };

/** Where the client left off; the server answers with a full authoritative snapshot when it cannot replay. */
export interface ResumeCursor {
  tableId: TableId | null;
  tableSeq: number;
  tournamentSeq: number;
}

export type ServerMessage =
  | { t: 'welcome'; st: EpochMs; sessionId: string; audience: ClientAudience; protocol: number }
  | { t: 'another_device'; st: EpochMs }
  | { t: 'session_replaced'; st: EpochMs }
  | { t: 'snapshot'; st: EpochMs; snapshot: ClientSnapshot }
  /**
   * One processed table command: the events it produced (already filtered
   * for this recipient — animation/log material) plus the resulting
   * authoritative table view for this audience. Clients render the view,
   * never a locally computed state (server state always wins, spec §76).
   * `fromSeq` is the first event seq covered; a gap versus the previously
   * received `toSeq` means frames were missed (harmless: the view is
   * complete), and the client may request a snapshot for event history.
   */
  | {
      t: 'table_update';
      st: EpochMs;
      tableId: TableId;
      fromSeq: number;
      toSeq: number;
      version: number;
      events: TableEvent[];
      view: PlayerTableView | SpectatorTableView | AdminTableView;
    }
  | { t: 'table_event'; st: EpochMs; event: TableEvent }
  | { t: 'tournament_event'; st: EpochMs; event: TournamentEventEnvelope; summary: TournamentPublicSummary | null }
  /** The player's table assignment changed (move, final table, elimination): re-render from this. */
  | { t: 'self_update'; st: EpochMs; self: PlayerSelfSummary }
  | { t: 'action_result'; st: EpochMs; actionId: ActionId; ok: boolean; code: ActionRejectCode | null; message: string | null }
  | { t: 'pong'; st: EpochMs; ct: EpochMs }
  | { t: 'notice'; st: EpochMs; notice: PlayerNotice }
  | { t: 'error'; st: EpochMs; code: string; message: string };

export interface TournamentPublicSummary {
  tournamentId: TournamentId;
  name: string;
  status: TournamentStatus;
  clock: BlindClockState;
  currentLevel: BlindLevel | null;
  nextLevel: BlindLevel | null;
  counters: TournamentCounters;
  handForHand: boolean;
  lastSeq: number;
  serverSeedHash: string;
}

export interface PlayerSelfSummary {
  playerId: PlayerId;
  publicId: string;
  displayName: string;
  status: TournamentPlayerStatus;
  tableId: TableId | null;
  tableNumber: number | null;
  seat: SeatIndex | null;
  stack: Chips;
  finishPosition: number | null;
  prizeMinor: number;
  handsPlayed: number;
}

export type ClientSnapshot =
  | { audience: 'PLAYER'; tournament: TournamentPublicSummary; self: PlayerSelfSummary; table: PlayerTableView | null }
  | { audience: 'SPECTATOR'; tournament: TournamentPublicSummary; table: SpectatorTableView | null }
  | { audience: 'DISPLAY'; tournament: TournamentPublicSummary; featured: SpectatorTableView | null }
  | { audience: 'ADMIN'; tournament: TournamentPublicSummary; table: AdminTableView | null };

/** Player-facing notifications that need a dedicated screen (spec §41, §115, §116). */
export type PlayerNotice =
  | {
      kind: 'TABLE_MOVE';
      fromTableNumber: number | null;
      fromSeat: SeatIndex | null;
      toTableNumber: number;
      toSeat: SeatIndex;
      stack: Chips;
    }
  | {
      kind: 'ELIMINATED';
      finishPosition: number;
      tiedCount: number;
      handsPlayed: number;
      prizeMinor: number;
      currency: string;
    }
  | { kind: 'CHAMPION'; playersInField: number; stack: Chips }
  | { kind: 'SUSPENDED'; reason: string | null }
  | { kind: 'RESTORED' }
  /** Private message from the tournament staff (admin "notice" / table-scoped announcement). */
  | { kind: 'MESSAGE'; text: string; from: 'ADMIN' | 'DIRECTOR' };

/** REST: player action request body (spec §75). */
export interface PlayerActionRequest {
  actionId: ActionId;
  type: ActionType;
  amount?: Chips;
  tableStateVersion: number;
}
