import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { MessageBus, Unsubscribe } from '../bus/bus';
import type { MetricsCatalog } from '../observability/catalog';
import { DuplicateSequenceError } from '../persistence/repos/logs';
import type { LoggedCommand, Snapshot } from '../persistence/repos/logs';
import type { ActorEnvelope, AnyActorDefinition, StepResult } from './actor';
import { actorAddress, checkStepResult, commandChannelOf } from './actor';
import type { ActorLog } from './actor-log';
import { canonicalCopy } from './canonical';
import type { Clock, ClockTimer } from './clock';
import { systemClock } from './clock';
import { ActorRuntimeError, DeterminismError, ReplayStepError } from './errors';
import type { Lease, LeaseManager } from './lease';
import { Fifo } from './mailbox';
import { recoverActor, replayOne } from './recovery';
import type { RecoveryReport } from './recovery';
import type { RpcReply, RpcRequest } from './rpc';
import { LEASE_RELEASED_CHANNEL, RecentMap, attemptOf, isRpcRequest } from './rpc';
import { TimerService } from './timer-service';
import type { TransactionRunner } from './transactions';

/**
 * ActorHost — owns the live actors of this node.
 *
 * Per actor: a FIFO mailbox processed strictly one command at a time
 * (different actors run concurrently). For each command:
 *
 *   stamp envelope (seq = last + 1, random commandId, at = max(now, last at))
 *   → step (pure)
 *   → ONE unit of work: log.append + projection + (every N) snapshot
 *   → only after COMMIT: replace state, apply timers, publish outbox, reply.
 *
 * Failure rules:
 *   - step throws / returns an invalid result → nothing persisted, actor
 *     FAULTED (keeps its lease so no other node re-runs the poison command),
 *     onFault fires, state stays at the last committed version;
 *   - unit of work fails (or exceeds commitTimeoutMs) → state not advanced,
 *     typed retryable error with processed 'unknown'; before the next command
 *     the host checks the log for seq + 1 (a failure reported on COMMIT can
 *     hide a commit) and, if it is there, catches up from the log;
 *   - DuplicateSequenceError on our seq means another owner wrote it
 *     (fencing) → the actor is deactivated here;
 *   - lease renewal refused or local lease validity (monotonic clock)
 *     elapsed → processing stops immediately and queued commands are
 *     rejected with NOT_OWNER.
 */
export interface ActorRegistration {
  definition: AnyActorDefinition;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  log: ActorLog<any>;
}

export interface ActorFault {
  kind: string;
  actorId: string;
  /** Command seq that was being processed / replayed. */
  seq: number;
  phase: 'step' | 'replay' | 'determinism';
  error: unknown;
}

export interface RuntimeLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

const silentLogger: RuntimeLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };

export interface ActorHostOptions {
  nodeId: string;
  transactions: TransactionRunner;
  leases: LeaseManager;
  bus: MessageBus;
  clock?: Clock;
  metrics?: MetricsCatalog;
  logger?: RuntimeLogger;
  /** Lease time-to-live (default 10 s). */
  leaseTtlMs?: number;
  /** Renewal period (default 3 s). */
  leaseRenewMs?: number;
  /** Stop processing this long BEFORE the lease would expire (default ttl / 5). */
  leaseSafetyMs?: number;
  /** How long activate() waits for a lease held by another node (default ttl + renew). */
  acquireWaitMs?: number;
  /** Run the determinism check on every recovery (default false). */
  verifyOnRecovery?: boolean;
  /** Back-off before re-firing a timer whose command failed with a retryable error (default 1 s). */
  timerRetryMs?: number;
  /** Mailbox bound per actor; beyond it submits are rejected UNAVAILABLE (default 10,000). */
  maxQueue?: number;
  /** Deadline for one unit of work or log read; past it the outcome counts as unknown (default 30 s). */
  commitTimeoutMs?: number;
  /** Back-off between attempts to settle an ambiguous commit while the log is unreachable (default 1 s). */
  reconcileRetryMs?: number;
  onFault?: (fault: ActorFault) => void;
  onDeactivated?: (info: { kind: string; actorId: string; reason: string }) => void;
}

export type ActorStatus = 'activating' | 'active' | 'draining' | 'faulted';

export interface ActorStats {
  kind: string;
  actorId: string;
  status: ActorStatus;
  seq: number;
  queueLength: number;
  lastProgressAt: number | null;
  lastLatencyMs: number | null;
  processed: number;
  faulted: boolean;
  fault: { phase: ActorFault['phase']; message: string; at: number; seq: number } | null;
  leaseEpoch: number | null;
  leaseExpiresAt: number | null;
  lastSnapshotSeq: number;
  timers: number;
  /** The last unit of work failed ambiguously and the log has not been checked yet (commands wait). */
  reconciling: boolean;
}

export interface HostSubmitOptions {
  /** Aborted when the submitter's deadline passes (see `bindDeadline`). */
  signal?: AbortSignal;
}

interface Job {
  command: unknown;
  /** Envelope commandId; routed requests use their correlationId, local submits a random one (null). */
  commandId: string | null;
  /** Processing began: a deadline now yields processed 'unknown'. */
  started: boolean;
  /** The submitter's deadline passed before processing began: skipped. */
  cancelled: boolean;
  resolve(reply: unknown): void;
  reject(err: ActorRuntimeError): void;
}

