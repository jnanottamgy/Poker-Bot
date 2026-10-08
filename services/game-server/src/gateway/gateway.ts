import type { RawData, WebSocket } from 'ws';
import { PROTOCOL_VERSION } from '@jpb/shared-types';
import type { ClientAudience, ClientMessage, ClientSnapshot, ServerMessage, TournamentPublicSummary } from '@jpb/shared-types';
import { channels } from '../bus/bus';
import type { MessageBus } from '../bus/bus';
import { adminCan } from '../auth/sessions';
import type { SessionService } from '../auth/sessions';
import type { MetricsCatalog } from '../observability/catalog';
import type {
  AdminChannelMessage,
  GatewayBackend,
  PlayerChannelMessage,
  TableUpdateMessage,
  TournamentChannelMessage,
  TournamentEventMessage,
} from '../runtime/contracts';
import { Connection } from './connection';
import type { GatewayPrincipal } from './connection';
import { ControllerManager } from './controller';
import { DelayQueue } from './delay';
import { SubscriptionHub } from './hub';
import { CLOSE_CODES, resolveGatewayOptions } from './options';
import type { GatewayOptions } from './options';
import type { PresenceStore } from './presence';
import { resolveTokens } from './principal';
import { parseClientFrame } from './protocol';
import { TableUpdateFrames, adminViewOf, playerViewOf, spectatorViewOf } from './views';

export interface GatewayLogger {
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface GatewayDeps {
  nodeId: string;
  backend: GatewayBackend;
  bus: MessageBus;
  sessions: SessionService;
  metrics: MetricsCatalog;
  presence: PresenceStore;
  now?: () => number;
  log?: GatewayLogger;
  options?: Partial<GatewayOptions>;
}

/** Revealing live hole cards targets one admin (optionally one session or one socket) watching one table. */
export interface RevealFilter {
  tableId: string;
  adminId: string;
  sessionId?: string | null;
  connectionId?: string | null;
}

type Delayed = 'SPECTATOR' | 'DISPLAY';
const isDelayedAudience = (a: ClientAudience | null): a is Delayed => a === 'SPECTATOR' || a === 'DISPLAY';

/** Tournament events after which the broadcast display's featured table may change. */
const FEATURED_TRIGGERS = new Set(['FINAL_TABLE_FORMED', 'TABLE_BROKEN', 'TABLE_CREATED']);
/** Tournament events only admins receive (internal integrity details). */
const ADMIN_ONLY_TOURNAMENT_EVENTS = new Set(['INTEGRITY_ALERT']);

const NOOP_LOG: GatewayLogger = { warn: () => undefined, error: () => undefined };

/** Runs a tournament-policy lookup; the periodic re-check memoizes them per tick (one backend call per tournament). */
type PolicyLookup = (key: string, lookup: () => Promise<boolean>) => Promise<boolean>;
const directLookup: PolicyLookup = (_key, lookup) => lookup();

export type Admission = 'OK' | 'NODE_FULL' | 'IP_FULL';

class Refusal extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly closeCode: number,
  ) {
    super(message);
  }
}

/**
 * The WebSocket gateway: authenticates sockets, applies the audience rules,
 * subscribes to bus channels (refcounted per node), projects table updates
 * per recipient and enforces one controller per player. It holds no game
 * state: everything it sends comes from the runtime (GatewayBackend + bus),
 * so any gateway node can serve any client and a reconnect always starts
 * from an authoritative snapshot.
 */
export class Gateway {
  readonly nodeId: string;
  private readonly opts: GatewayOptions;
  private readonly now: () => number;
  private readonly log: GatewayLogger;
  private readonly hub: SubscriptionHub;
  private readonly delay: DelayQueue;
  private readonly controller: ControllerManager;

  private readonly conns = new Map<string, Connection>();
  private readonly byTable = new Map<string, Set<Connection>>();
  private readonly byTournament = new Map<string, Set<Connection>>();
  private readonly byPlayer = new Map<string, Set<Connection>>();
  /** Spectator delay per tournament (cached; refreshed in the background). */
  private readonly delayMs = new Map<string, { ms: number; fetchedAt: number; refreshing: boolean }>();
  /** Latest table update released through the delay line, per table (snapshot source for delayed audiences). */
  private readonly releasedTables = new Map<string, TableUpdateMessage>();
  /** Tables whose cold-start state is in the delay line: later snapshots wait for that one release instead of queueing copies. */
  private readonly coldTables = new Set<string>();
  /** Latest tournament summary released through the delay line (snapshot source for delayed audiences). */
  private readonly releasedSummaries = new Map<string, TournamentPublicSummary>();
  /** SPECTATOR/DISPLAY sockets per tournament on this node (released summaries are kept only while some exist). */
  private readonly delayedSockets = new Map<string, number>();
  private readonly anonymousByIp = new Map<string, number>();
  private readonly timers: NodeJS.Timeout[] = [];
  private draining: Promise<void> | null = null;

  constructor(private readonly deps: GatewayDeps) {
    this.nodeId = deps.nodeId;
    this.opts = resolveGatewayOptions(deps.options);
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? NOOP_LOG;
    this.hub = new SubscriptionHub(deps.bus, (ch, m) => this.route(ch, m), (err, ch) => this.fail(err, { channel: ch }));
    this.delay = new DelayQueue(this.now, (err) => this.fail(err, { area: 'delay' }));
    this.controller = new ControllerManager(
      deps.presence,
      deps.backend,
      this.nodeId,
      { ttlMs: this.opts.controllerTtlMs, debounceMs: this.opts.disconnectDebounceMs },
      (id) => this.conns.has(id),
      (err) => this.fail(err, { area: 'presence' }),
    );
    this.every(this.opts.heartbeatIntervalMs, () => this.heartbeat());
    this.every(this.opts.controllerRefreshMs, () => this.refreshControllers());
  }

  get options(): Readonly<GatewayOptions> {
    return this.opts;
  }

  get isDraining(): boolean {
    return this.draining !== null;
  }

  /** Open sockets on this node (admin system view, tests). */
  connections(): Connection[] {
    return [...this.conns.values()];
  }

  // ------------------------------------------------------------------ lifecycle

  /**
   * Upgrade admission (checked before the socket is accepted): a full node
   * answers 503 so the load balancer tries another node; anonymous sockets
   * (no player/admin session) are capped per IP, generously for venue NAT.
   */
  admission(ip: string, principal: GatewayPrincipal): Admission {
    if (this.conns.size >= this.opts.maxConnectionsPerNode) return 'NODE_FULL';
    const anonymous = !principal.player && !principal.admin;
    if (anonymous && (this.anonymousByIp.get(ip) ?? 0) >= this.opts.maxAnonymousConnectionsPerIp) return 'IP_FULL';
    return 'OK';
  }

