import { describe, expect, it } from 'vitest';
import { LocalBus } from '../src/bus/local-bus';
import { stepResult } from '../src/runtime/actor';
import type { ActorDefinition } from '../src/runtime/actor';
import { ActorHost } from '../src/runtime/actor-host';
import type { ActorFault } from '../src/runtime/actor-host';
import { MemoryActorLog } from '../src/runtime/actor-log';
import { ManualClock } from '../src/runtime/clock';
import { ActorRuntimeError } from '../src/runtime/errors';
import { MemoryLeaseManager } from '../src/runtime/lease';
import { MemoryMembership, MemoryMembershipRegistry } from '../src/runtime/membership';
import { MemoryActorCatalog, NodeRuntime, createNodeRuntime } from '../src/runtime/node-runtime';
import type { NodeRole } from '../src/config/env';
import { replyChannel } from '../src/runtime/rpc';
import { memoryTransactions } from '../src/runtime/transactions';
import type { TransactionRunner } from '../src/runtime/transactions';
import type { BankCommand, BankReply, BankState } from './runtime-fixtures';
import { bankActor, deferred, open, transfer, waitFor } from './runtime-fixtures';

/** LocalBus that records every channel published to. */
class SpyBus extends LocalBus {
  readonly channels: string[] = [];
  override async publish(channel: string, message: unknown): Promise<void> {
    this.channels.push(channel);
    return super.publish(channel, message);
  }
}

function memoryHost(opts: { transactions?: TransactionRunner; def?: ActorDefinition<BankState, BankCommand, BankReply, unknown>; maxQueue?: number; onFault?: (f: ActorFault) => void } = {}) {
  const log = new MemoryActorLog();
  const host = new ActorHost({
    nodeId: 'mem-1',
    transactions: opts.transactions ?? memoryTransactions(),
    leases: new MemoryLeaseManager(),
    bus: new LocalBus(),
    clock: new ManualClock(),
    ...(opts.maxQueue ? { maxQueue: opts.maxQueue } : {}),
    ...(opts.onFault ? { onFault: opts.onFault } : {}),
  }).register({ definition: opts.def ?? bankActor(), log });
  return { host, log };
}

describe('single node (in-memory leases, membership and bus)', () => {
  it('activates on demand and routes through the local mailbox with no bus traffic', async () => {
    const bus = new SpyBus();
    const node = createNodeRuntime(
      { nodeId: 'solo', role: 'all', redisUrl: null },
      { bus, transactions: memoryTransactions(), kinds: [{ definition: bankActor(), log: new MemoryActorLog() }] },
    );
    await node.start();
    expect(await node.submit('table', 'T1', open('a', 10))).toEqual({ ok: true, seq: 1 });
    expect(await node.submit('table', 'T1', open('b', 10))).toEqual({ ok: true, seq: 2 });
    expect(await node.submit('table', 'T1', transfer('x', 'a', 'b', 3))).toEqual({ ok: true, seq: 3 });
    expect(node.host.stateOf<BankState>('table', 'T1')!.accounts).toEqual({ a: 7, b: 13 });
    // Only the actor's own outbox reaches the bus: no command routing, no RPC replies.
    expect(bus.channels.filter((c) => c.endsWith(':cmd') || c.startsWith('node:'))).toEqual([]);
    expect(node.stats().actors).toMatchObject([{ kind: 'table', actorId: 'T1', seq: 3, status: 'active' }]);
    await expect(node.submit('nope', 'x', {})).rejects.toMatchObject({ code: 'UNKNOWN_ACTOR_KIND' });
    await node.stop();
    expect(node.host.isHosted('table', 'T1')).toBe(false);
  });
});

describe('ActorHost invariants (in-memory log)', () => {
  it('rolls back the in-memory log on transaction failure', async () => {
    const tx = memoryTransactions();
    const { host, log } = memoryHost({ transactions: tx });
    await host.activate('table', 'T');
    await host.submit('table', 'T', open('a', 5));
    tx.failNext();
    await expect(host.submit('table', 'T', open('b', 5))).rejects.toMatchObject({ code: 'PERSISTENCE_FAILED' });
    expect(log.commandCount('T')).toBe(1);
    expect(await log.eventsAfter('T', 0, 10)).toHaveLength(1);
    expect(await host.submit('table', 'T', open('b', 5))).toEqual({ ok: true, seq: 2 });
    expect((await log.commandsAfter('T', 0, 10)).map((c) => c.seq)).toEqual([1, 2]);
    await host.stop();
  });

  it('faults on invalid step results (noop carrying effects, event-seq gaps)', async () => {
    const base = bankActor();
    const def: typeof base = {
      ...base,
      step(state, env) {
        const c = env.command;
        if (c.type === 'TRANSFER' && c.requestId === 'noop-with-events') return { ...base.step(state, env), noop: true };
        if (c.type === 'TRANSFER' && c.requestId === 'gap') {
          const r = base.step(state, env);
          return stepResult(r.state, r.reply, { events: r.events.map((e) => ({ ...e, seq: e.seq + 1 })) });
        }
        return base.step(state, env);
      },
    };
    for (const requestId of ['noop-with-events', 'gap']) {
      const faults: ActorFault[] = [];
      const { host, log } = memoryHost({ def, onFault: (f) => faults.push(f) });
      await host.activate('table', 'T');
      await host.submit('table', 'T', open('a', 5));
      await host.submit('table', 'T', open('b', 5));
      await expect(host.submit('table', 'T', transfer(requestId, 'a', 'b', 1))).rejects.toMatchObject({ code: 'FAULTED' });
      expect(faults).toHaveLength(1);
      expect(log.commandCount('T')).toBe(2);
      await host.stop();
    }
  });

  it('bounds the mailbox', async () => {
    const gate = deferred();
    const base = memoryTransactions();
    const { host } = memoryHost({ maxQueue: 3, transactions: { run: (fn) => base.run(async (tx) => (await gate.promise, fn(tx))) } });
    await host.activate('table', 'T');
    const accepted = [open('a', 1), open('b', 1), open('c', 1), open('d', 1)].map((c) => host.submit('table', 'T', c));
    await new Promise((r) => setTimeout(r, 5));
    await expect(host.submit('table', 'T', open('e', 1))).rejects.toMatchObject({ code: 'UNAVAILABLE', retryable: true });
    gate.resolve();
    expect((await Promise.all(accepted)).map((r) => (r as { seq: number }).seq)).toEqual([1, 2, 3, 4]);
    await host.stop();
  });

  it('rejects non-JSON commands before they reach the actor', async () => {
    const { host } = memoryHost();
    await host.activate('table', 'T');
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await expect(host.submit('table', 'T', cyclic)).rejects.toBeInstanceOf(TypeError);
    await host.stop();
  });
});

