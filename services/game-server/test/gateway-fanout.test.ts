import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { CardCode, TableEvent } from '@jpb/shared-types';
import { LocalBus } from '../src/bus/local-bus';
import { channels } from '../src/bus/bus';
import type { AdminChannelMessage, PlayerChannelMessage, TableUpdateMessage, TournamentChannelMessage } from '../src/runtime/contracts';
import { TableUpdateFrames } from '../src/gateway/views';
import type { Store } from '../src/persistence/store';
import { TEST_DATABASE_URL } from './helpers/db';
import type { GatewayNode } from './helpers/gateway';
import {
  FakeBackend,
  TestClient,
  actedEvent,
  createGatewayStore,
  holeEvent,
  playerCookie,
  seedAdmin,
  seedPlayer,
  seedTournament,
  self,
  sleep,
  startGatewayNode,
  summary,
  tableUpdate,
  tournamentEvent,
  until,
} from './helpers/gateway';

const RANKS = '23456789TJQKA';
const SUITS = 'cdhs';
const DECK: CardCode[] = [...RANKS].flatMap((r) => [...SUITS].map((s) => `${r}${s}` as CardCode));

interface Scenario {
  holeCards: Array<[CardCode, CardCode] | null>;
  board: CardCode[];
  events: Array<{ kind: 'acted' | 'hole' | 'orphan-private'; who: number }>;
}

/** Random deal over 3 seats: distinct hole cards (or none), a distinct board, and a random event stream. */
const scenarioArb = fc
  .record({
    order: fc.shuffledSubarray(DECK, { minLength: 11, maxLength: 11 }),
    dealt: fc.array(fc.boolean(), { minLength: 3, maxLength: 3 }),
    boardSize: fc.constantFrom(0, 3, 4, 5),
    events: fc.array(fc.record({ kind: fc.constantFrom('acted' as const, 'hole' as const, 'orphan-private' as const), who: fc.integer({ min: 0, max: 2 }) }), { maxLength: 8 }),
  })
  .map(({ order, dealt, boardSize, events }): Scenario => ({
    holeCards: [0, 1, 2].map((i) => (dealt[i] ? ([order[2 * i]!, order[2 * i + 1]!] as [CardCode, CardCode]) : null)),
    board: order.slice(6, 6 + boardSize),
    events,
  }));

function buildMessage(s: Scenario, tableId: string, tournamentId: string, players: string[], version: number): TableUpdateMessage {
  let seq = version * 100;
  const events: TableEvent[] = [];
  for (const e of s.events) {
    const pid = players[e.who]!;
    if (e.kind === 'acted') events.push(actedEvent(tableId, tournamentId, ++seq, e.who, pid));
    else if (e.kind === 'hole' && s.holeCards[e.who]) events.push(holeEvent(tableId, tournamentId, ++seq, e.who, pid, s.holeCards[e.who]!));
    else if (e.kind === 'orphan-private') {
      events.push({ ...actedEvent(tableId, tournamentId, ++seq, e.who, pid), visibility: 'PRIVATE', privateTo: null });
    }
  }
  return tableUpdate({ tableId, tournamentId, version, players, holeCards: s.holeCards, events, board: s.board });
}

const quoted = (c: string) => `"${c}"`;
const tableOf = (f: { snapshot?: unknown }) => (f.snapshot as { table?: { tableId: string; holeCards?: unknown } | null } | undefined)?.table ?? null;
const cardsOf = (s: Scenario, except: number | null) => s.holeCards.flatMap((h, i) => (h && i !== except ? h : []));