  /** Adopts an upgraded socket. Must attach listeners synchronously (no frame may be missed). */
  accept(socket: WebSocket, principal: GatewayPrincipal, ip: string): Connection {
    const conn = new Connection(
      socket,
      principal,
      ip,
      this.opts,
      {
        sent: (c) => this.deps.metrics.wsMessagesOut.inc({ audience: c.audience ?? 'PENDING' }),
        drained: (c) => void c.serial(() => this.sendSnapshot(c)),
        error: (err, c) => this.fail(err, { connection: c.id }),
      },
      this.now(),
    );
    this.conns.set(conn.id, conn);
    if (conn.anonymous) bump(this.anonymousByIp, ip, 1);
    this.deps.metrics.wsConnects.inc();
    this.deps.metrics.wsConnections.inc({ audience: 'PENDING' });

    socket.on('message', (data, isBinary) => this.onFrame(conn, data, isBinary));
    socket.on('pong', () => (conn.lastSeenAt = this.now()));
    socket.on('close', () => void this.cleanup(conn));
    socket.on('error', () => conn.close(CLOSE_CODES.POLICY_VIOLATION, 'socket error'));

    if (this.draining) {
      conn.close(CLOSE_CODES.SERVICE_RESTART, 'service restart');
      return conn;
    }
    this.armHelloDeadline(conn);
    return conn;
  }

  /**
   * Armed at accept and re-armed when hello arrives: the hello must arrive in
   * time, and processing it (backend lookups included) must finish in time,
   * so a hello stuck in the backend never holds a socket open forever.
   */
  private armHelloDeadline(conn: Connection): void {
    if (conn.helloTimer) clearTimeout(conn.helloTimer);
    conn.helloTimer = setTimeout(() => {
      conn.helloTimer = null;
      if (conn.ready || conn.closing) return;
      if (!conn.helloReceived) return this.refuse(conn, new Refusal('HELLO_TIMEOUT', 'No hello received in time.', CLOSE_CODES.HELLO_TIMEOUT));
      this.fail(new Error('hello processing timed out'), { connection: conn.id, area: 'hello' });
      this.refuse(conn, new Refusal('UNAVAILABLE', 'Server reconnecting. Please try again in a moment.', CLOSE_CODES.SERVICE_RESTART));
    }, this.opts.helloTimeoutMs);
    conn.helloTimer.unref?.();
  }

  /**
   * Graceful shutdown (deploys, scale-in): every socket is closed with 1012
   * so clients reconnect — through the load balancer — to another node,
   * then pending presence decisions are allowed to settle.
   */
  shutdown(): Promise<void> {
    if (!this.draining) this.draining = this.drain();
    return this.draining;
  }

  private async drain(): Promise<void> {
    for (const t of this.timers) clearInterval(t);
    const open = this.connections();
    for (const c of open) c.close(CLOSE_CODES.SERVICE_RESTART, 'service restart');
    const deadline = Date.now() + 2_000;
    while (this.conns.size > 0 && Date.now() < deadline) await sleep(20);
    for (const c of this.connections()) c.socket.terminate();
    await this.controller.flush();
    await this.hub.idle();
    this.delay.close();
  }

  private async cleanup(conn: Connection): Promise<void> {
    if (conn.closed) return;
    conn.dispose();
    this.conns.delete(conn.id);
    this.deps.metrics.wsDisconnects.inc();
    this.deps.metrics.windows.disconnectsPerSecond.record(this.now());
    this.deps.metrics.wsConnections.dec({ audience: conn.audience ?? 'PENDING' });
    if (conn.anonymous) bump(this.anonymousByIp, conn.ip, -1);
    if (isDelayedAudience(conn.audience) && conn.tournamentId && bump(this.delayedSockets, conn.tournamentId, -1) === 0) {
      this.releasedSummaries.delete(conn.tournamentId);
    }
    this.unindex(this.byTournament, conn.tournamentId, conn);
    this.unindex(this.byPlayer, conn.playerId, conn);
    this.setTableIndex(conn, null);
    for (const ch of conn.channels) this.hub.release(ch);
    conn.channels.clear();
    if (conn.isController && conn.playerId) {
      conn.isController = false;
      await this.controller.released(conn.playerId, conn.id).catch((err: unknown) => this.fail(err, { area: 'presence' }));
    }
  }

  // ------------------------------------------------------------------ client frames

  private onFrame(conn: Connection, data: RawData, isBinary: boolean): void {
    if (conn.closing) return;
    const now = this.now();
    conn.lastSeenAt = now;
    this.deps.metrics.wsMessagesIn.inc({ audience: conn.audience ?? 'PENDING' });
    if (!conn.allowMessage(now)) return this.rateLimited(conn);
    if (isBinary) return this.sendError(conn, 'BINARY_NOT_SUPPORTED', 'Only JSON text frames are accepted.');
    const parsed = parseClientFrame(rawToString(data), this.opts.maxFrameBytes);
    if (!parsed.ok) {
      if (!conn.helloReceived) return this.refuse(conn, new Refusal(parsed.code, parsed.message, CLOSE_CODES.BAD_HELLO));
      return this.sendError(conn, parsed.code, parsed.message);
    }
    const m = parsed.message;
    if (!conn.helloReceived) {
      if (m.t !== 'hello') return this.refuse(conn, new Refusal('HELLO_REQUIRED', 'The first message must be hello.', CLOSE_CODES.BAD_HELLO));
      conn.helloReceived = true;
      this.armHelloDeadline(conn);
      void conn.serial(() => this.hello(conn, m));
      return;
    }
    // Frames pipelined behind hello wait until it has been processed.
    if (!conn.audience) {
      void conn.serial(async () => {
        if (conn.audience) this.dispatch(conn, m, now);
      });
      return;
    }
    this.dispatch(conn, m, now);
  }

