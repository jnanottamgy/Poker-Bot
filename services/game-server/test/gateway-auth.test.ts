import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalBus } from '../src/bus/local-bus';
import { isAllowedOrigin } from '../src/gateway/origin';
import { parseClientFrame } from '../src/gateway/protocol';
import { CLOSE_CODES } from '../src/gateway/options';
import { TEST_DATABASE_URL } from './helpers/db';
import type { GatewayNode } from './helpers/gateway';
import {
  FakeBackend,
  ORIGIN,
  TestClient,
  createGatewayStore,
  holeEvent,
  playerCookie,
  seedAdmin,
  seedPlayer,
  seedTournament,
  self,
  startGatewayNode,
  summary,
  tableUpdate,
  until,
} from './helpers/gateway';
import type { Store } from '../src/persistence/store';

describe('origin check (unit)', () => {
  const base = { publicBaseUrl: 'https://poker.example.com', nodeEnv: 'production' as const };
  it('accepts only the public origin', () => {
    expect(isAllowedOrigin('https://poker.example.com', base)).toBe(true);
    expect(isAllowedOrigin('https://poker.example.com:443', base)).toBe(true);
    expect(isAllowedOrigin('https://evil.example.com', base)).toBe(false);
    expect(isAllowedOrigin('http://poker.example.com', base)).toBe(false);
    expect(isAllowedOrigin('https://poker.example.com.evil.com', base)).toBe(false);
    expect(isAllowedOrigin('null', base)).toBe(false);
    expect(isAllowedOrigin('file://x', base)).toBe(false);
  });
  it('allows a missing Origin (non-browser client) only outside production', () => {
    expect(isAllowedOrigin(undefined, base)).toBe(false);
    expect(isAllowedOrigin(undefined, { ...base, nodeEnv: 'development' })).toBe(true);
    expect(isAllowedOrigin('http://localhost:5173', { ...base, extraAllowedOrigins: ['http://localhost:5173'] })).toBe(true);
  });
});

describe('client frame validation (unit)', () => {
  it('rejects malformed, unknown, oversized and smuggled frames without throwing', () => {
    expect(parseClientFrame('{', 4096)).toMatchObject({ ok: false, code: 'MALFORMED_JSON' });
    expect(parseClientFrame('[]', 4096)).toMatchObject({ ok: false, code: 'UNKNOWN_TYPE' });
    expect(parseClientFrame('{"t":"nope"}', 4096)).toMatchObject({ ok: false, code: 'UNKNOWN_TYPE' });
    expect(parseClientFrame('{"t":"__proto__"}', 4096)).toMatchObject({ ok: false, code: 'UNKNOWN_TYPE' });
    expect(parseClientFrame(JSON.stringify({ t: 'ping', ct: 1, extra: 1 }), 4096)).toMatchObject({ ok: false, code: 'INVALID_MESSAGE' });
    expect(parseClientFrame(JSON.stringify({ t: 'ping', ct: 'x'.repeat(5000) }), 4096)).toMatchObject({ ok: false, code: 'FRAME_TOO_LARGE' });
    const badAction = { t: 'action', actionId: 'a1', tableId: 't', type: 'RAISE', amount: 1.5, tableStateVersion: 1 };
    expect(parseClientFrame(JSON.stringify(badAction), 4096)).toMatchObject({ ok: false, code: 'INVALID_MESSAGE' });
    expect(parseClientFrame(JSON.stringify({ ...badAction, amount: -1 }), 4096)).toMatchObject({ ok: false, code: 'INVALID_MESSAGE' });
    expect(parseClientFrame(JSON.stringify({ ...badAction, amount: 300 }), 4096)).toMatchObject({ ok: true });
    expect(parseClientFrame(JSON.stringify({ ...badAction, playerId: 'someone-else', amount: 300 }), 4096)).toMatchObject({ ok: false });
  });
});

