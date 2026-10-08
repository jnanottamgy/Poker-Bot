import { Redis } from 'ioredis';
import type { FastifyInstance } from 'fastify';
import type { ServerEnv } from './config/env';
import { Database, migrate } from './persistence/db';
import { Store } from './persistence/store';
import type { MessageBus } from './bus/bus';
import { LocalBus } from './bus/local-bus';
import { RedisBus } from './bus/redis-bus';
import { SessionService } from './auth/sessions';
import { AdminAuthService } from './auth/admin-auth';
import { AuditService } from './audit/audit-service';
import { MetricsRegistry } from './observability/metrics';
import { createMetricsCatalog } from './observability/catalog';
import type { MetricsCatalog } from './observability/catalog';
import { buildHttpApp } from './http/app';
import type { HttpContext } from './http/context';
import { createGameRuntime } from './game/wiring';
import type { GameRuntime } from './game/wiring';
import { RegistrationService } from './services/registration';
import { Gateway } from './gateway/gateway';
import { gatewayModule } from './gateway/plugin';
import { MemoryPresenceStore, RedisPresenceStore } from './gateway/presence';
import { LiveMetricsSampler } from './game/live-metrics';
import { DemoRunner } from './game/demo';
import { HealthMonitor } from './game/monitors';
import { registerPublicRoutes } from './http/routes/public';
import { registerPublicLiveRoutes } from './http/routes/public-live';
import { registerPlayerRoutes } from './http/routes/player';
import { registerAdminTournamentRoutes } from './http/routes/admin-tournaments';
import { registerAdminTableRoutes } from './http/routes/admin-tables';
import { registerAdminPlayerRoutes } from './http/routes/admin-players';
import { registerAdminHandRoutes } from './http/routes/admin-hands';
import { registerAdminSystemRoutes } from './http/routes/admin-system';
import { staticApps } from './http/static';
import type { RuntimeLogger } from './runtime/actor-host';

export const VERSION = '1.0.0';

export interface ServerLogger extends RuntimeLogger {
  child?(bindings: object): ServerLogger;
}

export interface JpbServer {
  env: ServerEnv;
  app: FastifyInstance;
  store: Store;
  bus: MessageBus;
  runtime: GameRuntime;
  gateway: Gateway | null;
  metrics: MetricsCatalog;
  demos: DemoRunner;
  /** Base URL once listening (http://host:port). */
  url: string | null;
  listen(): Promise<string>;
  close(): Promise<void>;
}

export interface BuildServerOptions {
  /** Fastify logger setting (default: pino at env.logLevel unless test). */
  logger?: boolean | { level: string };
  /** Use an existing database (tests). */
  db?: Database;
  bus?: MessageBus;
  runtimeOverrides?: Parameters<typeof createGameRuntime>[0]['nodeOverrides'];
  /** Skip migrations (tests that already migrated). */
  skipMigrations?: boolean;
  monitorEveryMs?: number;
}

/**
 * Assembles one node: database (+ migrations), bus, actor runtime (Johnny +
 * tables + durable outbox), WebSocket gateway, REST API, static web apps,
 * live metrics, health monitor and demo runner. The same code runs as a single
 * all-in-one process (zero-cost deployment) or as one role of a cluster.
 */