  private dispatch(conn: Connection, m: ClientMessage, now: number): void {
    switch (m.t) {
      case 'hello':
        return this.sendError(conn, 'ALREADY_HELLO', 'hello was already received on this connection.');
      case 'ping':
        conn.send(frame({ t: 'pong', st: now, ct: m.ct }));
        return;
      case 'action':
        return this.onAction(conn, m, now);
      case 'takeover':
        void conn.serial(() => this.takeover(conn));
        return;
      case 'watch':
        return this.onWatch(conn, m.tableId, now);
      case 'snapshot_request':
        if (!conn.snapshotLimiter.take('c', now)) return this.sendError(conn, 'RATE_LIMITED', 'Too many snapshot requests. Please wait.');
        void conn.serial(() => this.sendSnapshot(conn));
        return;
    }
  }

  private rateLimited(conn: Connection): void {
    conn.rateViolations++;
    if (conn.rateViolations > this.opts.maxRateLimitViolations) {
      conn.close(CLOSE_CODES.POLICY_VIOLATION, 'rate limit');
      return;
    }
    // One error frame per burst of violations: answering every dropped frame would amplify a flood.
    if (conn.rateViolations === 1 || conn.rateViolations % 10 === 0) this.sendError(conn, 'RATE_LIMITED', 'Too many messages. Please slow down.');
  }

  // ------------------------------------------------------------------ hello & authorization

  private async hello(conn: Connection, m: Extract<ClientMessage, { t: 'hello' }>): Promise<void> {
    try {
      if (m.v !== PROTOCOL_VERSION) throw new Refusal('PROTOCOL_VERSION', `Unsupported protocol version; this server speaks v${PROTOCOL_VERSION}.`, CLOSE_CODES.BAD_HELLO);
      // Sessions are resolved again now: one revoked between the upgrade and this hello must not be admitted.
      conn.principal = await resolveTokens(this.deps.sessions, { player: conn.principal.player?.token ?? null, admin: conn.principal.admin?.token ?? null });
      // Identity checks come first, so a PLAYER/ADMIN hello without a session never reaches the backend.
      const playerId = this.identityFor(conn, m.audience, m.tournamentId);
      const summary = await this.deps.backend.tournamentSummary(m.tournamentId);
      if (!summary) throw new Refusal('TOURNAMENT_NOT_FOUND', 'Tournament not found.', CLOSE_CODES.NOT_FOUND);
      const refusal = await this.policyRefusal(conn, m.audience, m.tournamentId, playerId, directLookup);
      if (refusal) throw refusal;
      if (conn.closing) return;

      conn.tournamentId = m.tournamentId;
      conn.audience = m.audience;
      conn.playerId = playerId;
      if (isDelayedAudience(m.audience)) bump(this.delayedSockets, m.tournamentId, 1);
      this.deps.metrics.wsConnections.dec({ audience: 'PENDING' });
      this.deps.metrics.wsConnections.inc({ audience: m.audience });
      if (m.resume) {
        this.deps.metrics.reconnects.inc({ audience: m.audience });
        this.deps.metrics.windows.reconnectsPerSecond.record(this.now());
      }
      // `sessionId` identifies this connection (it is what takeover/replacement refer to), never the auth session.
      conn.send(frame({ t: 'welcome', st: this.now(), sessionId: conn.id, audience: m.audience, protocol: PROTOCOL_VERSION }));

      this.index(this.byTournament, m.tournamentId, conn);
      if (isDelayedAudience(m.audience)) await this.spectatorDelay(m.tournamentId, true);
      await this.join(conn, channels.tournamentEvents(m.tournamentId));
      if (playerId) {
        this.index(this.byPlayer, playerId, conn);
        await this.join(conn, channels.player(playerId));
        // A SESSIONS_REVOKED published after the resolve above but before this subscription was missed: check once more.
        if (!(await this.playerSessionValid(conn))) throw new Refusal('SESSION_REVOKED', 'Your session was ended by the tournament staff.', CLOSE_CODES.UNAUTHORIZED);
      }
      if (m.audience === 'ADMIN') await this.join(conn, channels.admin(m.tournamentId));

      let claimed = true;
      if (m.audience === 'PLAYER' && playerId) {
        claimed = (await this.controller.claim(playerId, conn.id, false)).claimed;
        conn.isController = claimed && !conn.closing;
        if (claimed && conn.closing) await this.controller.released(playerId, conn.id);
      }
      await this.setTable(conn, await this.initialTable(conn, m.resume?.tableId ?? null));
      // hello.resume is accepted but always answered with a full authoritative snapshot (see README: Resume).
      await this.sendSnapshot(conn, summary);
      conn.ready = true;
      if (conn.helloTimer) clearTimeout(conn.helloTimer);
      conn.helloTimer = null;
      if (!claimed) conn.send(frame({ t: 'another_device', st: this.now() }));
    } catch (err) {
      this.refuse(conn, err instanceof Refusal ? err : this.internalRefusal(err, conn));
    }
  }

  /** Session-only checks (no backend call). Returns the player identity bound to the socket (or null) or throws a Refusal. */
  private identityFor(conn: Connection, audience: ClientAudience, tournamentId: string): string | null {
    const { player, admin } = conn.principal;
    const playerHere = player && player.tournamentId === tournamentId ? player.playerId : null;
    switch (audience) {
      case 'PLAYER':
        if (!player) throw new Refusal('UNAUTHORIZED', 'Please join or rejoin the tournament first.', CLOSE_CODES.UNAUTHORIZED);
        if (!playerHere) throw new Refusal('FORBIDDEN', 'Your session belongs to another tournament.', CLOSE_CODES.FORBIDDEN);
        return playerHere;
      case 'ADMIN':
        if (!admin) throw new Refusal('UNAUTHORIZED', 'Please sign in as an administrator.', CLOSE_CODES.UNAUTHORIZED);
        if (!adminCan(admin.admin, 'PLAYER_VIEW', tournamentId)) throw new Refusal('FORBIDDEN', 'You do not have access to this tournament.', CLOSE_CODES.FORBIDDEN);
        return null;
      case 'SPECTATOR':
        return playerHere;
      case 'DISPLAY':
        return null;
    }
  }

