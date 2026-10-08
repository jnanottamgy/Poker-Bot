import { randomBytes } from 'node:crypto';
import { WebSocket } from 'ws';
import type { FastifyInstance } from 'fastify';
import type {
  ActionType,
  AdminRole,
  CardCode,
  CommandReply,
  PlayerSelfSummary,
  PublicSeatView,
  ServerMessage,
  TableEvent,
  TournamentConfig,
  TournamentPublicSummary,
} from '@jpb/shared-types';
import { loadEnv } from '../../src/config/env';
import type { ServerEnv } from '../../src/config/env';
import { Store } from '../../src/persistence/store';
import { SessionService } from '../../src/auth/sessions';
import { AdminAuthService } from '../../src/auth/admin-auth';
import { AuditService } from '../../src/audit/audit-service';
import { MetricsRegistry } from '../../src/observability/metrics';
import { createMetricsCatalog } from '../../src/observability/catalog';
import type { MetricsCatalog } from '../../src/observability/catalog';
import { buildHttpApp } from '../../src/http/app';
import type { HttpContext } from '../../src/http/context';
import type { MessageBus } from '../../src/bus/bus';
import { channels } from '../../src/bus/bus';
import type { GatewayBackend, TableUpdateMessage, TournamentEventMessage } from '../../src/runtime/contracts';
import { Gateway } from '../../src/gateway/gateway';
import { gatewayModule } from '../../src/gateway/plugin';
import type { GatewayOptions } from '../../src/gateway/options';
import type { PresenceStore } from '../../src/gateway/presence';
import { MemoryPresenceStore } from '../../src/gateway/presence';
import { createTestDatabase } from './db';

export const ORIGIN = 'http://localhost:8080';

// ------------------------------------------------------------------ fake runtime

export interface ActionCall {
  playerId: string;
  tableId: string;
  actionId: string;
  type: ActionType;
  amount?: number;
  tableStateVersion: number;
  receivedAt: number;
}

/** In-memory GatewayBackend: tests set state directly and publish bus messages themselves. */
export class FakeBackend implements GatewayBackend {
  summaries = new Map<string, TournamentPublicSummary>();
  selves = new Map<string, PlayerSelfSummary>();
  tables = new Map<string, TableUpdateMessage>();
  featured = new Map<string, string | null>();
  publicWatch = new Set<string>();
  eliminatedSpectators = new Set<string>();
  displays = new Set<string>();
  delays = new Map<string, number>();
  actions: ActionCall[] = [];
  connections: Array<{ playerId: string; connected: boolean; at: number }> = [];
  actionReply: (a: ActionCall) => Promise<CommandReply> = async () => ({ ok: true, code: null, message: null, duplicate: false });

  async tournamentSummary(id: string) {
    return this.summaries.get(id) ?? null;
  }
  async playerSelf(id: string) {
    return this.selves.get(id) ?? null;
  }
  async tableSnapshot(id: string) {
    const t = this.tables.get(id);
    return t ? { ...t, events: [] } : null;
  }
  async featuredTable(tid: string) {
    return this.featured.get(tid) ?? null;
  }
  async canSpectate(tid: string, playerId: string | null) {
    return this.publicWatch.has(tid) || (playerId !== null && this.eliminatedSpectators.has(playerId));
  }
  async canDisplay(tid: string) {
    return this.displays.has(tid);
  }
  async spectatorDelayMs(tid: string) {
    return this.delays.get(tid) ?? 0;
  }
  async submitPlayerAction(input: ActionCall) {
    this.actions.push(input);
    return this.actionReply(input);
  }
  playerConnection(playerId: string, connected: boolean) {
    this.connections.push({ playerId, connected, at: Date.now() });
  }
}

export function summary(tournamentId: string, lastSeq = 0): TournamentPublicSummary {
  return {
    tournamentId,
    name: `Tournament ${tournamentId}`,
    status: 'RUNNING',
    clock: { levelIndex: 0, levelStartedAt: 0, levelEndsAt: null, pausedRemainingMs: null, breakEndsAt: null, pendingBreakAfterLevel: null },
    currentLevel: null,
    nextLevel: null,
    counters: { registered: 2, active: 2, eliminated: 0, inTransit: 0, tables: 1, handsCompleted: 0, totalChips: 20_000, largestPot: 0 },
    handForHand: false,
    lastSeq,
    serverSeedHash: 'hash',
  };
}

export function self(playerId: string, tableId: string | null, extra: Partial<PlayerSelfSummary> = {}): PlayerSelfSummary {
  return {
    playerId,
    publicId: `JPN-${playerId}`,
    displayName: `Name ${playerId}`,
    status: tableId ? 'SEATED' : 'REGISTERED',
    tableId,
    tableNumber: tableId ? 1 : null,
    seat: tableId ? 0 : null,
    stack: 10_000,
    finishPosition: null,
    prizeMinor: 0,
    handsPlayed: 0,
    ...extra,
  };
}

