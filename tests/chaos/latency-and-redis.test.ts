import { createServer, connect } from 'node:net';
import type { Server, Socket } from 'node:net';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import type { TournamentOverviewDto, TournamentPublicSummary } from '@jpb/shared-types';
import { buildServer } from '../../services/game-server/src/server';
import type { JpbServer } from '../../services/game-server/src/server';
import { createTestDatabase, TEST_DATABASE_URL } from '../../services/game-server/test/helpers/db';
import { Http } from '../../services/game-server/test/helpers/client';
import { ADMIN, ORIGIN, ResilientBot, chaosEnv, isolatedDatabase, setupTournament, waitFor, wsUrlOf } from './helpers';

const TEST_REDIS_URL = process.env.TEST_REDIS_URL;

/**
 * Adds latency to every PostgreSQL round trip of this process while `on`.
 * Wraps pg.Client#query for both the promise and the callback form.
 */
function injectDbLatency(range: [number, number]): { on: boolean; restore: () => void } {
  const proto = pg.Client.prototype as unknown as { query: (...args: unknown[]) => unknown };
  const original = proto.query;
  let n = 0;
  const state = {
    on: false,
    restore: () => {
      proto.query = original;
    },
  };
  proto.query = function (this: unknown, ...args: unknown[]) {
    if (!state.on) return original.apply(this, args);
    const delay = range[0] + ((n++ * 7919) % Math.max(1, range[1] - range[0]));
    const cb = args[args.length - 1];
    if (typeof cb === 'function') {
      setTimeout(() => original.apply(this, args), delay);
      return undefined;
    }
    return new Promise((r) => setTimeout(r, delay)).then(() => original.apply(this, args));
  };
  return state;
}

/** A TCP proxy in front of Redis that can be cut (every connection dropped, new ones refused) and restored. */
class KillableProxy {
  private server: Server | null = null;
  private readonly sockets = new Set<Socket>();
  constructor(
    readonly port: number,
    readonly target: { host: string; port: number },
  ) {}
  async start(): Promise<void> {
    this.server = createServer((client) => {
      const upstream = connect(this.target.port, this.target.host);
      for (const s of [client, upstream]) {
        this.sockets.add(s);
        s.on('close', () => this.sockets.delete(s));
        s.on('error', () => s.destroy());
      }
      client.pipe(upstream).pipe(client);
    });
    await new Promise<void>((resolve) => this.server!.listen(this.port, '127.0.0.1', () => resolve()));
  }
  async cut(): Promise<void> {
    const s = this.server;
    this.server = null;
    for (const sock of this.sockets) sock.destroy();
    await new Promise<void>((resolve) => (s ? s.close(() => resolve()) : resolve()));
  }
}

describe.skipIf(!TEST_DATABASE_URL)('chaos: slow database', () => {
  it('every PostgreSQL round trip delayed 20–120 ms for 12 s mid-play: play slows down, nothing breaks', async () => {
    const iso = await isolatedDatabase('chaos_latency');
    const latency = injectDbLatency([20, 120]);
    const bots: ResilientBot[] = [];
    let server: JpbServer | null = null;
    try {
      server = await buildServer(chaosEnv('chaos-lat'), { db: iso.db, runtimeOverrides: { verifyOnRecovery: true }, monitorEveryMs: 1000 });
      const base = await server.listen();
      const { admin, tournament, https } = await setupTournament([base], 18, 'CHAOSLT');
      for (const http of https) bots.push(new ResilientBot(http, tournament.id, () => wsUrlOf(base)));
      await Promise.all(bots.map((b) => b.start()));
      await admin.ok('POST', `/api/admin/tournaments/${tournament.id}/start`, {});
      const summary = () => new Http(base, ORIGIN).ok<TournamentPublicSummary>('GET', `/api/public/tournaments/${tournament.joinCode}/summary`);
      await waitFor(async () => (await summary()).counters.handsCompleted >= 3, 120_000, 100, '3 hands');
      latency.on = true;
      const during = (await summary()).counters.handsCompleted;
      await new Promise((r) => setTimeout(r, 12_000));
      latency.on = false;
      const after = await summary();
      expect(after.counters.handsCompleted >= during || after.status === 'COMPLETED').toBe(true);
      await waitFor(async () => (await summary()).status === 'COMPLETED', 240_000, 250, 'completion');
      const overview = await admin.ok<TournamentOverviewDto>('GET', `/api/admin/tournaments/${tournament.id}`);
      expect(overview.chipConservation?.ok).toBe(true);
      expect(server.runtime.node.stats().actors.filter((x) => x.faulted)).toEqual([]);
      const alerts = await admin.ok<{ alerts: Array<{ code: string }> }>('GET', `/api/admin/alerts?tournamentId=${tournament.id}`);
      expect(alerts.alerts.filter((x) => x.code !== 'TABLE_STALLED' && x.code !== 'ACTION_LATENCY_HIGH')).toEqual([]);
    } finally {
      latency.on = false;
      latency.restore();
      for (const b of bots) b.stop();
      await server?.close().catch(() => undefined);
      await iso.close();
    }
  }, 300_000);
});

