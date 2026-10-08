import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TournamentPublicSummary } from '@jpb/shared-types';
import { LocalBus } from '../src/bus/local-bus';
import { channels } from '../src/bus/bus';
import type { BusHandler, MessageBus, Unsubscribe } from '../src/bus/bus';
import type { PlayerChannelMessage } from '../src/runtime/contracts';
import { CLOSE_CODES } from '../src/gateway/options';
import type { GatewayOptions } from '../src/gateway/options';
import { MemoryPresenceStore } from '../src/gateway/presence';
import type { Store } from '../src/persistence/store';
import { TEST_DATABASE_URL } from './helpers/db';
import type { ActionCall, GatewayNode } from './helpers/gateway';
import {
  FakeBackend,
  TestClient,
  createGatewayStore,
  playerCookie,
  seedAdmin,
  seedPlayer,
  seedTournament,
  self,
  sleep,
  startGatewayNode,
  summary,
  tableUpdate,
  until,
} from './helpers/gateway';

/**
 * Adversarial review of the gateway: session binding, controller takeover
 * across nodes, DoS limits, subscription hygiene and error-frame hygiene.
 * Tests named "BUG:" fail on the current implementation and document a real defect.
 */

const SECRET = 'SECRET-pg://jpb:hunter2@db-internal:5432';

/** FakeBackend with switchable hangs and failures. */
class HostileBackend extends FakeBackend {
  hangSummary = new Set<string>();
  failSummary = new Set<string>();
  failTableSnapshot = false;
  failActions = false;
  spectateGate: Promise<void> | null = null;
  featuredGate: Promise<void> | null = null;

  override async tournamentSummary(id: string): Promise<TournamentPublicSummary | null> {
    if (this.hangSummary.has(id)) await new Promise<never>(() => undefined);
    if (this.failSummary.has(id)) throw new Error(SECRET);
    return super.tournamentSummary(id);
  }
  override async tableSnapshot(id: string) {
    if (this.failTableSnapshot) throw new Error(SECRET);
    return super.tableSnapshot(id);
  }
  override async canSpectate(tid: string, playerId: string | null): Promise<boolean> {
    if (this.spectateGate) await this.spectateGate;
    return super.canSpectate(tid, playerId);
  }
  override async featuredTable(tid: string): Promise<string | null> {
    if (this.featuredGate) await this.featuredGate;
    return super.featuredTable(tid);
  }
  override async submitPlayerAction(input: ActionCall) {
    if (this.failActions) throw new Error(SECRET);
    return super.submitPlayerAction(input);
  }
}