/** The privacy invariants for one recipient frame. */
function assertPlayerFrame(raw: string, s: Scenario, me: number, players: string[]) {
  const f = JSON.parse(raw) as { events: TableEvent[]; view: { audience: string; you?: { holeCards: unknown; playerId: string } } };
  for (const c of cardsOf(s, me)) expect(raw).not.toContain(quoted(c));
  for (const e of f.events) expect(e.visibility === 'PUBLIC' || e.privateTo === players[me]).toBe(true);
  expect(f.events.some((e) => e.visibility === 'PRIVATE' && e.privateTo !== players[me])).toBe(false);
  expect(f.view.audience).toBe('PLAYER');
  expect(f.view.you?.playerId).toBe(players[me]);
  expect(f.view.you?.holeCards).toEqual(s.holeCards[me]);
}

function assertPublicFrame(raw: string, s: Scenario) {
  const f = JSON.parse(raw) as { events: TableEvent[]; view: Record<string, unknown> };
  for (const c of cardsOf(s, null)) expect(raw).not.toContain(quoted(c));
  expect(f.events.every((e) => e.visibility === 'PUBLIC' && e.event.kind !== 'HOLE_CARDS_DEALT')).toBe(true);
  expect(f.view.audience).toBe('SPECTATOR');
  expect('you' in f.view).toBe(false);
  expect(raw).not.toContain('holeCardsBySeat');
  expect(raw).not.toContain('privateByPlayer');
}

function assertAdminFrame(raw: string, s: Scenario, revealed: boolean) {
  const f = JSON.parse(raw) as { events: TableEvent[]; view: { audience: string; holeCards: unknown } };
  expect(f.view.audience).toBe('ADMIN');
  if (!revealed) {
    expect(f.view.holeCards).toBeNull();
    for (const c of cardsOf(s, null)) expect(raw).not.toContain(quoted(c));
    expect(f.events.every((e) => e.visibility === 'PUBLIC')).toBe(true);
  } else {
    const expected: Record<string, unknown> = {};
    s.holeCards.forEach((h, i) => h && (expected[i] = h));
    expect(f.view.holeCards).toEqual(expected);
  }
}

describe('TableUpdateFrames (unit, property)', () => {
  const players = ['ply_a', 'ply_b', 'ply_c'];
  it('never leaks hole cards or private events across recipients', () => {
    fc.assert(
      fc.property(scenarioArb, fc.integer({ min: 1, max: 1_000_000 }), (s, version) => {
        const msg = buildMessage(s, 'tbl', 'trn', players, version);
        const frames = new TableUpdateFrames(msg, 123);
        players.forEach((_, i) => assertPlayerFrame(frames.playerFrame(players[i]!), s, i, players));
        assertPublicFrame(frames.spectatorFrame(), s);
        assertAdminFrame(frames.adminFrame(false), s, false);
        assertAdminFrame(frames.adminFrame(true), s, true);
        // A player not seated at the table gets the public projection.
        assertPublicFrame(frames.playerFrame('ply_stranger'), s);
      }),
      { numRuns: 500 },
    );
  });

  it('serializes shared parts once and reuses the same string per audience', () => {
    const msg = tableUpdate({ tableId: 't', tournamentId: 'x', version: 1, players: ['a', 'b'] });
    const frames = new TableUpdateFrames(msg, 1);
    expect(frames.spectatorFrame()).toBe(frames.spectatorFrame());
    expect(frames.adminFrame(false)).toBe(frames.adminFrame(false));
    expect(JSON.parse(frames.playerFrame('a'))).toMatchObject({ t: 'table_update', st: 1, view: { audience: 'PLAYER', you: { playerId: 'a' } } });
  });
});

