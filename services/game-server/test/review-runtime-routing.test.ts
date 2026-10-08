import { describe, expect, it } from 'vitest';
import { LocalBus } from '../src/bus/local-bus';
import type { NodeRole } from '../src/config/env';
import { noopResult, stepResult } from '../src/runtime/actor';
import type { ActorDefinition } from '../src/runtime/actor';
import { ActorHost } from '../src/runtime/actor-host';
import { MemoryActorLog } from '../src/runtime/actor-log';
import { ActorRuntimeError } from '../src/runtime/errors';
import { MemoryLeaseManager } from '../src/runtime/lease';
import { MemoryMembership, MemoryMembershipRegistry } from '../src/runtime/membership';
import { MemoryActorCatalog, NodeRuntime } from '../src/runtime/node-runtime';
import { ActorRouter } from '../src/runtime/router';
import { replyChannel } from '../src/runtime/rpc';
import { memoryTransactions } from '../src/runtime/transactions';
import type { BankReply, BankState } from './runtime-fixtures';
import { bankActor, open, transfer, waitFor } from './runtime-fixtures';

/**
 * Adversarial review of the actor runtime — routing, RPC and ownership
 * changes (in-process cluster on a shared LocalBus, real timers).
 */

/** LocalBus that can black-hole selected channels (a flaky subscriber connection). */
class LossyBus extends LocalBus {
  drop: (channel: string) => boolean = () => false;
  override async publish(channel: string, message: unknown): Promise<void> {
    if (this.drop(channel)) return;
    return super.publish(channel, message);
  }
}

interface CounterState {
  n: number;
}
type CounterCommand = { type: 'INC' } | { type: 'GET' } | { type: 'TIMER'; key: string; token: string };

/** A counter whose INC has no idempotency key (like a director tick or an admin pause/resume). */
const counterActor: ActorDefinition<CounterState, CounterCommand, { n: number }> = {
  kind: 'table',
  snapshotEvery: 1000,
  initialState: () => ({ n: 0 }),
  step: (s, env) => (env.command.type === 'INC' ? stepResult({ n: s.n + 1 }, { n: s.n + 1 }) : noopResult(s, { n: s.n })),
  commandType: (c) => c.type,
  actionIdOf: () => null,
  timerCommand: (key, token) => ({ type: 'TIMER', key, token }),
  pendingTimers: () => [],
};

function host(nodeId: string, bus: LocalBus, leases: MemoryLeaseManager, log: MemoryActorLog, ttl = 1_000) {
  return new ActorHost({ nodeId, transactions: memoryTransactions(), leases, bus, leaseTtlMs: ttl, leaseRenewMs: Math.floor(ttl / 4) }).register({
    definition: counterActor,
    log,
  });
}

describe('review: RPC retransmission and ownership change', () => {
  it('BUG: a request whose ack/result were lost is re-processed by the NEXT owner after a hand-off (command applied twice)', async () => {
    const bus = new LossyBus();
    const leases = new MemoryLeaseManager();
    const log = new MemoryActorLog();
    const h1 = host('w1', bus, leases, log);
    const h2 = host('w2', bus, leases, log);
    const gwHost = host('gw', bus, leases, log);
    const router = new ActorRouter({ nodeId: 'gw', role: 'gateway', host: gwHost, bus, members: () => [], requestTimeoutMs: 5_000 });
    await router.start();
    await h1.activate('table', 'C');

    // The gateway's reply subscription hiccups: ack and result from w1 are lost.
    bus.drop = (ch) => ch === replyChannel('gw');
    const pending = router.submit<{ n: number }>('table', 'C', { type: 'INC' });
    await waitFor(() => log.commandCount('C') === 1, 2_000, 1);

    // Placement moves the actor (graceful hand-off) before the gateway retransmits.
    await h1.deactivate('table', 'C', 'placement moved');
    await h2.activate('table', 'C');
    bus.drop = () => false;

    const reply = await pending;
    // One logical submit must be applied once.
    expect(log.commandCount('C')).toBe(1);
    expect(reply).toEqual({ n: 1 });
    await Promise.all([h2.stop(), router.stop()]);
  });

  it('control: a late reply after the deadline is ignored and leaves no pending entry behind', async () => {
    const bus = new LossyBus();
    const leases = new MemoryLeaseManager();
    const log = new MemoryActorLog();
    const h1 = host('w1', bus, leases, log);
    const gwHost = host('gw', bus, leases, log);
    const router = new ActorRouter({ nodeId: 'gw', role: 'gateway', host: gwHost, bus, members: () => [] });
    await router.start();
    await h1.activate('table', 'C');
    bus.drop = (ch) => ch === replyChannel('gw');
    const err = await router.submit('table', 'C', { type: 'INC' }, { timeoutMs: 120 }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'UNAVAILABLE', processed: 'unknown' });
    expect((router as unknown as { pending: Map<string, unknown> }).pending.size).toBe(0);
    bus.drop = () => false;
    expect(await router.submit('table', 'C', { type: 'GET' })).toEqual({ n: 1 });
    expect((router as unknown as { pending: Map<string, unknown> }).pending.size).toBe(0);
    await Promise.all([h1.stop(), router.stop()]);
  });

  it('BUG: a submit routed to a node that is still activating the actor (waiting for another node\'s lease) ignores its deadline', async () => {
    const bus = new LocalBus();
    const leases = new MemoryLeaseManager();
    const log = new MemoryActorLog();
    // The previous owner (crashed, or still draining) holds the lease for 1.5 s more.
    await leases.acquire('table:C', 'old-owner', 1_500, Date.now());
    const b = host('B', bus, leases, log, 1_000);
    const router = new ActorRouter({ nodeId: 'B', role: 'worker', host: b, bus, members: () => [{ nodeId: 'B', role: 'worker', startedAt: 0, capacity: 1 }] });
    await router.start();
    // The rebalancer starts the activation with the default wait (ttl + renew).
    const activation = b.activate('table', 'C').catch(() => undefined);
    const t0 = Date.now();
    const outcome = await router.submit('table', 'C', { type: 'INC' }, { timeoutMs: 200 }).then(
      () => 'resolved',
      (e: unknown) => (e as ActorRuntimeError).code,
    );
    const elapsed = Date.now() - t0;
    // Deadline 200 ms: the caller must get an answer (UNAVAILABLE) close to it, not ~1.5 s later.
    expect(elapsed).toBeLessThan(700);
    expect(outcome).toBe('UNAVAILABLE');
    await activation;
    await Promise.all([b.stop(), router.stop()]);
  });
});

