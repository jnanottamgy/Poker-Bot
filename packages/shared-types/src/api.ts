import type { Alert, PaymentStatus } from './audit';
import type { CardCode, HandCategory } from './cards';
import type { BlindLevel, PrizePlace, RegistrationFieldConfig, TournamentConfig, LateRegistrationConfig } from './config';
import type { ActionType, Street } from './hand';
import type { AdminRole, Permission } from './roles';
import type { AdminTableView, HoldReason, TableStatus } from './table';
import type {
  BlindClockState,
  EliminationRecord,
  MoveReason,
  TournamentCounters,
  TournamentPlayerStatus,
  TournamentStatus,
} from './tournament';
import type { TournamentPublicSummary, PlayerSelfSummary } from './protocol';

/**
 * REST response/request DTOs (docs/API.md). Server routes return exactly
 * these shapes; the apps consume them. Times are epoch ms; chips integers;
 * money integer minor units.
 */

export interface Paginated<T> {
  rows: T[];
  total: number;
  offset: number;
  limit: number;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details: unknown };
}

// ---------------------------------------------------------------- public / player

export interface JoinInfoDto {
  tournamentId: string;
  name: string;
  joinCode: string;
  status: TournamentStatus;
  startTime: number | null;
  serverSeedHash: string;
  registration: {
    open: boolean;
    fields: RegistrationFieldConfig[];
    requiresAccessCode: boolean;
    requiresApproval: boolean;
    deadline: number | null;
    lateRegistration: LateRegistrationConfig;
  };
  limits: { minPlayers: number; maxPlayers: number };
  startingStack: number;
  counters: TournamentCounters | null;
  spectators: { publicWatch: boolean };
  prizes: { currency: string; places: PrizePlace[]; notes: string | null };
}

export interface RegisterRequest {
  fields: Record<string, string>;
  accessCode?: string | null;
  /** 64 hex chars from the browser CSPRNG — contributes to tournament public entropy. */
  clientSeed?: string | null;
}

export interface RegisterResponse {
  player: { playerId: string; publicId: string; displayName: string; status: TournamentPlayerStatus };
  tournamentId: string;
  /** Shown ONCE. Lets the player recover their seat on another device. */
  rejoinCode: string;
  csrfToken: string;
}

export interface RejoinRequest {
  publicId: string;
  rejoinCode: string;
}

export interface RejoinResponse {
  player: { playerId: string; publicId: string; displayName: string };
  tournamentId: string;
  csrfToken: string;
}

export type PlayerMeDto = PlayerSelfSummary & { tournamentId: string; joinCode: string; tournamentName: string };

export interface PlayerHistoryDto {
  finishPosition: number | null;
  tiedCount: number;
  prizeMinor: number;
  currency: string;
  handsPlayed: number;
  largestPotWon: number;
  startingStack: number;
  finalStack: number;
  movements: MovementDto[];
}

export interface LeaderboardRowDto {
  rank: number;
  playerId: string;
  publicId: string;
  displayName: string;
  stack: number;
  /** Only for mode=finish. */
  finishPosition: number | null;
  tiedCount: number;
  prizeMinor: number;
  status: TournamentPlayerStatus;
  tableNumber: number | null;
}

export interface LeaderboardDto extends Paginated<LeaderboardRowDto> {
  mode: 'stack' | 'finish';
  /** Explicit UI label: "Current stack ranking" or "Finishing positions". */
  label: string;
}

// ---------------------------------------------------------------- admin: identity

export interface AdminMeDto {
  admin: { id: string; username: string; displayName: string; role: AdminRole; tournamentScope: string[] | null };
  permissions: Permission[];
  sessionExpiresAt: number;
}

export interface AdminUserDto {
  id: string;
  username: string;
  displayName: string;
  role: AdminRole;
  tournamentScope: string[] | null;
  createdAt: number;
  createdBy: string | null;
  disabled: boolean;
  lastLoginAt: number | null;
  locked: boolean;
  failedLogins: number;
}

// ---------------------------------------------------------------- admin: tournaments

export interface TournamentListItemDto {
  id: string;
  name: string;
  joinCode: string;
  status: TournamentStatus;
  isSimulation: boolean;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  registered: number;
  active: number;
  tables: number;
}

export interface ChipConservationDto {
  expectedTotal: number;
  /** Σ table chips + chips in transit, as last checked. */
  actualTotal: number;
  ok: boolean;
  checkedAt: number;
  offendingTables: string[];
}

export interface TournamentStatsDto {
  averageStack: number;
  averageStackBB: number;
  medianStack: number;
  chipLeader: { playerId: string; displayName: string; stack: number } | null;
  largestPot: number;
  handsCompleted: number;
  handsPerMinute: number;
  actionsPerSecond: number;
  averageHandDurationMs: number;
  elapsedMs: number;
  /** Documented estimate (see Overview ETA formula); null when not enough data. */
  estimatedRemainingMs: number | null;
}