interface ActorRecord {
  kind: string;
  actorId: string;
  address: string;
  reg: ActorRegistration;
  status: ActorStatus;
  retired: boolean;
  state: unknown;
  seq: number;
  lastAt: number;
  lastSnapshotSeq: number;
  lease: Lease | null;
  /** Monotonic instant until which the lease may be used: request sent + ttl - safety. */
  leaseValidUntil: number;
  /** The last unit of work failed ambiguously: the log may already hold seq + 1. */
  suspect: boolean;
  retryTimer: ClockTimer | null;
  /** Monotonic time of the last submit or activation (idle detection). */
  lastActivity: number;
  queue: Fifo<Job>;
  running: boolean;
  drainWaiters: Array<() => void>;
  unsubscribe: Unsubscribe | null;
  activation: Promise<RecoveryReport>;
  lastProgressAt: number | null;
  lastLatencyMs: number | null;
  processed: number;
  fault: ActorStats['fault'];
}

const DEFAULT_TTL_MS = 10_000;
const DEFAULT_RENEW_MS = 3_000;
const DEFAULT_COMMIT_TIMEOUT_MS = 30_000;
/** Final replies kept per node for retransmitted requests. */
const RPC_REPLY_CAPACITY = 50_000;
/**
 * How far back (in commands) an owner looks for a retransmitted request that
 * a previous owner may have committed. A retransmission is at most one
 * requester deadline (default 5 s) late, far fewer commands than this.
 */
const RPC_LOOKBACK_COMMANDS = 1_000;

const errMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export class ActorHost {
  readonly nodeId: string;
  readonly clock: Clock;
  readonly timers: TimerService;
  private readonly kinds = new Map<string, ActorRegistration>();
  private readonly records = new Map<string, ActorRecord>();
  /** Teardown in progress per address; a re-activation waits for it. */
  private readonly retiring = new Map<string, Promise<void>>();
  private readonly releaseWaiters = new Map<string, Set<() => void>>();
  /** correlationId → final reply (null while in progress). */
  private readonly rpcReplies = new RecentMap<RpcReply | null>(RPC_REPLY_CAPACITY);
  private readonly logger: RuntimeLogger;
  private readonly ttlMs: number;
  private readonly renewMs: number;
  private readonly safetyMs: number;
  private renewTimer: ClockTimer | null = null;
  private releaseSub: Unsubscribe | null = null;
  private started: Promise<void> | null = null;
  private dead = false;
  /** Set by stop(): pending activations give up instead of waiting for leases. */
  private stopping = false;

  constructor(private readonly opts: ActorHostOptions) {
    this.nodeId = opts.nodeId;
    this.clock = opts.clock ?? systemClock;
    this.logger = opts.logger ?? silentLogger;
    this.ttlMs = opts.leaseTtlMs ?? DEFAULT_TTL_MS;
    this.renewMs = opts.leaseRenewMs ?? DEFAULT_RENEW_MS;
    this.safetyMs = opts.leaseSafetyMs ?? Math.floor(this.ttlMs / 5);
    if (this.renewMs >= this.ttlMs - this.safetyMs) throw new Error('leaseRenewMs must be shorter than leaseTtlMs - leaseSafetyMs');
    this.timers = new TimerService(this.clock, (address, key, token) => this.onTimer(address, key, token));
  }

  register(reg: ActorRegistration): this {
    if (this.kinds.has(reg.definition.kind)) throw new Error(`Actor kind ${reg.definition.kind} already registered`);
    if (!Number.isInteger(reg.definition.snapshotEvery) || reg.definition.snapshotEvery < 1) throw new Error('snapshotEvery must be a positive integer');
    this.kinds.set(reg.definition.kind, reg);
    return this;
  }

  registration(kind: string): ActorRegistration | undefined {
    return this.kinds.get(kind);
  }

  registrations(): ActorRegistration[] {
    return [...this.kinds.values()];
  }

  /** Subscribes to lease-release notices and starts the lease renewal loop. */
  start(): Promise<void> {
    this.started ??= (async () => {
      this.releaseSub = await this.opts.bus.subscribe(LEASE_RELEASED_CHANNEL, (msg) => {
        const resource = (msg as { resource?: unknown })?.resource;
        if (typeof resource === 'string') this.wakeAcquirers(resource);
      });
      this.scheduleRenew();
    })();
    return this.started;
  }

  // ------------------------------------------------------------------ queries

  isActive(kind: string, actorId: string): boolean {
    return this.records.get(actorAddress(kind, actorId))?.status === 'active';
  }

  /** Whether the actor is hosted here in any state (activating, active, draining, faulted). */
  isHosted(kind: string, actorId: string): boolean {
    return this.records.has(actorAddress(kind, actorId));
  }

  statusOf(kind: string, actorId: string): ActorStatus | null {
    return this.records.get(actorAddress(kind, actorId))?.status ?? null;
  }

  /** Current committed state (read-only; never mutate). */
  stateOf<S>(kind: string, actorId: string): S | undefined {
    const rec = this.records.get(actorAddress(kind, actorId));
    return rec && rec.status !== 'activating' ? (rec.state as S) : undefined;
  }

  hostedIds(kind: string): string[] {
    return [...this.records.values()].filter((r) => r.kind === kind).map((r) => r.actorId);
  }

  stats(): ActorStats[] {
    return [...this.records.values()].map((r) => this.statsOf(r));
  }

  stat(kind: string, actorId: string): ActorStats | null {
    const rec = this.records.get(actorAddress(kind, actorId));
    return rec ? this.statsOf(rec) : null;
  }

  /** Active with nothing queued, in flight or armed, and no submit for `ms` (monotonic). */
  isIdle(kind: string, actorId: string, ms: number): boolean {
    const rec = this.records.get(actorAddress(kind, actorId));
    if (!rec || rec.status !== 'active' || rec.running || rec.suspect || rec.queue.length > 0) return false;
    return this.timers.timersOf(rec.address).length === 0 && this.clock.monotonic() - rec.lastActivity >= ms;
  }

  /** Resolves once no actor has queued or in-flight commands (tests / graceful shutdown). */
  async idle(): Promise<void> {
    for (;;) {
      const busy = [...this.records.values()].some((r) => r.running || (r.queue.length > 0 && r.status === 'active'));
      if (!busy && this.retiring.size === 0) return;
      await new Promise((r) => setTimeout(r, 1));
    }
  }

  // ------------------------------------------------------------- activation

  /**
   * Acquires the lease (waiting for a previous owner's lease to expire),
   * subscribes to the actor's command channel, recovers state from the log
   * and re-arms timers. Concurrent calls share one activation.
   */
  activate(kind: string, actorId: string, opts: { acquireWaitMs?: number } = {}): Promise<RecoveryReport> {
    const address = actorAddress(kind, actorId);
    const existing = this.records.get(address);
    if (existing && existing.status !== 'draining') return existing.activation;
    if (existing) return this.waitRetired(existing).then(() => this.activate(kind, actorId, opts));
    const reg = this.kinds.get(kind);
    if (!reg) return Promise.reject(new ActorRuntimeError('UNKNOWN_ACTOR_KIND', `No actor kind ${kind} registered`));
    if (this.dead || this.stopping) return Promise.reject(new ActorRuntimeError('NOT_OWNER', 'Host stopped'));
    const rec: ActorRecord = {
      kind,
      actorId,
      address,
      reg,
      status: 'activating',
      retired: false,
      state: undefined,
      seq: 0,
      lastAt: 0,
      lastSnapshotSeq: 0,
      lease: null,
      leaseValidUntil: 0,
      suspect: false,
      retryTimer: null,
      lastActivity: this.clock.monotonic(),
      queue: new Fifo(),
      running: false,
      drainWaiters: [],
      unsubscribe: null,
      activation: Promise.resolve(null as unknown as RecoveryReport),
      lastProgressAt: null,
      lastLatencyMs: null,
      processed: 0,
      fault: null,
    };
    this.records.set(address, rec);
    rec.activation = this.runActivation(rec, opts.acquireWaitMs ?? this.opts.acquireWaitMs ?? this.ttlMs + this.renewMs);
    rec.activation.catch(() => undefined);
    return rec.activation;
  }

  private async runActivation(rec: ActorRecord, waitMs: number): Promise<RecoveryReport> {
    const { definition: def, log } = rec.reg;
    const previous = this.retiring.get(rec.address);
    if (previous) await previous;
    try {
      await this.start();
      rec.lease = await this.acquireLease(rec, waitMs);
      rec.unsubscribe = await this.opts.bus.subscribe(commandChannelOf(def, rec.actorId), (msg) => this.onRemote(rec, msg));
    } catch (err) {
      this.retire(rec, `activation failed: ${errMessage(err)}`, new ActorRuntimeError('NOT_OWNER', 'Actor could not be activated here'));
      throw err instanceof ActorRuntimeError ? err : new ActorRuntimeError('UNAVAILABLE', `Activation failed: ${errMessage(err)}`);
    }
    if (rec.retired) throw new ActorRuntimeError('NOT_OWNER', 'Lease lost during activation');
    let recovered;
    try {
      recovered = await recoverActor(def, log, rec.actorId, { verify: this.opts.verifyOnRecovery === true });
    } catch (err) {
      if (err instanceof ReplayStepError || err instanceof DeterminismError) {
        const phase = err instanceof ReplayStepError ? 'replay' : 'determinism';
        this.fault(rec, phase, err, err instanceof ReplayStepError ? err.seq : rec.seq);
        throw new ActorRuntimeError(phase === 'replay' ? 'FAULTED' : 'NONDETERMINISTIC', err.message);
      }
      this.retire(rec, `recovery failed: ${errMessage(err)}`, new ActorRuntimeError('NOT_OWNER', 'Actor could not be recovered here'));
      throw new ActorRuntimeError('UNAVAILABLE', `Recovery failed: ${errMessage(err)}`);
    }
    if (rec.retired) throw new ActorRuntimeError('NOT_OWNER', 'Lease lost during recovery');
    rec.state = recovered.state;
    rec.seq = recovered.seq;
    rec.lastAt = recovered.lastAt;
    rec.lastSnapshotSeq = recovered.report.snapshotSeq;
    for (const t of def.pendingTimers(rec.state)) this.timers.schedule(rec.address, t.key, t.at, t.token);
    rec.status = 'active';
    rec.lastActivity = this.clock.monotonic();
    this.gauge(rec.kind);
    this.logger.info({ kind: rec.kind, actorId: rec.actorId, ...recovered.report }, 'actor activated');
    this.kick(rec);
    return recovered.report;
  }

  private async acquireLease(rec: ActorRecord, waitMs: number): Promise<Lease> {
    const deadline = this.clock.now() + waitMs;
    const pollMs = Math.max(25, Math.floor(this.ttlMs / 10));
    for (;;) {
      if (rec.retired || this.dead || this.stopping) throw new ActorRuntimeError('NOT_OWNER', 'Activation cancelled');
      const sent = this.clock.monotonic();
      const lease = await this.opts.leases.acquire(rec.address, this.nodeId, this.ttlMs, this.clock.now());
      if (lease) {
        rec.leaseValidUntil = this.validUntil(sent);
        return lease;
      }
      const remaining = deadline - this.clock.now();
      if (remaining <= 0) throw new ActorRuntimeError('UNAVAILABLE', `Lease ${rec.address} is held by another node`);
      await this.waitForRelease(rec.address, Math.min(pollMs, remaining));
    }
  }

  private waitForRelease(resource: string, ms: number): Promise<void> {
    return new Promise((resolve) => {
      let set = this.releaseWaiters.get(resource);
      if (!set) {
        set = new Set();
        this.releaseWaiters.set(resource, set);
      }
      const waiters = set;
      const done = () => {
        this.clock.clearTimeout(timer);
        waiters.delete(done);
        if (waiters.size === 0 && this.releaseWaiters.get(resource) === waiters) this.releaseWaiters.delete(resource);
        resolve();
      };
      const timer = this.clock.setTimeout(done, ms);
      waiters.add(done);
    });
  }

  private wakeAcquirers(resource: string): void {
    for (const w of [...(this.releaseWaiters.get(resource) ?? [])]) w();
  }

  // ---------------------------------------------------------- deactivation

  /**
   * Graceful hand-off: stops accepting new commands (NOT_OWNER), processes
   * those already queued, writes a final snapshot, cancels timers, releases
   * the lease. A faulted actor is released without a snapshot.
   */
  async deactivate(kind: string, actorId: string, reason = 'deactivated'): Promise<void> {
    const rec = this.records.get(actorAddress(kind, actorId));
    if (!rec) return this.retiring.get(actorAddress(kind, actorId));
    if (rec.status === 'activating') await rec.activation.catch(() => undefined);
    if (rec.retired) return this.waitRetired(rec);
    if (rec.status === 'faulted') {
      this.retire(rec, reason, new ActorRuntimeError('NOT_OWNER', 'Actor deactivated'));
      return this.waitRetired(rec);
    }
    if (rec.status !== 'draining') {
      rec.status = 'draining';
      this.kick(rec);
    }
    await this.waitDrained(rec);
    if (rec.retired) return this.waitRetired(rec);
    // A queued command may have faulted the actor while draining.
    if ((rec.status as ActorStatus) !== 'faulted' && rec.seq > rec.lastSnapshotSeq) {
      try {
        const snap = this.snapshotOf(rec.reg.definition, rec.state, rec.seq, rec.lastAt);
        await this.withDeadline(this.opts.transactions.run((tx) => rec.reg.log.saveSnapshot(tx, rec.actorId, snap)), 'final snapshot');
        rec.lastSnapshotSeq = rec.seq;
      } catch (err) {
        // Not fatal: the command log is authoritative; recovery just replays more.
        this.logger.warn({ kind, actorId, err: errMessage(err) }, 'final snapshot failed');
      }
    }
    this.retire(rec, reason, new ActorRuntimeError('NOT_OWNER', 'Actor deactivated'));
    return this.waitRetired(rec);
  }

  /** Restarts a FAULTED actor from its durable log (after the bug is fixed / for an operator retry). */
  async resetFaulted(kind: string, actorId: string): Promise<RecoveryReport> {
    const rec = this.records.get(actorAddress(kind, actorId));
    if (rec?.status === 'faulted') {
      this.retire(rec, 'reset after fault', new ActorRuntimeError('NOT_OWNER', 'Actor restarting'));
      await this.waitRetired(rec);
    }
    return this.activate(kind, actorId);
  }

  /** Graceful stop of every hosted actor (final snapshots, lease releases), then of the host. */
  async stop(): Promise<void> {
    this.stopping = true;
    for (const resource of [...this.releaseWaiters.keys()]) this.wakeAcquirers(resource);
    await Promise.all([...this.records.values()].map((r) => this.deactivate(r.kind, r.actorId, 'node stopping')));
    this.dead = true;
    this.stopLoops();
    await this.releaseSub?.();
    this.releaseSub = null;
  }

  /**
   * Simulates abrupt process death (chaos tests): timers and renewals stop,
   * subscriptions close, queued commands are rejected — and NOTHING is
   * written or released, exactly as if the process had been killed.
   */
  async abandon(): Promise<void> {
    this.dead = true;
    this.stopLoops();
    const recs = [...this.records.values()];
    this.records.clear();
    for (const rec of recs) {
      rec.retired = true;
      this.clearRetry(rec);
      for (const job of rec.queue.drainAll()) job.reject(new ActorRuntimeError('NOT_OWNER', 'Node stopped'));
    }
    await Promise.allSettled([...recs.map((r) => r.unsubscribe?.()), this.releaseSub?.()]);
  }

  private stopLoops(): void {
    if (this.renewTimer) this.clock.clearTimeout(this.renewTimer);
    this.renewTimer = null;
    this.timers.stop();
  }

  /**
   * Removes the actor from this node: rejects queued commands with `error`,
   * cancels timers, unsubscribes and (best effort, compare-and-set) releases
   * the lease once any in-flight command has finished.
   */
  private retire(rec: ActorRecord, reason: string, error: ActorRuntimeError): void {
    if (rec.retired) return;
    rec.retired = true;
    if (this.records.get(rec.address) === rec) this.records.delete(rec.address);
    this.timers.cancelAll(rec.address);
    this.clearRetry(rec);
    for (const job of rec.queue.drainAll()) job.reject(error);
    const done = (async () => {
      await this.waitDrained(rec);
      await rec.unsubscribe?.().catch(() => undefined);
      if (rec.lease) {
        try {
          await this.opts.leases.release(rec.lease);
          await this.opts.bus.publish(LEASE_RELEASED_CHANNEL, { resource: rec.address });
        } catch (err) {
          this.logger.warn({ address: rec.address, err: errMessage(err) }, 'lease release failed (it will expire)');
        }
      }
    })();
    this.retiring.set(rec.address, done);
    void done.finally(() => {
      if (this.retiring.get(rec.address) === done) this.retiring.delete(rec.address);
    });
    this.gauge(rec.kind);
    this.logger.info({ kind: rec.kind, actorId: rec.actorId, seq: rec.seq, reason }, 'actor deactivated');
    this.opts.onDeactivated?.({ kind: rec.kind, actorId: rec.actorId, reason });
  }

  private waitRetired(rec: ActorRecord): Promise<void> {
    return this.retiring.get(rec.address) ?? Promise.resolve();
  }

  private waitDrained(rec: ActorRecord): Promise<void> {
    if (!rec.running && (rec.queue.length === 0 || (rec.status !== 'active' && rec.status !== 'draining') || rec.retired)) return Promise.resolve();
    return new Promise((resolve) => rec.drainWaiters.push(resolve));
  }

  private loseOwnership(rec: ActorRecord, reason: string): void {
    if (rec.retired) return;
    this.logger.warn({ kind: rec.kind, actorId: rec.actorId, seq: rec.seq, reason }, 'actor ownership lost');
    this.retire(rec, reason, new ActorRuntimeError('NOT_OWNER', `Ownership lost: ${reason}`));
  }

  // ------------------------------------------------------------ leases

  /**
   * Judged on the monotonic clock: a wall-clock step (NTP) must never extend
   * how long this node believes it still owns the actor.
   */
  private leaseValid(rec: ActorRecord): boolean {
    return rec.lease !== null && this.clock.monotonic() < rec.leaseValidUntil;
  }

  /** Validity of a lease granted for a request sent at monotonic time `sent` (the store's TTL starts later). */
  private validUntil(sent: number): number {
    return sent + this.ttlMs - this.safetyMs;
  }

  private scheduleRenew(): void {
    if (this.dead) return;
    this.renewTimer = this.clock.setTimeout(() => {
      void this.renewAll().finally(() => this.scheduleRenew());
    }, this.renewMs);
  }

  /**
   * Renews every held lease. A refused renewal (another owner, or expired)
   * stops the actor immediately. A renewal that errors (Redis unreachable)
   * is retried next period while the lease is still locally valid; every
   * command also checks local validity before it is processed.
   */
  async renewAll(): Promise<void> {
    const recs = [...this.records.values()].filter((r) => r.lease && !r.retired);
    await Promise.all(
      recs.map(async (rec) => {
        const lease = rec.lease!;
        try {
          const sent = this.clock.monotonic();
          const renewed = await this.opts.leases.renew(lease, this.ttlMs, this.clock.now());
          if (rec.retired || rec.lease !== lease) return;
          if (renewed) {
            rec.lease = renewed;
            rec.leaseValidUntil = this.validUntil(sent);
          } else this.loseOwnership(rec, 'lease renewal refused');
        } catch (err) {
          this.logger.warn({ address: rec.address, err: errMessage(err) }, 'lease renewal error');
          if (!rec.retired && !this.leaseValid(rec)) this.loseOwnership(rec, 'lease renewal failed and the lease is about to expire');
        }
      }),
    );
  }

  // ------------------------------------------------------------ commands

  /**
   * Submits a command to a locally hosted actor. Rejects NOT_OWNER if it is
   * not hosted here, and UNAVAILABLE when `signal` aborts first (see `bindDeadline`).
   */
  submit<R = unknown>(kind: string, actorId: string, command: unknown, opts: HostSubmitOptions = {}): Promise<R> {
    const rec = this.records.get(actorAddress(kind, actorId));
    if (!rec) return Promise.reject(new ActorRuntimeError('NOT_OWNER', `${kind} ${actorId} is not hosted on ${this.nodeId}`));
    return this.enqueue(rec, command, opts) as Promise<R>;
  }

  private enqueue(rec: ActorRecord, command: unknown, opts: { commandId?: string; signal?: AbortSignal } = {}): Promise<unknown> {
    if (rec.status === 'faulted') return Promise.reject(this.faultedError(rec));
    if (rec.status === 'draining' || rec.retired) return Promise.reject(new ActorRuntimeError('NOT_OWNER', 'Actor is moving to another node'));
    if (opts.signal?.aborted) return Promise.reject(deadlineError(false));
    if (rec.queue.length >= (this.opts.maxQueue ?? 10_000)) return Promise.reject(new ActorRuntimeError('UNAVAILABLE', 'Actor mailbox is full'));
    let normalized: unknown;
    try {
      // Live processing sees exactly what replay will see: plain JSON with canonical key order.
      normalized = canonicalCopy(command);
    } catch {
      return Promise.reject(new TypeError('Actor commands must be JSON-serializable'));
    }
    rec.lastActivity = this.clock.monotonic();
    return new Promise((resolve, reject) => {
      const job: Job = { command: normalized, commandId: opts.commandId ?? null, started: false, cancelled: false, resolve, reject };
      if (opts.signal) bindDeadline(job, opts.signal);
      rec.queue.push(job);
      this.kick(rec);
    });
  }

  private faultedError(rec: ActorRecord): ActorRuntimeError {
    return new ActorRuntimeError('FAULTED', `${rec.kind} ${rec.actorId} is halted after an internal error: ${rec.fault?.message ?? 'unknown'}`);
  }

  private kick(rec: ActorRecord): void {
    if (rec.running || rec.retired || (rec.status !== 'active' && rec.status !== 'draining')) return;
    void this.drain(rec);
  }

  private async drain(rec: ActorRecord): Promise<void> {
    rec.running = true;
    try {
      while (!rec.retired && (rec.status === 'active' || rec.status === 'draining')) {
        // Never answer from a state that may be behind the durable log.
        if (rec.suspect) {
          if (await this.reconcile(rec)) continue;
          break;
        }
        const job = rec.queue.shift();
        if (!job) break;
        if (job.cancelled) continue;
        await this.processOne(rec, job);
      }
    } catch (err) {
      // processOne handles its own failures; anything here is a host bug.
      this.logger.error({ address: rec.address, err: errMessage(err) }, 'actor drain loop failed');
    } finally {
      rec.running = false;
      for (const w of rec.drainWaiters.splice(0)) w();
    }
  }

  private async processOne(rec: ActorRecord, job: Job): Promise<void> {
    const started = performance.now();
    const def = rec.reg.definition;
    job.started = true;
    if (!this.leaseValid(rec)) {
      job.reject(new ActorRuntimeError('NOT_OWNER', 'Lease expired'));
      this.loseOwnership(rec, 'lease no longer valid locally');
      return;
    }
    const env: ActorEnvelope<unknown> = {
      actorId: rec.actorId,
      seq: rec.seq + 1,
      commandId: job.commandId ?? randomUUID(),
      // Monotonic per actor even if the wall clock steps backwards.
      at: Math.max(this.clock.now(), rec.lastAt),
      command: job.command,
    };

    let result: StepResult<unknown, unknown>;
    let logged: LoggedCommand;
    let meta: unknown;
    try {
      result = def.step(rec.state, env);
      checkStepResult(def, rec.state, result);
      if (result.noop) {
        job.resolve(result.reply);
        this.observe(rec, started);
        return;
      }
      logged = { seq: env.seq, commandId: env.commandId, at: env.at, type: def.commandType(env.command), command: env.command, actionId: def.actionIdOf(env.command) };
      meta = def.logMeta ? def.logMeta(result.state, env) : undefined;
    } catch (err) {
      this.fault(rec, 'step', err, env.seq);
      job.reject(this.faultedError(rec));
      return;
    }

    const snapshotDue = env.seq % def.snapshotEvery === 0;
    const dbStarted = performance.now();
    try {
      await this.withDeadline(
        this.opts.transactions.run(async (tx) => {
          await rec.reg.log.append(tx, rec.actorId, logged, result.events, meta);
          if (result.projection) await result.projection(tx.repos);
          if (snapshotDue) await rec.reg.log.saveSnapshot(tx, rec.actorId, this.snapshotOf(def, result.state, env.seq, env.at));
        }),
        'unit of work',
      );
    } catch (err) {
      this.opts.metrics?.dbErrors.inc({ area: 'actor' });
      await this.onCommitFailure(rec, job, env, err);
      return;
    }
    const dbMs = performance.now() - dbStarted;
    this.opts.metrics?.dbLatency.observe(dbMs);
    this.opts.metrics?.windows.dbLatency.record(dbMs);

    // Committed: only now does the in-memory actor advance.
    rec.state = result.state;
    rec.seq = env.seq;
    rec.lastAt = env.at;
    rec.lastProgressAt = env.at;
    rec.processed++;
    if (snapshotDue) rec.lastSnapshotSeq = env.seq;
    if (!rec.retired && rec.status !== 'faulted') {
      for (const key of result.cancelTimers) this.timers.cancel(rec.address, key);
      for (const t of result.timers) this.timers.schedule(rec.address, t.key, t.at, t.token);
    }
    for (const m of result.outbox) {
      // Issued in order without awaiting: per-channel order is preserved by the bus connection.
      this.opts.bus.publish(m.channel, m.message).catch((err: unknown) => {
        this.opts.metrics?.errors.inc({ area: 'bus_publish' });
        this.logger.warn({ channel: m.channel, err: errMessage(err) }, 'outbox publish failed (at-most-once)');
      });
    }
    job.resolve(result.reply);
    this.observe(rec, started);
  }

  private async onCommitFailure(rec: ActorRecord, job: Job, env: ActorEnvelope<unknown>, err: unknown): Promise<void> {
    if (err instanceof DuplicateSequenceError) {
      // Distinguish fencing (our seq exists: another owner — or an ambiguous
      // earlier commit — wrote it) from an idempotency-key collision.
      let fenced: boolean | null;
      try {
        const found = await rec.reg.log.commandsAfter(rec.actorId, env.seq - 1, 1);
        fenced = found[0]?.seq === env.seq;
      } catch {
        fenced = null;
      }
      if (fenced === true) {
        job.reject(new ActorRuntimeError('FENCED', `Sequence ${env.seq} of ${rec.address} was written by another owner`));
        this.opts.metrics?.integrityViolations.inc({ code: 'ACTOR_FENCED' });
        this.loseOwnership(rec, `fenced at seq ${env.seq}`);
        return;
      }
      if (fenced === false) {
        job.reject(new ActorRuntimeError('CONFLICT', 'The command idempotency key is already recorded'));
        return;
      }
    }
    this.logger.warn({ address: rec.address, seq: env.seq, err: errMessage(err) }, 'actor transaction failed');
    // A failure reported for COMMIT itself (or a timeout) can hide a successful commit, hence
    // 'unknown' — and the log must be checked before this state answers anything again.
    rec.suspect = true;
    job.reject(new ActorRuntimeError('PERSISTENCE_FAILED', `Could not persist the command: ${errMessage(err)}`, 'unknown'));
  }

  /**
   * Settles an ambiguous unit of work: if the log holds seq + 1 the command
   * did commit, so the actor catches up by replaying the log from its current
   * state and re-arms timers from the new state (its outbox messages are lost:
   * at-most-once). Returns false when processing must pause: the log is
   * unreachable (retried after reconcileRetryMs), or replay faulted.
   */
  private async reconcile(rec: ActorRecord): Promise<boolean> {
    const { definition: def, log } = rec.reg;
    try {
      const next = await this.withDeadline(log.commandsAfter(rec.actorId, rec.seq, 1), 'log read');
      if (rec.retired) return false;
      if (next.length > 0) {
        const from = { state: rec.state, seq: rec.seq, lastAt: rec.lastAt };
        const caughtUp = await this.withDeadline(recoverActor(def, log, rec.actorId, { from, verify: this.opts.verifyOnRecovery === true }), 'log replay');
        if (rec.retired) return false;
        rec.state = caughtUp.state;
        rec.seq = caughtUp.seq;
        rec.lastAt = caughtUp.lastAt;
        rec.lastProgressAt = caughtUp.lastAt;
        this.timers.cancelAll(rec.address);
        if (rec.status !== 'faulted') for (const t of def.pendingTimers(rec.state)) this.timers.schedule(rec.address, t.key, t.at, t.token);
        this.logger.warn({ address: rec.address, from: from.seq, seq: rec.seq }, 'ambiguous commit had committed: actor caught up from the log');
      }
      rec.suspect = false;
      return true;
    } catch (err) {
      if (err instanceof ReplayStepError || err instanceof DeterminismError) {
        this.fault(rec, err instanceof ReplayStepError ? 'replay' : 'determinism', err, err instanceof ReplayStepError ? err.seq : rec.seq + 1);
        return false;
      }
      this.logger.warn({ address: rec.address, seq: rec.seq, err: errMessage(err) }, 'cannot settle an ambiguous commit yet (log unreachable); commands wait');
      this.clearRetry(rec);
      rec.retryTimer = this.clock.setTimeout(() => {
        rec.retryTimer = null;
        this.kick(rec);
      }, this.opts.reconcileRetryMs ?? 1000);
      return false;
    }
  }

  private clearRetry(rec: ActorRecord): void {
    if (rec.retryTimer) this.clock.clearTimeout(rec.retryTimer);
    rec.retryTimer = null;
  }

  /**
   * Bounds a database call. Without it a black-holed connection (no reset, no
   * reply) wedges the actor's mailbox forever while the lease keeps renewing.
   * The abandoned call may still complete later; callers treat a timeout as
   * an ambiguous outcome.
   */
  private withDeadline<T>(work: Promise<T>, what: string): Promise<T> {
    const ms = this.opts.commitTimeoutMs ?? DEFAULT_COMMIT_TIMEOUT_MS;
    return new Promise<T>((resolve, reject) => {
      const timer = this.clock.setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
      work.then(
        (v) => {
          this.clock.clearTimeout(timer);
          resolve(v);
        },
        (e: unknown) => {
          this.clock.clearTimeout(timer);
          reject(e);
        },
      );
    });
  }

  private fault(rec: ActorRecord, phase: ActorFault['phase'], error: unknown, seq: number): void {
    rec.status = 'faulted';
    rec.fault = { phase, message: errMessage(error), at: this.clock.now(), seq };
    this.timers.cancelAll(rec.address);
    for (const job of rec.queue.drainAll()) job.reject(this.faultedError(rec));
    this.opts.metrics?.errors.inc({ area: 'actor_fault' });
    this.opts.metrics?.integrityViolations.inc({ code: 'ACTOR_FAULT' });
    this.gauge(rec.kind);
    this.logger.error({ kind: rec.kind, actorId: rec.actorId, seq, phase, err: errMessage(error) }, 'actor FAULTED');
    try {
      this.opts.onFault?.({ kind: rec.kind, actorId: rec.actorId, seq, phase, error });
    } catch {
      // The alert hook must never break the host.
    }
  }

  private snapshotOf(def: AnyActorDefinition, state: unknown, seq: number, at: number): Snapshot {
    return { commandSeq: seq, version: def.versionOf ? def.versionOf(state) : seq, at, state: def.toSnapshot ? def.toSnapshot(state) : state };
  }

  private observe(rec: ActorRecord, started: number): void {
    const ms = performance.now() - started;
    rec.lastLatencyMs = ms;
    this.opts.metrics?.commandLatency.observe(ms, { kind: rec.kind });
  }

  private gauge(kind: string): void {
    const m = this.opts.metrics;
    if (!m) return;
    const g = m.registry.gauge('jpb_actors_hosted', 'Actors hosted on this node, by kind and status');
    const counts: Record<ActorStatus, number> = { activating: 0, active: 0, draining: 0, faulted: 0 };
    for (const r of this.records.values()) if (r.kind === kind) counts[r.status]++;
    for (const [status, n] of Object.entries(counts)) g.set(n, { kind, status });
  }

  // ------------------------------------------------------------ timers

  private onTimer(address: string, key: string, token: string): void {
    const rec = this.records.get(address);
    if (!rec || rec.status !== 'active') return;
    let command: unknown;
    try {
      command = rec.reg.definition.timerCommand(key, token);
    } catch (err) {
      this.fault(rec, 'step', err, rec.seq + 1);
      return;
    }
    this.enqueue(rec, command).catch((err: unknown) => {
      // A transient failure must not lose the timer: re-arm it unless it was replaced meanwhile.
      if (!(err instanceof ActorRuntimeError) || !err.retryable || err.code === 'NOT_OWNER' || err.code === 'FENCED') return;
      const live = this.records.get(address);
      if (live !== rec || rec.status !== 'active') return;
      if (this.timers.timersOf(address).some((t) => t.key === key)) return;
      this.timers.schedule(address, key, this.clock.now() + (this.opts.timerRetryMs ?? 1000), token);
    });
  }

  // ------------------------------------------------------------ remote commands

  /**
   * Answers a read-only query from the actor's last committed state, without
   * entering the mailbox: at scale, thousands of reads (snapshots, summaries)
   * must never queue in front of commands. The state is replaced only after a
   * command commits, so a reader never sees uncommitted state, and a client
   * that received a command's reply reads the state that includes it.
   */
  async read(kind: string, actorId: string, query: unknown): Promise<unknown> {
    const rec = this.records.get(actorAddress(kind, actorId));
    if (!rec) throw new ActorRuntimeError('NOT_OWNER', `${kind} ${actorId} is not hosted on ${this.nodeId}`);
    if (rec.status === 'activating') await rec.activation;
    if (rec.retired || rec.status !== 'active' || !this.leaseValid(rec)) throw new ActorRuntimeError('NOT_OWNER', `${kind} ${actorId} is not active on ${this.nodeId}`);
    const def = rec.reg.definition;
    if (!def.read) throw new ActorRuntimeError('UNKNOWN_ACTOR_KIND', `${kind} has no read path`);
    return def.read(rec.state, query, this.clock.now());
  }

  /** Hands a routed request (e.g. from the node inbox) to a hosted actor; ignored if not hosted. */
  deliverRemote(request: unknown): void {
    if (!isRpcRequest(request)) return;
    const rec = this.records.get(actorAddress(request.kind, request.actorId));
    if (rec) this.onRemote(rec, request);
  }

  /**
   * Bus request handler. Only a node that holds a valid lease answers; others
   * stay silent so a requester never receives a rejection from a node that is
   * not the owner while the real owner processes the command.
   */
  private onRemote(rec: ActorRecord, raw: unknown): void {
    if (!isRpcRequest(raw) || raw.kind !== rec.kind || raw.actorId !== rec.actorId) return;
    if (rec.retired || rec.status === 'draining' || !this.leaseValid(rec)) return;
    const id = raw.correlationId;
    const send = (reply: RpcReply) =>
      this.opts.bus.publish(raw.replyTo, reply).catch((err: unknown) => this.logger.warn({ err: errMessage(err) }, 'rpc reply publish failed'));
    const known = this.rpcReplies.get(id);
    if (known !== undefined) {
      // Never processed twice. A retransmission means the requester missed our ack or result.
      if (attemptOf(raw) > 0) void send(known ?? { t: 'actor_ack', correlationId: id });
      return;
    }
    this.rpcReplies.set(id, null);
    void send({ t: 'actor_ack', correlationId: id });
    const settle = (reply: RpcReply) => {
      this.rpcReplies.set(id, reply);
      void send(reply);
    };
    this.handleRemote(rec, raw).then(
      (reply) => settle({ t: 'actor_result', correlationId: id, ok: true, reply }),
      (err: unknown) => {
        const e = err instanceof ActorRuntimeError ? err : new ActorRuntimeError('UNAVAILABLE', errMessage(err), 'unknown');
        settle({ t: 'actor_result', correlationId: id, ok: false, error: e.toWire() });
      },
    );
  }

  /**
   * The command is logged with commandId = correlationId. A retransmission
   * seen here for the first time may already have been committed by a
   * previous owner whose replies were lost before a hand-off: then the
   * logged command's reply is returned instead of applying it again.
   */
  private async handleRemote(rec: ActorRecord, req: RpcRequest): Promise<unknown> {
    if (req.read) return this.read(rec.kind, rec.actorId, req.command);
    if (attemptOf(req) > 0) {
      if (rec.status === 'activating') await rec.activation;
      const logged = await this.findLogged(rec, req.correlationId);
      if (logged) return this.replyOf(rec, logged);
    }
    return this.enqueue(rec, req.command, { commandId: req.correlationId });
  }

  private async findLogged(rec: ActorRecord, commandId: string): Promise<LoggedCommand | null> {
    const from = Math.max(0, rec.seq - RPC_LOOKBACK_COMMANDS);
    const tail = await this.withDeadline(rec.reg.log.commandsAfter(rec.actorId, from, 2 * RPC_LOOKBACK_COMMANDS), 'log read');
    return tail.find((c) => c.commandId === commandId) ?? null;
  }

  /**
   * The reply a logged command produced, recomputed from the log: `step` is
   * deterministic, so re-running it on the state before the command yields
   * the original reply. May replay the whole log when the latest snapshot is
   * newer than the command (rare: only for duplicates after a hand-off).
   */
  private async replyOf(rec: ActorRecord, logged: LoggedCommand): Promise<unknown> {
    const def = rec.reg.definition;
    try {
      const before = await this.withDeadline(recoverActor(def, rec.reg.log, rec.actorId, { untilSeq: logged.seq - 1 }), 'log replay');
      return replayOne(def, before.state, rec.actorId, logged).reply;
    } catch (err) {
      if (!(err instanceof ReplayStepError || err instanceof DeterminismError)) throw err;
      throw new ActorRuntimeError('CONFLICT', `Request already processed as command ${logged.seq}; its reply could not be rebuilt: ${err.message}`);
    }
  }

  private statsOf(r: ActorRecord): ActorStats {
    return {
      kind: r.kind,
      actorId: r.actorId,
      status: r.status,
      seq: r.seq,
      queueLength: r.queue.length,
      lastProgressAt: r.lastProgressAt,
      lastLatencyMs: r.lastLatencyMs,
      processed: r.processed,
      faulted: r.status === 'faulted',
      fault: r.fault,
      leaseEpoch: r.lease?.epoch ?? null,
      leaseExpiresAt: r.lease?.expiresAt ?? null,
      lastSnapshotSeq: r.lastSnapshotSeq,
      timers: this.timers.timersOf(r.address).length,
      reconciling: r.suspect,
    };
  }
}

/** Rejects the job when the submitter's deadline passes: processed 'no' if it never started, 'unknown' if in flight. */
function bindDeadline(job: Job, signal: AbortSignal): void {
  const { resolve, reject } = job;
  const onAbort = () => {
    job.cancelled = !job.started;
    reject(deadlineError(job.started));
  };
  signal.addEventListener('abort', onAbort, { once: true });
  job.resolve = (reply) => {
    signal.removeEventListener('abort', onAbort);
    resolve(reply);
  };
  job.reject = (err) => {
    signal.removeEventListener('abort', onAbort);
    reject(err);
  };
}

function deadlineError(started: boolean): ActorRuntimeError {
  return started
    ? new ActorRuntimeError('UNAVAILABLE', 'Deadline exceeded while the command was being processed', 'unknown')
    : new ActorRuntimeError('UNAVAILABLE', 'Deadline exceeded before the command was processed');
}
