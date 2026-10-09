import { expect } from 'vitest';
import type {
  AdminMeDto,
  AdminUserDto,
  AlertDto,
  AuditEntryDto,
  ChipConservationDto,
  DemoStatusDto,
  FairnessExport,
  HandDetailDto,
  HandFairnessRecord,
  HandListItemDto,
  JoinInfoDto,
  LeaderboardDto,
  LeaderboardRowDto,
  LiveMetricsPoint,
  MovementDto,
  NodeDto,
  Paginated,
  PayoutRowDto,
  PayoutsDto,
  PlayerDetailDto,
  PlayerListItemDto,
  PlayerPiiDto,
  RegisterResponse,
  RejoinResponse,
  SeatScoreDto,
  SessionDto,
  SystemDto,
  TableDetailDto,
  TableEvent,
  TableInternalsDto,
  TableListItemDto,
  TournamentFairnessDto,
  TournamentListItemDto,
  TournamentOverviewDto,
  TournamentPublicSummary,
  TournamentReportDto,
  TournamentStatsDto,
} from '@jpb/shared-types';
import type {
  AdminSessionDto,
  IntegrityCheckResponse,
  LoginResponse,
  ManualRegistrationResponse,
  RejoinCodeResponse,
} from '../../apps/admin-dashboard/src/api/types';

/**
 * Small runtime shape checks for the admin API contract test. A `Spec<T>` must
 * name exactly the keys of the TypeScript DTO `T` (enforced by the compiler),
 * and `check` enforces at runtime that the server's JSON has exactly those
 * keys with the given JSON kinds — so a renamed, missing, extra or wrongly
 * nullable field fails either the typecheck or the test.
 */
type Base = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null' | 'unknown';
export type Kind = Base | `${Base}|null` | `${Base}?`;
export type Spec<T> = { [K in keyof Required<T>]: Kind };

function kindOf(v: unknown): Base {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v as Base;
}

export function check<T>(label: string, value: unknown, spec: Spec<T>): T {
  expect(kindOf(value), `${label} is not an object`).toBe('object');
  const obj = value as Record<string, unknown>;
  const extra = Object.keys(obj).filter((k) => !(k in spec));
  expect(extra, `${label}: fields the client does not know`).toEqual([]);
  for (const [key, kind] of Object.entries(spec) as Array<[string, Kind]>) {
    const v = obj[key];
    const optional = kind.endsWith('?');
    if (v === undefined) {
      expect(optional, `${label}.${key} is missing`).toBe(true);
      continue;
    }
    const allowed = kind.replace('?', '').split('|');
    if (allowed.includes('unknown')) continue;
    expect(allowed, `${label}.${key} is ${kindOf(v)} (${JSON.stringify(v)?.slice(0, 80)})`).toContain(kindOf(v));
  }
  return value as T;
}

export function checkAll<T>(label: string, rows: unknown, spec: Spec<T>): T[] {
  expect(Array.isArray(rows), `${label} is not an array`).toBe(true);
  return (rows as unknown[]).map((r, i) => check<T>(`${label}[${i}]`, r, spec));
}

export function checkPage<T>(label: string, value: unknown, rowSpec: Spec<T>): Paginated<T> {
  const page = check<Paginated<T>>(label, value, PAGINATED);
  checkAll(`${label}.rows`, page.rows, rowSpec);
  expect(page.rows.length).toBeLessThanOrEqual(page.limit);
  expect(page.total).toBeGreaterThanOrEqual(page.rows.length);
  return page;
}

export const OK: Spec<{ ok: boolean }> = { ok: 'boolean' };

export const PAGINATED: Spec<Paginated<unknown>> = { rows: 'array', total: 'number', offset: 'number', limit: 'number' };

export const LOGIN: Spec<LoginResponse> = { admin: 'object', permissions: 'array', csrfToken: 'string' };
export const ME: Spec<AdminMeDto> = { admin: 'object', permissions: 'array', sessionExpiresAt: 'number' };
export const ME_ADMIN: Spec<AdminMeDto['admin']> = { id: 'string', username: 'string', displayName: 'string', role: 'string', tournamentScope: 'array|null' };

export const TOURNAMENT_ITEM: Spec<TournamentListItemDto> = {
  id: 'string',
  name: 'string',
  joinCode: 'string',
  status: 'string',
  isSimulation: 'boolean',
  createdAt: 'number',
  startedAt: 'number|null',
  completedAt: 'number|null',
  registered: 'number',
  active: 'number',
  tables: 'number',
};

