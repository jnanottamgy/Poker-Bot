import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CardCode } from '@jpb/shared-types';
import { LocalBus } from '../src/bus/local-bus';
import { channels } from '../src/bus/bus';
import { CLOSE_CODES } from '../src/gateway/options';
import type { Store } from '../src/persistence/store';
import { TEST_DATABASE_URL } from './helpers/db';
import type { GatewayNode } from './helpers/gateway';
import {
  FakeBackend,
  TestClient,
  createGatewayStore,
  seedAdmin,
  seedTournament,
  sleep,
  startGatewayNode,
  summary,
  tableUpdate,
  tournamentEvent,
  until,
} from './helpers/gateway';

/**
 * Adversarial review of the gateway's privacy rules: spectator delay,
 * spectator/display policy, admin hole-card reveals. Tests named "BUG:" fail
 * on the current implementation and document a real defect.
 */

/** FakeBackend whose tableSnapshot can be held open per table (to widen race windows). */
class GatedBackend extends FakeBackend {
  readonly gates = new Map<string, Promise<void>>();
  override async tableSnapshot(id: string) {
    const gate = this.gates.get(id);
    if (gate) await gate;
    return super.tableSnapshot(id);
  }
}

const quoted = (c: string) => `"${c}"`;
type Snap = { tournament: { lastSeq: number }; table?: { tableId: string; version: number; holeCards?: unknown } | null };
const snapOf = (f: { snapshot?: unknown }) => f.snapshot as Snap;

