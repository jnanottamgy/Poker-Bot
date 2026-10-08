import type {
  AdminTableView,
  CardCode,
  CommandReply,
  LegalActions,
  PlayerId,
  PlayerNotice,
  PlayerSelfSummary,
  SeatIndex,
  SpectatorTableView,
  TableEvent,
  TableId,
  TournamentEventEnvelope,
  TournamentId,
  TournamentPublicSummary,
  ActionType,
} from '@jpb/shared-types';

/**
 * Contracts between the actor runtime (owner of table/director state) and the
 * WebSocket gateway (owner of client connections). They are the ONLY data
 * that crosses the bus, so they never contain the deck or the server seed.
 */

/** Published on bus channel `table:{id}:events` after every durably committed table command. */
export interface TableUpdateMessage {
  kind: 'TABLE_UPDATE';
  tableId: TableId;
  tournamentId: TournamentId;
  /** First and last event seq produced by the command (fromSeq > toSeq when it produced no events). */
  fromSeq: number;
  toSeq: number;
  version: number;
  at: number;
  /** All events, including PRIVATE ones; the gateway filters per recipient. */
  events: TableEvent[];
  /** Public projection (no hole cards except those shown at showdown). */
  publicView: SpectatorTableView;
  /** Private part for each seated player. Merged into publicView to form a PlayerTableView. */
  privateByPlayer: Record<PlayerId, { seat: SeatIndex; holeCards: [CardCode, CardCode] | null; legal: LegalActions | null }>;
  /** Admin projection without hole cards. */
  adminView: AdminTableView;
  /**
   * Live hole cards by seat. Only forwarded to admin sockets that performed
   * an audited reveal for this table and hold VIEW_HOLE_CARDS.
   */
  holeCardsBySeat: Record<SeatIndex, [CardCode, CardCode]>;
}

/** Published on `tournament:{id}:events`. */
export interface TournamentEventMessage {
  kind: 'TOURNAMENT_EVENT';
  tournamentId: TournamentId;
  envelope: TournamentEventEnvelope;
  summary: TournamentPublicSummary;
}

/** Published on `player:{id}`. */
export type PlayerChannelMessage =
  | { kind: 'SELF_UPDATE'; self: PlayerSelfSummary }
  | { kind: 'NOTICE'; notice: PlayerNotice }
  /** A newer controller connection exists; the receiving gateway closes older controller sockets with session_replaced. */
  | { kind: 'CONTROLLER_CLAIMED'; playerId: PlayerId; connectionId: string; nodeId: string }
  /** Sessions were revoked by an admin: close every socket of this player. */
  | { kind: 'SESSIONS_REVOKED'; playerId: PlayerId };

/**
 * Published on `tournament:{id}:events` when the broadcast display's featured
 * table changes (admin display endpoint); gateways re-point DISPLAY sockets.
 */
export interface DisplayFeaturedMessage {
  kind: 'DISPLAY_FEATURED_CHANGED';
  tournamentId: TournamentId;
  tableId: TableId | null;
}

/** Everything that may arrive on `tournament:{id}:events`. */
export type TournamentChannelMessage = TournamentEventMessage | DisplayFeaturedMessage;

/** Published on `admin:{tournamentId}`. */
export type AdminChannelMessage =
  | { kind: 'ALERT'; alert: unknown }
  | { kind: 'AUDIT'; entry: unknown }
  | { kind: 'METRICS'; snapshot: unknown }
  /**
   * An audited live hole-card reveal (VIEW_HOLE_CARDS, danger level 2) was
   * performed for `tableId`. Gateways enable hole cards only on that admin's
   * sockets watching the table (narrowed to one session when `sessionId` is set).
   */
  | { kind: 'HOLE_CARDS_REVEALED'; tableId: TableId; adminId: string; sessionId: string | null };

/** What the gateway asks the runtime for (local call on one node, bus RPC across nodes). */
export interface GatewayBackend {
  tournamentSummary(tournamentId: TournamentId): Promise<TournamentPublicSummary | null>;
  playerSelf(playerId: PlayerId): Promise<PlayerSelfSummary | null>;
  /** Latest full state of a table as a TABLE_UPDATE with no events (used for snapshots). */
  tableSnapshot(tableId: TableId): Promise<TableUpdateMessage | null>;
  /** Table currently featured on broadcast displays / suggested for spectators. */
  featuredTable(tournamentId: TournamentId): Promise<TableId | null>;
  /** Whether this player may spectate (eliminated + spectators allowed) or anyone may (public watch). */
  canSpectate(tournamentId: TournamentId, playerId: PlayerId | null): Promise<boolean>;
  /** Whether broadcast DISPLAY sockets may follow this tournament (features.broadcastDisplay). */
  canDisplay(tournamentId: TournamentId): Promise<boolean>;
  /** Spectator delay for this tournament in ms. */
  spectatorDelayMs(tournamentId: TournamentId): Promise<number>;
  submitPlayerAction(input: {
    playerId: PlayerId;
    tableId: TableId;
    actionId: string;
    type: ActionType;
    amount?: number;
    tableStateVersion: number;
    receivedAt: number;
  }): Promise<CommandReply>;
  /** Connection presence feeds the table actor (away logic) — fire and forget. */
  playerConnection(playerId: PlayerId, connected: boolean): void;
}