describe.skipIf(!TEST_DATABASE_URL)('gateway fan-out over real sockets', () => {
  let store: Store;
  let node: GatewayNode;
  const backend = new FakeBackend();
  const bus = new LocalBus();
  let T: string;
  let players: string[];
  let cookies: string[];
  let adminR: Awaited<ReturnType<typeof seedAdmin>>;
  let adminN: Awaited<ReturnType<typeof seedAdmin>>;
  let staff: Awaited<ReturnType<typeof seedAdmin>>;
  const TABLE = 'tbl_fan_1';
  const TABLE_B = 'tbl_fan_2';
  let version = 10;

  beforeAll(async () => {
    store = await createGatewayStore('gwfan');
    node = await startGatewayNode({ store, backend, bus });
    T = await seedTournament(store);
    players = [await seedPlayer(store, T), await seedPlayer(store, T), await seedPlayer(store, T)];
    cookies = await Promise.all(players.map((p) => playerCookie(node.ctx.sessions, p, T)));
    adminR = await seedAdmin(store, node.ctx.sessions, 'SUPER_ADMIN');
    adminN = await seedAdmin(store, node.ctx.sessions, 'SUPER_ADMIN');
    staff = await seedAdmin(store, node.ctx.sessions, 'STAFF');
    backend.summaries.set(T, summary(T));
    players.forEach((p, i) => backend.selves.set(p, self(p, TABLE, { seat: i })));
    backend.featured.set(T, TABLE);
    backend.publicWatch.add(T);
    backend.displays.add(T);
    backend.tables.set(TABLE, tableUpdate({ tableId: TABLE, tournamentId: T, version, players, holeCards: [['2c', '2d'], ['3c', '3d'], null] }));
    backend.tables.set(TABLE_B, tableUpdate({ tableId: TABLE_B, tournamentId: T, version: 1, players: [players[0]!] }));
  });
  afterAll(async () => {
    await node?.close();
    await bus.close();
    await store?.close();
  });

  async function adminWatching(cookie: string): Promise<TestClient> {
    const c = await TestClient.connect(node.url, { audience: 'ADMIN', tournamentId: T }, { cookie });
    c.send({ t: 'watch', tableId: TABLE });
    await c.waitFor((f) => f.t === 'snapshot' && (f.snapshot as { table: unknown }).table !== null);
    return c;
  }

  it('PRIVACY: for random table updates no recipient ever receives data it must not see', async () => {
    const pcs = await Promise.all(cookies.map((cookie) => TestClient.connect(node.url, { audience: 'PLAYER', tournamentId: T }, { cookie })));
    const spectator = await TestClient.connect(node.url, { audience: 'SPECTATOR', tournamentId: T });
    const display = await TestClient.connect(node.url, { audience: 'DISPLAY', tournamentId: T });
    const revealed = await adminWatching(adminR.cookie);
    const plain = await adminWatching(adminN.cookie);
    const staffC = await adminWatching(staff.cookie);

    // Admin snapshots before any reveal carry no hole cards.
    expect(revealed.of('snapshot').at(-1)!.snapshot).toMatchObject({ table: { holeCards: null } });
    expect(node.gateway.revealHoleCards({ tableId: TABLE, adminId: staff.adminId })).toBe(0); // STAFF lacks VIEW_HOLE_CARDS
    expect(node.gateway.revealHoleCards({ tableId: TABLE, adminId: adminR.adminId })).toBe(1);
    const shown = await revealed.waitFor((f) => f.t === 'snapshot' && !!tableOf(f) && tableOf(f)!.holeCards !== null);
    expect(shown.snapshot).toMatchObject({ table: { holeCards: { 0: ['2c', '2d'], 1: ['3c', '3d'] } } });

    const all = [...pcs, spectator, display, revealed, plain, staffC];
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (s) => {
        const v = ++version;
        const msg = buildMessage(s, TABLE, T, players, v);
        await bus.publish(channels.tableEvents(TABLE), msg);
        const rawFor = async (c: TestClient) => {
          await c.waitFor((f) => f.t === 'table_update' && f.version === v);
          return c.raw[c.frames.findIndex((f) => f.t === 'table_update' && f.version === v)]!;
        };
        const raws = await Promise.all(all.map(rawFor));
        pcs.forEach((_, i) => assertPlayerFrame(raws[i]!, s, i, players));
        assertPublicFrame(raws[3]!, s);
        assertPublicFrame(raws[4]!, s);
        assertAdminFrame(raws[5]!, s, true);
        assertAdminFrame(raws[6]!, s, false);
        assertAdminFrame(raws[7]!, s, false);
      }),
      { numRuns: 40 },
    );
    // Player observers (second device) receive the same private data as the controller, nothing more.
    const observer = await TestClient.connect(node.url, { audience: 'PLAYER', tournamentId: T }, { cookie: cookies[0] });
    expect(observer.of('another_device')).toHaveLength(1);
    const s: Scenario = { holeCards: [['Ah', 'Ac'], ['Kh', 'Kc'], null], board: [], events: [{ kind: 'hole', who: 0 }, { kind: 'hole', who: 1 }] };
    const v = ++version;
    await bus.publish(channels.tableEvents(TABLE), buildMessage(s, TABLE, T, players, v));
    await observer.waitFor((f) => f.t === 'table_update' && f.version === v);
    assertPlayerFrame(observer.raw[observer.frames.findIndex((f) => f.t === 'table_update' && f.version === v)]!, s, 0, players);

    // Watching another table ends the reveal; it does not carry over.
    revealed.send({ t: 'watch', tableId: TABLE_B });
    await revealed.waitFor((f) => f.t === 'snapshot' && (f.snapshot as { table: { tableId: string } | null }).table?.tableId === TABLE_B);
    const before = revealed.of('snapshot').length;
    revealed.send({ t: 'watch', tableId: TABLE });
    await until(() => revealed.of('snapshot').length > before, 2_000, 'snapshot after re-watch');
    expect(tableOf(revealed.of('snapshot')[before]!)).toMatchObject({ tableId: TABLE, holeCards: null });
    for (const c of [...all, observer]) c.close();
  });

  it('one bus subscription per channel per node, released when the last watcher leaves', async () => {
    const ch = channels.tableEvents(TABLE_B);
    const watchers = await Promise.all([0, 1, 2].map(() => TestClient.connect(node.url, { audience: 'SPECTATOR', tournamentId: T })));
    for (const w of watchers) w.send({ t: 'watch', tableId: TABLE_B });
    await Promise.all(watchers.map((w) => w.waitFor((f) => f.t === 'snapshot' && (f.snapshot as { table: { tableId: string } | null }).table?.tableId === TABLE_B)));
    expect(bus.subscriberCount(ch)).toBe(1);
    watchers[0]!.close();
    watchers[1]!.send({ t: 'watch', tableId: null });
    await watchers[1]!.waitFor((f) => f.t === 'snapshot' && (f.snapshot as { table: unknown }).table === null);
    expect(bus.subscriberCount(ch)).toBe(1);
    watchers[2]!.close();
    await until(() => bus.subscriberCount(ch) === 0, 2_000, 'unsubscribe');
    watchers[1]!.close();
  });

  it('watch: only tables of the same tournament', async () => {
    const other = await seedTournament(store);
    backend.tables.set('tbl_foreign', tableUpdate({ tableId: 'tbl_foreign', tournamentId: other, version: 1, players: ['zz'] }));
    for (const c of [await TestClient.connect(node.url, { audience: 'SPECTATOR', tournamentId: T }), await TestClient.connect(node.url, { audience: 'ADMIN', tournamentId: T }, { cookie: adminN.cookie })]) {
      c.send({ t: 'watch', tableId: 'tbl_foreign' });
      expect(await c.waitFor((f) => f.t === 'error')).toMatchObject({ code: 'TABLE_NOT_FOUND' });
      c.send({ t: 'watch', tableId: 'tbl_missing' });
      await c.waitFor((f) => f.t === 'error' && c.of('error').length === 2);
      c.close();
    }
    const p = await TestClient.connect(node.url, { audience: 'PLAYER', tournamentId: T }, { cookie: cookies[2] });
    p.send({ t: 'watch', tableId: TABLE_B });
    expect(await p.waitFor((f) => f.t === 'error')).toMatchObject({ code: 'WATCH_NOT_ALLOWED' });
    p.close();
  });

  it('reveal can arrive through the admin channel (from any node)', async () => {
    const c = await adminWatching(adminR.cookie);
    await bus.publish(channels.admin(T), { kind: 'HOLE_CARDS_REVEALED', tableId: TABLE, adminId: adminR.adminId, sessionId: 'ses_other' } satisfies AdminChannelMessage);
    await sleep(100);
    expect(c.of('snapshot').every((f) => (tableOf(f)?.holeCards ?? null) === null)).toBe(true);
    await bus.publish(channels.admin(T), { kind: 'HOLE_CARDS_REVEALED', tableId: TABLE, adminId: adminR.adminId, sessionId: adminR.sessionId } satisfies AdminChannelMessage);
    await c.waitFor((f) => f.t === 'snapshot' && !!tableOf(f) && tableOf(f)!.holeCards !== null);
    c.close();
  });

  it('SELF_UPDATE moves a player to the new table with a fresh snapshot', async () => {
    const p = await TestClient.connect(node.url, { audience: 'PLAYER', tournamentId: T }, { cookie: cookies[1] });
    const moved = self(players[1]!, TABLE_B, { seat: 3 });
    backend.selves.set(players[1]!, moved);
    backend.tables.set(TABLE_B, tableUpdate({ tableId: TABLE_B, tournamentId: T, version: 2, players: [players[0]!, players[1]!], holeCards: [null, ['9s', '9h']] }));
    await bus.publish(channels.player(players[1]!), { kind: 'SELF_UPDATE', self: moved } satisfies PlayerChannelMessage);
    await p.waitFor((f) => f.t === 'self_update');
    const snap = (await p.waitFor((f) => f.t === 'snapshot' && (f.snapshot as { table: { tableId: string } | null }).table?.tableId === TABLE_B)).snapshot as {
      table: { you: { holeCards: unknown } };
    };
    expect(snap.table.you.holeCards).toEqual(['9s', '9h']);
    const t = p.frames.map((f) => f.t);
    expect(t.lastIndexOf('self_update')).toBeLessThan(t.lastIndexOf('snapshot'));

    await bus.publish(channels.tableEvents(TABLE), buildMessage({ holeCards: [null, null, null], board: [], events: [] }, TABLE, T, players, ++version));
    await bus.publish(channels.tableEvents(TABLE_B), tableUpdate({ tableId: TABLE_B, tournamentId: T, version: 3, players: [players[0]!, players[1]!] }));
    await p.waitFor((f) => f.t === 'table_update' && f.tableId === TABLE_B && f.version === 3);
    expect(p.of('table_update').filter((f) => f.tableId === TABLE && f.version === version)).toHaveLength(0);

    await bus.publish(channels.player(players[1]!), { kind: 'NOTICE', notice: { kind: 'TABLE_MOVE', fromTableNumber: 1, fromSeat: 1, toTableNumber: 2, toSeat: 3, stack: 10_000 } } satisfies PlayerChannelMessage);
    expect(await p.waitFor((f) => f.t === 'notice')).toMatchObject({ notice: { kind: 'TABLE_MOVE', toSeat: 3 } });
    p.close();
    backend.selves.set(players[1]!, self(players[1]!, TABLE, { seat: 1 }));
  });

  it('tournament events reach every audience; integrity alerts reach admins only', async () => {
    const p = await TestClient.connect(node.url, { audience: 'PLAYER', tournamentId: T }, { cookie: cookies[2] });
    const s = await TestClient.connect(node.url, { audience: 'SPECTATOR', tournamentId: T });
    const a = await TestClient.connect(node.url, { audience: 'ADMIN', tournamentId: T }, { cookie: staff.cookie });
    await bus.publish(channels.tournamentEvents(T), tournamentEvent(T, 1001, 'Level up soon'));
    const alert = tournamentEvent(T, 1002);
    alert.envelope.event = { kind: 'INTEGRITY_ALERT', severity: 'CRITICAL', code: 'CHIPS', detail: 'internal detail', tableId: TABLE };
    await bus.publish(channels.tournamentEvents(T), alert satisfies TournamentChannelMessage);
    await bus.publish(channels.tournamentEvents(T), tournamentEvent(T, 1003));
    for (const c of [p, s, a]) await c.waitFor((f) => f.t === 'tournament_event' && (f.event as { seq: number }).seq === 1003);
    expect(a.of('tournament_event').map((f) => f.event.seq)).toEqual([1001, 1002, 1003]);
    for (const c of [p, s]) {
      expect(c.of('tournament_event').map((f) => f.event.seq)).toEqual([1001, 1003]);
      expect(c.raw.join('')).not.toContain('internal detail');
    }
    // Stale (already covered by the snapshot / duplicated) tournament events are dropped.
    await bus.publish(channels.tournamentEvents(T), tournamentEvent(T, 1001));
    await bus.publish(channels.tournamentEvents(T), tournamentEvent(T, 1004));
    await p.waitFor((f) => f.t === 'tournament_event' && f.event.seq === 1004);
    expect(p.of('tournament_event').filter((f) => f.event.seq === 1001)).toHaveLength(1);
    for (const c of [p, s, a]) c.close();
  });

  it('DISPLAY follows featured-table changes', async () => {
    const d = await TestClient.connect(node.url, { audience: 'DISPLAY', tournamentId: T });
    backend.featured.set(T, TABLE_B);
    await bus.publish(channels.tournamentEvents(T), { kind: 'DISPLAY_FEATURED_CHANGED', tournamentId: T, tableId: TABLE_B } satisfies TournamentChannelMessage);
    const snap = await d.waitFor((f) => f.t === 'snapshot' && (f.snapshot as { featured: { tableId: string } | null }).featured?.tableId === TABLE_B);
    expect(snap.snapshot).toMatchObject({ audience: 'DISPLAY' });
    backend.featured.set(T, TABLE);
    d.close();
  });

  it('snapshot_request returns a fresh snapshot and is rate limited', async () => {
    const p = await TestClient.connect(node.url, { audience: 'PLAYER', tournamentId: T }, { cookie: cookies[2] });
    for (let i = 0; i < 6; i++) p.send({ t: 'snapshot_request' });
    await p.waitFor((f) => f.t === 'error' && f.code === 'RATE_LIMITED');
    await until(() => p.of('snapshot').length >= 4, 2_000, 'snapshots');
    await sleep(100);
    expect(p.of('snapshot')).toHaveLength(1 + node.gateway.options.limits.snapshot.capacity);
    p.close();
  });
});

