import type {
  AdminRole,
  AdminUserDto,
  AlertDto,
  AuditEntryDto,
  BlindLevel,
  BreakRule,
  CardCode,
  FeatureFlags,
  Permission,
  PlayerListItemDto,
  SpectatorConfig,
  TableEvent,
  TableStatus,
  TimingConfig,
  TournamentConfig,
  TournamentListItemDto,
  TournamentPlayerStatus,
  TournamentStatus,
} from '@jpb/shared-types';
import type { ConfirmWord } from './endpoints';

/**
 * Request bodies and response envelopes that docs/API.md describes in prose
 * but packages/shared-types/src/api.ts does not define. Where the game server
 * already implements a route (auth, alerts, audit, users, sessions) these
 * mirror it exactly; the rest are this app's documented assumptions (see
 * CONTRIBUTING-SECTIONS.md → "Contract notes").
 */

// ---------------------------------------------------------------- shared bodies

/** Body of every level-2 endpoint: the reason (audit log) and the typed confirmation word. */
export interface DangerBody<W extends ConfirmWord = ConfirmWord> {
  reason: string;
  confirm: W;
}

/** Level-1 endpoints accept an optional reason that is written to the audit log. */
export interface ReasonBody {
  reason?: string;
}

export interface OkResponse {
  ok: boolean;
}

// ---------------------------------------------------------------- auth

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  admin: { id: string; username: string; displayName: string; role: AdminRole };
  permissions: Permission[];
  csrfToken: string;
}

// ---------------------------------------------------------------- tournaments

export interface TournamentListQuery {
  status?: TournamentStatus;
  simulations?: boolean;
}

export interface TournamentListResponse {
  tournaments: TournamentListItemDto[];
}

export interface TournamentCreatedResponse {
  tournament: TournamentListItemDto;
}

/** PATCH /config/running — only MUTABLE_WHILE_RUNNING fields. */
export interface RunningConfigChanges {
  /** Full schedule; levels at or before the current level must be unchanged (server-checked). */
  blindSchedule?: BlindLevel[];
  breaks?: BreakRule[];
  timing?: Partial<Pick<TimingConfig, 'actionTimerSeconds' | 'awayActionTimerSeconds'>>;
  spectators?: Partial<SpectatorConfig>;
  features?: Partial<FeatureFlags>;
}

export interface RunningConfigRequest extends DangerBody<'EDIT'> {
  changes: RunningConfigChanges;
}

export interface PutConfigRequest extends ReasonBody {
  config: TournamentConfig;
}

// ---------------------------------------------------------------- tables

export type TableListStatus = TableStatus | 'STALLED';

export interface TablesQuery {
  status?: TableListStatus;
  minPlayers?: number;
  maxPlayers?: number;
  stalled?: boolean;
  /** Table number search (spec §2.5 "search by number"; not yet in API.md — contract note). */
  q?: string;
  sort?: 'number' | 'players' | 'stall' | 'chips';
  offset?: number;
  limit?: number;
}

export interface TableEventsResponse {
  events: TableEvent[];
  nextAfter: number | null;
}

export interface HoleCardsRevealResponse {
  holeCards: Record<number, [CardCode, CardCode]>;
}

export interface RebalanceResponse {
  ok: boolean;
  movesPlanned: number;
}

export interface IntegrityCheckResponse {
  ok: boolean;
  checkedTables: number;
  checkedAt: number;
  violations: Array<{ tableId: string; tableNumber: number; code: string; detail: string }>;
  chipConservation: { expectedTotal: number; actualTotal: number; ok: boolean };
}

// ---------------------------------------------------------------- players

export type PlayerSort = 'stack' | 'finish' | 'name' | 'registration';

export interface PlayersQuery {
  q?: string;
  status?: TournamentPlayerStatus | 'CONNECTED' | 'DISCONNECTED' | 'AWAY';
  tableId?: string;
  sort?: PlayerSort;
  offset?: number;
  limit?: number;
}

export interface MovePlayerRequest {
  toTableId: string;
  toSeat?: number;
  reason: string;
}

export interface AdjustStackRequest extends DangerBody<'ADJUST'> {
  newStack: number;
}

export interface RejoinCodeResponse {
  publicId: string;
  rejoinCode: string;
  /** Absolute URL encoded in the rejoin QR. */
  rejoinUrl: string;
}

export interface ManualRegistrationRequest {
  fields: Record<string, string>;
}

export interface ManualRegistrationResponse {
  player: PlayerListItemDto;
  rejoinCode: string;
}

// ---------------------------------------------------------------- hands, fairness, standings, payouts

export interface HandsQuery {
  tableId?: string;
  playerId?: string;
  /** Hand number search (spec §2.10; not yet in API.md — contract note). */
  handNumber?: number;
  minPot?: number;
  showdown?: boolean;
  allIn?: boolean;
  offset?: number;
  limit?: number;
}

export interface RevealSeedResponse {
  serverSeed: string;
}

export interface StandingsQuery {
  mode: 'stack' | 'finish';
  offset?: number;
  limit?: number;
}

export interface PaymentUpdateRequest {
  status: 'UNPAID' | 'PROCESSING' | 'PAID';
  reference: string | null;
  note: string | null;
}

// ---------------------------------------------------------------- broadcast

export type AnnounceScope = 'ALL' | 'TABLE' | 'PLAYER' | 'DISPLAY';

export interface AnnounceRequest {
  text: string;
  scope: AnnounceScope;
  targetId?: string;
}

export type DisplayScene = 'OVERVIEW' | 'LEADERBOARD' | 'FINAL_TABLE' | 'ANNOUNCEMENT' | 'CHAMPION' | 'FEATURED_TABLE';

export interface DisplayRequest {
  scene: DisplayScene;
  featuredTableId?: string | null;
}

// ---------------------------------------------------------------- alerts & audit (mirror the server)

export interface AlertsQuery {
  tournamentId?: string;
  open?: boolean;
  limit?: number;
}

export interface AlertsResponse {
  alerts: AlertDto[];
}

export interface AlertResponse {
  alert: AlertDto;
}

export interface AuditQuery {
  tournamentId?: string;
  adminId?: string;
  action?: string;
  target?: string;
  beforeSeq?: number;
  limit?: number;
}

export interface AuditListResponse {
  entries: AuditEntryDto[];
  nextBeforeSeq: number | null;
}

export interface AuditVerifyResponse {
  checked: number;
  brokenAtSeq: number | null;
  intact: boolean;
  verifiedAt: number;
}

// ---------------------------------------------------------------- users & sessions (mirror the server)

export interface UsersResponse {
  users: AdminUserDto[];
  rolePermissions: Record<AdminRole, Permission[]>;
}

export interface CreateUserRequest {
  username: string;
  displayName: string;
  role: AdminRole;
  password: string;
  tournamentScope: string[] | null;
}

export interface UpdateUserRequest extends DangerBody<'USER'> {
  displayName?: string;
  role?: AdminRole;
  tournamentScope?: string[] | null;
  disabled?: boolean;
}

export interface ResetPasswordRequest extends DangerBody<'USER'> {
  password: string;
}

export interface UserResponse {
  user: AdminUserDto | null;
}

export interface AdminSessionDto {
  id: string;
  adminId: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  ip: string | null;
  userAgent: string | null;
}

export interface SessionsResponse {
  sessions: AdminSessionDto[];
}