export const OVERVIEW: Spec<TournamentOverviewDto> = {
  id: 'string',
  name: 'string',
  joinCode: 'string',
  status: 'string',
  resumeTo: 'string|null',
  allowedTransitions: 'array',
  isSimulation: 'boolean',
  config: 'object',
  configLocked: 'boolean',
  createdAt: 'number',
  startedAt: 'number|null',
  completedAt: 'number|null',
  serverSeedHash: 'string',
  seedRevealed: 'boolean',
  publicEntropy: 'string|null',
  summary: 'object|null',
  clock: 'object|null',
  currentLevel: 'object|null',
  nextLevel: 'object|null',
  counters: 'object',
  tablesByStatus: 'object',
  stats: 'object',
  chipConservation: 'object|null',
  handForHand: 'boolean',
  frozen: 'boolean',
  openAlerts: 'number',
};

export const STATS: Spec<TournamentStatsDto> = {
  averageStack: 'number',
  averageStackBB: 'number',
  medianStack: 'number',
  chipLeader: 'object|null',
  largestPot: 'number',
  handsCompleted: 'number',
  handsPerMinute: 'number',
  actionsPerSecond: 'number',
  averageHandDurationMs: 'number',
  elapsedMs: 'number',
  estimatedRemainingMs: 'number|null',
};

export const CHIP_CONSERVATION: Spec<ChipConservationDto> = { expectedTotal: 'number', actualTotal: 'number', ok: 'boolean', checkedAt: 'number', offendingTables: 'array' };

export const SUMMARY: Spec<TournamentPublicSummary> = {
  tournamentId: 'string',
  name: 'string',
  status: 'string',
  clock: 'object',
  currentLevel: 'object|null',
  nextLevel: 'object|null',
  counters: 'object',
  handForHand: 'boolean',
  lastSeq: 'number',
  serverSeedHash: 'string',
};

export const TABLE_ITEM: Spec<TableListItemDto> = {
  tableId: 'string',
  tableNumber: 'number',
  status: 'string',
  holds: 'array',
  frozen: 'boolean',
  players: 'number',
  maxSeats: 'number',
  handNumber: 'number',
  isFinalTable: 'boolean',
  lastProgressAt: 'number|null',
  disconnectedPlayers: 'number',
  chips: 'number',
  breaking: 'boolean?',
};

export const TABLE_DETAIL: Spec<TableDetailDto> = { view: 'object', internals: 'object', holeCards: 'object|null', recentHands: 'array' };

export const TABLE_INTERNALS: Spec<TableInternalsDto> = {
  version: 'number',
  lastEventSeq: 'number',
  lastCommandSeq: 'number',
  ownerNode: 'string|null',
  leaseEpoch: 'number|null',
  queueLength: 'number',
  faulted: 'boolean',
  lastProgressAt: 'number|null',
  invariantViolations: 'array',
  chipsAtTable: 'number',
};

export const TABLE_EVENT: Spec<TableEvent> = {
  tableId: 'string',
  tournamentId: 'string',
  seq: 'number',
  version: 'number',
  at: 'number',
  visibility: 'string',
  privateTo: 'string|null',
  event: 'object',
};

export const SEAT_SCORE: Spec<SeatScoreDto> = { seat: 'number', score: 'number', breakdown: 'object', best: 'boolean' };

export const INTEGRITY: Spec<IntegrityCheckResponse> = { ok: 'boolean', checkedTables: 'number', checkedAt: 'number', violations: 'array', chipConservation: 'object' };

export const PLAYER_ITEM: Spec<PlayerListItemDto> = {
  playerId: 'string',
  entryId: 'string',
  publicId: 'string',
  displayName: 'string',
  nickname: 'string|null',
  status: 'string',
  tableId: 'string|null',
  tableNumber: 'number|null',
  seat: 'number|null',
  stack: 'number',
  stackBB: 'number',
  stackRank: 'number|null',
  finishPosition: 'number|null',
  connected: 'boolean|null',
  consecutiveTimeouts: 'number',
  registrationSeq: 'number',
  registeredAt: 'number',
};