function seatView(seat: number, playerId: string): PublicSeatView {
  return {
    seat,
    playerId,
    displayName: `Name ${playerId}`,
    publicId: `JPN-${playerId}`,
    stack: 10_000,
    connected: true,
    inHand: true,
    folded: false,
    allIn: false,
    streetContribution: 0,
    lastAction: null,
    isButton: seat === 0,
    isSmallBlind: false,
    isBigBlind: false,
    shownCards: null,
    away: false,
  };
}

export interface TableSpec {
  tableId: string;
  tournamentId: string;
  version: number;
  players: string[];
  /** Hole cards per player (index-aligned with players). */
  holeCards?: Array<[CardCode, CardCode] | null>;
  events?: TableEvent[];
  board?: CardCode[];
}

export function tableUpdate(spec: TableSpec): TableUpdateMessage {
  const seats = spec.players.map((p, i) => seatView(i, p));
  const blinds = { level: 1, smallBlind: 50, bigBlind: 100, ante: 0, anteType: 'NONE' as const };
  const base = {
    tableId: spec.tableId,
    tournamentId: spec.tournamentId,
    tableNumber: 1,
    version: spec.version,
    lastEventSeq: spec.version,
    status: 'IN_HAND' as const,
    holds: [],
    frozen: false,
    maxSeats: Math.max(2, spec.players.length),
    seats,
    buttonSeat: 0,
    blinds,
    hand: {
      handId: 'h1',
      handNumber: 1,
      phase: 'PREFLOP' as const,
      board: spec.board ?? [],
      pots: [],
      totalPot: 0,
      currentBet: 0,
      actingSeat: 0,
      actionDeadline: null,
      turnVersion: spec.version,
    },
    serverTime: 0,
  };
  const privateByPlayer: TableUpdateMessage['privateByPlayer'] = {};
  const holeCardsBySeat: TableUpdateMessage['holeCardsBySeat'] = {};
  spec.players.forEach((p, i) => {
    const cards = spec.holeCards?.[i] ?? null;
    privateByPlayer[p] = { seat: i, holeCards: cards, legal: null };
    if (cards) holeCardsBySeat[i] = cards;
  });
  const events = spec.events ?? [];
  return {
    kind: 'TABLE_UPDATE',
    tableId: spec.tableId,
    tournamentId: spec.tournamentId,
    fromSeq: events[0]?.seq ?? spec.version + 1,
    toSeq: events[events.length - 1]?.seq ?? spec.version,
    version: spec.version,
    at: Date.now(),
    events,
    publicView: { ...base, audience: 'SPECTATOR' },
    privateByPlayer,
    adminView: {
      ...base,
      audience: 'ADMIN',
      holeCards: null,
      seatDetails: seats.map(() => null),
      timing: { actionTimerMs: 15_000, awayActionTimerMs: 5_000, awayAfterTimeouts: 2, actionGraceMs: 500, betweenHandsDelayMs: 2_000, showdownDelayMs: 2_000 },
      handForHand: false,
      pendingBlinds: null,
      lastProgressAt: 0,
      handsPlayed: 0,
    },
    holeCardsBySeat,
  };
}

export function holeEvent(tableId: string, tournamentId: string, seq: number, seat: number, playerId: string, cards: [CardCode, CardCode], visibility: 'PUBLIC' | 'PRIVATE' = 'PRIVATE'): TableEvent {
  return { tableId, tournamentId, seq, version: seq, at: 0, visibility, privateTo: playerId, event: { kind: 'HOLE_CARDS_DEALT', seat, playerId, cards } };
}

export function actedEvent(tableId: string, tournamentId: string, seq: number, seat: number, playerId: string): TableEvent {
  return {
    tableId,
    tournamentId,
    seq,
    version: seq,
    at: 0,
    visibility: 'PUBLIC',
    privateTo: null,
    event: { kind: 'PLAYER_ACTED', seat, playerId, action: 'CALL', amount: 100, toAmount: 100, allIn: false, stack: 9_900, pot: 200, timeout: false },
  };
}

export function tournamentEvent(tournamentId: string, seq: number, text = `announcement ${seq}`): TournamentEventMessage {
  return {
    kind: 'TOURNAMENT_EVENT',
    tournamentId,
    envelope: { tournamentId, seq, at: Date.now(), event: { kind: 'ANNOUNCEMENT', text, from: 'DIRECTOR' } },
    summary: summary(tournamentId, seq),
  };
}

// ------------------------------------------------------------------ server

