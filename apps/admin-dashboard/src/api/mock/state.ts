import type {
  AdminRole,
  Alert,
  AuditEntryDto,
  BlindClockState,
  EliminationRecord,
  HoldReason,
  LiveMetricsPoint,
  MovementDto,
  PaymentStatus,
  SessionDto,
  TableStatus,
  TournamentConfig,
  TournamentEventEnvelope,
  TournamentPlayerStatus,
  TournamentStatus,
} from '@jpb/shared-types';
import type { DemoStatusDto, HandListItemDto } from '@jpb/shared-types';

/** Mutable in-memory state of the mock server (plain objects, like the real server's projections). */

export interface MockPlayer {
  playerId: string;
  entryId: string;
  publicId: string;
  displayName: string;
  nickname: string | null;
  status: TournamentPlayerStatus;
  tableId: string | null;
  seat: number | null;
  stack: number;
  finishPosition: number | null;
  tiedCount: number;
  connected: boolean | null;
  consecutiveTimeouts: number;
  registrationSeq: number;
  registeredAt: number;
  pii: { email: string; phone: string; participantId: string | null; collegeId: string | null };
  handsPlayed: number;
  largestPotWon: number;
  prizeMinor: number;
  payment: { status: PaymentStatus; paidAt: number | null; processedBy: string | null; reference: string | null; note: string | null };
  elimination: EliminationRecord | null;
  movements: MovementDto[];
  sessions: SessionDto[];
  /** 1 for the first entry; re-entries count up (absent = 1). */
  entryNumber?: number;
}

export interface MockTable {
  tableId: string;
  tableNumber: number;
  maxSeats: number;
  /** playerId per seat index. */
  seats: Array<string | null>;
  status: TableStatus;
  holds: HoldReason[];
  frozen: boolean;
  handNumber: number;
  isFinalTable: boolean;
  lastProgressAt: number;
  /** Mock fault injection: no progress until released. */
  stalled: boolean;
  /** Progress through the current hand (drives the live table view). */
  handStep: number;
  /** Admin ids that performed an audited hole-card reveal. */
  revealedTo: string[];
}

export interface MockTournament {
  id: string;
  name: string;
  joinCode: string;
  status: TournamentStatus;
  resumeTo: TournamentStatus | null;
  isSimulation: boolean;
  config: TournamentConfig;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  serverSeed: string;
  serverSeedHash: string;
  seedRevealed: boolean;
  publicEntropy: string | null;
  clientSeedCount: number;
  clock: BlindClockState;
  handForHand: boolean;
  frozen: boolean;
  players: MockPlayer[];
  tables: MockTable[];
  handsCompleted: number;
  largestPot: number;
  /** Hand list cache (index = global hand index, oldest first). */
  hands: HandListItemDto[];
  metrics: LiveMetricsPoint[];
  events: TournamentEventEnvelope[];
  seq: number;
  /** Per-tournament deterministic seed root. */
  seedKey: string;
  display: { scene: string; featuredTableId: string | null };
}

export interface MockAdmin {
  id: string;
  username: string;
  displayName: string;
  role: AdminRole;
  tournamentScope: string[] | null;
  password: string;
  createdAt: number;
  createdBy: string | null;
  disabled: boolean;
  lastLoginAt: number | null;
  lockedUntil: number | null;
  failedLogins: number;
}

export interface MockAdminSession {
  id: string;
  adminId: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  ip: string | null;
  userAgent: string | null;
  revokedAt: number | null;
}

export interface MockWorld {
  tournaments: MockTournament[];
  alerts: Alert[];
  audit: AuditEntryDto[];
  admins: MockAdmin[];
  sessions: MockAdminSession[];
  demos: DemoStatusDto[];
  /** The signed-in admin session of this browser tab (the mock has no cookies). */
  currentSessionId: string | null;
  idCounter: number;
}