describe.skipIf(!TEST_DATABASE_URL)('review: spectator delay, display policy, admin reveal', () => {
  let store: Store;
  let node: GatewayNode;
  const backend = new GatedBackend();
  const bus = new LocalBus();
  const DELAY = 400;
  let T: string;
  const TABLE = 'tbl_rvp_a';
  const TABLE_B = 'tbl_rvp_b';
  const players = ['rvp_p0', 'rvp_p1'];
  const HOLE: Array<[CardCode, CardCode]> = [
    ['Ah', 'Kd'],
    ['7c', '7s'],
  ];
  let version = 1;

  beforeAll(async () => {
    store = await createGatewayStore('rvgwpriv');
    node = await startGatewayNode({ store, backend, bus });
    T = await seedTournament(store);
    backend.summaries.set(T, summary(T, 0));
    backend.publicWatch.add(T);
    backend.displays.add(T);
    backend.featured.set(T, TABLE);
    backend.delays.set(T, DELAY);
    backend.tables.set(TABLE, tableUpdate({ tableId: TABLE, tournamentId: T, version, players, holeCards: HOLE }));
    backend.tables.set(TABLE_B, tableUpdate({ tableId: TABLE_B, tournamentId: T, version: 1, players: ['rvp_p9'] }));
  });
  afterAll(async () => {
    await node?.close();
    await bus.close();
    await store?.close();
  });

  async function spectatorWithReleasedTable(): Promise<TestClient> {
    const s = await TestClient.connect(node.url, { audience: 'SPECTATOR', tournamentId: T });
    await s.waitFor((f) => f.t === 'table_update' || (f.t === 'snapshot' && !!snapOf(f).table), 2_000);
    return s;
  }

  it('BUG: a spectator snapshot carries the LIVE tournament summary, bypassing the spectator delay', async () => {
    const s = await spectatorWithReleasedTable();
    // Something just happened (e.g. an elimination). Players see it live; spectators only after DELAY.
    backend.summaries.set(T, summary(T, 7));
    await bus.publish(channels.tournamentEvents(T), tournamentEvent(T, 7));
    const before = s.of('snapshot').length;
    s.send({ t: 'snapshot_request' });
    await until(() => s.of('snapshot').length > before, 300, 'snapshot');
    const snap = s.of('snapshot')[before]!;
    // Nothing about seq 7 may reach a spectator before the delay has elapsed.
    expect(s.of('tournament_event')).toHaveLength(0);
    expect(snapOf(snap).tournament.lastSeq).toBeLessThan(7);
    s.close();
  });

  it('BUG: a spectator that switches tables (or re-snapshots) loses the tournament events still in the delay line', async () => {
    const s = await spectatorWithReleasedTable();
    const control = await spectatorWithReleasedTable(); // does not re-snapshot
    backend.summaries.set(T, summary(T, 8));
    await bus.publish(channels.tournamentEvents(T), tournamentEvent(T, 8, 'Player X eliminated'));
    const before = s.of('snapshot').length;
    s.send({ t: 'watch', tableId: TABLE_B });
    await until(() => s.of('snapshot').length > before, 1_000, 'snapshot after watch');
    await sleep(DELAY + 300);
    // The event is released through the delay line after the snapshot was sent, but the snapshot's LIVE
    // lastSeq became the baseline, so the delayed event is discarded as "already covered".
    expect(control.of('tournament_event').map((f) => f.event.seq)).toContain(8);
    s.close();
    control.close();
    expect(s.of('tournament_event').map((f) => f.event.seq)).toContain(8);
  });

  it('BUG: N spectators arriving on a cold table within the delay window each receive N copies of the same state (O(N^2) frames)', async () => {
    const T2 = await seedTournament(store);
    const COLD = 'tbl_rvp_cold';
    backend.summaries.set(T2, summary(T2));
    backend.publicWatch.add(T2);
    backend.featured.set(T2, COLD);
    backend.delays.set(T2, 800);
    backend.tables.set(COLD, tableUpdate({ tableId: COLD, tournamentId: T2, version: 5, players: ['cold_p'] }));
    const N = 20;
    const watchers = await Promise.all(Array.from({ length: N }, () => TestClient.connect(node.url, { audience: 'SPECTATOR', tournamentId: T2 })));
    for (const w of watchers) expect(snapOf(w.of('snapshot')[0]!).table).toBeNull();
    await Promise.all(watchers.map((w) => w.waitFor((f) => f.t === 'table_update' && f.tableId === COLD, 3_000)));
    await sleep(300);
    const counts = watchers.map((w) => w.of('table_update').filter((f) => f.tableId === COLD && f.version === 5).length);
    // One cold-start state per spectator is enough; every extra copy is pure amplification
    // (the README's "final table + thousands of phones" surge turns into millions of frames).
    expect(Math.max(...counts)).toBeLessThanOrEqual(1);
    for (const w of watchers) w.close();
  });

  it('BUG: an anonymous client can follow the featured table as DISPLAY although the tournament does not allow public watching', async () => {
    const T3 = await seedTournament(store);
    const FEAT = 'tbl_rvp_disp';
    backend.summaries.set(T3, summary(T3));
    backend.displays.add(T3); // broadcast display enabled, public watch NOT enabled
    backend.featured.set(T3, FEAT);
    backend.tables.set(FEAT, tableUpdate({ tableId: FEAT, tournamentId: T3, version: 2, players: ['disp_p'] }));
    // The same anonymous client is (correctly) refused as a spectator...
    const s = await TestClient.connect(node.url, { audience: 'SPECTATOR', tournamentId: T3 });
    expect((await s.waitClose()).code).toBe(CLOSE_CODES.FORBIDDEN);
    // ...but simply asking for the DISPLAY audience (no credential at all) yields the live featured table.
    const d = await TestClient.connect(node.url, { audience: 'DISPLAY', tournamentId: T3 });
    const featured = (d.of('snapshot')[0]?.snapshot as { featured?: unknown } | undefined)?.featured ?? null;
    d.close();
    expect(featured).toBeNull();
  });

  it('BUG: a revoked admin session keeps receiving live hole cards until the periodic re-check (60 s)', async () => {
    const admin = await seedAdmin(store, node.ctx.sessions, 'SUPER_ADMIN');
    const a = await TestClient.connect(node.url, { audience: 'ADMIN', tournamentId: T }, { cookie: admin.cookie });
    a.send({ t: 'watch', tableId: TABLE });
    await a.waitFor((f) => f.t === 'snapshot' && snapOf(f).table?.tableId === TABLE);
    expect(node.gateway.revealHoleCards({ tableId: TABLE, adminId: admin.adminId, sessionId: admin.sessionId })).toBe(1);
    await a.waitFor((f) => f.t === 'snapshot' && !!snapOf(f).table?.holeCards);

    // The account is compromised / the admin logs out: every session is revoked.
    await node.ctx.sessions.revokeAllForAdmin(admin.adminId, 'compromised');
    await sleep(50);
    const v = ++version;
    await bus.publish(channels.tableEvents(TABLE), tableUpdate({ tableId: TABLE, tournamentId: T, version: v, players, holeCards: [['Qs', 'Jd'], ['2h', '2s']] }));
    await sleep(300);
    const leaked = a.raw.filter((r) => r.includes(quoted('Qs')) || r.includes(quoted('2h')));
    a.close();
    expect(leaked).toHaveLength(0);
  });

  it('reveal stays bound to one admin session: other sessions of the same admin and other admins never get hole cards', async () => {
    const x = await seedAdmin(store, node.ctx.sessions, 'SUPER_ADMIN');
    const x2 = await node.ctx.sessions.issue({ kind: 'ADMIN', adminId: x.adminId, userAgent: 'tab2', ip: '127.0.0.1' });
    const y = await seedAdmin(store, node.ctx.sessions, 'SUPER_ADMIN');
    const open = async (cookie: string) => {
      const c = await TestClient.connect(node.url, { audience: 'ADMIN', tournamentId: T }, { cookie });
      c.send({ t: 'watch', tableId: TABLE });
      await c.waitFor((f) => f.t === 'snapshot' && snapOf(f).table?.tableId === TABLE);
      return c;
    };
    const [revealed, sameAdminOtherSession, otherAdmin] = [await open(x.cookie), await open(`jpb_as=${x2.token}`), await open(y.cookie)];
    expect(node.gateway.revealHoleCards({ tableId: TABLE, adminId: x.adminId, sessionId: x.sessionId })).toBe(1);
    await revealed.waitFor((f) => f.t === 'snapshot' && !!snapOf(f).table?.holeCards);
    const v = ++version;
    await bus.publish(channels.tableEvents(TABLE), tableUpdate({ tableId: TABLE, tournamentId: T, version: v, players, holeCards: [['9d', '8d'], ['4c', '3c']] }));
    for (const c of [revealed, sameAdminOtherSession, otherAdmin]) await c.waitFor((f) => f.t === 'table_update' && f.version === v);
    expect(revealed.raw.some((r) => r.includes(quoted('9d')))).toBe(true);
    for (const c of [sameAdminOtherSession, otherAdmin]) {
      for (const card of ['9d', '8d', '4c', '3c', ...HOLE.flat()]) expect(c.raw.join('')).not.toContain(quoted(card));
    }
    for (const c of [revealed, sameAdminOtherSession, otherAdmin]) c.close();
  });

  it('a reveal racing a table switch neither follows the admin to the new table nor survives a return', async () => {
    const x = await seedAdmin(store, node.ctx.sessions, 'SUPER_ADMIN');
    backend.tables.set(TABLE_B, tableUpdate({ tableId: TABLE_B, tournamentId: T, version: 3, players: ['rvp_p9'], holeCards: [['Tc', 'Td']] }));
    const a = await TestClient.connect(node.url, { audience: 'ADMIN', tournamentId: T }, { cookie: x.cookie });
    a.send({ t: 'watch', tableId: TABLE });
    await a.waitFor((f) => f.t === 'snapshot' && snapOf(f).table?.tableId === TABLE);

    let open!: () => void;
    backend.gates.set(TABLE_B, new Promise<void>((r) => (open = r)));
    a.send({ t: 'watch', tableId: TABLE_B }); // held inside tableBelongsTo(TABLE_B)
    await sleep(50);
    // The audited reveal for TABLE lands while the switch is in flight.
    expect(node.gateway.revealHoleCards({ tableId: TABLE, adminId: x.adminId })).toBe(1);
    backend.gates.delete(TABLE_B);
    open();
    await a.waitFor((f) => f.t === 'snapshot' && snapOf(f).table?.tableId === TABLE_B);
    await sleep(100);
    for (const f of a.of('snapshot').filter((s) => snapOf(s).table?.tableId === TABLE_B)) expect(snapOf(f).table?.holeCards).toBeNull();
    await bus.publish(channels.tableEvents(TABLE_B), tableUpdate({ tableId: TABLE_B, tournamentId: T, version: 4, players: ['rvp_p9'], holeCards: [['5d', '5h']] }));
    await a.waitFor((f) => f.t === 'table_update' && f.tableId === TABLE_B && f.version === 4);
    expect(a.raw.join('')).not.toContain(quoted('5d'));

    const before = a.of('snapshot').length;
    a.send({ t: 'watch', tableId: TABLE });
    await until(() => a.of('snapshot').length > before, 2_000, 'snapshot after return');
    expect(snapOf(a.of('snapshot').at(-1)!).table).toMatchObject({ tableId: TABLE, holeCards: null });
    a.close();
  });
});