export async function buildServer(env: ServerEnv, opts: BuildServerOptions = {}): Promise<JpbServer> {
  if (!opts.db && !env.databaseUrl) {
    throw new Error('DATABASE_URL is required: PostgreSQL is the source of truth (crash recovery, audit, history). Start it with `docker compose up -d postgres`.');
  }
  const db = opts.db ?? new Database(env.databaseUrl!, env.databasePoolMax);
  if (!opts.skipMigrations) await migrate(db);
  const store = new Store(db);
  const redis = env.redisUrl ? new Redis(env.redisUrl, { maxRetriesPerRequest: 3 }) : null;
  const bus = opts.bus ?? (env.redisUrl ? new RedisBus(env.redisUrl) : new LocalBus());

  const registry = new MetricsRegistry();
  const metrics = createMetricsCatalog(registry);
  const audit = new AuditService(store);
  const ctx: HttpContext = {
    env,
    store,
    sessions: new SessionService(store, { playerMs: env.sessionTtlMs, adminMs: env.adminSessionTtlMs }),
    adminAuth: new AdminAuthService(store, audit),
    audit,
    metrics: registry,
    limiters: new Map(),
    now: Date.now,
  };
  await ctx.adminAuth.bootstrap(env.bootstrapAdmin);

  // Fastify's logger exists only once the app is built; earlier components log through this holder.
  const logRef: { current: ServerLogger | null } = { current: null };
  const runtime = createGameRuntime({
    env,
    store,
    bus,
    ...(redis ? { redis } : {}),
    metrics,
    logger: { info: (o, m) => logRef.current?.info(o, m), warn: (o, m) => logRef.current?.warn(o, m), error: (o, m) => logRef.current?.error(o, m) },
    ...(opts.runtimeOverrides ? { nodeOverrides: opts.runtimeOverrides } : {}),
  });
  const game = runtime.game;
  const registration = new RegistrationService(store, game);
  const servesClients = env.role === 'all' || env.role === 'gateway';
  const gateway = servesClients
    ? new Gateway({
        nodeId: env.nodeId,
        backend: game,
        bus,
        sessions: ctx.sessions,
        metrics,
        presence: redis ? new RedisPresenceStore(redis) : new MemoryPresenceStore(),
        log: { warn: (o, m) => logRef.current?.warn(o as object, m ?? ''), error: (o, m) => logRef.current?.error(o as object, m ?? '') },
      })
    : null;
  const connections = () => {
    const out: Record<string, number> = { PLAYER: 0, SPECTATOR: 0, ADMIN: 0, DISPLAY: 0 };
    for (const c of gateway?.connections() ?? []) if (c.audience) out[c.audience] = (out[c.audience] ?? 0) + 1;
    return out;
  };
  const live = new LiveMetricsSampler(game, metrics, () => Object.values(connections()).reduce((a, b) => a + b, 0));
  const demos = new DemoRunner(game, bus, { maxPlayers: env.nodeEnv === 'production' ? 20_000 : 100_000, speedModeAllowed: env.speedModeAllowed });
  const monitor = new HealthMonitor(game, bus, metrics, { stallThresholdMs: env.stallThresholdMs, actionLatencyAlertMs: env.actionLatencyAlertMs, ...(opts.monitorEveryMs ? { everyMs: opts.monitorEveryMs } : {}) });
  const statics = env.staticDir && servesClients ? staticApps(env.staticDir) : null;
  const startedAt = Date.now();

  const deps = { ctx, game };
  const app = await buildHttpApp(ctx, {
    logger: opts.logger ?? (env.nodeEnv === 'test' ? false : { level: env.logLevel }),
    ...(statics ? { fallback: statics.fallback } : {}),
    modules: [
      ...(gateway ? [gatewayModule(gateway)] : []),
      (a) => registerPublicRoutes(a, ctx, registration),
      (a) => registerPublicLiveRoutes(a, deps),
      (a) => registerPlayerRoutes(a, deps),
      (a) => registerAdminTournamentRoutes(a, { ...deps, live, bus }),
      (a) => registerAdminTableRoutes(a, { ...deps, bus }),
      (a) => registerAdminPlayerRoutes(a, { ...deps, bus, registration }),
      (a) => registerAdminHandRoutes(a, deps),
      (a) => registerAdminSystemRoutes(a, { ...deps, metrics, demos, connections, startedAt, version: VERSION }),
      ...(statics ? [(a: FastifyInstance) => statics.register(a)] : []),
    ],
  });
  logRef.current = app.log as unknown as ServerLogger;
  app.addHook('onResponse', async (req, reply) => {
    const group = req.url.startsWith('/api/admin') ? 'admin' : req.url.startsWith('/api/player') ? 'player' : req.url.startsWith('/api/public') ? 'public' : 'other';
    metrics.httpRequests.inc({ group, status: `${Math.floor(reply.statusCode / 100)}xx` });
  });

  await runtime.start();
  live.start();
  monitor.start();

  const server: JpbServer = {
    env,
    app,
    store,
    bus,
    runtime,
    gateway,
    metrics,
    demos,
    url: null,
    async listen() {
      const address = await app.listen({ port: env.port, host: env.host });
      server.url = address;
      return address;
    },
    async close() {
      await demos.shutdown();
      await live.stop();
      await monitor.stop();
      await app.close();
      await runtime.stop();
      if (!opts.bus) await bus.close();
      redis?.disconnect();
      if (!opts.db) await store.close();
    },
  };
  return server;
}