  /**
   * Tournament policy for the public audiences, checked at hello and again
   * periodically (spectators/features are mutable while running):
   * - SPECTATOR: `canSpectate(tournamentId, playerId)`;
   * - DISPLAY: `canDisplay` AND (an admin session with PLAYER_VIEW for the
   *   tournament OR the spectator policy). Without the second condition an
   *   anonymous DISPLAY hello would bypass `publicWatch = false`.
   */
  private async policyRefusal(conn: Connection, audience: ClientAudience, tid: string, playerId: string | null, lookup: PolicyLookup): Promise<Refusal | null> {
    const canSpectate = () => lookup(`S|${tid}|${playerId ?? ''}`, () => this.deps.backend.canSpectate(tid, playerId));
    if (audience === 'SPECTATOR') {
      return (await canSpectate()) ? null : new Refusal('SPECTATING_NOT_ALLOWED', 'Spectating is not available for this tournament.', CLOSE_CODES.FORBIDDEN);
    }
    if (audience !== 'DISPLAY') return null;
    if (!(await lookup(`D|${tid}`, () => this.deps.backend.canDisplay(tid)))) {
      return new Refusal('DISPLAY_NOT_ALLOWED', 'The broadcast display is disabled for this tournament.', CLOSE_CODES.FORBIDDEN);
    }
    const admin = conn.principal.admin;
    if (admin && adminCan(admin.admin, 'PLAYER_VIEW', tid)) return null;
    if (await canSpectate()) return null;
    return new Refusal('DISPLAY_NOT_ALLOWED', 'This tournament is not public; sign in as an administrator on this screen.', CLOSE_CODES.FORBIDDEN);
  }

  private async playerSessionValid(conn: Connection): Promise<boolean> {
    const player = conn.principal.player;
    if (!player) return false;
    const r = await this.deps.sessions.resolve(player.token);
    return !!r && r.session.id === player.sessionId;
  }

  private async initialTable(conn: Connection, resumeTableId: string | null): Promise<string | null> {
    const tid = conn.tournamentId!;
    switch (conn.audience) {
      case 'PLAYER':
        return null; // the snapshot resolves the player's table (one playerSelf call)
      case 'DISPLAY':
        return this.deps.backend.featuredTable(tid);
      case 'SPECTATOR':
        if (resumeTableId && (await this.tableBelongsTo(resumeTableId, tid))) return resumeTableId;
        return this.deps.backend.featuredTable(tid);
      case 'ADMIN':
        return resumeTableId && (await this.tableBelongsTo(resumeTableId, tid)) ? resumeTableId : null;
      default:
        return null;
    }
  }

  private async tableBelongsTo(tableId: string, tournamentId: string): Promise<boolean> {
    const snap = await this.deps.backend.tableSnapshot(tableId);
    return !!snap && snap.tournamentId === tournamentId;
  }

  private refuse(conn: Connection, r: Refusal): void {
    this.sendError(conn, r.code, r.message);
    conn.close(r.closeCode, r.code.slice(0, 100));
  }

  private internalRefusal(err: unknown, conn: Connection): Refusal {
    this.fail(err, { connection: conn.id, area: 'hello' });
    return new Refusal('UNAVAILABLE', 'Server reconnecting. Please try again in a moment.', CLOSE_CODES.SERVICE_RESTART);
  }

  // ------------------------------------------------------------------ snapshots & table subscription

  /**
   * Sends an authoritative snapshot for the socket's audience. Bus frames
   * arriving meanwhile are held and flushed afterwards only if newer.
   */
  private async sendSnapshot(conn: Connection, knownSummary?: TournamentPublicSummary): Promise<void> {
    if (!conn.audience || conn.closing) return;
    conn.beginSync();
    let baseline: { tableVersion: number | null; tournamentSeq: number | null } = { tableVersion: null, tournamentSeq: null };
    try {
      const live = knownSummary ?? (await this.deps.backend.tournamentSummary(conn.tournamentId!));
      if (!live) throw new Refusal('TOURNAMENT_NOT_FOUND', 'Tournament not found.', CLOSE_CODES.NOT_FOUND);
      const built = await this.buildSnapshot(conn, live);
      if (!built) return;
      // The summary actually sent is the baseline: for delayed audiences that is the released one, so
      // tournament events still in the delay line are delivered after this snapshot instead of dropped.
      baseline = { tableVersion: built.tableVersion, tournamentSeq: built.snapshot.tournament.lastSeq };
      conn.send(frame({ t: 'snapshot', st: this.now(), snapshot: built.snapshot }));
    } catch (err) {
      if (err instanceof Refusal) this.refuse(conn, err);
      else {
        this.fail(err, { connection: conn.id, area: 'snapshot' });
        this.sendError(conn, 'SNAPSHOT_UNAVAILABLE', 'Could not load the table right now; retrying shortly is safe.');
      }
    } finally {
      conn.endSync(baseline);
    }
  }

  private async buildSnapshot(conn: Connection, live: TournamentPublicSummary): Promise<{ snapshot: ClientSnapshot; tableVersion: number | null } | null> {
    const audience = conn.audience!;
    if (audience === 'PLAYER') {
      const self = await this.deps.backend.playerSelf(conn.playerId!);
      if (!self) throw new Refusal('PLAYER_NOT_FOUND', 'Your registration could not be found.', CLOSE_CODES.FORBIDDEN);
      if (self.tableId !== conn.tableId) await this.setTable(conn, self.tableId);
      const msg = conn.tableId ? await this.liveTable(conn) : null;
      const view = msg ? playerViewOf(msg, conn.playerId!) : null;
      const table = view && view.audience === 'PLAYER' ? view : null;
      return { snapshot: { audience, tournament: live, self, table }, tableVersion: msg?.version ?? null };
    }
    if (audience === 'ADMIN') {
      const msg = conn.tableId ? await this.liveTable(conn) : null;
      const table = msg ? adminViewOf(msg, await this.revealAllowed(conn, msg.tableId)) : null;
      return { snapshot: { audience, tournament: live, table }, tableVersion: msg?.version ?? null };
    }
    const delay = await this.spectatorDelay(conn.tournamentId!, false);
    const tournament = delay > 0 ? this.delayedSummary(conn.tournamentId!, live) : live;
    const msg = conn.tableId ? await this.delayedTable(conn, delay) : null;
    const view = msg ? spectatorViewOf(msg) : null;
    const snapshot: ClientSnapshot = audience === 'DISPLAY' ? { audience, tournament, featured: view } : { audience, tournament, table: view };
    return { snapshot, tableVersion: msg?.version ?? null };
  }

  /**
   * Tournament summary for delayed audiences: the latest one released through
   * the delay line. On a cold start (no delayed socket of this tournament on
   * this node yet, so nothing is in the line) there is no older state to
   * offer: the current summary seeds it, and from then on spectators only
   * ever see summaries that went through the delay line.
   */
  private delayedSummary(tournamentId: string, live: TournamentPublicSummary): TournamentPublicSummary {
    const released = this.releasedSummaries.get(tournamentId);
    if (released) return released;
    this.releasedSummaries.set(tournamentId, live);
    return live;
  }