export function tournamentConfig(name: string, joinCode: string): TournamentConfig {
  return {
    name,
    joinCode,
    game: 'NLH',
    minPlayers: 2,
    maxPlayers: 100,
    tables: { targetSize: 8, maxSize: 9, minSize: 2, finalTableSize: 9 },
    startingStack: 10_000,
    blindSchedule: [{ level: 1, smallBlind: 50, bigBlind: 100, ante: 0, durationSeconds: 480 }],
    anteType: 'NONE',
    breaks: [],
    timing: {
      actionTimerSeconds: 15,
      awayActionTimerSeconds: 5,
      awayAfterTimeouts: 2,
      actionGraceMs: 500,
      timeoutBehavior: 'CHECK_ELSE_FOLD',
      betweenHandsDelayMs: 2000,
      showdownDelayMs: 2000,
      startCountdownSeconds: 30,
    },
    lateRegistration: { enabled: false, untilLevel: 0 },
    reentry: { enabled: false, maxEntriesPerPlayer: 1, untilLevel: 0 },
    prizeStructure: { currency: 'INR', places: [{ position: 1, amountMinor: 1_000 }] },
    registration: { fields: [{ key: 'name', required: true }], requireApproval: false, accessCode: null },
    startTime: null,
    autoStart: false,
    registrationDeadline: null,
    spectators: { enabled: true, allowEliminatedPlayers: true, publicWatch: false, delaySeconds: 0 },
    balancing: { maxImbalance: 1, recentMoveWindowHands: 10, weights: { position: 1, blindFairness: 1, recentMove: 1, seatCompatibility: 0.1 }, consolidateBy: 'TARGET' },
    handForHand: { autoAtBubble: true },
    features: { spectatorMode: true, advancedFairnessAudit: true, lateRegistration: false, soundEffects: true, haptics: true, broadcastDisplay: true },
    speedMode: false,
  };
}

export interface GatewayNode {
  app: FastifyInstance;
  ctx: HttpContext;
  gateway: Gateway;
  metrics: MetricsCatalog;
  url: string;
  close(): Promise<void>;
}

export function testEnv(overrides: Record<string, string> = {}): ServerEnv {
  return loadEnv({ NODE_ENV: 'test', COOKIE_SECURE: 'false', PUBLIC_BASE_URL: ORIGIN, ...overrides });
}

