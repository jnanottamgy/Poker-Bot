import type { Redis } from 'ioredis';
import type { MessageBus, Unsubscribe } from '../bus/bus';
import type { NodeRole, ServerEnv } from '../config/env';
import type { MetricsCatalog } from '../observability/catalog';
import { ActorHost } from './actor-host';
import type { ActorFault, ActorRegistration, ActorStats, RuntimeLogger } from './actor-host';
import { actorAddress, poolOf } from './actor';
import type { Clock, ClockTimer } from './clock';
import { systemClock } from './clock';
import type { LeaseManager } from './lease';
import { MemoryLeaseManager, RedisLeaseManager } from './lease';
import type { MemberInfo, Membership, MembershipTiming } from './membership';
import { MemoryMembership, RedisMembership } from './membership';
import { placeActor, roleServesPool } from './placement';
import { ActorRouter } from './router';
import type { SubmitOptions } from './router';
import { MEMBERSHIP_CHANNEL } from './rpc';
import type { TransactionRunner } from './transactions';

/**
 * NodeRuntime — one node of the cluster: Membership + LeaseManager +
 * ActorHost (+ its TimerService) + ActorRouter, for a given role.
 *
 *   all          hosts every actor kind (single node; also a valid cluster member)
 *   worker       hosts table actors (and any kind whose pool is 'worker')
 *   orchestrator hosts director actors
 *   gateway      hosts nothing; only routes
 *
 * Placement is re-evaluated whenever membership changes and periodically:
 * actors placed elsewhere are handed off gracefully (final snapshot + lease
 * release); actors placed here — from the catalog of live actors — are
 * activated (waiting for a dead owner's lease to expire, then recovering
 * from the log). Hosted actors that have left the catalog (closed tables,
 * finished tournaments) are deactivated once idle for `catalogGraceMs`.
 */

/** Source of the actor ids that must be running somewhere (e.g. open tables). */
export interface ActorCatalog {
  list(kind: string): Promise<string[]>;
}

export class MemoryActorCatalog implements ActorCatalog {
  private readonly ids = new Map<string, Set<string>>();
  add(kind: string, actorId: string): void {
    let set = this.ids.get(kind);
    if (!set) {
      set = new Set();
      this.ids.set(kind, set);
    }
    set.add(actorId);
  }
  remove(kind: string, actorId: string): void {
    this.ids.get(kind)?.delete(actorId);
  }
  async list(kind: string): Promise<string[]> {
    return [...(this.ids.get(kind) ?? [])];
  }
}

export interface NodeRuntimeOptions {
  nodeId: string;
  role: NodeRole;
  bus: MessageBus;
  leases: LeaseManager;
  membership: Membership;
  transactions: TransactionRunner;
  kinds: ActorRegistration[];
  catalog?: ActorCatalog;
  clock?: Clock;
  metrics?: MetricsCatalog;
  logger?: RuntimeLogger;
  leaseTtlMs?: number;
  leaseRenewMs?: number;
  leaseSafetyMs?: number;
  /** Periodic placement re-evaluation (default 5 s); membership changes trigger it immediately. */
  rebalanceIntervalMs?: number;
  requestTimeoutMs?: number;
  /** Parallel activations during a rebalance (default 16). */
  activationConcurrency?: number;
  /**
   * A hosted actor absent from the catalog is deactivated once it has had no
   * submit, queued command or armed timer for this long (default 60 s). It is
   * re-activated on demand if a command arrives later.
   */
  catalogGraceMs?: number;
  /** See ActorHostOptions.commitTimeoutMs. */
  commitTimeoutMs?: number;
  verifyOnRecovery?: boolean;
  onFault?: (fault: ActorFault) => void;
}

export class NodeRuntime {
  readonly host: ActorHost;
  readonly router: ActorRouter;
  readonly membership: Membership;
  private readonly clock: Clock;
  private rebalanceTimer: ClockTimer | null = null;
  private rebalancing: Promise<void> | null = null;
  private rebalanceAgain = false;
  private unsubs: Array<Unsubscribe | (() => void)> = [];
  private running = false;