  /** Current state of the socket's table, guarded against cross-tournament table ids. */
  private async liveTable(conn: Connection): Promise<TableUpdateMessage | null> {
    const msg = await this.deps.backend.tableSnapshot(conn.tableId!);
    return msg && msg.tournamentId === conn.tournamentId ? msg : null;
  }

  /**
   * Spectator/display snapshot that honours the spectator delay: the latest
   * update released through the delay line. With nothing released yet, the
   * first such snapshot pushes the live state through the delay line (the
   * client gets `table: null` now and the table after the delay); snapshots
   * arriving while that cold-start state is queued just wait for its release,
   * so N watchers arriving together cost one queued state, not N.
   */
  private async delayedTable(conn: Connection, delay: number): Promise<TableUpdateMessage | null> {
    if (delay <= 0) return this.liveTable(conn);
    const tid = conn.tournamentId!;
    const tableId = conn.tableId!;
    const released = this.releasedTables.get(tableId);
    if (released && released.tournamentId === tid) return released;
    if (this.coldTables.has(tableId)) return null;
    this.coldTables.add(tableId);
    let live: TableUpdateMessage | null = null;
    try {
      live = await this.liveTable(conn);
    } finally {
      if (!live) this.coldTables.delete(tableId);
    }
    if (!live) return null;
    const cold: TableUpdateMessage = { ...live, events: [] };
    this.delay.push(tid, delay, () => {
      this.coldTables.delete(tableId);
      this.releaseToDelayed(cold, true);
    });
    return null;
  }

  /** Points the socket at a table: refcounted channel switch + index update. Reveals do not carry over. */
  private async setTable(conn: Connection, tableId: string | null): Promise<void> {
    if (conn.tableId === tableId || conn.closed) return;
    const old = conn.tableId;
    this.setTableIndex(conn, tableId);
    conn.resetTableBaseline();
    for (const t of [...conn.revealedTables]) if (t !== tableId) conn.revealedTables.delete(t);
    if (tableId) await this.join(conn, channels.tableEvents(tableId));
    if (old) this.leave(conn, channels.tableEvents(old));
  }

  private setTableIndex(conn: Connection, tableId: string | null): void {
    const old = conn.tableId;
    if (old) {
      this.unindex(this.byTable, old, conn);
      if (!this.hasDelayedWatcher(old)) this.releasedTables.delete(old);
    }
    conn.tableId = tableId;
    if (tableId) this.index(this.byTable, tableId, conn);
  }

  private hasDelayedWatcher(tableId: string): boolean {
    for (const c of this.byTable.get(tableId) ?? []) if (isDelayedAudience(c.audience)) return true;
    return false;
  }

  private async join(conn: Connection, channel: string): Promise<void> {
    if (conn.channels.has(channel) || conn.closed) return;
    conn.channels.add(channel);
    await this.hub.acquire(channel);
  }

  private leave(conn: Connection, channel: string): void {
    if (!conn.channels.delete(channel)) return;
    this.hub.release(channel);
  }

  // ------------------------------------------------------------------ actions, takeover, watch

  private onAction(conn: Connection, m: Extract<ClientMessage, { t: 'action' }>, receivedAt: number): void {
    const reject = (code: 'INVALID_COMMAND' | 'RATE_LIMITED', message: string) =>
      conn.send(frame({ t: 'action_result', st: this.now(), actionId: m.actionId, ok: false, code, message }));
    if (conn.audience !== 'PLAYER' || !conn.playerId) return void reject('INVALID_COMMAND', 'Only players can act.');
    if (!conn.isController) return void reject('INVALID_COMMAND', 'Another device controls your seat. Take over to play here.');
    if (!conn.actionLimiter.take('c', receivedAt)) return void reject('RATE_LIMITED', 'Too many actions. Please slow down.');
    const playerId = conn.playerId;
    void conn.serialAction(async () => {
      // Re-checked at submission: a takeover may have happened while this action was queued.
      if (!conn.isController) return void reject('INVALID_COMMAND', 'Another device controls your seat. Take over to play here.');
      // The local flag lags a takeover on another node (CONTROLLER_CLAIMED may be lost): the presence key decides.
      if (!(await this.stillController(conn, playerId))) {
        reject('INVALID_COMMAND', 'Another device controls your seat. Take over to play here.');
        if (conn.isController) this.replaceController(conn);
        return;
      }
      let reply;
      try {
        // Duplicate actionIds are NOT filtered here: the table actor answers them idempotently with the original reply.
        reply = await this.deps.backend.submitPlayerAction({
          playerId,
          tableId: m.tableId,
          actionId: m.actionId,
          type: m.type,
          ...(m.amount !== undefined ? { amount: m.amount } : {}),
          tableStateVersion: m.tableStateVersion,
          receivedAt,
        });
      } catch (err) {
        this.fail(err, { connection: conn.id, area: 'action' });
        conn.send(
          frame({ t: 'action_result', st: this.now(), actionId: m.actionId, ok: false, code: null, message: 'We could not confirm your action. Retrying is safe.' }),
        );
        return;
      }
      conn.send(frame({ t: 'action_result', st: this.now(), actionId: m.actionId, ok: reply.ok, code: reply.code, message: reply.message }));
    });
  }

  private async takeover(conn: Connection): Promise<void> {
    if (conn.audience !== 'PLAYER' || !conn.playerId) return this.sendError(conn, 'TAKEOVER_NOT_ALLOWED', 'Only player connections can take over.');
    if (conn.isController || conn.closing) return;
    const playerId = conn.playerId;
    const res = await this.controller.claim(playerId, conn.id, true);
    if (!res.claimed) return this.sendError(conn, 'TAKEOVER_FAILED', 'Could not take over right now; please retry.');
    if (conn.closing) {
      await this.controller.released(playerId, conn.id);
      return;
    }
    conn.isController = true;
    // Local sockets are replaced immediately; other nodes learn it from the player channel.
    this.replaceControllers(playerId, conn.id);
    await this.deps.bus.publish(channels.player(playerId), {
      kind: 'CONTROLLER_CLAIMED',
      playerId,
      connectionId: conn.id,
      nodeId: this.nodeId,
    } satisfies PlayerChannelMessage);
    await this.sendSnapshot(conn);
  }