describe.skipIf(!TEST_DATABASE_URL || !TEST_REDIS_URL)('chaos: Redis outage in a two-node cluster', () => {
  it('Redis unreachable for 5 s: leases lapse, actors stop, then the cluster recovers and the tournament completes', async () => {
    const redisUrl = new URL(TEST_REDIS_URL!);
    const proxyPort = 26379 + (process.pid % 1000);
    const proxy = new KillableProxy(proxyPort, { host: redisUrl.hostname, port: Number(redisUrl.port || 6379) });
    await proxy.start();
    const viaProxy = `redis://127.0.0.1:${proxyPort}`;
    const db = await createTestDatabase('chaos_redis');
    const prefix = `jpb:test:chaosredis:${process.pid}:${Date.now()}:`;
    const common = {
      db,
      redisPrefix: prefix,
      membershipTiming: { heartbeatMs: 150, ttlMs: 900 },
      runtimeOverrides: { leaseTtlMs: 1500, leaseRenewMs: 300, rebalanceIntervalMs: 300, catalogGraceMs: 2000, verifyOnRecovery: true },
      monitorEveryMs: 1000,
    };
    const servers: JpbServer[] = [];
    const bots: ResilientBot[] = [];
    try {
      servers.push(await buildServer(chaosEnv('redis-a', { REDIS_URL: viaProxy }), common));
      servers.push(await buildServer(chaosEnv('redis-b', { REDIS_URL: viaProxy }), { ...common, skipMigrations: true }));
      const bases = [await servers[0]!.listen(), await servers[1]!.listen()];
      await waitFor(() => servers.every((s) => s.runtime.node.membership.members().length === 2), 10_000, 50, 'cluster membership');
      const { admin, tournament, https } = await setupTournament(bases, 24, 'CHAOSRD');
      https.forEach((http, i) => bots.push(new ResilientBot(http, tournament.id, () => wsUrlOf(bases[i % 2]!))));
      await Promise.all(bots.map((b) => b.start()));
      await admin.ok('POST', `/api/admin/tournaments/${tournament.id}/start`, {});
      const summary = () => new Http(bases[0]!, ORIGIN).ok<TournamentPublicSummary>('GET', `/api/public/tournaments/${tournament.joinCode}/summary`);
      await waitFor(async () => (await summary()).counters.handsCompleted >= 4, 120_000, 100, '4 hands');

      await proxy.cut();
      await new Promise((r) => setTimeout(r, 5_000));
      // With Redis gone no node may keep processing commands on a lease it cannot renew.
      const stillActive = servers.flatMap((s) => s.runtime.node.stats().actors.filter((a) => a.status === 'active'));
      expect(stillActive).toEqual([]);
      await proxy.start();

      await waitFor(
        async () => {
          const s = await summary().catch(() => null);
          return s?.status === 'COMPLETED';
        },
        240_000,
        250,
        'completion after the outage',
      );
      await admin.ok('POST', '/api/admin/auth/login', ADMIN).catch(() => undefined);
      const overview = await admin.ok<TournamentOverviewDto>('GET', `/api/admin/tournaments/${tournament.id}`);
      expect(overview.chipConservation?.ok).toBe(true);
      for (const s of servers) expect(s.runtime.node.stats().actors.filter((x) => x.faulted)).toEqual([]);
      const alerts = await admin.ok<{ alerts: Array<{ code: string }> }>('GET', `/api/admin/alerts?tournamentId=${tournament.id}`);
      expect(alerts.alerts.filter((x) => x.code !== 'TABLE_STALLED')).toEqual([]);
    } finally {
      for (const b of bots) b.stop();
      for (const s of servers) await s.close().catch(() => undefined);
      await proxy.cut().catch(() => undefined);
      await db.close();
    }
  }, 300_000);
});
