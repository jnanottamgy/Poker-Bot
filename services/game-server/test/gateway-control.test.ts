import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { LocalBus } from '../src/bus/local-bus';
import { RedisBus } from '../src/bus/redis-bus';
import { channels } from '../src/bus/bus';
import type { PlayerChannelMessage } from '../src/runtime/contracts';
import { CLOSE_CODES } from '../src/gateway/options';
import type { GatewayOptions } from '../src/gateway/options';
import { MemoryPresenceStore, RedisPresenceStore } from '../src/gateway/presence';
import type { Connection } from '../src/gateway/connection';
import type { Store } from '../src/persistence/store';
import { TEST_DATABASE_URL } from './helpers/db';
import type { GatewayNode } from './helpers/gateway';
import {
  FakeBackend,
  TestClient,
  createGatewayStore,
  playerCookie,
  seedPlayer,
  seedTournament,
  self,
  sleep,
  startGatewayNode,
  summary,
  tableUpdate,
  until,
} from './helpers/gateway';

const redisUrl = process.env.TEST_REDIS_URL;

const FAST: Partial<GatewayOptions> = {
  disconnectDebounceMs: 250,
  heartbeatIntervalMs: 100,
  idleTimeoutMs: 500,
  controllerRefreshMs: 100,
  controllerTtlMs: 3_000,
  drainCheckMs: 20,
  sessionRecheckMs: 60_000,
};

const TABLE = 'tbl_ctl_1';
const act = (actionId: string, extra: Record<string, unknown> = {}) => ({ t: 'action', actionId, tableId: TABLE, type: 'CALL', tableStateVersion: 3, ...extra });

describe('presence stores (unit)', () => {
  const contract = (name: string, make: () => MemoryPresenceStore | RedisPresenceStore) =>
    it(`${name}: compare-and-set claim, refresh, release`, async () => {
      const p = make();
      const pid = `ply_${name}_${process.pid}_${Date.now()}`;
      const a = { connectionId: 'c1', nodeId: 'n1' };
      const b = { connectionId: 'c2', nodeId: 'n2' };
      expect(await p.claim(pid, a, 5_000, false)).toEqual({ claimed: true, previous: null });
      expect(await p.claim(pid, a, 5_000, false)).toEqual({ claimed: true, previous: a });
      expect(await p.claim(pid, b, 5_000, false)).toEqual({ claimed: false, previous: a });
      expect(await p.refresh(pid, a, 5_000)).toBe(true);
      expect(await p.claim(pid, b, 5_000, true)).toEqual({ claimed: true, previous: a });
      expect(await p.refresh(pid, a, 5_000)).toBe(false);
      await p.release(pid, a); // not ours any more: no-op
      expect(await p.get(pid)).toEqual(b);
      await p.release(pid, b);
      expect(await p.get(pid)).toBeNull();
    });
  let now = 0;
  contract('memory', () => new MemoryPresenceStore(() => now));
  it('memory: claims expire', async () => {
    const p = new MemoryPresenceStore(() => now);
    await p.claim('x', { connectionId: 'c', nodeId: 'n' }, 100, false);
    now += 101;
    expect(await p.get('x')).toBeNull();
  });
  if (redisUrl) {
    const redis = new Redis(redisUrl);
    afterAll(() => redis.quit());
    contract('redis', () => new RedisPresenceStore(redis, `jpb:test:${process.pid}:`));
  }
});