  /**
   * Compare-and-set refresh of the controller key before an action is
   * forwarded. A presence-store failure keeps the local decision (fail open):
   * rejecting every action during a Redis blip would time out every player,
   * while the local flag still reflects a claim this socket really made.
   */
  private async stillController(conn: Connection, playerId: string): Promise<boolean> {
    try {
      return await this.controller.refresh(playerId, conn.id);
    } catch (err) {
      this.fail(err, { connection: conn.id, area: 'presence' });
      return conn.isController;
    }
  }

  private replaceControllers(playerId: string, newControllerId: string): void {
    for (const c of this.byPlayer.get(playerId) ?? []) {
      if (c.audience !== 'PLAYER' || !c.isController || c.id === newControllerId) continue;
      this.replaceController(c);
    }
  }

  private replaceController(c: Connection): void {
    // The key now belongs to the new controller; dropping the flag first avoids releasing it on close.
    c.isController = false;
    c.send(frame({ t: 'session_replaced', st: this.now() }));
    c.close(CLOSE_CODES.SESSION_REPLACED, 'session replaced');
  }

  /**
   * CONTROLLER_CLAIMED from the bus. Two takeovers racing on different nodes
   * may deliver their messages in either order, so the presence store (not
   * message order) decides: a local controller is replaced only if the key
   * is no longer its own.
   */
  private async onControllerClaimed(playerId: string, claimerId: string): Promise<void> {
    const local = [...(this.byPlayer.get(playerId) ?? [])].filter((c) => c.audience === 'PLAYER' && c.isController && c.id !== claimerId);
    if (local.length === 0) return;
    const current = await this.deps.presence.get(playerId);
    for (const c of local) {
      if (current && current.connectionId === c.id && current.nodeId === this.nodeId) continue;
      this.replaceControllers(playerId, current?.connectionId ?? claimerId);
    }
  }

  private onWatch(conn: Connection, tableId: string | null, now: number): void {
    if (conn.audience !== 'SPECTATOR' && conn.audience !== 'ADMIN') {
      return this.sendError(conn, 'WATCH_NOT_ALLOWED', 'This connection cannot choose a table.');
    }
    if (!conn.snapshotLimiter.take('c', now)) return this.sendError(conn, 'RATE_LIMITED', 'Too many requests. Please wait.');
    void conn.serial(async () => {
      if (tableId !== null && !(await this.tableBelongsTo(tableId, conn.tournamentId!))) {
        return this.sendError(conn, 'TABLE_NOT_FOUND', 'That table does not exist in this tournament.');
      }
      await this.setTable(conn, tableId);
      await this.sendSnapshot(conn);
    });
  }

  // ------------------------------------------------------------------ admin reveal & display

  /**
   * Enables live hole cards for matching ADMIN sockets that currently watch
   * `tableId` and hold VIEW_HOLE_CARDS for the tournament. Called after the
   * admin API has audited the reveal (or via HOLE_CARDS_REVEALED on the
   * admin channel). Each enabled socket immediately gets a fresh snapshot.
   * Returns the number of sockets enabled on this node.
   */
  revealHoleCards(filter: RevealFilter): number {
    let n = 0;
    for (const c of this.byTable.get(filter.tableId) ?? []) {
      const admin = c.principal.admin;
      if (c.audience !== 'ADMIN' || !admin || admin.admin.id !== filter.adminId) continue;
      if (filter.sessionId && admin.sessionId !== filter.sessionId) continue;
      if (filter.connectionId && c.id !== filter.connectionId) continue;
      if (!adminCan(admin.admin, 'VIEW_HOLE_CARDS', c.tournamentId)) continue;
      c.revealedTables.add(filter.tableId);
      void c.serial(() => this.sendSnapshot(c));
      n++;
    }
    return n;
  }

  /** Re-points DISPLAY sockets of a tournament at the backend's featured table. */
  async refreshFeatured(tournamentId: string, known?: string | null): Promise<void> {
    const displays = [...(this.byTournament.get(tournamentId) ?? [])].filter((c) => c.audience === 'DISPLAY');
    if (displays.length === 0) return;
    const featured = known !== undefined ? known : await this.deps.backend.featuredTable(tournamentId);
    for (const c of displays) {
      if (c.tableId === featured) continue;
      void c.serial(async () => {
        if (featured && !(await this.tableBelongsTo(featured, tournamentId))) return;
        await this.setTable(c, featured);
        await this.sendSnapshot(c);
      });
    }
  }

  private canSeeHoleCards(conn: Connection, tableId: string): boolean {
    const admin = conn.principal.admin;
    return conn.audience === 'ADMIN' && !!admin && conn.revealedTables.has(tableId) && adminCan(admin.admin, 'VIEW_HOLE_CARDS', conn.tournamentId);
  }

  /**
   * Whether this admin socket may receive live hole cards for `tableId` right
   * now. The session is re-validated before every revealed frame (a session
   * cache hit, so cheap; revealed sockets are few), and at most every
   * `revealRecheckMs` the cache is bypassed so that a revocation made on
   * another node is seen too. A failed check closes the socket (4401/4403);
   * an unreachable session store withholds the cards.
   */
  private async revealAllowed(conn: Connection, tableId: string): Promise<boolean> {
    if (!this.canSeeHoleCards(conn, tableId)) return false;
    const now = this.now();
    if (now - conn.lastRevealCheckAt >= this.opts.revealRecheckMs) {
      this.deps.sessions.forgetSession(conn.principal.admin!.sessionId);
      conn.lastRevealCheckAt = now;
    }
    try {
      if (!(await this.validateAdmin(conn))) return false;
    } catch (err) {
      this.fail(err, { connection: conn.id, area: 'reveal' });
      return false;
    }
    return this.canSeeHoleCards(conn, tableId);
  }

  /** Revealed frames wait for the session re-check, in order behind the socket's other serialized work. */
  private sendRevealed(conn: Connection, frames: TableUpdateFrames): void {
    const { tableId, version } = frames.msg;
    void conn.serial(async () => {
      const revealed = await this.revealAllowed(conn, tableId);
      conn.sendTable(tableId, version, frames.adminFrame(revealed));
    });
  }

  // ------------------------------------------------------------------ bus fan-out

  private route(channel: string, message: unknown): void {
    if (!message || typeof message !== 'object') return;
    const kind = (message as { kind?: unknown }).kind;
    if (channel.startsWith('table:') && kind === 'TABLE_UPDATE') return this.onTableUpdate(message as TableUpdateMessage);
    if (channel.startsWith('tournament:')) return this.onTournamentMessage(message as TournamentChannelMessage);
    if (channel.startsWith('player:')) return this.onPlayerMessage(channel.slice('player:'.length), message as PlayerChannelMessage);
    if (channel.startsWith('admin:')) return this.onAdminMessage(channel.slice('admin:'.length), message as AdminChannelMessage);
  }