export const PLAYER_DETAIL: Spec<PlayerDetailDto> = {
  ...PLAYER_ITEM,
  handsPlayed: 'number',
  largestPotWon: 'number',
  prizeMinor: 'number',
  tiedCount: 'number',
  elimination: 'object|null',
  paymentStatus: 'string',
  sessions: 'array',
  movements: 'array',
  recentActions: 'array',
  piiAvailable: 'boolean',
};

export const PLAYER_SESSION: Spec<SessionDto> = {
  id: 'string',
  createdAt: 'number',
  lastSeenAt: 'number',
  expiresAt: 'number',
  revokedAt: 'number|null',
  revokedReason: 'string|null',
  ip: 'string|null',
  userAgent: 'string|null',
  isController: 'boolean',
};

export const MOVEMENT: Spec<MovementDto> = {
  moveId: 'string',
  reason: 'string',
  fromTableNumber: 'number|null',
  fromSeat: 'number|null',
  toTableNumber: 'number',
  toSeat: 'number',
  stack: 'number',
  requestedAt: 'number',
  completedAt: 'number|null',
  scoreBreakdown: 'object|null',
};

export const PII: Spec<PlayerPiiDto> = {
  playerId: 'string',
  name: 'string',
  nickname: 'string|null',
  participantId: 'string|null',
  email: 'string|null',
  phone: 'string|null',
  collegeId: 'string|null',
};

export const REJOIN_CODE: Spec<RejoinCodeResponse> = { publicId: 'string', rejoinCode: 'string', rejoinUrl: 'string' };
export const MANUAL_REGISTRATION: Spec<ManualRegistrationResponse> = { player: 'object', rejoinCode: 'string', rejoinUrl: 'string' };

export const HAND_ITEM: Spec<HandListItemDto> = {
  handId: 'string',
  tableId: 'string',
  tableNumber: 'number',
  handNumber: 'number',
  startedAt: 'number',
  completedAt: 'number|null',
  level: 'number',
  smallBlind: 'number',
  bigBlind: 'number',
  totalPot: 'number',
  players: 'number',
  showdown: 'boolean',
  allIn: 'boolean',
  winners: 'array',
};

export const HAND_DETAIL: Spec<HandDetailDto> = {
  ...HAND_ITEM,
  buttonSeat: 'number|null',
  smallBlindSeat: 'number|null',
  bigBlindSeat: 'number',
  ante: 'number',
  board: 'array',
  boardByStreet: 'object',
  seats: 'array',
  actions: 'array',
  pots: 'array',
  uncalledReturns: 'array',
  randomness: 'object',
};

export const HAND_FAIRNESS: Spec<HandFairnessRecord> = {
  scheme: 'string',
  tournamentId: 'string',
  tableId: 'string',
  handId: 'string',
  handNumber: 'number',
  publicEntropy: 'string',
  serverSeedHash: 'string',
  deckHash: 'string',
  maxSeats: 'number',
  buttonSeat: 'number',
  holeCards: 'array',
  board: 'array',
  burns: 'array|null',
};

export const TOURNAMENT_FAIRNESS: Spec<TournamentFairnessDto> = {
  tournamentId: 'string',
  serverSeedHash: 'string',
  serverSeed: 'string|null',
  seedRevealed: 'boolean',
  publicEntropy: 'string|null',
  entropyInputs: 'object',
  method: 'string',
  documentationUrl: 'string',
};

export const FAIRNESS_EXPORT: Spec<FairnessExport> = {
  format: 'string',
  formatVersion: 'number',
  scheme: 'string',
  method: 'object',
  tournamentId: 'string',
  serverSeedHash: 'string',
  serverSeed: 'string|null',
  publicEntropy: 'string',
  entropyInputs: 'object|null',
  hands: 'array',
};

export const LEADERBOARD: Spec<LeaderboardDto> = { ...PAGINATED, mode: 'string', label: 'string' };

export const LEADERBOARD_ROW: Spec<LeaderboardRowDto> = {
  rank: 'number',
  playerId: 'string',
  publicId: 'string',
  displayName: 'string',
  stack: 'number',
  finishPosition: 'number|null',
  tiedCount: 'number',
  prizeMinor: 'number',
  status: 'string',
  tableNumber: 'number|null',
};

export const PAYOUTS: Spec<PayoutsDto> = { currency: 'string', rows: 'array', totals: 'object' };
export const PAYOUT_TOTALS: Spec<PayoutsDto['totals']> = { configuredMinor: 'number', awardedMinor: 'number', paidMinor: 'number', outstandingMinor: 'number' };