describe.skipIf(!TEST_DATABASE_URL)('controller, actions, backpressure, heartbeat', () => {
  let store: Store;
  let node: GatewayNode;
  const backend = new FakeBackend();
  const bus = new LocalBus();
  let T: string;

  beforeAll(async () => {
    store = await createGatewayStore('gwctl');
    node = await startGatewayNode({ store, backend, bus, options: FAST });
    T = await seedTournament(store);
    backend.summaries.set(T, summary(T));
    backend.tables.set(TABLE, tableUpdate({ tableId: TABLE, tournamentId: T, version: 3, players: ['seed'] }));
  });
  afterAll(async () => {
    await node?.close();
    await bus.close();
    await store?.close();
  });

  async function newPlayer(): Promise<{ id: string; cookie: string }> {
    const id = await seedPlayer(store, T);
    backend.selves.set(id, self(id, TABLE));
    return { id, cookie: await playerCookie(node.ctx.sessions, id, T) };
  }
  const connectPlayer = (cookie: string, opts: { autoPong?: boolean } = {}) =>
    TestClient.connect(node.url, { audience: 'PLAYER', tournamentId: T }, { cookie, ...opts });
  const serverConn = (playerId: string, pred: (c: Connection) => boolean = () => true) =>
    node.gateway.connections().find((c) => c.playerId === playerId && pred(c))!;
  const presenceEvents = (pid: string) => backend.connections.filter((e) => e.playerId === pid).map((e) => e.connected);

  it('one controller per player: observers get another_device and cannot act until they take over', async () => {
    const p = await newPlayer();
    const a = await connectPlayer(p.cookie);
    expect(a.of('another_device')).toHaveLength(0);
    const b = await connectPlayer(p.cookie);
    expect(await b.waitFor((f) => f.t === 'another_device')).toBeTruthy();
    expect(b.frames.map((f) => f.t).slice(0, 3)).toEqual(['welcome', 'snapshot', 'another_device']);

    b.send(act('b-1'));
    expect(await b.waitFor((f) => f.t === 'action_result')).toMatchObject({ actionId: 'b-1', ok: false, code: 'INVALID_COMMAND' });
    a.send(act('a-1', { type: 'RAISE', amount: 400 }));
    expect(await a.waitFor((f) => f.t === 'action_result')).toMatchObject({ actionId: 'a-1', ok: true, code: null });
    const calls = backend.actions.filter((x) => x.playerId === p.id);
    expect(calls.map((x) => x.actionId)).toEqual(['a-1']);
    expect(calls[0]).toMatchObject({ tableId: TABLE, type: 'RAISE', amount: 400, tableStateVersion: 3 });
    expect(Math.abs(calls[0]!.receivedAt - Date.now())).toBeLessThan(2_000);

    b.send({ t: 'takeover' });
    await a.waitFor((f) => f.t === 'session_replaced');
    expect((await a.waitClose()).code).toBe(CLOSE_CODES.SESSION_REPLACED);
    b.send(act('b-2'));
    expect(await b.waitFor((f) => f.t === 'action_result' && f.actionId === 'b-2')).toMatchObject({ ok: true });
    expect(await node.gateway.connections().find((c) => c.playerId === p.id)?.isController).toBe(true);

    // Taking over is not a disconnect: the table only ever saw "connected".
    await sleep(FAST.disconnectDebounceMs! + 150);
    expect(presenceEvents(p.id)).toEqual([true]);

    b.close();
    await until(() => presenceEvents(p.id).length === 2, 2_000, 'debounced disconnect');
    expect(presenceEvents(p.id)).toEqual([true, false]);
  });

  it('a quick refresh does not flap the away state', async () => {
    const p = await newPlayer();
    const a = await connectPlayer(p.cookie);
    a.close();
    await a.waitClose();
    const again = await connectPlayer(p.cookie);
    expect(again.of('another_device')).toHaveLength(0);
    await sleep(FAST.disconnectDebounceMs! + 150);
    expect(presenceEvents(p.id)).toEqual([true]);
    again.close();
  });

  it('per-connection action rate limit; duplicates are passed to the backend (idempotent there)', async () => {
    const p = await newPlayer();
    const c = await connectPlayer(p.cookie);
    for (let i = 0; i < 10; i++) c.send(act(`r-${i}`));
    await until(() => c.of('action_result').length === 10, 2_000, 'all results');
    const results = c.of('action_result');
    expect(results.filter((r) => r.ok)).toHaveLength(4);
    expect(results.filter((r) => r.code === 'RATE_LIMITED')).toHaveLength(6);
    expect(backend.actions.filter((x) => x.playerId === p.id)).toHaveLength(4);

    await sleep(1_100);
    backend.actionReply = async (x) => ({ ok: true, code: null, message: null, duplicate: backend.actions.filter((y) => y.actionId === x.actionId).length > 1 });
    c.send(act('dup-1'));
    c.send(act('dup-1'));
    await until(() => c.of('action_result').filter((r) => r.actionId === 'dup-1').length === 2, 2_000, 'duplicate replies');
    expect(backend.actions.filter((x) => x.actionId === 'dup-1')).toHaveLength(2);

    backend.actionReply = async () => {
      throw new Error('owner unreachable');
    };
    await sleep(600);
    c.send(act('boom-1'));
    expect(await c.waitFor((f) => f.t === 'action_result' && f.actionId === 'boom-1')).toMatchObject({ ok: false, code: null });
    backend.actionReply = async () => ({ ok: true, code: null, message: null, duplicate: false });
    expect(c.closeInfo).toBeNull();
    c.close();
  });

  it('message floods are answered sparingly and finally closed (1008)', async () => {
    const p = await newPlayer();
    const c = await connectPlayer(p.cookie);
    for (let i = 0; i < 120; i++) c.send({ t: 'ping', ct: i });
    expect((await c.waitClose()).code).toBe(CLOSE_CODES.POLICY_VIOLATION);
    const errors = c.of('error').filter((e) => e.code === 'RATE_LIMITED');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.length).toBeLessThan(10);
  });

  it('SESSIONS_REVOKED closes every socket of the player and releases control', async () => {
    const p = await newPlayer();
    const a = await connectPlayer(p.cookie);
    const b = await connectPlayer(p.cookie);
    await bus.publish(channels.player(p.id), { kind: 'SESSIONS_REVOKED', playerId: p.id } satisfies PlayerChannelMessage);
    for (const c of [a, b]) {
      expect((await c.waitClose()).code).toBe(CLOSE_CODES.UNAUTHORIZED);
      expect(c.of('error').at(-1)).toMatchObject({ code: 'SESSION_REVOKED' });
    }
    await until(() => presenceEvents(p.id).at(-1) === false, 2_000, 'disconnect after revoke');
  });

  it('backpressure: skips table updates above 1 MB buffered, resyncs with one snapshot when drained, closes above 8 MB', async () => {
    const p = await newPlayer();
    const c = await connectPlayer(p.cookie);
    const conn = serverConn(p.id);
    let buffered = 0;
    Object.defineProperty(conn.socket, 'bufferedAmount', { get: () => buffered, configurable: true });

    await bus.publish(channels.tableEvents(TABLE), tableUpdate({ tableId: TABLE, tournamentId: T, version: 4, players: [p.id] }));
    await c.waitFor((f) => f.t === 'table_update' && f.version === 4);

    buffered = 2 * 1024 * 1024;
    const snapshots = c.of('snapshot').length;
    await bus.publish(channels.tableEvents(TABLE), tableUpdate({ tableId: TABLE, tournamentId: T, version: 5, players: [p.id] }));
    await bus.publish(channels.tableEvents(TABLE), tableUpdate({ tableId: TABLE, tournamentId: T, version: 6, players: [p.id] }));
    await until(() => conn.stale, 1_000, 'stale');
    await sleep(60);
    expect(c.of('table_update').filter((f) => (f.version as number) > 4)).toHaveLength(0);
    // Small control frames still flow while stale.
    c.send({ t: 'ping', ct: 7 });
    await c.waitFor((f) => f.t === 'pong' && f.ct === 7);

    buffered = 0;
    await until(() => c.of('snapshot').length === snapshots + 1, 1_000, 'resync snapshot');
    expect(conn.stale).toBe(false);
    await sleep(80);
    expect(c.of('snapshot')).toHaveLength(snapshots + 1);
    await bus.publish(channels.tableEvents(TABLE), tableUpdate({ tableId: TABLE, tournamentId: T, version: 7, players: [p.id] }));
    await c.waitFor((f) => f.t === 'table_update' && f.version === 7);

    buffered = 9 * 1024 * 1024;
    await bus.publish(channels.tableEvents(TABLE), tableUpdate({ tableId: TABLE, tournamentId: T, version: 8, players: [p.id] }));
    expect((await c.waitClose()).code).toBe(CLOSE_CODES.SLOW_CONSUMER);
  });

  it('heartbeat: silent sockets are closed; pong-answering sockets stay open', async () => {
    const p = await newPlayer();
    const silent = await connectPlayer(p.cookie, { autoPong: false });
    const alive = await connectPlayer(p.cookie);
    expect((await silent.waitClose(3_000)).code).toBe(CLOSE_CODES.IDLE_TIMEOUT);
    expect(alive.closeInfo).toBeNull();
    alive.close();
  });
});