  private onTableUpdate(msg: TableUpdateMessage): void {
    const watchers = this.byTable.get(msg.tableId);
    if (!watchers || watchers.size === 0) return;
    const frames = new TableUpdateFrames(msg, this.now());
    let delayed = false;
    for (const c of watchers) {
      if (c.tournamentId !== msg.tournamentId) continue;
      if (c.audience === 'PLAYER') c.sendTable(msg.tableId, msg.version, frames.playerFrame(c.playerId!));
      else if (c.audience === 'ADMIN') {
        if (this.canSeeHoleCards(c, msg.tableId)) this.sendRevealed(c, frames);
        else c.sendTable(msg.tableId, msg.version, frames.adminFrame(false));
      }
      else if (isDelayedAudience(c.audience)) delayed = true;
    }
    if (delayed) this.delay.push(msg.tournamentId, this.cachedDelay(msg.tournamentId), () => this.releaseToDelayed(msg));
  }

  /** `cold`: a cold-start state (see delayedTable), skipped when a newer or equal state was already released. */
  private releaseToDelayed(msg: TableUpdateMessage, cold = false): void {
    if (!this.hasDelayedWatcher(msg.tableId)) return;
    const prev = this.releasedTables.get(msg.tableId);
    if (cold && prev && prev.version >= msg.version) return;
    if (!prev || prev.version <= msg.version) this.releasedTables.set(msg.tableId, msg);
    const frames = new TableUpdateFrames(msg, this.now());
    for (const c of this.byTable.get(msg.tableId) ?? []) {
      if (isDelayedAudience(c.audience) && c.tournamentId === msg.tournamentId) c.sendTable(msg.tableId, msg.version, frames.spectatorFrame());
    }
  }

  private onTournamentMessage(msg: TournamentChannelMessage): void {
    if (msg.kind === 'DISPLAY_FEATURED_CHANGED') {
      void this.refreshFeatured(msg.tournamentId, msg.tableId).catch((err: unknown) => this.fail(err, { area: 'display' }));
      return;
    }
    if (msg.kind !== 'TOURNAMENT_EVENT') return;
    const conns = this.byTournament.get(msg.tournamentId);
    if (!conns || conns.size === 0) return;
    const adminOnly = ADMIN_ONLY_TOURNAMENT_EVENTS.has(msg.envelope.event.kind);
    const shared = tournamentFrame(msg, this.now());
    let delayed = false;
    for (const c of conns) {
      if (c.audience === 'ADMIN' || (c.audience === 'PLAYER' && !adminOnly)) c.sendTournament(msg.envelope.seq, shared);
      else if (isDelayedAudience(c.audience) && !adminOnly) delayed = true;
    }
    if (delayed) {
      this.delay.push(msg.tournamentId, this.cachedDelay(msg.tournamentId), () => this.releaseTournamentEvent(msg));
    }
    if (FEATURED_TRIGGERS.has(msg.envelope.event.kind)) {
      void this.refreshFeatured(msg.tournamentId).catch((err: unknown) => this.fail(err, { area: 'display' }));
    }
  }

  private releaseTournamentEvent(msg: TournamentEventMessage): void {
    const tid = msg.tournamentId;
    if (!this.delayedSockets.get(tid)) return;
    const prev = this.releasedSummaries.get(tid);
    if (!prev || prev.lastSeq <= msg.summary.lastSeq) this.releasedSummaries.set(tid, msg.summary);
    const f = tournamentFrame(msg, this.now());
    for (const c of this.byTournament.get(tid) ?? []) if (isDelayedAudience(c.audience)) c.sendTournament(msg.envelope.seq, f);
  }

  private onPlayerMessage(playerId: string, msg: PlayerChannelMessage): void {
    const conns = [...(this.byPlayer.get(playerId) ?? [])];
    switch (msg.kind) {
      case 'SELF_UPDATE':
        for (const c of conns) {
          if (c.audience !== 'PLAYER') continue;
          void c.serial(async () => {
            c.sendOrdered(frame({ t: 'self_update', st: this.now(), self: msg.self }));
            // Moved / finished at a table: follow the player to the new table with a fresh authoritative snapshot.
            if (msg.self.tableId !== c.tableId) await this.sendSnapshot(c);
          });
        }
        return;
      case 'NOTICE':
        for (const c of conns) if (c.audience === 'PLAYER') c.sendOrdered(frame({ t: 'notice', st: this.now(), notice: msg.notice }));
        return;
      case 'CONTROLLER_CLAIMED':
        if (msg.playerId === playerId) void this.onControllerClaimed(playerId, msg.connectionId).catch((err: unknown) => this.fail(err, { area: 'presence' }));
        return;
      case 'SESSIONS_REVOKED':
        // Closing releases the controller key and reports the disconnect through the normal close path.
        for (const c of conns) this.refuse(c, new Refusal('SESSION_REVOKED', 'Your session was ended by the tournament staff.', CLOSE_CODES.UNAUTHORIZED));
        return;
    }
  }

  private onAdminMessage(_tournamentId: string, msg: AdminChannelMessage): void {
    if (msg.kind === 'HOLE_CARDS_REVEALED') this.revealHoleCards({ tableId: msg.tableId, adminId: msg.adminId, sessionId: msg.sessionId });
  }

  // ------------------------------------------------------------------ periodic work

  private heartbeat(): void {
    const now = this.now();
    const lookup = this.memoizedLookup();
    for (const c of this.conns.values()) {
      if (c.closing) continue;
      if (now - c.lastSeenAt > this.opts.idleTimeoutMs) {
        c.close(CLOSE_CODES.IDLE_TIMEOUT, 'idle timeout');
        continue;
      }
      try {
        c.socket.ping();
      } catch {
        // socket already closing; the close handler cleans up
      }
      if (c.audience && now - c.lastAuthCheckAt >= this.opts.sessionRecheckMs) {
        c.lastAuthCheckAt = now;
        void this.recheck(c, lookup).catch((err: unknown) => this.fail(err, { area: 'session-recheck' }));
      }
    }
  }