describe('in-process cluster (shared LocalBus, memory leases and membership)', () => {
  function cluster() {
    const bus = new LocalBus();
    const leases = new MemoryLeaseManager();
    const registry = new MemoryMembershipRegistry();
    const catalog = new MemoryActorCatalog();
    const log = new MemoryActorLog();
    const nodes: NodeRuntime[] = [];
    const add = (nodeId: string, role: NodeRole, extra: { leaseTtlMs?: number; leaseRenewMs?: number; requestTimeoutMs?: number } = {}) => {
      const n = new NodeRuntime({
        nodeId,
        role,
        bus,
        leases,
        membership: new MemoryMembership({ nodeId, role, startedAt: 0, capacity: 1 }, registry, undefined, { heartbeatMs: 50, ttlMs: 200 }),
        transactions: memoryTransactions(),
        kinds: [{ definition: bankActor(), log }],
        catalog,
        rebalanceIntervalMs: 100,
        leaseTtlMs: extra.leaseTtlMs ?? 1000,
        leaseRenewMs: extra.leaseRenewMs ?? 300,
        requestTimeoutMs: extra.requestTimeoutMs ?? 3000,
      });
      nodes.push(n);
      return n;
    };
    return { bus, leases, catalog, log, add, stopAll: () => Promise.all(nodes.map((n) => n.stop())) };
  }

  it('a gateway routes by bus RPC to the owner; with no owner it fails UNAVAILABLE (outcome unknown)', async () => {
    const c = cluster();
    const gw = c.add('gw', 'gateway', { requestTimeoutMs: 300 });
    await gw.start();
    const err = await gw.submit('table', 'T1', open('a', 1)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ActorRuntimeError);
    expect(err).toMatchObject({ code: 'UNAVAILABLE', processed: 'unknown' });

    const w = c.add('w1', 'worker');
    await w.start();
    expect(await gw.submit('table', 'T1', open('a', 1), { timeoutMs: 3000 })).toEqual({ ok: true, seq: 1 });
    expect(w.host.isActive('table', 'T1')).toBe(true);
    expect(gw.host.isHosted('table', 'T1')).toBe(false);
    await c.stopAll();
  });

  it('retransmits an unacknowledged request until the new owner subscribes, and processes it exactly once', async () => {
    const c = cluster();
    // A dead previous owner still holds the lease for 400 ms.
    expect(await c.leases.acquire('table:T9', 'ghost', 400, Date.now())).not.toBeNull();
    c.catalog.add('table', 'T9');
    const gw = c.add('gw', 'gateway');
    const w = c.add('w1', 'worker');
    await gw.start();
    await w.start();
    const t0 = Date.now();
    expect(await gw.submit('table', 'T9', open('a', 1), { timeoutMs: 5000 })).toEqual({ ok: true, seq: 1 });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(250);
    expect(c.log.commandCount('T9')).toBe(1);
    await c.stopAll();
  });

  it('the owner de-duplicates a re-published request by correlation id', async () => {
    const c = cluster();
    const w = c.add('w1', 'worker');
    await w.start();
    await w.host.activate('table', 'T5');
    const replies: unknown[] = [];
    await c.bus.subscribe(replyChannel('probe'), (m) => replies.push(m));
    const request = { t: 'actor_rpc', correlationId: 'corr-1', replyTo: replyChannel('probe'), kind: 'table', actorId: 'T5', command: open('a', 1) };
    await c.bus.publish('table:T5:cmd', request);
    await c.bus.publish('table:T5:cmd', request);
    await waitFor(() => replies.length >= 2);
    await new Promise((r) => setTimeout(r, 20));
    expect(replies).toEqual([
      { t: 'actor_ack', correlationId: 'corr-1' },
      { t: 'actor_result', correlationId: 'corr-1', ok: true, reply: { ok: true, seq: 1 } },
    ]);
    expect(c.log.commandCount('T5')).toBe(1);
    await c.stopAll();
  });
});