describe.skipIf(!TEST_DATABASE_URL)('session re-validation and graceful shutdown', () => {
  let store: Store;
  const backend = new FakeBackend();
  const bus = new LocalBus();
  let T: string;

  beforeAll(async () => {
    store = await createGatewayStore('gwshut');
    T = await seedTournament(store);
    backend.summaries.set(T, summary(T));
    backend.publicWatch.add(T);
  });
  afterAll(async () => {
    await bus.close();
    await store?.close();
  });

  it('closes sockets whose session was revoked (periodic re-validation)', async () => {
    const node = await startGatewayNode({ store, backend, bus, options: { ...FAST, sessionRecheckMs: 150 } });
    const pid = await seedPlayer(store, T);
    backend.selves.set(pid, self(pid, null));
    const issued = await node.ctx.sessions.issue({ kind: 'PLAYER', playerId: pid, tournamentId: T, userAgent: null, ip: null });
    const c = await TestClient.connect(node.url, { audience: 'PLAYER', tournamentId: T }, { cookie: `jpb_ps=${issued.token}` });
    await node.ctx.sessions.revoke(issued.session, 'logout elsewhere');
    expect((await c.waitClose(3_000)).code).toBe(CLOSE_CODES.UNAUTHORIZED);
    await node.close();
  });

  it('closes every socket with 1012 on shutdown and refuses new upgrades while draining', async () => {
    const node = await startGatewayNode({ store, backend, bus, options: FAST });
    const pid = await seedPlayer(store, T);
    backend.selves.set(pid, self(pid, null));
    const cookie = await playerCookie(node.ctx.sessions, pid, T);
    const p = await TestClient.connect(node.url, { audience: 'PLAYER', tournamentId: T }, { cookie });
    const s = await TestClient.connect(node.url, { audience: 'SPECTATOR', tournamentId: T });
    const pending = await TestClient.open(node.url);
    const draining = node.gateway.shutdown();
    await expect(TestClient.open(node.url)).rejects.toMatchObject({ statusCode: 503 });
    for (const c of [p, s, pending]) expect((await c.waitClose()).code).toBe(CLOSE_CODES.SERVICE_RESTART);
    await draining;
    // Shutdown waited for the debounce window and then reported the controller's disconnect.
    expect(backend.connections.filter((e) => e.playerId === pid).map((e) => e.connected)).toEqual([true, false]);
    expect(node.gateway.connections()).toHaveLength(0);
    await node.close();
  });

  it('app.close() triggers the same graceful shutdown', async () => {
    const node = await startGatewayNode({ store, backend, bus, options: FAST });
    const s = await TestClient.connect(node.url, { audience: 'SPECTATOR', tournamentId: T });
    const closing = node.close();
    expect((await s.waitClose()).code).toBe(CLOSE_CODES.SERVICE_RESTART);
    await closing;
  });
});