describe.skipIf(!TEST_DATABASE_URL)('review: spectator policy is enforced only at hello', () => {
  let store: Store;
  let node: GatewayNode;
  const backend = new FakeBackend();
  const bus = new LocalBus();

  beforeAll(async () => {
    store = await createGatewayStore('rvgwpol');
    // Fast periodic re-validation so the test shows the policy is not re-checked even then.
    node = await startGatewayNode({ store, backend, bus, options: { heartbeatIntervalMs: 100, sessionRecheckMs: 200 } });
  });
  afterAll(async () => {
    await node?.close();
    await bus.close();
    await store?.close();
  });

  it('BUG: turning public watch / the broadcast display off does not disconnect existing anonymous spectators and displays', async () => {
    const T = await seedTournament(store);
    const TABLE = 'tbl_rvp_pol';
    backend.summaries.set(T, summary(T));
    backend.publicWatch.add(T);
    backend.displays.add(T);
    backend.featured.set(T, TABLE);
    backend.tables.set(TABLE, tableUpdate({ tableId: TABLE, tournamentId: T, version: 1, players: ['pol_p'] }));
    const s = await TestClient.connect(node.url, { audience: 'SPECTATOR', tournamentId: T });
    const d = await TestClient.connect(node.url, { audience: 'DISPLAY', tournamentId: T });
    expect(snapOf(s.of('snapshot')[0]!).table).toMatchObject({ tableId: TABLE });

    // The director closes spectating mid-tournament (spectators/features are MUTABLE_WHILE_RUNNING).
    backend.publicWatch.delete(T);
    backend.displays.delete(T);
    await sleep(800); // several heartbeat + re-check cycles
    await bus.publish(channels.tableEvents(TABLE), tableUpdate({ tableId: TABLE, tournamentId: T, version: 2, players: ['pol_p'] }));
    await sleep(200);
    const stillWatching = [s, d].filter((c) => c.of('table_update').some((f) => f.version === 2));
    s.close();
    d.close();
    expect(stillWatching).toHaveLength(0);
  });
});