describe('review: design gaps (RPC reply cache, catalog cleanup)', () => {
  it('an owner re-sends the cached result when a retransmission shows that both the ack and the result were lost', async () => {
    const bus = new LossyBus();
    const leases = new MemoryLeaseManager();
    const log = new MemoryActorLog();
    const h1 = host('w1', bus, leases, log);
    const gwHost = host('gw', bus, leases, log);
    const router = new ActorRouter({ nodeId: 'gw', role: 'gateway', host: gwHost, bus, members: () => [], requestTimeoutMs: 3_000 });
    await router.start();
    await h1.activate('table', 'C');
    bus.drop = (ch) => ch === replyChannel('gw');
    const pending = router.submit<{ n: number }>('table', 'C', { type: 'INC' });
    await waitFor(() => log.commandCount('C') === 1, 2_000, 1);
    await new Promise((r) => setTimeout(r, 50));
    bus.drop = () => false; // the next retransmission reaches the same owner, which has seen it
    expect(await pending).toEqual({ n: 1 });
    expect(log.commandCount('C')).toBe(1);
    await Promise.all([h1.stop(), router.stop()]);
  });

  it('a hosted actor that left the catalog is deactivated once idle; one with an armed timer stays', async () => {
    const bus = new LocalBus();
    const catalog = new MemoryActorCatalog();
    const registry = new MemoryMembershipRegistry();
    const node = new NodeRuntime({
      nodeId: 'n1',
      role: 'all',
      bus,
      leases: new MemoryLeaseManager(),
      membership: new MemoryMembership({ nodeId: 'n1', role: 'all', startedAt: 0, capacity: 1 }, registry, undefined, { heartbeatMs: 50, ttlMs: 200 }),
      transactions: memoryTransactions(),
      kinds: [{ definition: bankActor(), log: new MemoryActorLog() }],
      catalog,
      rebalanceIntervalMs: 30,
      catalogGraceMs: 60,
      leaseTtlMs: 1_000,
      leaseRenewMs: 250,
    });
    catalog.add('table', 'closed');
    catalog.add('table', 'ticking');
    await node.start();
    await waitFor(() => node.host.isActive('table', 'closed') && node.host.isActive('table', 'ticking'), 2_000);
    await node.submit('table', 'ticking', { type: 'START_INTEREST', rateBp: 1, everyMs: 60_000 });
    catalog.remove('table', 'closed');
    catalog.remove('table', 'ticking');
    await waitFor(() => !node.host.isHosted('table', 'closed'), 2_000);
    await new Promise((r) => setTimeout(r, 200));
    expect(node.host.isActive('table', 'ticking')).toBe(true);
    // Still reachable on demand.
    expect(await node.submit('table', 'closed', open('a', 1))).toEqual({ ok: true, seq: 1 });
    await node.stop();
  });
});