describe.skipIf(!TEST_DATABASE_URL || !redisUrl)('two gateway nodes sharing Redis (bus + presence)', () => {
  let store: Store;
  const backend = new FakeBackend();
  let redis: Redis;
  let busA: RedisBus;
  let busB: RedisBus;
  let nodeA: GatewayNode;
  let nodeB: GatewayNode;
  let T: string;

  beforeAll(async () => {
    store = await createGatewayStore('gwredis');
    redis = new Redis(redisUrl!);
    const prefix = `jpb:test:gw:${process.pid}:${Date.now()}:`;
    busA = new RedisBus(redisUrl!);
    busB = new RedisBus(redisUrl!);
    nodeA = await startGatewayNode({ store, backend, bus: busA, nodeId: 'node-a', presence: new RedisPresenceStore(redis, prefix), options: FAST });
    nodeB = await startGatewayNode({ store, backend, bus: busB, nodeId: 'node-b', presence: new RedisPresenceStore(redis, prefix), options: FAST });
    T = await seedTournament(store);
    backend.summaries.set(T, summary(T));
    backend.tables.set(TABLE, tableUpdate({ tableId: TABLE, tournamentId: T, version: 3, players: ['seed'] }));
  });
  afterAll(async () => {
    await nodeA?.close();
    await nodeB?.close();
    await busA?.close();
    await busB?.close();
    await redis?.quit();
    await store?.close();
  });

  it('a second device on another node is an observer until takeover; the old node then replaces its controller', async () => {
    const pid = await seedPlayer(store, T);
    backend.selves.set(pid, self(pid, TABLE));
    const cookie = await playerCookie(nodeA.ctx.sessions, pid, T);
    const a = await TestClient.connect(nodeA.url, { audience: 'PLAYER', tournamentId: T }, { cookie });
    const b = await TestClient.connect(nodeB.url, { audience: 'PLAYER', tournamentId: T }, { cookie });
    expect(a.of('another_device')).toHaveLength(0);
    await b.waitFor((f) => f.t === 'another_device');

    b.send(act('x-b-1'));
    expect(await b.waitFor((f) => f.t === 'action_result')).toMatchObject({ ok: false, code: 'INVALID_COMMAND' });

    // Both nodes deliver table updates from the shared Redis bus.
    await busA.publish(channels.tableEvents(TABLE), tableUpdate({ tableId: TABLE, tournamentId: T, version: 9, players: [pid], holeCards: [['Qs', 'Qd']] }));
    for (const c of [a, b]) expect(await c.waitFor((f) => f.t === 'table_update' && f.version === 9)).toMatchObject({ view: { you: { holeCards: ['Qs', 'Qd'] } } });

    b.send({ t: 'takeover' });
    await a.waitFor((f) => f.t === 'session_replaced');
    expect((await a.waitClose()).code).toBe(CLOSE_CODES.SESSION_REPLACED);
    b.send(act('x-b-2'));
    expect(await b.waitFor((f) => f.t === 'action_result' && f.actionId === 'x-b-2')).toMatchObject({ ok: true });

    // Presence: node A's close does not report a disconnect because node B holds the controller.
    await sleep(FAST.disconnectDebounceMs! + 200);
    expect(backend.connections.filter((e) => e.playerId === pid).map((e) => e.connected)).not.toContain(false);

    // The controller key survives refresh cycles on node B (TTL refreshed while connected).
    await sleep(300);
    b.send(act('x-b-3'));
    expect(await b.waitFor((f) => f.t === 'action_result' && f.actionId === 'x-b-3')).toMatchObject({ ok: true });

    b.close();
    await until(() => backend.connections.filter((e) => e.playerId === pid).at(-1)?.connected === false, 2_000, 'disconnect');
    // The key was released: a new device becomes controller immediately on either node.
    const c = await TestClient.connect(nodeA.url, { audience: 'PLAYER', tournamentId: T }, { cookie });
    expect(c.of('another_device')).toHaveLength(0);
    c.close();
  });
});