  constructor(private readonly opts: NodeRuntimeOptions) {
    this.clock = opts.clock ?? systemClock;
    this.membership = opts.membership;
    this.host = new ActorHost({
      nodeId: opts.nodeId,
      transactions: opts.transactions,
      leases: opts.leases,
      bus: opts.bus,
      clock: this.clock,
      ...(opts.metrics ? { metrics: opts.metrics } : {}),
      ...(opts.logger ? { logger: opts.logger } : {}),
      ...(opts.leaseTtlMs !== undefined ? { leaseTtlMs: opts.leaseTtlMs } : {}),
      ...(opts.leaseRenewMs !== undefined ? { leaseRenewMs: opts.leaseRenewMs } : {}),
      ...(opts.leaseSafetyMs !== undefined ? { leaseSafetyMs: opts.leaseSafetyMs } : {}),
      ...(opts.verifyOnRecovery !== undefined ? { verifyOnRecovery: opts.verifyOnRecovery } : {}),
      ...(opts.commitTimeoutMs !== undefined ? { commitTimeoutMs: opts.commitTimeoutMs } : {}),
      ...(opts.onFault ? { onFault: opts.onFault } : {}),
    });
    for (const k of opts.kinds) this.host.register(k);
    this.router = new ActorRouter({
      nodeId: opts.nodeId,
      role: opts.role,
      host: this.host,
      bus: opts.bus,
      members: () => this.membership.members(),
      clock: this.clock,
      ...(opts.requestTimeoutMs !== undefined ? { requestTimeoutMs: opts.requestTimeoutMs } : {}),
    });
  }

  get nodeId(): string {
    return this.opts.nodeId;
  }

  get role(): NodeRole {
    return this.opts.role;
  }

  async start(): Promise<void> {
    this.running = true;
    await this.router.start();
    if (this.opts.role !== 'gateway') await this.host.start();
    this.unsubs.push(
      await this.opts.bus.subscribe(MEMBERSHIP_CHANNEL, (msg) => {
        if ((msg as { nodeId?: unknown })?.nodeId !== this.opts.nodeId) void this.membership.refresh().catch(() => undefined);
      }),
    );
    this.unsubs.push(this.membership.onChange(() => this.requestRebalance()));
    await this.membership.start();
    await this.opts.bus.publish(MEMBERSHIP_CHANNEL, { type: 'join', nodeId: this.opts.nodeId }).catch(() => undefined);
    this.requestRebalance();
    this.scheduleRebalance();
  }

  /** Graceful stop: leave the cluster, hand off every actor (final snapshots, lease releases), stop routing. */
  async stop(): Promise<void> {
    this.running = false;
    if (this.rebalanceTimer) this.clock.clearTimeout(this.rebalanceTimer);
    this.rebalanceTimer = null;
    await this.rebalancing?.catch(() => undefined);
    await this.membership.stop().catch(() => undefined);
    await this.opts.bus.publish(MEMBERSHIP_CHANNEL, { type: 'leave', nodeId: this.opts.nodeId }).catch(() => undefined);
    await this.host.stop();
    await this.router.stop();
    await Promise.allSettled(this.unsubs.splice(0).map((u) => u()));
  }

  /** Crash simulation: stops heartbeats, renewals and timers without leaving, snapshotting or releasing. */
  async kill(): Promise<void> {
    this.running = false;
    if (this.rebalanceTimer) this.clock.clearTimeout(this.rebalanceTimer);
    this.rebalanceTimer = null;
    this.membership.halt();
    await this.host.abandon();
    await this.router.stop();
    await Promise.allSettled(this.unsubs.splice(0).map((u) => u()));
  }

  submit<R = unknown>(kind: string, actorId: string, command: unknown, opts?: SubmitOptions): Promise<R> {
    return this.router.submit<R>(kind, actorId, command, opts);
  }

  stats(): { nodeId: string; role: NodeRole; members: MemberInfo[]; actors: ActorStats[]; timers: number } {
    return { nodeId: this.opts.nodeId, role: this.opts.role, members: this.membership.members(), actors: this.host.stats(), timers: this.host.timers.size };
  }

  /** Coalesces rebalance requests: at most one runs, and one more follows if requested meanwhile. */
  requestRebalance(): Promise<void> {
    if (!this.running || this.opts.role === 'gateway') return Promise.resolve();
    if (this.rebalancing) {
      this.rebalanceAgain = true;
      return this.rebalancing;
    }
    this.rebalancing = (async () => {
      do {
        this.rebalanceAgain = false;
        await this.rebalance().catch((err: unknown) => this.opts.logger?.warn({ err: String(err) }, 'rebalance failed'));
      } while (this.rebalanceAgain && this.running);
    })().finally(() => {
      this.rebalancing = null;
    });
    return this.rebalancing;
  }