export const PAYOUT_ROW: Spec<PayoutRowDto> = {
  entryId: 'string',
  playerId: 'string',
  publicId: 'string',
  displayName: 'string',
  finishPosition: 'number',
  tiedCount: 'number',
  prizeMinor: 'number',
  currency: 'string',
  paymentStatus: 'string',
  paidAt: 'number|null',
  processedBy: 'string|null',
  paymentReference: 'string|null',
};

export const AUDIT_ENTRY: Spec<AuditEntryDto> = {
  id: 'string',
  seq: 'number',
  at: 'number',
  tournamentId: 'string|null',
  adminId: 'string|null',
  adminUsername: 'string',
  action: 'string',
  target: 'string',
  reason: 'string|null',
  beforeState: 'unknown',
  afterState: 'unknown',
  ip: 'string|null',
  prevHash: 'string',
  hash: 'string',
};

export const ALERT: Spec<AlertDto> = {
  id: 'string',
  at: 'number',
  tournamentId: 'string|null',
  severity: 'string',
  code: 'string',
  message: 'string',
  target: 'string|null',
  acknowledgedBy: 'string|null',
  acknowledgedAt: 'number|null',
  resolvedAt: 'number|null',
};

export const ADMIN_USER: Spec<AdminUserDto> = {
  id: 'string',
  username: 'string',
  displayName: 'string',
  role: 'string',
  tournamentScope: 'array|null',
  createdAt: 'number',
  createdBy: 'string|null',
  disabled: 'boolean',
  lastLoginAt: 'number|null',
  locked: 'boolean',
  failedLogins: 'number',
};

export const ADMIN_SESSION: Spec<AdminSessionDto> = {
  id: 'string',
  adminId: 'string',
  createdAt: 'number',
  lastSeenAt: 'number',
  expiresAt: 'number',
  ip: 'string|null',
  userAgent: 'string|null',
};

export const SYSTEM: Spec<SystemDto> = {
  nodes: 'array',
  connections: 'object',
  latency: 'object',
  rates: 'object',
  errors: 'object',
  stalledTables: 'array',
  uptimeMs: 'number',
  version: 'string',
};

export const NODE: Spec<NodeDto> = { nodeId: 'string', role: 'string', startedAt: 'number', lastHeartbeatAt: 'number', ownedTables: 'number', ownedDirectors: 'number' };

export const METRICS_POINT: Spec<LiveMetricsPoint> = {
  at: 'number',
  playersRemaining: 'number',
  tables: 'number',
  handsPerMinute: 'number',
  actionsPerSecond: 'number',
  actionLatencyP50: 'number',
  actionLatencyP95: 'number',
  actionLatencyP99: 'number',
  connections: 'number',
};

export const REPORT: Spec<TournamentReportDto> = {
  tournamentId: 'string',
  name: 'string',
  status: 'string',
  players: 'number',
  entries: 'number',
  tablesUsed: 'number',
  startedAt: 'number|null',
  completedAt: 'number|null',
  durationMs: 'number|null',
  handsPlayed: 'number',
  averageHandDurationMs: 'number|null',
  finalTableDurationMs: 'number|null',
  largestPot: 'object|null',
  winner: 'object|null',
  standings: 'array',
  prizeStructure: 'object',
  payouts: 'object',
  serverSeedHash: 'string',
  seedRevealed: 'boolean',
  generatedAt: 'number',
};

export const DEMO: Spec<DemoStatusDto> = {
  tournamentId: 'string',
  joinCode: 'string',
  players: 'number',
  running: 'boolean',
  status: 'string',
  startedAt: 'number',
  handsCompleted: 'number',
  actionsSubmitted: 'number',
  playersRemaining: 'number',
};

export const JOIN_INFO: Spec<JoinInfoDto> = {
  tournamentId: 'string',
  name: 'string',
  joinCode: 'string',
  status: 'string',
  startTime: 'number|null',
  serverSeedHash: 'string',
  registration: 'object',
  limits: 'object',
  startingStack: 'number',
  counters: 'object|null',
  spectators: 'object',
  prizes: 'object',
};

export const REGISTERED: Spec<RegisterResponse> = { player: 'object', tournamentId: 'string', rejoinCode: 'string', csrfToken: 'string' };
export const REJOINED: Spec<RejoinResponse> = { player: 'object', tournamentId: 'string', csrfToken: 'string' };