/** One gateway node: a real Fastify app (buildHttpApp + gatewayModule) listening on an ephemeral port. */
export async function startGatewayNode(input: {
  store: Store;
  backend: GatewayBackend;
  bus: MessageBus;
  presence?: PresenceStore;
  nodeId?: string;
  options?: Partial<GatewayOptions>;
  env?: ServerEnv;
}): Promise<GatewayNode> {
  const env = input.env ?? testEnv();
  const audit = new AuditService(input.store);
  const registry = new MetricsRegistry();
  const ctx: HttpContext = {
    env,
    store: input.store,
    sessions: new SessionService(input.store, { playerMs: env.sessionTtlMs, adminMs: env.adminSessionTtlMs }),
    adminAuth: new AdminAuthService(input.store, audit),
    audit,
    metrics: registry,
    limiters: new Map(),
    now: Date.now,
  };
  const metrics = createMetricsCatalog(registry);
  let gateway!: Gateway;
  const app = await buildHttpApp(ctx, {
    modules: [
      async (a, c) => {
        gateway = new Gateway({
          nodeId: input.nodeId ?? 'node-test',
          backend: input.backend,
          bus: input.bus,
          sessions: c.sessions,
          metrics,
          presence: input.presence ?? new MemoryPresenceStore(),
          options: input.options,
        });
        await gatewayModule(gateway)(a, c);
      },
    ],
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { app, ctx, gateway, metrics, url: `ws://127.0.0.1:${port}/ws`, close: () => app.close() };
}

export async function createGatewayStore(name: string): Promise<Store> {
  return new Store(await createTestDatabase(name));
}

let seq = 0;
const uniq = (p: string) => `${p}_${process.pid}_${++seq}`;

export async function seedTournament(store: Store, id = uniq('trn')): Promise<string> {
  await store.repos.tournaments.create({
    id,
    joinCode: randomBytes(3).toString('hex').toUpperCase(),
    config: tournamentConfig(`T ${id}`, 'X'),
    serverSeedHash: 'h',
    serverSeedEnc: 'e',
    isSimulation: false,
    createdBy: null,
  });
  return id;
}

export async function seedPlayer(store: Store, tournamentId: string, id = uniq('ply')): Promise<string> {
  await store.repos.players.createPlayer({
    id,
    tournamentId,
    publicId: `JPN-${id.slice(-6)}`,
    displayName: `Name ${id}`,
    nickname: null,
    participantId: null,
    email: null,
    phone: null,
    collegeId: null,
  });
  return id;
}

export async function playerCookie(sessions: SessionService, playerId: string, tournamentId: string): Promise<string> {
  const issued = await sessions.issue({ kind: 'PLAYER', playerId, tournamentId, userAgent: 'test', ip: '127.0.0.1' });
  return `jpb_ps=${issued.token}`;
}

export async function seedAdmin(
  store: Store,
  sessions: SessionService,
  role: AdminRole,
  scope: string[] | null = null,
): Promise<{ adminId: string; cookie: string; sessionId: string }> {
  const adminId = uniq('adm');
  await store.repos.admins.create({ id: adminId, username: adminId, displayName: adminId, role, passwordHash: 'x', tournamentScope: scope, createdBy: null });
  const issued = await sessions.issue({ kind: 'ADMIN', adminId, userAgent: 'test', ip: '127.0.0.1' });
  return { adminId, cookie: `jpb_as=${issued.token}`, sessionId: issued.session.id };
}

// ------------------------------------------------------------------ client

type Frame = ServerMessage & Record<string, unknown>;

/** A real `ws` client that records every frame, with predicate-based waiting. */
export class TestClient {
  readonly frames: Frame[] = [];
  readonly raw: string[] = [];
  readonly arrivals: number[] = [];
  closeInfo: { code: number; reason: string } | null = null;
  private waiters: Array<() => void> = [];
  readonly closed: Promise<{ code: number; reason: string }>;

  private constructor(readonly ws: WebSocket) {
    ws.on('message', (data) => {
      const text = data.toString();
      this.raw.push(text);
      this.frames.push(JSON.parse(text) as Frame);
      this.arrivals.push(Date.now());
      this.wake();
    });
    this.closed = new Promise((resolve) =>
      ws.on('close', (code, reason) => {
        this.closeInfo = { code, reason: reason.toString() };
        resolve(this.closeInfo);
        this.wake();
      }),
    );
  }

  static open(url: string, opts: { cookie?: string; origin?: string | null; autoPong?: boolean } = {}): Promise<TestClient> {
    const headers: Record<string, string> = {};
    if (opts.cookie) headers.cookie = opts.cookie;
    const origin = opts.origin === undefined ? ORIGIN : opts.origin;
    if (origin !== null) headers.origin = origin;
    const ws = new WebSocket(url, { headers, autoPong: opts.autoPong ?? true });
    const client = new TestClient(ws);
    return new Promise((resolve, reject) => {
      ws.once('open', () => resolve(client));
      ws.once('unexpected-response', (_req, res) => reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { statusCode: res.statusCode })));
      ws.once('error', reject);
    });
  }

  /** Opens and completes hello; resolves after the snapshot frame. */
  static async connect(url: string, hello: { audience: string; tournamentId: string; resume?: unknown }, opts: { cookie?: string; origin?: string | null } = {}): Promise<TestClient> {
    const c = await TestClient.open(url, opts);
    c.send({ t: 'hello', v: 1, audience: hello.audience, tournamentId: hello.tournamentId, resume: hello.resume ?? null });
    await c.waitFor((f) => f.t === 'snapshot' || f.t === 'error');
    return c;
  }

  send(obj: unknown): void {
    this.ws.send(JSON.stringify(obj));
  }

  sendRaw(data: string | Buffer, binary = false): void {
    this.ws.send(data, { binary });
  }

  of<T extends Frame['t']>(t: T): Array<Extract<Frame, { t: T }>> {
    return this.frames.filter((f) => f.t === t) as Array<Extract<Frame, { t: T }>>;
  }

  async waitFor(pred: (f: Frame) => boolean, timeoutMs = 3_000): Promise<Frame> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const hit = this.frames.find(pred);
      if (hit) return hit;
      if (Date.now() > deadline) throw new Error(`timeout waiting for frame; got: ${this.frames.map((f) => f.t).join(',')} close=${JSON.stringify(this.closeInfo)}`);
      await new Promise<void>((r) => {
        const t = setTimeout(r, Math.max(1, deadline - Date.now()));
        this.waiters.push(() => {
          clearTimeout(t);
          r();
        });
      });
    }
  }

  async waitClose(timeoutMs = 3_000): Promise<{ code: number; reason: string }> {
    return Promise.race([this.closed, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout waiting for close')), timeoutMs))]);
  }

  close(): void {
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) this.ws.close();
  }

  private wake(): void {
    const w = this.waiters;
    this.waiters = [];
    for (const f of w) f();
  }
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Polls until `cond` is true (or throws after the timeout). */
export async function until(cond: () => boolean | Promise<boolean>, timeoutMs = 3_000, what = 'condition'): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await cond())) {
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${what}`);
    await sleep(10);
  }
}

export { channels };