export interface TournamentOverviewDto {
  id: string;
  name: string;
  joinCode: string;
  status: TournamentStatus;
  /** State to return to after PAUSED/BREAK. */
  resumeTo: TournamentStatus | null;
  allowedTransitions: TournamentStatus[];
  isSimulation: boolean;
  config: TournamentConfig;
  configLocked: boolean;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  serverSeedHash: string;
  seedRevealed: boolean;
  publicEntropy: string | null;
  summary: TournamentPublicSummary | null;
  clock: BlindClockState | null;
  currentLevel: BlindLevel | null;
  nextLevel: BlindLevel | null;
  counters: TournamentCounters;
  tablesByStatus: Record<string, number>;
  stats: TournamentStatsDto;
  chipConservation: ChipConservationDto | null;
  handForHand: boolean;
  frozen: boolean;
  openAlerts: number;
}

// ---------------------------------------------------------------- admin: tables

export interface TableListItemDto {
  tableId: string;
  tableNumber: number;
  status: TableStatus | 'STALLED';
  holds: HoldReason[];
  frozen: boolean;
  players: number;
  maxSeats: number;
  handNumber: number;
  isFinalTable: boolean;
  lastProgressAt: number | null;
  disconnectedPlayers: number;
  chips: number;
  /** Johnny is breaking this table (players leave as their hands finish). */
  breaking?: boolean;
}

/** One free seat scored for an incoming player (lower is better; documented formula in SEATING_AND_BALANCING.md). */
export interface SeatScoreDto {
  seat: number;
  score: number;
  breakdown: Record<string, number>;
  /** The seat Johnny would choose. */
  best: boolean;
}

export interface TableInternalsDto {
  version: number;
  lastEventSeq: number;
  lastCommandSeq: number;
  ownerNode: string | null;
  leaseEpoch: number | null;
  queueLength: number;
  faulted: boolean;
  lastProgressAt: number | null;
  invariantViolations: string[];
  chipsAtTable: number;
}

export interface TableDetailDto {
  view: AdminTableView;
  internals: TableInternalsDto;
  /** Hole cards by seat, present only after an audited reveal by this admin. */
  holeCards: Record<number, [CardCode, CardCode]> | null;
  recentHands: HandListItemDto[];
}

// ---------------------------------------------------------------- admin: players

export interface PlayerListItemDto {
  playerId: string;
  entryId: string;
  publicId: string;
  displayName: string;
  nickname: string | null;
  status: TournamentPlayerStatus;
  tableId: string | null;
  tableNumber: number | null;
  seat: number | null;
  stack: number;
  stackBB: number;
  stackRank: number | null;
  finishPosition: number | null;
  connected: boolean | null;
  consecutiveTimeouts: number;
  registrationSeq: number;
  registeredAt: number;
}

export interface MovementDto {
  moveId: string;
  reason: MoveReason;
  fromTableNumber: number | null;
  fromSeat: number | null;
  toTableNumber: number;
  toSeat: number;
  stack: number;
  requestedAt: number;
  completedAt: number | null;
  scoreBreakdown: Record<string, number> | null;
}

export interface SessionDto {
  id: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  revokedAt: number | null;
  revokedReason: string | null;
  ip: string | null;
  userAgent: string | null;
  isController: boolean;
}

export interface PlayerDetailDto extends PlayerListItemDto {
  handsPlayed: number;
  largestPotWon: number;
  prizeMinor: number;
  tiedCount: number;
  elimination: EliminationRecord | null;
  paymentStatus: PaymentStatus;
  sessions: SessionDto[];
  movements: MovementDto[];
  recentActions: Array<{ handId: string; handNumber: number; street: Street; action: ActionType; amount: number; toAmount: number; timeout: boolean; at: number }>;
  /** True when PII fields are available to this admin via /pii. */
  piiAvailable: boolean;
}

export interface PlayerPiiDto {
  playerId: string;
  name: string;
  nickname: string | null;
  participantId: string | null;
  email: string | null;
  phone: string | null;
  collegeId: string | null;
}

// ---------------------------------------------------------------- admin: hands & fairness

export interface HandListItemDto {
  handId: string;
  tableId: string;
  tableNumber: number;
  handNumber: number;
  startedAt: number;
  completedAt: number | null;
  level: number;
  smallBlind: number;
  bigBlind: number;
  totalPot: number;
  players: number;
  showdown: boolean;
  allIn: boolean;
  winners: Array<{ playerId: string; displayName: string; amount: number }>;
}

export interface HandActionDto {
  seq: number;
  street: Street;
  seat: number;
  playerId: string;
  displayName: string;
  action: ActionType | 'POST_SB' | 'POST_BB' | 'POST_ANTE';
  amount: number;
  toAmount: number;
  allIn: boolean;
  timeout: boolean;
  stackAfter: number;
  potAfter: number;
  at: number;
}