  /**
   * One backend call per distinct policy question per heartbeat, however many
   * sockets ask it. A failing lookup keeps the sockets (logged once): an
   * unavailable backend must not disconnect every spectator.
   */
  private memoizedLookup(): PolicyLookup {
    const memo = new Map<string, Promise<boolean>>();
    return (key, lookup) => {
      let p = memo.get(key);
      if (!p) {
        p = lookup().catch((err: unknown) => {
          this.fail(err, { area: 'policy-recheck' });
          return true;
        });
        memo.set(key, p);
      }
      return p;
    };
  }

  /**
   * Long-lived sockets are re-validated: revocation, expiry, disabled admins
   * and lost permissions close them, and so does a tournament policy change
   * (public watch / broadcast display turned off) for SPECTATOR and DISPLAY.
   */
  private async recheck(c: Connection, lookup: PolicyLookup): Promise<void> {
    if (c.playerId !== null && c.principal.player !== null && !(await this.playerSessionValid(c))) {
      return this.refuse(c, new Refusal('SESSION_EXPIRED', 'Your session expired. Please rejoin.', CLOSE_CODES.UNAUTHORIZED));
    }
    if (c.audience === 'ADMIN') {
      await this.validateAdmin(c);
      return;
    }
    if (!isDelayedAudience(c.audience) || c.closing) return;
    if (c.audience === 'DISPLAY' && c.principal.admin) {
      // A display admitted through an admin session keeps that privilege only while the session is valid.
      const fresh = await resolveTokens(this.deps.sessions, { player: null, admin: c.principal.admin.token });
      c.principal = { ...c.principal, admin: fresh.admin };
    }
    const refusal = await this.policyRefusal(c, c.audience, c.tournamentId!, c.playerId, lookup);
    if (refusal) this.refuse(c, refusal);
  }

  /** Re-validates an ADMIN socket's session and permissions; refuses the socket and returns false when they are gone. */
  private async validateAdmin(c: Connection): Promise<boolean> {
    const admin = c.principal.admin;
    if (c.closing) return false;
    if (!admin) {
      this.refuse(c, new Refusal('SESSION_EXPIRED', 'Your session expired. Please sign in again.', CLOSE_CODES.UNAUTHORIZED));
      return false;
    }
    const r = await this.deps.sessions.resolve(admin.token);
    if (!r || !r.admin || r.session.id !== admin.sessionId) {
      c.revealedTables.clear();
      this.refuse(c, new Refusal('SESSION_EXPIRED', 'Your session expired. Please sign in again.', CLOSE_CODES.UNAUTHORIZED));
      return false;
    }
    c.principal = { ...c.principal, admin: { ...admin, admin: r.admin } };
    if (!adminCan(r.admin, 'PLAYER_VIEW', c.tournamentId)) {
      c.revealedTables.clear();
      this.refuse(c, new Refusal('FORBIDDEN', 'Your access to this tournament was removed.', CLOSE_CODES.FORBIDDEN));
      return false;
    }
    if (!adminCan(r.admin, 'VIEW_HOLE_CARDS', c.tournamentId)) c.revealedTables.clear();
    return true;
  }

  private refreshControllers(): void {
    for (const c of this.conns.values()) {
      if (!c.isController || !c.playerId || c.closing) continue;
      const playerId = c.playerId;
      void this.controller
        .refresh(playerId, c.id)
        .then((ok) => {
          // Taken over (e.g. the CONTROLLER_CLAIMED message was lost): the newer device wins.
          if (!ok && c.isController) this.replaceController(c);
        })
        .catch((err: unknown) => this.fail(err, { area: 'presence' }));
    }
  }

  // ------------------------------------------------------------------ helpers

  /** Spectator delay with a short cache; `await` only on first use for a tournament. */
  private async spectatorDelay(tournamentId: string, forceFresh: boolean): Promise<number> {
    const cached = this.delayMs.get(tournamentId);
    const fresh = cached && this.now() - cached.fetchedAt < this.opts.delayCacheMs;
    if (cached && (fresh || !forceFresh)) {
      if (!fresh) this.cachedDelay(tournamentId);
      return cached.ms;
    }
    const ms = Math.max(0, await this.deps.backend.spectatorDelayMs(tournamentId));
    this.delayMs.set(tournamentId, { ms, fetchedAt: this.now(), refreshing: false });
    return ms;
  }

  /** Synchronous read for the fan-out path; refreshes stale values in the background. */
  private cachedDelay(tournamentId: string): number {
    const cached = this.delayMs.get(tournamentId);
    if (cached && this.now() - cached.fetchedAt >= this.opts.delayCacheMs && !cached.refreshing) {
      cached.refreshing = true;
      void this.deps.backend
        .spectatorDelayMs(tournamentId)
        .then((ms) => this.delayMs.set(tournamentId, { ms: Math.max(0, ms), fetchedAt: this.now(), refreshing: false }))
        .catch((err: unknown) => {
          cached.refreshing = false;
          this.fail(err, { area: 'spectator-delay' });
        });
    }
    return cached?.ms ?? 0;
  }

  private sendError(conn: Connection, code: string, message: string): void {
    conn.send(frame({ t: 'error', st: this.now(), code, message }));
  }

  private index(map: Map<string, Set<Connection>>, key: string | null, conn: Connection): void {
    // A socket that closed while an async step was in flight must not be re-indexed after its cleanup.
    if (!key || conn.closed) return;
    let set = map.get(key);
    if (!set) {
      set = new Set();
      map.set(key, set);
    }
    set.add(conn);
  }

  private unindex(map: Map<string, Set<Connection>>, key: string | null, conn: Connection): void {
    if (!key) return;
    const set = map.get(key);
    if (!set) return;
    set.delete(conn);
    if (set.size === 0) map.delete(key);
  }

  private every(ms: number, fn: () => void): void {
    const t = setInterval(fn, ms);
    t.unref?.();
    this.timers.push(t);
  }

  private fail(err: unknown, ctx: object): void {
    this.deps.metrics.errors.inc({ area: 'gateway' });
    this.log.error({ err, ...ctx }, 'gateway error');
  }
}

function frame(m: ServerMessage): string {
  return JSON.stringify(m);
}

function tournamentFrame(msg: TournamentEventMessage, st: number): string {
  return frame({ t: 'tournament_event', st, event: msg.envelope, summary: msg.summary });
}

function rawToString(data: RawData): string {
  if (typeof data === 'string') return data;
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Adds `delta` to a per-key counter (deleting it at zero) and returns the new count. */
function bump(map: Map<string, number>, key: string, delta: number): number {
  const n = Math.max(0, (map.get(key) ?? 0) + delta);
  if (n === 0) map.delete(key);
  else map.set(key, n);
  return n;
}