describe.skipIf(!TEST_DATABASE_URL)('gateway authentication & audiences', () => {
  let store: Store;
  let node: GatewayNode;
  const backend = new FakeBackend();
  const bus = new LocalBus();
  let T1: string;
  let T2: string;
  let p1: string;
  let p2: string;
  let pOther: string;
  let cookies: Record<string, string>;
  let admins: Record<string, { adminId: string; cookie: string; sessionId: string }>;
  const TABLE = 'tbl_auth_1';

  beforeAll(async () => {
    store = await createGatewayStore('gwauth');
    node = await startGatewayNode({ store, backend, bus, options: { helloTimeoutMs: 300 } });
    T1 = await seedTournament(store);
    T2 = await seedTournament(store);
    p1 = await seedPlayer(store, T1);
    p2 = await seedPlayer(store, T1);
    pOther = await seedPlayer(store, T2);
    const s = node.ctx.sessions;
    cookies = { p1: await playerCookie(s, p1, T1), p2: await playerCookie(s, p2, T1), pOther: await playerCookie(s, pOther, T2) };
    admins = {
      superAdmin: await seedAdmin(store, s, 'SUPER_ADMIN'),
      staff: await seedAdmin(store, s, 'STAFF'),
      scopedElsewhere: await seedAdmin(store, s, 'TOURNAMENT_DIRECTOR', [T2]),
    };
    backend.summaries.set(T1, summary(T1, 7));
    backend.summaries.set(T2, summary(T2));
    backend.selves.set(p1, self(p1, TABLE));
    backend.selves.set(p2, self(p2, TABLE));
    backend.featured.set(T1, TABLE);
    backend.tables.set(
      TABLE,
      tableUpdate({ tableId: TABLE, tournamentId: T1, version: 5, players: [p1, p2], holeCards: [['As', 'Ad'], ['Kc', 'Kh']] }),
    );
  });
  afterAll(async () => {
    await node?.close();
    await bus.close();
    await store?.close();
  });

  const url = () => node.url;

  it('rejects upgrades from a foreign Origin (cross-site WebSocket hijacking)', async () => {
    await expect(TestClient.open(url(), { cookie: cookies.p1, origin: 'https://evil.example' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(TestClient.open(url(), { cookie: cookies.p1, origin: 'null' })).rejects.toMatchObject({ statusCode: 403 });
    // Non-browser client without Origin: allowed outside production.
    const c = await TestClient.open(url(), { cookie: cookies.p1, origin: null });
    c.close();
  });

  it('refuses PLAYER without a session, with a forged cookie, or for another tournament', async () => {
    for (const cookie of [undefined, 'jpb_ps=forged-token-value', `jpb_ps=${'x'.repeat(200)}`]) {
      const c = await TestClient.connect(url(), { audience: 'PLAYER', tournamentId: T1 }, { cookie });
      expect(c.of('error')[0]).toMatchObject({ code: 'UNAUTHORIZED' });
      expect((await c.waitClose()).code).toBe(CLOSE_CODES.UNAUTHORIZED);
      expect(c.of('snapshot')).toHaveLength(0);
    }
    const other = await TestClient.connect(url(), { audience: 'PLAYER', tournamentId: T1 }, { cookie: cookies.pOther });
    expect(other.of('error')[0]).toMatchObject({ code: 'FORBIDDEN' });
    expect((await other.waitClose()).code).toBe(CLOSE_CODES.FORBIDDEN);
    // An admin cookie is not a player session.
    const adm = await TestClient.connect(url(), { audience: 'PLAYER', tournamentId: T1 }, { cookie: admins.superAdmin!.cookie });
    expect((await adm.waitClose()).code).toBe(CLOSE_CODES.UNAUTHORIZED);
  });

  it('PLAYER: welcome then an authoritative snapshot with only their own hole cards', async () => {
    const c = await TestClient.connect(url(), { audience: 'PLAYER', tournamentId: T1 }, { cookie: cookies.p1 });
    expect(c.frames.map((f) => f.t).slice(0, 2)).toEqual(['welcome', 'snapshot']);
    expect(c.frames[0]).toMatchObject({ audience: 'PLAYER', protocol: 1 });
    const snap = c.of('snapshot')[0]!.snapshot;
    expect(snap.audience).toBe('PLAYER');
    if (snap.audience !== 'PLAYER') throw new Error('unreachable');
    expect(snap.self.playerId).toBe(p1);
    expect(snap.table?.you).toEqual({ playerId: p1, seat: 0, holeCards: ['As', 'Ad'], legal: null });
    expect(snap.tournament.lastSeq).toBe(7);
    expect(c.raw.join('')).not.toContain('"Kc"');
    for (const f of c.frames) expect(typeof f.st).toBe('number');
    c.send({ t: 'ping', ct: 1234 });
    expect(await c.waitFor((f) => f.t === 'pong')).toMatchObject({ ct: 1234 });
    c.close();
  });

  it('ADMIN requires an admin session with PLAYER_VIEW in scope', async () => {
    const none = await TestClient.connect(url(), { audience: 'ADMIN', tournamentId: T1 }, { cookie: cookies.p1 });
    expect((await none.waitClose()).code).toBe(CLOSE_CODES.UNAUTHORIZED);
    const scoped = await TestClient.connect(url(), { audience: 'ADMIN', tournamentId: T1 }, { cookie: admins.scopedElsewhere!.cookie });
    expect(scoped.of('error')[0]).toMatchObject({ code: 'FORBIDDEN' });
    expect((await scoped.waitClose()).code).toBe(CLOSE_CODES.FORBIDDEN);
    const staff = await TestClient.connect(url(), { audience: 'ADMIN', tournamentId: T1 }, { cookie: admins.staff!.cookie });
    expect(staff.of('snapshot')[0]!.snapshot).toMatchObject({ audience: 'ADMIN', table: null });
    staff.close();
    // Scope applies per tournament: the scoped director may follow T2.
    const ok = await TestClient.connect(url(), { audience: 'ADMIN', tournamentId: T2 }, { cookie: admins.scopedElsewhere!.cookie });
    expect(ok.of('snapshot')).toHaveLength(1);
    ok.close();
  });

  it('SPECTATOR requires the tournament policy (public watch, or an eliminated player)', async () => {
    const denied = await TestClient.connect(url(), { audience: 'SPECTATOR', tournamentId: T1 });
    expect(denied.of('error')[0]).toMatchObject({ code: 'SPECTATING_NOT_ALLOWED' });
    expect((await denied.waitClose()).code).toBe(CLOSE_CODES.FORBIDDEN);

    backend.eliminatedSpectators.add(p2);
    const eliminated = await TestClient.connect(url(), { audience: 'SPECTATOR', tournamentId: T1 }, { cookie: cookies.p2 });
    const snap = eliminated.of('snapshot')[0]!.snapshot;
    expect(snap).toMatchObject({ audience: 'SPECTATOR', table: { tableId: TABLE, audience: 'SPECTATOR' } });
    expect(eliminated.raw.join('')).not.toMatch(/"(As|Ad|Kc|Kh)"/);
    eliminated.close();
    backend.eliminatedSpectators.clear();

    backend.publicWatch.add(T1);
    const anon = await TestClient.connect(url(), { audience: 'SPECTATOR', tournamentId: T1 });
    expect(anon.of('snapshot')).toHaveLength(1);
    anon.close();
    backend.publicWatch.clear();
  });

  it('DISPLAY requires the broadcast display to be enabled and shows the featured table', async () => {
    const denied = await TestClient.connect(url(), { audience: 'DISPLAY', tournamentId: T1 });
    expect((await denied.waitClose()).code).toBe(CLOSE_CODES.FORBIDDEN);
    backend.displays.add(T1);
    // Enabled but the tournament is not public: an anonymous screen must not bypass publicWatch = false.
    const privateDenied = await TestClient.connect(url(), { audience: 'DISPLAY', tournamentId: T1 });
    expect((await privateDenied.waitClose()).code).toBe(CLOSE_CODES.FORBIDDEN);
    backend.publicWatch.add(T1);
    const d = await TestClient.connect(url(), { audience: 'DISPLAY', tournamentId: T1 });
    const snap = d.of('snapshot')[0]!.snapshot;
    expect(snap).toMatchObject({ audience: 'DISPLAY', featured: { tableId: TABLE, audience: 'SPECTATOR' } });
    expect(d.raw.join('')).not.toMatch(/"(As|Ad|Kc|Kh)"/);
    d.send({ t: 'watch', tableId: TABLE });
    expect(await d.waitFor((f) => f.t === 'error')).toMatchObject({ code: 'WATCH_NOT_ALLOWED' });
    d.close();
    backend.publicWatch.clear();
  });

  it('unknown tournament, wrong protocol version, missing/late hello', async () => {
    // A player session bound to another tournament is refused before any lookup (no tournament enumeration).
    const foreign = await TestClient.connect(url(), { audience: 'PLAYER', tournamentId: 'trn_missing' }, { cookie: cookies.p1 });
    expect((await foreign.waitClose()).code).toBe(CLOSE_CODES.FORBIDDEN);
    const unknown = await TestClient.connect(url(), { audience: 'SPECTATOR', tournamentId: 'trn_missing' });
    expect((await unknown.waitClose()).code).toBe(CLOSE_CODES.NOT_FOUND);

    const v = await TestClient.open(url(), { cookie: cookies.p1 });
    v.send({ t: 'hello', v: 99, audience: 'PLAYER', tournamentId: T1, resume: null });
    expect((await v.waitClose()).code).toBe(CLOSE_CODES.BAD_HELLO);
    expect(v.of('error')[0]).toMatchObject({ code: 'PROTOCOL_VERSION' });

    const first = await TestClient.open(url(), { cookie: cookies.p1 });
    first.send({ t: 'ping', ct: 1 });
    expect((await first.waitClose()).code).toBe(CLOSE_CODES.BAD_HELLO);

    const garbage = await TestClient.open(url(), { cookie: cookies.p1 });
    garbage.sendRaw('not json');
    expect((await garbage.waitClose()).code).toBe(CLOSE_CODES.BAD_HELLO);

    const silent = await TestClient.open(url(), { cookie: cookies.p1 });
    expect((await silent.waitClose()).code).toBe(CLOSE_CODES.HELLO_TIMEOUT);
    expect(silent.of('error')[0]).toMatchObject({ code: 'HELLO_TIMEOUT' });
  });

  it('answers malformed, unknown, oversized and binary frames with error frames and keeps serving', async () => {
    const c = await TestClient.connect(url(), { audience: 'PLAYER', tournamentId: T1 }, { cookie: cookies.p1 });
    c.sendRaw('{oops');
    c.send({ t: 'launch_missiles' });
    c.send({ t: 'action', actionId: 'x', tableId: TABLE, type: 'RAISE', amount: 'lots', tableStateVersion: 1 });
    c.send({ t: 'ping', ct: 1, pad: 'x'.repeat(5_000) });
    c.sendRaw(Buffer.from([1, 2, 3]), true);
    c.send({ t: 'hello', v: 1, audience: 'PLAYER', tournamentId: T1, resume: null });
    c.send({ t: 'ping', ct: 42 });
    await c.waitFor((f) => f.t === 'pong' && f.ct === 42);
    expect(c.of('error').map((e) => e.code)).toEqual(['MALFORMED_JSON', 'UNKNOWN_TYPE', 'INVALID_MESSAGE', 'FRAME_TOO_LARGE', 'BINARY_NOT_SUPPORTED', 'ALREADY_HELLO']);
    expect(c.closeInfo).toBeNull();
    // Beyond the hard ws limit the socket is closed by the protocol layer (1009 Message Too Big).
    c.sendRaw('x'.repeat(node.gateway.options.hardMaxPayloadBytes + 1));
    expect((await c.waitClose()).code).toBe(1009);
  });

  it('accepts hello.resume, counts reconnects and connection metrics by audience', async () => {
    const before = node.metrics.reconnects.get({ audience: 'PLAYER' });
    const c = await TestClient.connect(url(), { audience: 'PLAYER', tournamentId: T1, resume: { tableId: TABLE, tableSeq: 3, tournamentSeq: 2 } }, { cookie: cookies.p1 });
    expect(c.of('snapshot')).toHaveLength(1);
    expect(node.metrics.reconnects.get({ audience: 'PLAYER' })).toBe(before + 1);
    expect(node.metrics.wsConnections.get({ audience: 'PLAYER' })).toBeGreaterThanOrEqual(1);
    expect(node.metrics.wsMessagesIn.get({ audience: 'PLAYER' })).toBeGreaterThan(0);
    expect(node.metrics.wsMessagesOut.get({ audience: 'PLAYER' })).toBeGreaterThan(0);
    const disconnects = node.metrics.wsDisconnects.get();
    c.close();
    await until(() => node.metrics.wsDisconnects.get() > disconnects, 2_000, 'disconnect metric');
    expect(node.metrics.wsConnects.get()).toBeGreaterThan(0);
  });

  it('refuses a session revoked in the database', async () => {
    const p3 = await seedPlayer(store, T1);
    backend.selves.set(p3, self(p3, null));
    const issued = await node.ctx.sessions.issue({ kind: 'PLAYER', playerId: p3, tournamentId: T1, userAgent: null, ip: null });
    await node.ctx.sessions.revoke(issued.session, 'test');
    const c = await TestClient.connect(url(), { audience: 'PLAYER', tournamentId: T1 }, { cookie: `jpb_ps=${issued.token}` });
    expect((await c.waitClose()).code).toBe(CLOSE_CODES.UNAUTHORIZED);
  });

  it('defence in depth: a HOLE_CARDS_DEALT mislabelled PUBLIC still reaches only its owner', async () => {
    backend.publicWatch.add(T1);
    const a = await TestClient.connect(url(), { audience: 'PLAYER', tournamentId: T1 }, { cookie: cookies.p1 });
    const spec = await TestClient.connect(url(), { audience: 'SPECTATOR', tournamentId: T1 });
    const msg = tableUpdate({
      tableId: TABLE,
      tournamentId: T1,
      version: 6,
      players: [p1, p2],
      holeCards: [['As', 'Ad'], ['Kc', 'Kh']],
      events: [holeEvent(TABLE, T1, 6, 1, p2, ['Kc', 'Kh'], 'PUBLIC')],
    });
    await bus.publish(`table:${TABLE}:events`, msg);
    const upd = await a.waitFor((f) => f.t === 'table_update' && f.version === 6);
    expect(upd.events).toEqual([]);
    const supd = await spec.waitFor((f) => f.t === 'table_update' && f.version === 6);
    expect(supd.events).toEqual([]);
    expect(spec.raw.join('')).not.toMatch(/"(As|Ad|Kc|Kh)"/);
    a.close();
    spec.close();
    backend.publicWatch.clear();
  });

  it('serves the Origin of PUBLIC_BASE_URL', () => {
    expect(ORIGIN).toBe(node.ctx.env.publicBaseUrl);
  });
});
