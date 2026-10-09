import { randomUUID } from 'node:crypto';
import type { MessageBus, Unsubscribe } from '../bus/bus';
import type { NodeRole } from '../config/env';
import type { ActorHost } from './actor-host';
import { actorAddress, commandChannelOf, poolOf } from './actor';
import type { Clock, ClockTimer } from './clock';
import { sleep, systemClock } from './clock';
import { ActorRuntimeError } from './errors';
import type { MemberInfo } from './membership';
import { placeActor, roleServesPool } from './placement';
import type { RpcReply, RpcRequest } from './rpc';
import { inboxChannel, isRpcReply, isRpcRequest, replyChannel } from './rpc';

/**
 * ActorRouter — `submit(kind, id, command)` from anywhere in the cluster.
 *
 *   1. hosted here and active          → local mailbox (no serialization, no network);
 *   2. placement says this node owns it → activate on demand, then local mailbox;
 *   3. otherwise                        → bus request/reply to the actor's
 *      command channel, answered by whichever node holds the lease.
 *
 * Only errors that guarantee the command was NOT applied (NOT_OWNER, FENCED)
 * are retried, with placement re-resolved each time. The deadline holds on
 * every path, local ones included: a command still queued when it passes is
 * withdrawn (UNAVAILABLE, processed 'no'); one in flight, or a remote request
 * without a reply, is reported as UNAVAILABLE with processed = 'unknown': the
 * caller must retry with the same idempotency key, never blindly.
 */
export interface SubmitOptions {
  /** Overall deadline for this submit (default: router requestTimeoutMs). */
  timeoutMs?: number;
}

export interface ActorRouterOptions {
  nodeId: string;
  role: NodeRole;
  host: ActorHost;
  bus: MessageBus;
  /** Current live members (from Membership). */
  members: () => MemberInfo[];
  clock?: Clock;
  /** Default deadline per submit (default 5 s). */
  requestTimeoutMs?: number;
  /** Re-publish an unacknowledged request after this long (doubling, default 150 ms). */
  ackTimeoutMs?: number;
}

interface Pending {
  resolve(reply: unknown): void;
  reject(err: ActorRuntimeError): void;
  acked: boolean;
}

const RETRY_BACKOFF_MS = [10, 25, 50, 100, 200, 400];

export class ActorRouter {
  private readonly pending = new Map<string, Pending>();
  private readonly clock: Clock;
  private readonly replyTo: string;
  private unsubscribe: Unsubscribe | null = null;
  private unsubscribeInbox: Unsubscribe | null = null;
  private stopped = false;