describe.skipIf(!TEST_DATABASE_URL)('spectator delay', () => {
  let store: Store;
  let node: GatewayNode;
  const backend = new FakeBackend();
  const bus = new LocalBus();
  let T: string;
  let player: string;
  let cookie: string;
  const TABLE = 'tbl_delay_1';
  const DELAY = 400;

  beforeAll(async () => {
    store = await createGatewayStore('gwdelay');
    node = await startGatewayNode({ store, backend, bus });
    T = await seedTournament(store);
    player = await seedPlayer(store, T);
    cookie = await playerCookie(node.ctx.sessions, player, T);
    backend.summaries.set(T, summary(T));
    backend.selves.set(player, self(player, TABLE));
    backend.featured.set(T, TABLE);
    backend.publicWatch.add(T);
    backend.displays.add(T);
    backend.delays.set(T, DELAY);
    backend.tables.set(TABLE, tableUpdate({ tableId: TABLE, tournamentId: T, version: 1, players: [player] }));
  });
  afterAll(async () => {
    await node?.close();
    await bus.close();
    await store?.close();
  });

  it('delays spectator/display frames by the configured delay and preserves their order; players are live', async () => {
    const p = await TestClient.connect(node.url, { audience: 'PLAYER', tournamentId: T }, { cookie });
    const s = await TestClient.connect(node.url, { audience: 'SPECTATOR', tournamentId: T });
    const d = await TestClient.connect(node.url, { audience: 'DISPLAY', tournamentId: T });
    // With a delay and nothing released yet, the spectator snapshot shows no live table...
    expect(s.of('snapshot')[0]!.snapshot).toMatchObject({ table: null });
    expect(d.of('snapshot')[0]!.snapshot).toMatchObject({ featured: null });
    // ...and the table arrives after the delay.
    const snapAt = Date.now();
    await s.waitFor((f) => f.t === 'table_update' && f.version === 1, 2_000);
    expect(Date.now() - snapAt).toBeGreaterThanOrEqual(DELAY - 100);

    const t0 = Date.now();
    await bus.publish(channels.tableEvents(TABLE), tableUpdate({ tableId: TABLE, tournamentId: T, version: 2, players: [player] }));
    await bus.publish(channels.tournamentEvents(T), tournamentEvent(T, 1));
    await bus.publish(channels.tableEvents(TABLE), tableUpdate({ tableId: TABLE, tournamentId: T, version: 3, players: [player] }));
    await p.waitFor((f) => f.t === 'table_update' && f.version === 3);
    expect(Date.now() - t0).toBeLessThan(DELAY / 2);
    expect(s.frames.some((f) => f.t === 'table_update' && f.version === 2)).toBe(false);

    for (const c of [s, d]) {
      await c.waitFor((f) => f.t === 'table_update' && f.version === 3, 2_000);
      const seqOf = (f: (typeof c.frames)[number]) => (f.t === 'table_update' ? `u${f.version}` : f.t === 'tournament_event' ? `e${f.event.seq}` : f.t);
      const relevant = c.frames.map((f, i) => ({ f, at: c.arrivals[i]! })).filter(({ f }) => (f.t === 'table_update' && (f.version as number) >= 2) || f.t === 'tournament_event');
      expect(relevant.map(({ f }) => seqOf(f))).toEqual(['u2', 'e1', 'u3']);
      for (const { at } of relevant) expect(at - t0).toBeGreaterThanOrEqual(DELAY - 50);
    }
    // A spectator joining now gets the last RELEASED state (version 3), not anything newer.
    await bus.publish(channels.tableEvents(TABLE), tableUpdate({ tableId: TABLE, tournamentId: T, version: 4, players: [player] }));
    const late = await TestClient.connect(node.url, { audience: 'SPECTATOR', tournamentId: T });
    expect(late.of('snapshot')[0]!.snapshot).toMatchObject({ table: { version: 3 } });
    await late.waitFor((f) => f.t === 'table_update' && f.version === 4, 2_000);
    for (const c of [p, s, d, late]) c.close();
  });

  it('zero delay delivers immediately', async () => {
    backend.delays.set(T, 0);
    const T0 = await seedTournament(store);
    backend.summaries.set(T0, summary(T0));
    backend.publicWatch.add(T0);
    backend.featured.set(T0, 'tbl_zero');
    backend.tables.set('tbl_zero', tableUpdate({ tableId: 'tbl_zero', tournamentId: T0, version: 1, players: ['x'] }));
    const s = await TestClient.connect(node.url, { audience: 'SPECTATOR', tournamentId: T0 });
    expect(s.of('snapshot')[0]!.snapshot).toMatchObject({ table: { version: 1 } });
    const t0 = Date.now();
    await bus.publish(channels.tableEvents('tbl_zero'), tableUpdate({ tableId: 'tbl_zero', tournamentId: T0, version: 2, players: ['x'] }));
    await s.waitFor((f) => f.t === 'table_update' && f.version === 2);
    expect(Date.now() - t0).toBeLessThan(150);
    s.close();
  });
});
