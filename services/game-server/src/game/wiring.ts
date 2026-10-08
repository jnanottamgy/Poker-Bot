import type { Redis } from 'ioredis';
import type { MessageBus } from '../bus/bus';
import type { ServerEnv } from '../config/env';
import type { Store } from '../persistence/store';
import type { MetricsCatalog } from '../observability/catalog';
import type { ActorFault, RuntimeLogger } from '../runtime/actor-host';
import { createNodeRuntime, NodeRuntime } from '../runtime/node-runtime';
import type { NodeRuntimeOptions } from '../runtime/node-runtime';
import { MemoryLeaseManager } from '../runtime/lease';
import { MemoryMembership } from '../runtime/membership';
import { PostgresDirectorLog, PostgresTableLog } from '../runtime/pg-actor-log';
import { storeTransactions } from '../runtime/transactions';
import { newId } from '../security/ids';
import { createDirectorActorDefinition } from './director-actor';
import { createTableActorDefinition } from './table-actor';
import { GameService } from './game-service';
import { OutboxDispatcher } from './outbox-dispatcher';
import { SeedService, withSeedPreload } from './seeds';

export interface GameRuntime {
  node: NodeRuntime;
  game: GameService;
  seeds: SeedService;
  dispatcher: OutboxDispatcher;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface GameRuntimeDeps {
  env: Pick<ServerEnv, 'nodeId' | 'role' | 'redisUrl' | 'snapshotEveryCommands' | 'seedEncryptionKey'>;
  store: Store;
  bus: MessageBus;
  redis?: Redis;
  metrics?: MetricsCatalog;
  logger?: RuntimeLogger;
  /** Tests: overrides for a single in-process node (lease timings, verifyOnRecovery...). */
  nodeOverrides?: Partial<Omit<NodeRuntimeOptions, 'kinds' | 'bus' | 'transactions'>>;
  dispatcher?: { sweepMs?: number; concurrency?: number };
}

/** Builds the poker runtime of one node: actors, router, outbox dispatcher and the game facade. */
export function createGameRuntime(deps: GameRuntimeDeps): GameRuntime {
  const { env, store, bus } = deps;
  const seeds = new SeedService(store, env.seedEncryptionKey);
  const seedFor = (tid: string) => seeds.seedFor(tid);
  // The fault handler and the catalog need the facade, which needs the node.
  const ref: { game: GameService | null } = { game: null };
  const kinds = [
    {
      definition: createTableActorDefinition({ seedFor, snapshotEvery: env.snapshotEveryCommands }),
      log: withSeedPreload(new PostgresTableLog(store.repos), (id) => seeds.loadForTable(id)),
    },
    {
      definition: createDirectorActorDefinition({ seedFor, snapshotEvery: env.snapshotEveryCommands }),
      log: withSeedPreload(new PostgresDirectorLog(store.repos), async (id) => {
        await seeds.load(id);
      }),
    },
  ];
  const onFault = (fault: ActorFault) => {
    deps.logger?.error({ kind: fault.kind, actorId: fault.actorId, seq: fault.seq, phase: fault.phase, err: String((fault.error as Error)?.message ?? fault.error) }, 'actor faulted');
    void (async () => {
      const tournamentId = fault.kind === 'director' ? fault.actorId : await ref.game!.tableTournament(fault.actorId);
      const target = `${fault.kind}:${fault.actorId}`;
      if (await store.repos.alerts.findOpen(tournamentId, 'TABLE_CRASHED', target)) return;
      const alert = await store.repos.alerts.create({
        id: newId('alt'),
        tournamentId,
        severity: 'CRITICAL',
        code: 'TABLE_CRASHED',
        message: `${fault.kind} ${fault.actorId} halted at command ${fault.seq} (${fault.phase}): ${String((fault.error as Error)?.message ?? fault.error).slice(0, 300)}`,
        target,
      });
      if (tournamentId) await bus.publish(`admin:${tournamentId}`, { kind: 'ALERT', alert });
    })().catch(() => undefined);
  };

  const catalog = { list: (kind: string) => ref.game!.catalog().list(kind) };
  let node: NodeRuntime;
  if (deps.nodeOverrides) {
    node = new NodeRuntime({
      nodeId: env.nodeId,
      role: env.role,
      bus,
      leases: new MemoryLeaseManager(),
      membership: new MemoryMembership({ nodeId: env.nodeId, role: env.role, startedAt: Date.now(), capacity: 1 }),
      transactions: storeTransactions(store),
      kinds,
      catalog,
      onFault,
      ...(deps.metrics ? { metrics: deps.metrics } : {}),
      ...(deps.logger ? { logger: deps.logger } : {}),
      ...deps.nodeOverrides,
    });
  } else {
    node = createNodeRuntime(env, {
      bus,
      transactions: storeTransactions(store),
      kinds,
      catalog,
      onFault,
      ...(deps.redis ? { redis: deps.redis } : {}),
      ...(deps.metrics ? { metrics: deps.metrics } : {}),
      ...(deps.logger ? { logger: deps.logger } : {}),
    });
  }
  const game = new GameService({ store, node, seeds });
  ref.game = game;
  const dispatcher = new OutboxDispatcher({ store, node, bus, ...(deps.logger ? { logger: deps.logger } : {}), ...deps.dispatcher });

  return {
    node,
    game,
    seeds,
    dispatcher,
    async start() {
      await node.start();
      await dispatcher.start();
    },
    async stop() {
      await dispatcher.stop();
      await node.stop();
    },
  };
}
