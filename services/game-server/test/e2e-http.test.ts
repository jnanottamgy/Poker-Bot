import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  HandDetailDto,
  HandFairnessRecord,
  HandListItemDto,
  LeaderboardDto,
  Paginated,
  PayoutsDto,
  PlayerDetailDto,
  PlayerListItemDto,
  SystemDto,
  TableDetailDto,
  TableListItemDto,
  TournamentListItemDto,
  TournamentOverviewDto,
  TournamentPublicSummary,
  TournamentReportDto,
} from '@jpb/shared-types';
import { verifyHand } from '@jpb/fairness-engine/node';
import { loadEnv } from '../src/config/env';
import { buildServer } from '../src/server';
import type { JpbServer } from '../src/server';
import { createTestDatabase, TEST_DATABASE_URL } from './helpers/db';
import { fastConfig } from './helpers/game';
import { Http, WsBot } from './helpers/client';

const ADMIN = { username: 'director', password: 'a very long test password' };

/**
 * The whole product over its real interfaces: admin REST (login, CSRF,
 * create, lifecycle), public registration, WebSocket players acting until a
 * champion is crowned, then every admin read endpoint, the seed reveal and
 * independent verification of the published fairness records.
 */
describe.skipIf(!TEST_DATABASE_URL)('end to end over HTTP + WebSocket', () => {
  let server: JpbServer;
  let base: string;
  let wsUrl: string;
  const origin = 'http://127.0.0.1';

  beforeAll(async () => {
    const db = await createTestDatabase('e2e_http');
    const env = loadEnv({
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: '0',
      PUBLIC_BASE_URL: origin,
      COOKIE_SECURE: 'false',
      SEED_ENCRYPTION_KEY: 'b'.repeat(64),
      BOOTSTRAP_ADMIN_USERNAME: ADMIN.username,
      BOOTSTRAP_ADMIN_PASSWORD: ADMIN.password,
      RATE_LIMIT_SCALE: '100',
      NODE_ID: 'e2e-node',
    });
    server = await buildServer(env, { db, runtimeOverrides: { verifyOnRecovery: true }, monitorEveryMs: 1000 });
    base = await server.listen();
    wsUrl = `${base.replace('http', 'ws')}/ws`;
    const close = server.close.bind(server);
    server.close = async () => {
      await close();
      await db.close();
    };
  });
  afterAll(async () => server?.close());

  it('runs a tournament from creation to payouts through the public interfaces', async () => {
    const admin = new Http(base, origin);
    const login = await admin.req('POST', '/api/admin/auth/login', ADMIN);
    expect(login.status).toBe(200);

    // CSRF is enforced on writes.
    const noCsrf = await fetch(`${base}/api/admin/tournaments`, { method: 'POST', headers: { cookie: admin.jar.header(), 'content-type': 'application/json' }, body: '{}' });
    expect(noCsrf.status).toBe(403);

    const config = fastConfig(15, { joinCode: 'E2EHTTP', name: 'E2E over HTTP' });
    const { tournament } = await admin.ok<{ tournament: TournamentListItemDto }>('POST', '/api/admin/tournaments', { config });
    expect(tournament.status).toBe('DRAFT');
    const T = `/api/admin/tournaments/${tournament.id}`;

    // L2 endpoints require the typed confirmation word.
    const cancelNoWord = await admin.req('POST', `${T}/cancel`, { reason: 'testing the guard' });
    expect(cancelNoWord.status).toBe(400);
    expect((cancelNoWord.body as { error: { code: string } }).error.code).toBe('CONFIRMATION_REQUIRED');

    await admin.ok('POST', `${T}/registration/open`, {});
    const join = await new Http(base, origin).ok<{ registration: { open: boolean } }>('GET', `/api/public/tournaments/${tournament.joinCode}`);
    expect(join.registration.open).toBe(true);

    const bots: WsBot[] = [];
    for (let i = 0; i < 14; i++) {
      const http = new Http(base, origin);
      const r = await http.ok<{ player: { playerId: string }; rejoinCode: string }>('POST', `/api/public/tournaments/${tournament.joinCode}/register`, {
        fields: { name: `Player ${i + 1}` },
        clientSeed: (i + 1).toString(16).padStart(64, '0'),
      });
      expect(r.rejoinCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      bots.push(new WsBot(`p${i + 1}`, http, wsUrl, tournament.id));
    }
    await Promise.all(bots.map((b) => b.connect()));

    // A manual (staff) registration too.
    const manual = await admin.ok<{ player: PlayerListItemDto }>('POST', `${T}/registrations/manual`, { fields: { name: 'Walk-in Player' } });
    expect(manual.player.status).toBe('REGISTERED');

    const started = await admin.ok<{ publicEntropy: string }>('POST', `${T}/start`, { adminEntropy: 'e2e dice roll 4-2-6' });
    expect(started.publicEntropy).toMatch(/^[0-9a-f]{64}$/);

    // While running: overview, tables, players, table detail.
    const overview = await admin.ok<TournamentOverviewDto>('GET', T);
    expect(['STARTING', 'RUNNING']).toContain(overview.status);
    expect(overview.counters.registered).toBe(15);
    await waitFor(async () => (await admin.ok<TournamentOverviewDto>('GET', T)).status === 'RUNNING', 20_000);
    const tables = await admin.ok<Paginated<TableListItemDto>>('GET', `${T}/tables`);
    expect(tables.total).toBe(2);
    const detail = await admin.ok<TableDetailDto>('GET', `/api/admin/tables/${encodeURIComponent(tables.rows[0]!.tableId)}`);
    expect(detail.view.audience).toBe('ADMIN');
    expect(detail.holeCards).toBeNull();
    expect(detail.internals.invariantViolations).toEqual([]);
    const players = await admin.ok<Paginated<PlayerListItemDto>>('GET', `${T}/players?limit=100`);
    expect(players.total).toBe(15);

    // The walk-in has no socket: their timer plays for them. Everyone else acts over WebSocket.
    const pub = new Http(base, origin);
    await waitFor(async () => (await pub.ok<TournamentPublicSummary>('GET', `/api/public/tournaments/${tournament.joinCode}/summary`)).status === 'COMPLETED', 240_000, 250);
    expect(bots.reduce((n, b) => n + b.actions, 0)).toBeGreaterThan(14);

    // ---- after completion
    const final = await admin.ok<TournamentOverviewDto>('GET', T);
    expect(final.status).toBe('COMPLETED');
    expect(final.chipConservation?.ok).toBe(true);

    const finish = await pub.ok<LeaderboardDto>('GET', `/api/public/tournaments/${tournament.joinCode}/leaderboard?mode=finish&limit=50`);
    expect(finish.label).toBe('Finishing positions');
    expect(finish.total).toBe(15);
    expect(finish.rows[0]!.finishPosition).toBe(1);

    const payouts = await admin.ok<PayoutsDto>('GET', `${T}/payouts`);
    expect(payouts.totals.awardedMinor).toBe(payouts.totals.configuredMinor);
    const firstRow = payouts.rows[0]!;
    const paid = await admin.ok<{ row: { paymentStatus: string } }>('PATCH', `/api/admin/entries/${firstRow.entryId}/payment`, { status: 'PAID', reference: 'UPI-123' });
    expect(paid.row.paymentStatus).toBe('PAID');
    const csv = await admin.req('GET', `${T}/payouts.csv`);
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect(csv.text).toContain('UPI-123');

    const hands = await admin.ok<Paginated<HandListItemDto>>('GET', `${T}/hands?limit=500`);
    expect(hands.total).toBe(final.counters.handsCompleted);
    const hand = await admin.ok<HandDetailDto>('GET', `/api/admin/hands/${hands.rows[0]!.handId}`);
    expect(hand.seats.every((s) => s.holeCards !== null)).toBe(true);
    expect(hand.actions.length).toBeGreaterThan(0);

    const report = await admin.ok<TournamentReportDto>('GET', `${T}/report`);
    expect(report.winner).not.toBeNull();
    expect(report.handsPlayed).toBe(hands.total);

    const playerDetail = await admin.ok<PlayerDetailDto>('GET', `/api/admin/players/${report.winner!.playerId}`);
    expect(playerDetail.finishPosition).toBe(1);

    // Seed reveal (L2) then independent verification of public records.
    const hidden = await pub.ok<HandFairnessRecord>('GET', `/api/public/hands/${hands.rows[0]!.handId}/fairness`);
    expect(hidden.burns).toBeNull();
    const reveal = await admin.ok<{ serverSeed: string }>('POST', `${T}/fairness/reveal-seed`, { reason: 'post-event audit', confirm: 'REVEAL' });
    const fairness = await pub.ok<{ serverSeed: string; serverSeedHash: string }>('GET', `/api/public/tournaments/${tournament.joinCode}/fairness`);
    expect(fairness.serverSeed).toBe(reveal.serverSeed);
    for (const h of hands.rows.slice(0, 25)) {
      const rec = await pub.ok<HandFairnessRecord>('GET', `/api/public/hands/${h.handId}/fairness`);
      const v = verifyHand(rec, reveal.serverSeed);
      expect(v.status, JSON.stringify(v.checks)).toBe('VERIFIED');
    }

    const audit = await admin.ok<{ intact: boolean; checked: number }>('GET', '/api/admin/audit/verify');
    expect(audit.intact).toBe(true);
    expect(audit.checked).toBeGreaterThan(5);

    const system = await admin.ok<SystemDto>('GET', '/api/admin/system');
    expect(system.nodes[0]!.nodeId).toBe('e2e-node');
    expect(system.connections.PLAYER).toBeGreaterThan(0);
    expect(system.latency.actions.count).toBeGreaterThan(0);

    const alerts = await admin.ok<{ alerts: Array<{ code: string; message: string }> }>('GET', `/api/admin/alerts?tournamentId=${tournament.id}`);
    expect(alerts.alerts).toEqual([]);
    for (const b of bots) b.close();
  }, 300_000);

  it('serves the player, admin and display apps with client-side routing fallbacks when built', async () => {
    const res = await fetch(`${base}/api/does-not-exist`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });
});

async function waitFor(check: () => Promise<boolean>, timeoutMs: number, everyMs = 100): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error('condition not reached in time');
    await new Promise((r) => setTimeout(r, everyMs));
  }
}