/** A node-local view of a shared bus that silently loses CONTROLLER_CLAIMED (pub/sub is at-most-once). */
class LossyBus implements MessageBus {
  constructor(private readonly inner: MessageBus) {}
  publish(channel: string, message: unknown): Promise<void> {
    return this.inner.publish(channel, message);
  }
  subscribe(channel: string, handler: BusHandler): Promise<Unsubscribe> {
    return this.inner.subscribe(channel, (m) => {
      if ((m as { kind?: unknown } | null)?.kind === 'CONTROLLER_CLAIMED') return;
      handler(m);
    });
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

const OPTS: Partial<GatewayOptions> = { helloTimeoutMs: 400, heartbeatIntervalMs: 100 };
const TABLE = 'tbl_rvs_1';
const act = (actionId: string) => ({ t: 'action', actionId, tableId: TABLE, type: 'CALL', tableStateVersion: 3 });

describe.skipIf(!TEST_DATABASE_URL)('review: sessions, DoS limits, error hygiene', () => {
  let store: Store;
  let node: GatewayNode;
  const backend = new HostileBackend();
  const bus = new LocalBus();
  let T: string;

  beforeAll(async () => {
    store = await createGatewayStore('rvgwsess');
    node = await startGatewayNode({ store, backend, bus, options: OPTS });
    T = await seedTournament(store);
    backend.summaries.set(T, summary(T));
    backend.publicWatch.add(T);
    backend.featured.set(T, TABLE);
    backend.tables.set(TABLE, tableUpdate({ tableId: TABLE, tournamentId: T, version: 3, players: ['rvs_seed'] }));
  });
  afterAll(async () => {
    await node?.close();
    await bus.close();
    await store?.close();
  });

  async function newPlayer(tournamentId = T): Promise<{ id: string; cookie: string }> {
    const id = await seedPlayer(store, tournamentId);
    backend.selves.set(id, self(id, TABLE));
    return { id, cookie: await playerCookie(node.ctx.sessions, id, tournamentId) };
  }

  it('BUG: a player whose sessions were revoked after the upgrade but before hello is still admitted (principal resolved only at upgrade)', async () => {
    const p = await newPlayer();
    const c = await TestClient.open(node.url, { cookie: p.cookie });
    // The player is disqualified / kicked: every session is revoked and the gateways are told.
    await node.ctx.sessions.revokeAllForPlayer(p.id, 'disqualified');
    await bus.publish(channels.player(p.id), { kind: 'SESSIONS_REVOKED', playerId: p.id } satisfies PlayerChannelMessage);
    await sleep(50);
    c.send({ t: 'hello', v: 1, audience: 'PLAYER', tournamentId: T, resume: null });
    await c.waitFor((f) => f.t === 'snapshot' || f.t === 'error');
    // The socket now controls the seat until the 60 s periodic re-check.
    c.send(act('revoked-1'));
    await sleep(150);
    c.close();
    expect(backend.actions.filter((a) => a.actionId === 'revoked-1')).toHaveLength(0);
    expect(c.of('snapshot')).toHaveLength(0);
  });

  it('BUG: a hello whose backend lookup never completes is never timed out (the hello timer stops at receipt)', async () => {
    const stuck = await seedTournament(store);
    backend.hangSummary.add(stuck);
    const c = await TestClient.open(node.url);
    c.send({ t: 'hello', v: 1, audience: 'SPECTATOR', tournamentId: stuck, resume: null });
    await sleep(OPTS.helloTimeoutMs! * 3);
    const stillPending = c.closeInfo === null;
    c.close();
    expect(stillPending).toBe(false);
  });

  it('frames: 4-16 KB get FRAME_TOO_LARGE and the socket survives; above 16 KB ws closes with 1009', async () => {
    const c = await TestClient.connect(node.url, { audience: 'SPECTATOR', tournamentId: T });
    c.send({ t: 'ping', ct: 1, pad: 'x'.repeat(8 * 1024) });
    expect(await c.waitFor((f) => f.t === 'error')).toMatchObject({ code: 'FRAME_TOO_LARGE' });
    c.send({ t: 'ping', ct: 2 });
    await c.waitFor((f) => f.t === 'pong' && f.ct === 2);
    c.sendRaw('x'.repeat(20 * 1024));
    expect((await c.waitClose()).code).toBe(1009);
  });

  it('a client that never sends hello is closed by the hello timeout even while it spams binary frames', async () => {
    const c = await TestClient.open(node.url);
    const spam = setInterval(() => c.ws.readyState === 1 && c.sendRaw(Buffer.from([1, 2, 3]), true), 50);
    const closed = await c.waitClose(OPTS.helloTimeoutMs! + 1_000);
    clearInterval(spam);
    expect(closed.code).toBe(CLOSE_CODES.HELLO_TIMEOUT);
  });

  it('error frames never carry internal error details (hello, snapshot, action)', async () => {
    const broken = await seedTournament(store);
    backend.failSummary.add(broken);
    const h = await TestClient.connect(node.url, { audience: 'SPECTATOR', tournamentId: broken });
    expect(h.of('error')[0]).toMatchObject({ code: 'UNAVAILABLE' });
    await h.waitClose();

    const p = await newPlayer();
    const c = await TestClient.connect(node.url, { audience: 'PLAYER', tournamentId: T }, { cookie: p.cookie });
    backend.failTableSnapshot = true;
    c.send({ t: 'snapshot_request' });
    expect(await c.waitFor((f) => f.t === 'error')).toMatchObject({ code: 'SNAPSHOT_UNAVAILABLE' });
    backend.failTableSnapshot = false;
    backend.failActions = true;
    c.send(act('fails-1'));
    expect(await c.waitFor((f) => f.t === 'action_result')).toMatchObject({ ok: false, code: null });
    backend.failActions = false;
    for (const raw of [...h.raw, ...c.raw]) {
      expect(raw).not.toContain('SECRET');
      expect(raw).not.toContain('hunter2');
      expect(raw).not.toMatch(/at .*\.ts:\d+/);
    }
    c.close();
  });

  it('a socket that closes while hello is suspended in the backend leaks no subscription, index or controller key', async () => {
    let openSpectate!: () => void;
    backend.spectateGate = new Promise<void>((r) => (openSpectate = r));
    const a = await TestClient.open(node.url);
    a.send({ t: 'hello', v: 1, audience: 'SPECTATOR', tournamentId: T, resume: null });
    await sleep(30);
    a.close();
    await a.waitClose();
    backend.spectateGate = null;
    openSpectate();

    let openFeatured!: () => void;
    backend.featuredGate = new Promise<void>((r) => (openFeatured = r));
    const b = await TestClient.open(node.url);
    b.send({ t: 'hello', v: 1, audience: 'SPECTATOR', tournamentId: T, resume: null });
    await until(() => bus.subscriberCount(channels.tournamentEvents(T)) === 1, 1_000, 'tournament channel joined');
    b.close();
    await b.waitClose();
    backend.featuredGate = null;
    openFeatured();

    await until(() => node.gateway.connections().length === 0, 2_000, 'connections cleaned');
    await sleep(50);
    expect(bus.subscriberCount(channels.tournamentEvents(T))).toBe(0);
    expect(bus.subscriberCount(channels.tableEvents(TABLE))).toBe(0);
  });

  it('cross-site WebSocket hijacking: look-alike origins are rejected before any cookie is used', async () => {
    const p = await newPlayer();
    for (const origin of ['http://localhost:8081', 'https://localhost:8080', 'http://evil.localhost:8080', 'http://localhost:8080.evil.example', 'null', 'file://']) {
      await expect(TestClient.open(node.url, { cookie: p.cookie, origin })).rejects.toMatchObject({ statusCode: 403 });
    }
  });

  it('a player cookie of another tournament never binds a SPECTATOR socket to that player', async () => {
    const other = await seedTournament(store);
    const p = await newPlayer(other);
    const s = await TestClient.connect(node.url, { audience: 'SPECTATOR', tournamentId: T }, { cookie: p.cookie });
    expect(node.gateway.connections().find((c) => c.audience === 'SPECTATOR')?.playerId).toBeNull();
    await bus.publish(channels.player(p.id), { kind: 'NOTICE', notice: { kind: 'TABLE_MOVE', fromTableNumber: 1, fromSeat: 1, toTableNumber: 2, toSeat: 3, stack: 1 } } satisfies PlayerChannelMessage);
    await sleep(100);
    expect(s.of('notice')).toHaveLength(0);
    s.close();
  });

  it('BUG: an admin whose sessions were revoked after the upgrade but before hello is admitted (same root cause)', async () => {
    const admin = await seedAdmin(store, node.ctx.sessions, 'SUPER_ADMIN');
    const c = await TestClient.open(node.url, { cookie: admin.cookie });
    await node.ctx.sessions.revokeAllForAdmin(admin.adminId, 'logout');
    c.send({ t: 'hello', v: 1, audience: 'ADMIN', tournamentId: T, resume: null });
    await c.waitFor((f) => f.t === 'snapshot' || f.t === 'error');
    const admitted = c.of('snapshot').length > 0;
    c.close();
    expect(admitted).toBe(false);
  });
});

describe.skipIf(!TEST_DATABASE_URL)('review: takeover across nodes', () => {
  let store: Store;
  const backend = new FakeBackend();
  const shared = new LocalBus();
  const presence = new MemoryPresenceStore();
  let node1: GatewayNode;
  let node2: GatewayNode;
  let T: string;

  beforeAll(async () => {
    store = await createGatewayStore('rvgwtake');
    // Default refresh interval (5 s): the window in which a lost CONTROLLER_CLAIMED goes unnoticed.
    node1 = await startGatewayNode({ store, backend, bus: new LossyBus(shared), presence, nodeId: 'rv-node-1' });
    node2 = await startGatewayNode({ store, backend, bus: shared, presence, nodeId: 'rv-node-2' });
    T = await seedTournament(store);
    backend.summaries.set(T, summary(T));
    backend.tables.set(TABLE, tableUpdate({ tableId: TABLE, tournamentId: T, version: 3, players: ['rvs_seed'] }));
  });
  afterAll(async () => {
    await node1?.close();
    await node2?.close();
    await shared.close();
    await store?.close();
  });

  it('BUG: after a takeover on another node, the replaced device can keep acting until its next presence refresh', async () => {
    const pid = await seedPlayer(store, T);
    backend.selves.set(pid, self(pid, TABLE));
    const cookie = await playerCookie(node1.ctx.sessions, pid, T);
    const a = await TestClient.connect(node1.url, { audience: 'PLAYER', tournamentId: T }, { cookie });
    const b = await TestClient.connect(node2.url, { audience: 'PLAYER', tournamentId: T }, { cookie });
    await b.waitFor((f) => f.t === 'another_device');
    b.send({ t: 'takeover' });
    await until(() => b.of('snapshot').length >= 2, 2_000, 'takeover snapshot');
    expect(await presence.get(pid)).toMatchObject({ nodeId: 'rv-node-2' });

    // The presence store says B controls the seat, yet A (node 1 never saw CONTROLLER_CLAIMED) still acts.
    a.send(act('stale-controller-1'));
    const res = await a.waitFor((f) => f.t === 'action_result');
    a.close();
    b.close();
    expect(res).toMatchObject({ ok: false, code: 'INVALID_COMMAND' });
    expect(backend.actions.filter((x) => x.actionId === 'stale-controller-1')).toHaveLength(0);
  });
});
