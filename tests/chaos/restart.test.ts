import { describe, expect, it } from 'vitest';
import type { TournamentOverviewDto, TournamentPublicSummary } from '@jpb/shared-types';
import { Database } from '../../services/game-server/src/persistence/db';
import { buildServer } from '../../services/game-server/src/server';
import type { JpbServer } from '../../services/game-server/src/server';
import { TEST_DATABASE_URL } from '../../services/game-server/test/helpers/db';
import { Http } from '../../services/game-server/test/helpers/client';
import { ADMIN, ORIGIN, ResilientBot, chaosEnv, isolatedDatabase, setupTournament, waitFor, wsUrlOf } from './helpers';

describe.skipIf(!TEST_DATABASE_URL)('chaos: crashes and database outages on a single node', () => {
  it('a crashed process restarted on the same database resumes and finishes the tournament', async () => {
    const iso = await isolatedDatabase('chaos_restart');
    const servers: JpbServer[] = [];
    const bots: ResilientBot[] = [];
    try {
      const opts = { db: iso.db, runtimeOverrides: { verifyOnRecovery: true, rebalanceIntervalMs: 300 }, monitorEveryMs: 1000 };
      let current = await buildServer(chaosEnv('chaos-r1'), opts);
      servers.push(current);
      let base = await current.listen();
      const { admin, tournament, https } = await setupTournament([base], 18, 'CHAOSRS');
      for (const http of https) bots.push(new ResilientBot(http, tournament.id, () => wsUrlOf(base)));
      await Promise.all(bots.map((b) => b.start()));
      await admin.ok('POST', `/api/admin/tournaments/${tournament.id}/start`, {});
      const summary = () => new Http(base, ORIGIN).ok<TournamentPublicSummary>('GET', `/api/public/tournaments/${tournament.joinCode}/summary`);

      for (let round = 0; round < 2; round++) {
        const target = (await summary()).counters.handsCompleted + 4;
        await waitFor(async () => (await summary()).counters.handsCompleted >= target || (await summary()).status === 'COMPLETED', 120_000, 100, 'hands before crash');
        if ((await summary()).status === 'COMPLETED') break;
        await current.crash();
        current = await buildServer(chaosEnv(`chaos-r${round + 2}`), { ...opts, skipMigrations: true });
        servers.push(current);
        base = await current.listen();
        // Clients follow the restarted node (same origin in a real deployment).
        for (const http of [...https, admin]) Object.assign(http, { base });
      }
      await waitFor(async () => (await summary()).status === 'COMPLETED', 240_000, 250, 'completion');
      const a2 = new Http(base, ORIGIN);
      await a2.ok('POST', '/api/admin/auth/login', ADMIN);
      const overview = await a2.ok<TournamentOverviewDto>('GET', `/api/admin/tournaments/${tournament.id}`);
      expect(overview.chipConservation?.ok).toBe(true);
      expect(current.runtime.node.stats().actors.filter((x) => x.faulted)).toEqual([]);
      const alerts = await a2.ok<{ alerts: Array<{ code: string }> }>('GET', `/api/admin/alerts?tournamentId=${tournament.id}`);
      expect(alerts.alerts.filter((x) => x.code !== 'TABLE_STALLED')).toEqual([]);
    } finally {
      for (const b of bots) b.stop();
      for (const s of servers) await s.close().catch(() => undefined);
      await iso.close();
    }
  }, 300_000);

  it('PostgreSQL connections killed repeatedly mid-play: commands retry or reconcile, nothing is lost', async () => {
    const iso = await isolatedDatabase('chaos_dbkill');
    const bots: ResilientBot[] = [];
    let server: JpbServer | null = null;
    try {
      server = await buildServer(chaosEnv('chaos-db'), { db: iso.db, runtimeOverrides: { verifyOnRecovery: true }, monitorEveryMs: 1000 });
      const base = await server.listen();
      const { admin, tournament, https } = await setupTournament([base], 18, 'CHAOSDB');
      for (const http of https) bots.push(new ResilientBot(http, tournament.id, () => wsUrlOf(base)));
      await Promise.all(bots.map((b) => b.start()));
      await admin.ok('POST', `/api/admin/tournaments/${tournament.id}/start`, {});
      const killer = new Database(TEST_DATABASE_URL!, 1);
      const summary = () => new Http(base, ORIGIN).req<TournamentPublicSummary>('GET', `/api/public/tournaments/${tournament.joinCode}/summary`);
      let kills = 0;
      for (let i = 0; i < 4; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const r = await killer.query<{ n: number }>(
          `SELECT count(pg_terminate_backend(pid))::int AS n FROM pg_stat_activity WHERE application_name = $1 AND pid <> pg_backend_pid()`,
          [iso.appName],
        );
        kills += r.rows[0]?.n ?? 0;
      }
      await killer.close();
      expect(kills).toBeGreaterThan(0);
      await waitFor(async () => (await summary()).body.status === 'COMPLETED', 240_000, 250, 'completion');
      await admin.ok('POST', '/api/admin/auth/login', ADMIN).catch(() => undefined);
      const overview = await admin.ok<TournamentOverviewDto>('GET', `/api/admin/tournaments/${tournament.id}`);
      expect(overview.chipConservation?.ok).toBe(true);
      expect(server.runtime.node.stats().actors.filter((x) => x.faulted)).toEqual([]);
      const alerts = await admin.ok<{ alerts: Array<{ code: string }> }>('GET', `/api/admin/alerts?tournamentId=${tournament.id}`);
      expect(alerts.alerts.filter((x) => x.code !== 'TABLE_STALLED')).toEqual([]);
    } finally {
      for (const b of bots) b.stop();
      await server?.close().catch(() => undefined);
      await iso.close();
    }
  }, 300_000);
});