  private scheduleRebalance(): void {
    if (!this.running) return;
    this.rebalanceTimer = this.clock.setTimeout(() => {
      void this.requestRebalance().finally(() => this.scheduleRebalance());
    }, this.opts.rebalanceIntervalMs ?? 5000);
  }

  private async rebalance(): Promise<void> {
    const members = this.membership.members();
    // Without our own entry the view is unreliable (e.g. Redis unreachable): change nothing.
    if (!members.some((m) => m.nodeId === this.opts.nodeId)) return;
    const toActivate: Array<[string, string]> = [];
    const toRelease: Array<[string, string, string]> = [];
    const graceMs = this.opts.catalogGraceMs ?? 60_000;
    for (const reg of this.host.registrations()) {
      const kind = reg.definition.kind;
      const pool = poolOf(reg.definition);
      const servesPool = roleServesPool(this.opts.role, pool);
      const listed = this.opts.catalog ? new Set(await this.opts.catalog.list(kind)) : null;
      const ids = new Set([...(listed ?? []), ...this.host.hostedIds(kind)]);
      for (const id of ids) {
        const owner = servesPool ? placeActor(actorAddress(kind, id), pool, members) : null;
        const hosted = this.host.isHosted(kind, id);
        if (owner === this.opts.nodeId && !hosted) toActivate.push([kind, id]);
        else if (owner !== this.opts.nodeId && hosted && this.host.statusOf(kind, id) !== 'activating') toRelease.push([kind, id, 'placement moved to another node']);
        else if (hosted && listed && !listed.has(id) && this.host.isIdle(kind, id, graceMs)) toRelease.push([kind, id, 'no longer in the actor catalog']);
      }
    }
    await Promise.all(toRelease.map(([kind, id, reason]) => this.host.deactivate(kind, id, reason)));
    await runLimited(toActivate, this.opts.activationConcurrency ?? 16, async ([kind, id]) => {
      if (!this.running) return;
      await this.host.activate(kind, id).catch((err: unknown) => this.opts.logger?.warn({ kind, actorId: id, err: String(err) }, 'activation deferred'));
    });
  }
}

async function runLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]!);
  });
  await Promise.all(workers);
}

/** Dependencies for building a NodeRuntime from the process environment. */
export interface NodeRuntimeDeps {
  bus: MessageBus;
  transactions: TransactionRunner;
  kinds: ActorRegistration[];
  /** Command connection for leases and membership; required when env.redisUrl is set. */
  redis?: Redis;
  catalog?: ActorCatalog;
  metrics?: MetricsCatalog;
  logger?: RuntimeLogger;
  onFault?: (fault: ActorFault) => void;
  capacity?: number;
  membershipTiming?: MembershipTiming;
}

/**
 * Wires a NodeRuntime for `env.role`. Without Redis (single node) it uses
 * in-memory leases and membership: the router then always takes the local
 * fast path, with no network hop beyond the mailbox.
 */
export function createNodeRuntime(env: Pick<ServerEnv, 'nodeId' | 'role' | 'redisUrl'>, deps: NodeRuntimeDeps): NodeRuntime {
  const self: MemberInfo = { nodeId: env.nodeId, role: env.role, startedAt: Date.now(), capacity: deps.capacity ?? 1 };
  const multiNode = env.redisUrl !== null;
  if (multiNode && !deps.redis) throw new Error('createNodeRuntime: a Redis connection is required when REDIS_URL is set');
  const leases = multiNode ? new RedisLeaseManager(deps.redis!) : new MemoryLeaseManager();
  const membership = multiNode
    ? new RedisMembership(self, deps.redis!, { ...deps.membershipTiming, ...(deps.logger ? { onError: (err) => deps.logger!.warn({ err: String(err) }, 'membership heartbeat failed') } : {}) })
    : new MemoryMembership(self, undefined, systemClock, deps.membershipTiming);
  return new NodeRuntime({
    nodeId: env.nodeId,
    role: env.role,
    bus: deps.bus,
    leases,
    membership,
    transactions: deps.transactions,
    kinds: deps.kinds,
    ...(deps.catalog ? { catalog: deps.catalog } : {}),
    ...(deps.metrics ? { metrics: deps.metrics } : {}),
    ...(deps.logger ? { logger: deps.logger } : {}),
    ...(deps.onFault ? { onFault: deps.onFault } : {}),
  });
}
