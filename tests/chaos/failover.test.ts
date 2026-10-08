import { describe, expect, it } from 'vitest';
import type { TournamentOverviewDto, TournamentPublicSummary } from '@jpb/shared-types';
import { buildServer } from '../../services/game-server/src/server';
import type { JpbServer } from '../../services/game-server/src/server';
import { createTestDatabase, TEST_DATABASE_URL } from '../../services/game-server/test/helpers/db';
import { Http } from '../../services/game-server/test/helpers/client';
import { ADMIN, ORIGIN, ResilientBot, chaosEnv, setupTournament, waitFor, wsUrlOf } from './helpers';

const TEST_REDIS_URL = process.env.TEST_REDIS_URL;

/**
 * Two complete nodes (HTTP + WebSocket gateway + actors) share PostgreSQL and
 * Redis. Mid-tournament the node hosting Johnny dies like a killed process:
 * sockets dropped, no final snapshot, leases left to expire. The survivor must
 * take over the director and every table from the logs, re-arm their timers,
 * deliver the dead node's pending outbox messages, accept the reconnecting
 * players, and finish the tournament with every chip accounted for.
 */
describe.skipIf(!TEST_DATABASE_URL || !TEST_REDIS_URL)('chaos: a node dies mid-tournament', () => {
  it('the surviving node takes over the director and the tables and the tournament completes', async () => {
    const db = await createTestDatabase('chaos_failover');
    const prefix = `jpb:test:chaos:${process.pid}:${Date.now()}:`;
    const common = {
      db,
      redisPrefix: prefix,
      membershipTiming: { heartbeatMs: 150, ttlMs: 700 },
      runtimeOverrides: { leaseTtlMs: 1500, leaseRenewMs: 300, rebalanceIntervalMs: 300, catalogGraceMs: 2000, verifyOnRecovery: true },
      monitorEveryMs: 1000,
    };
    const servers: JpbServer[] = [];
    const bots: ResilientBot[] = [];
    try {
      const a = await buildServer(chaosEnv('chaos-a', { REDIS_URL: TEST_REDIS_URL! }), common);
      servers.push(a);
      const b = await buildServer(chaosEnv('chaos-b', { REDIS_URL: TEST_REDIS_URL! }), { ...common, skipMigrations: true });
      servers.push(b);
      const bases = [await a.listen(), await b.listen()];
      await waitFor(() => a.runtime.node.membership.members().length === 2 && b.runtime.node.membership.members().length === 2, 10_000, 50, 'cluster membership');

      const { admin, tournament, https } = await setupTournament(bases, 24, 'CHAOSFO');
      const dead = new Set<string>();
      const live = (preferred: string) => (dead.has(preferred) ? bases.find((u) => !dead.has(u))! : preferred);
      https.forEach((http, i) => bots.push(new ResilientBot(http, tournament.id, () => wsUrlOf(live(bases[i % 2]!)))));
      await Promise.all(bots.map((bot) => bot.start()));
      await admin.ok('POST', `/api/admin/tournaments/${tournament.id}/start`, {});

      const pub = (base: string) => new Http(base, ORIGIN).ok<TournamentPublicSummary>('GET', `/api/public/tournaments/${tournament.joinCode}/summary`);
      await waitFor(async () => (await pub(bases[0]!)).counters.handsCompleted >= 4, 120_000, 100, '4 hands');

      // Kill the node that hosts Johnny (the harder case).
      const victimIndex = a.runtime.node.host.isHosted('director', tournament.id) ? 0 : 1;
      const victim = servers[victimIndex]!;
      const survivor = servers[1 - victimIndex]!;
      const before = (await pub(bases[1 - victimIndex]!)).counters;
      expect(victim.runtime.node.host.hostedIds('table').length + victim.runtime.node.host.hostedIds('director').length).toBeGreaterThan(0);
      dead.add(bases[victimIndex]!);
      await victim.crash();

      // The survivor owns everything once the leases expire, and play continues.
      await waitFor(() => survivor.runtime.node.host.isActive('director', tournament.id), 20_000, 50, 'director takeover');
      await waitFor(
        async () => {
          const s = await pub(bases[1 - victimIndex]!);
          return s.counters.handsCompleted >= before.handsCompleted + 3 || s.status === 'COMPLETED';
        },
        60_000,
        200,
        'play after failover',
      );
      await waitFor(async () => (await pub(bases[1 - victimIndex]!)).status === 'COMPLETED', 240_000, 250, 'completion');

      const admin2 = new Http(bases[1 - victimIndex]!, ORIGIN);
      await admin2.ok('POST', '/api/admin/auth/login', ADMIN);
      const overview = await admin2.ok<TournamentOverviewDto>('GET', `/api/admin/tournaments/${tournament.id}`);
      expect(overview.status).toBe('COMPLETED');
      expect(overview.chipConservation?.ok).toBe(true);
      expect(overview.counters.registered).toBe(24);
      expect(bots.some((bot) => bot.reconnects > 0)).toBe(true);
      const faults = survivor.runtime.node.stats().actors.filter((x) => x.faulted);
      expect(faults).toEqual([]);
      const alerts = await admin2.ok<{ alerts: Array<{ code: string; message: string }> }>('GET', `/api/admin/alerts?tournamentId=${tournament.id}`);
      expect(alerts.alerts.filter((x) => x.code !== 'TABLE_STALLED')).toEqual([]);
      await waitFor(async () => (await survivor.store.repos.outbox.countPending()) === 0, 10_000, 100, 'outbox drained');
    } finally {
      for (const bot of bots) bot.stop();
      for (const s of servers) await s.close().catch(() => undefined);
      await db.close();
    }
  }, 300_000);
});