  constructor(private readonly opts: ActorRouterOptions) {
    this.clock = opts.clock ?? systemClock;
    this.replyTo = replyChannel(opts.nodeId);
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.unsubscribe ??= await this.opts.bus.subscribe(this.replyTo, (msg) => this.onReply(msg));
    if (this.opts.role !== 'gateway') this.unsubscribeInbox ??= await this.opts.bus.subscribe(inboxChannel(this.opts.nodeId), (msg) => void this.onInbox(msg));
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const p of this.pending.values()) p.reject(new ActorRuntimeError('UNAVAILABLE', 'Router stopped', 'unknown'));
    this.pending.clear();
    await this.unsubscribe?.();
    await this.unsubscribeInbox?.();
    this.unsubscribe = null;
    this.unsubscribeInbox = null;
  }

  /** Node that placement assigns the actor to from this node's membership view (null if none). */
  ownerOf(kind: string, actorId: string): string | null {
    const reg = this.opts.host.registration(kind);
    if (!reg) return null;
    return placeActor(actorAddress(kind, actorId), poolOf(reg.definition), this.opts.members());
  }

  /** Whether this node is the placement owner and may host the kind. */
  placedHere(kind: string, actorId: string): boolean {
    const reg = this.opts.host.registration(kind);
    if (!reg || !roleServesPool(this.opts.role, poolOf(reg.definition))) return false;
    return this.ownerOf(kind, actorId) === this.opts.nodeId;
  }

  /** Read-only query against the owner's committed state (no mailbox, no log); same routing and deadlines as submit. */
  async read<R = unknown>(kind: string, actorId: string, query: unknown, opts: SubmitOptions = {}): Promise<R> {
    return this.submit<R>(kind, actorId, query, opts, true);
  }

  async submit<R = unknown>(kind: string, actorId: string, command: unknown, opts: SubmitOptions = {}, read = false): Promise<R> {
    const deadline = this.clock.now() + (opts.timeoutMs ?? this.opts.requestTimeoutMs ?? 5000);
    // One deadline for every path, local ones included: a command still queued
    // when it passes is withdrawn (processed 'no'); one in flight answers 'unknown'.
    const expiry = new AbortController();
    const timer = this.clock.setTimeout(() => expiry.abort(), Math.max(0, deadline - this.clock.now()));
    try {
      return (await this.submitUntil(kind, actorId, command, deadline, expiry.signal, read)) as R;
    } finally {
      this.clock.clearTimeout(timer);
    }
  }

  private async submitUntil(kind: string, actorId: string, command: unknown, deadline: number, signal: AbortSignal, read: boolean): Promise<unknown> {
    const host = this.opts.host;
    // Fast path: nothing beyond the mailbox (or, for reads, nothing at all) when the actor lives here.
    if (host.isActive(kind, actorId)) {
      try {
        return await (read ? host.read(kind, actorId, command, { signal }) : host.submit(kind, actorId, command, { signal }));
      } catch (err) {
        if (!isNotApplied(err)) throw err;
      }
    }
    if (!host.registration(kind)) throw new ActorRuntimeError('UNKNOWN_ACTOR_KIND', `No actor kind ${kind} registered`);
    for (let attempt = 0; ; attempt++) {
      if (this.stopped) throw new ActorRuntimeError('UNAVAILABLE', 'Router stopped');
      try {
        return await this.route(kind, actorId, command, deadline, signal, read);
      } catch (err) {
        if (!isNotApplied(err)) throw err;
        const wait = RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)]!;
        if (this.clock.now() + wait >= deadline) throw new ActorRuntimeError('UNAVAILABLE', `No owner available for ${kind} ${actorId}: ${(err as Error).message}`);
        await sleep(this.clock, wait);
      }
    }
  }

  private async route(kind: string, actorId: string, command: unknown, deadline: number, signal: AbortSignal, read: boolean): Promise<unknown> {
    const host = this.opts.host;
    const status = host.statusOf(kind, actorId);
    const local = () => (read ? host.read(kind, actorId, command, { signal }) : host.submit(kind, actorId, command, { signal }));
    if (status === 'faulted' && read) throw new ActorRuntimeError('FAULTED', `${kind} ${actorId} is halted`);
    // 'activating' queues in the mailbox until the deadline; 'faulted' answers FAULTED immediately.
    if (status === 'active' || status === 'activating' || status === 'faulted') return local();
    if (status === 'draining') throw new ActorRuntimeError('NOT_OWNER', 'Actor is moving to another node');
    if (!this.placedHere(kind, actorId)) return this.remote(kind, actorId, command, deadline, read);
    await host.activate(kind, actorId, { acquireWaitMs: Math.max(0, deadline - this.clock.now()) }).catch((err: unknown) => {
      // A lease still held elsewhere means the command was not applied: retryable.
      throw err instanceof ActorRuntimeError && err.code === 'UNAVAILABLE' ? new ActorRuntimeError('NOT_OWNER', err.message) : err;
    });
    return local();
  }

  private remote(kind: string, actorId: string, command: unknown, deadline: number, read = false): Promise<unknown> {
    const reg = this.opts.host.registration(kind)!;
    const channel = commandChannelOf(reg.definition, actorId);
    const correlationId = randomUUID();
    return new Promise((resolve, reject) => {
      let retransmit: ClockTimer | null = null;
      const timeout = this.clock.setTimeout(
        () => finish(() => reject(new ActorRuntimeError('UNAVAILABLE', `No reply from the owner of ${kind} ${actorId}`, 'unknown'))),
        Math.max(0, deadline - this.clock.now()),
      );
      const finish = (settle: () => void) => {
        if (!this.pending.delete(correlationId)) return;
        this.clock.clearTimeout(timeout);
        if (retransmit) this.clock.clearTimeout(retransmit);
        settle();
      };
      const entry: Pending = {
        acked: false,
        resolve: (reply) => finish(() => resolve(reply)),
        reject: (err) => finish(() => reject(err)),
      };
      this.pending.set(correlationId, entry);
      let backoff = this.opts.ackTimeoutMs ?? 150;
      let attempt = 0;
      const publish = () => {
        if (entry.acked || !this.pending.has(correlationId)) return;
        // `attempt` > 0 tells a new owner to look the request up in the durable log first.
        const request: RpcRequest = { t: 'actor_rpc', correlationId, replyTo: this.replyTo, kind, actorId, command, attempt, ...(read ? { read: true } : {}) };
        this.opts.bus.publish(channel, request).catch(() => undefined);
        // Unacknowledged: maybe nobody hosts the actor. Ask the placement owner to activate it.
        const owner = attempt++ > 0 ? this.ownerOf(kind, actorId) : null;
        if (owner && owner !== this.opts.nodeId) this.opts.bus.publish(inboxChannel(owner), request).catch(() => undefined);
        retransmit = this.clock.setTimeout(publish, backoff);
        backoff = Math.min(backoff * 2, 1000);
      };
      publish();
    });
  }

  /** Inbox: activate on demand if placement says the actor belongs here, then handle the request. */
  private async onInbox(raw: unknown): Promise<void> {
    if (!isRpcRequest(raw) || !this.opts.host.registration(raw.kind) || this.stopped) return;
    const host = this.opts.host;
    const status = host.statusOf(raw.kind, raw.actorId);
    if (status === null && !this.placedHere(raw.kind, raw.actorId)) return;
    if (status === null || status === 'activating') await host.activate(raw.kind, raw.actorId).catch(() => undefined);
    host.deliverRemote(raw);
  }

  private onReply(raw: unknown): void {
    if (!isRpcReply(raw)) return;
    const p = this.pending.get(raw.correlationId);
    if (!p) return;
    const reply = raw as RpcReply;
    if (reply.t === 'actor_ack') {
      p.acked = true;
      return;
    }
    if (reply.ok) p.resolve(reply.reply);
    else p.reject(ActorRuntimeError.fromWire(reply.error));
  }
}

const isNotApplied = (err: unknown): boolean => err instanceof ActorRuntimeError && (err.code === 'NOT_OWNER' || err.code === 'FENCED');