export interface HandDetailDto extends HandListItemDto {
  buttonSeat: number | null;
  smallBlindSeat: number | null;
  bigBlindSeat: number;
  ante: number;
  board: CardCode[];
  boardByStreet: { flop: CardCode[]; turn: CardCode | null; river: CardCode | null };
  seats: Array<{
    seat: number;
    playerId: string;
    displayName: string;
    publicId: string;
    startingStack: number;
    finalStack: number;
    holeCards: [CardCode, CardCode] | null;
    shown: boolean;
    finalHand: { category: HandCategory; description: string; bestFive: CardCode[] } | null;
  }>;
  actions: HandActionDto[];
  pots: Array<{
    potIndex: number;
    type: 'MAIN' | 'SIDE';
    amount: number;
    eligibleSeats: number[];
    winners: Array<{ seat: number; playerId: string; amount: number; oddChips: number }>;
    winningHand: { category: HandCategory; description: string } | null;
  }>;
  uncalledReturns: Array<{ seat: number; amount: number }>;
  randomness: {
    method: 'HMAC-SHA256-STREAM+FISHER-YATES';
    serverSeedHash: string;
    publicEntropy: string;
    deckHash: string;
    label: string;
  };
}

export type VerificationStatus = 'VERIFIED' | 'FAILED' | 'NOT_AVAILABLE';

export interface TournamentFairnessDto {
  tournamentId: string;
  serverSeedHash: string;
  serverSeed: string | null;
  seedRevealed: boolean;
  publicEntropy: string | null;
  entropyInputs: { clientSeedCount: number; adminEntropy: string | null };
  method: string;
  documentationUrl: string;
}

// ---------------------------------------------------------------- admin: standings & payouts

export interface PayoutRowDto {
  entryId: string;
  playerId: string;
  publicId: string;
  displayName: string;
  finishPosition: number;
  tiedCount: number;
  prizeMinor: number;
  currency: string;
  paymentStatus: PaymentStatus;
  paidAt: number | null;
  processedBy: string | null;
  paymentReference: string | null;
}

export interface PayoutsDto {
  currency: string;
  rows: PayoutRowDto[];
  totals: { configuredMinor: number; awardedMinor: number; paidMinor: number; outstandingMinor: number };
}

// ---------------------------------------------------------------- admin: system, metrics, reports

export interface AuditEntryDto {
  id: string;
  seq: number;
  at: number;
  tournamentId: string | null;
  adminId: string | null;
  adminUsername: string;
  action: string;
  target: string;
  reason: string | null;
  beforeState: unknown;
  afterState: unknown;
  ip: string | null;
  prevHash: string;
  hash: string;
}

export type AlertDto = Alert;

export interface NodeDto {
  nodeId: string;
  role: string;
  startedAt: number;
  lastHeartbeatAt: number;
  ownedTables: number;
  ownedDirectors: number;
}

export interface SystemDto {
  nodes: NodeDto[];
  connections: Record<string, number>;
  latency: {
    actions: { p50: number; p95: number; p99: number; count: number };
    db: { p50: number; p95: number; p99: number; count: number };
  };
  rates: { actionsPerSecond: number; handsPerMinute: number; disconnectsPerSecond: number; reconnectsPerSecond: number };
  errors: Record<string, number>;
  stalledTables: Array<{ tableId: string; tableNumber: number; lastProgressAt: number | null }>;
  uptimeMs: number;
  version: string;
}

export interface LiveMetricsPoint {
  at: number;
  playersRemaining: number;
  tables: number;
  handsPerMinute: number;
  actionsPerSecond: number;
  actionLatencyP50: number;
  actionLatencyP95: number;
  actionLatencyP99: number;
  connections: number;
}

export interface LiveMetricsDto {
  points: LiveMetricsPoint[];
}

export interface TournamentReportDto {
  tournamentId: string;
  name: string;
  status: TournamentStatus;
  players: number;
  entries: number;
  tablesUsed: number;
  startedAt: number | null;
  completedAt: number | null;
  durationMs: number | null;
  handsPlayed: number;
  averageHandDurationMs: number | null;
  finalTableDurationMs: number | null;
  largestPot: { amount: number; handId: string; winnerName: string } | null;
  winner: { playerId: string; displayName: string; publicId: string } | null;
  standings: LeaderboardRowDto[];
  prizeStructure: { currency: string; places: PrizePlace[] };
  payouts: PayoutsDto['totals'];
  serverSeedHash: string;
  seedRevealed: boolean;
  generatedAt: number;
}

export interface DemoRequest {
  players: number;
  strategyMix: Partial<Record<'ALWAYS_FOLD' | 'RANDOM_LEGAL_ACTION' | 'CALL_HEAVY' | 'RAISE_HEAVY' | 'ALL_IN_RANDOMLY' | 'TIMEOUT_ALWAYS' | 'FLAKY', number>>;
  speedMode: boolean;
  name?: string;
}

export interface DemoStatusDto {
  tournamentId: string;
  joinCode: string;
  players: number;
  running: boolean;
  status: TournamentStatus;
  startedAt: number;
  handsCompleted: number;
  actionsSubmitted: number;
  playersRemaining: number;
}