describe('review: resource cleanup when actors deactivate', () => {
  it('deactivating 300 actors with timers leaves no timers, subscriptions, waiters or records behind', async () => {
    const bus = new LocalBus();
    const leases = new MemoryLeaseManager();
    const log = new MemoryActorLog();
    const h = new ActorHost({ nodeId: 'n', transactions: memoryTransactions(), leases, bus, leaseTtlMs: 1_000, leaseRenewMs: 250 }).register({
      definition: bankActor(),
      log,
    });
    const ids = Array.from({ length: 300 }, (_, i) => `T${i}`);
    await Promise.all(ids.map((id) => h.activate('table', id)));
    await Promise.all(ids.map((id) => h.submit('table', id, { type: 'START_INTEREST', rateBp: 1, everyMs: 60_000 })));
    expect(h.timers.size).toBe(300);
    // One activation also waits for a lease held elsewhere and is then cancelled by deactivate/stop.
    await leases.acquire('table:BLOCKED', 'other', 60_000, Date.now());
    const blocked = h.activate('table', 'BLOCKED').catch((e: unknown) => e);
    await Promise.all(ids.map((id) => h.deactivate('table', id)));
    expect(h.timers.size).toBe(0);
    expect(h.stats().filter((s) => s.actorId !== 'BLOCKED')).toEqual([]);
    for (const id of ids) expect(bus.subscriberCount(`table:${id}:cmd`)).toBe(0);
    await h.stop();
    expect(await blocked).toBeInstanceOf(ActorRuntimeError);
    const internals = h as unknown as { releaseWaiters: Map<string, unknown>; retiring: Map<string, unknown>; records: Map<string, unknown> };
    expect(internals.releaseWaiters.size).toBe(0);
    expect(internals.retiring.size).toBe(0);
    expect(internals.records.size).toBe(0);
    expect(h.timers.heapSize).toBeLessThanOrEqual(300);
  });
});

describe('review: routing while ownership changes under load', () => {
  function cluster() {
    const bus = new LocalBus();
    const leases = new MemoryLeaseManager();
    const registry = new MemoryMembershipRegistry();
    const catalog = new MemoryActorCatalog();
    const log = new MemoryActorLog();
    const nodes: NodeRuntime[] = [];
    const add = (nodeId: string, role: NodeRole) => {
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
        leaseTtlMs: 1_000,
        leaseRenewMs: 300,
        requestTimeoutMs: 8_000,
      });
      nodes.push(n);
      return n;
    };
    return { log, catalog, add, stopAll: () => Promise.all(nodes.map((n) => n.stop())) };
  }

  it('every acknowledged command is applied exactly once while nodes join and leave gracefully', async () => {
    const c = cluster();
    const ids = Array.from({ length: 12 }, (_, i) => `R${i}`);
    for (const id of ids) c.catalog.add('table', id);
    const gw = c.add('gw', 'gateway');
    const w1 = c.add('w1', 'worker');
    await gw.start();
    await w1.start();
    for (const id of ids) {
      await gw.submit('table', id, open('a', 1_000_000));
      await gw.submit('table', id, open('b', 1_000_000));
    }
    const results: Array<Promise<{ id: string; req: string; r: BankReply | ActorRuntimeError }>> = [];
    let n = 0;
    const fire = (count: number) => {
      for (let i = 0; i < count; i++) {
        const id = ids[n % ids.length]!;
        const req = `q${n++}`;
        results.push(
          gw.submit<BankReply>('table', id, transfer(req, 'a', 'b', 1)).then(
            (r) => ({ id, req, r }),
            (e: unknown) => ({ id, req, r: e as ActorRuntimeError }),
          ),
        );
      }
    };
    fire(100);
    const w2 = c.add('w2', 'worker');
    await w2.start();
    fire(100);
    await new Promise((r) => setTimeout(r, 300));
    fire(100);
    await w2.stop();
    fire(100);
    const settled = await Promise.all(results);
    const failures = settled.filter((s) => s.r instanceof ActorRuntimeError);
    expect(failures.map((f) => (f.r as ActorRuntimeError).code)).toEqual([]);
    for (const id of ids) {
      const cmds = await c.log.commandsAfter(id, 0, 10_000);
      expect(cmds.map((x) => x.seq)).toEqual(cmds.map((_, i) => i + 1));
      const reqs = cmds.map((x) => x.actionId);
      expect(new Set(reqs).size).toBe(reqs.length);
    }
    const total = (await Promise.all(ids.map((id) => c.log.commandsAfter(id, 0, 10_000)))).reduce((s, x) => s + x.length, 0);
    expect(total).toBe(ids.length * 2 + 400);
    const any = (await w1.submit<BankState | unknown>('table', ids[0]!, transfer('final', 'a', 'b', 1))) as BankReply;
    expect(any.ok).toBe(true);
    await c.stopAll();
  }, 30_000);
});
