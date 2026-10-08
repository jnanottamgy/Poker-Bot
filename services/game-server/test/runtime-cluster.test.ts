import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RedisBus } from '../src/bus/redis-bus';
import type { NodeRole } from '../src/config/env';
import { actorAddress } from '../src/runtime/actor';
import { RedisLeaseManager } from '../src/runtime/lease';
import { RedisMembership } from '../src/runtime/membership';
import { MemoryActorCatalog, NodeRuntime } from '../src/runtime/node-runtime';
import { PostgresDirectorLog, PostgresTableLog } from '../src/runtime/pg-actor-log';
import { placeActor } from '../src/runtime/placement';
import { recoverActor } from '../src/runtime/recovery';
import { storeTransactions } from '../src/runtime/transactions';
import type { BankReply, BankState, PgFixture } from './runtime-fixtures';
import { TEST_DATABASE_URL, TEST_REDIS_URL, bankActor, open, pgFixture, transfer, waitFor } from './runtime-fixtures';

const LEASE_TTL = 900;
const LEASE_RENEW = 250;
const MEMBER_TTL = 600;

describe.skipIf(!TEST_DATABASE_URL || !TEST_REDIS_URL)('multi-node runtime (Redis + PostgreSQL)', () => {
  let fx: PgFixture;
  const buses: RedisBus[] = [];
  const nodes: NodeRuntime[] = [];
  beforeAll(async () => {
    fx = await pgFixture('runtime_cluster');
  });
  afterAll(async () => {
    await Promise.allSettled(nodes.map((n) => n.stop()));
    await Promise.allSettled(buses.map((b) => b.close()));
    await fx?.close();
  });

  const tableDef = bankActor();
  const directorDef = bankActor({ kind: 'director' });

  function makeCluster(tag: string) {
    const prefix = `jpb:test:runtime:${process.pid}:${tag}:${Date.now()}:`;
    const catalog = new MemoryActorCatalog();
    const add = (name: string, role: NodeRole) => {
      const nodeId = `${name}-${process.pid}-${tag}`;
      const bus = new RedisBus(TEST_REDIS_URL!);
      buses.push(bus);
      const node = new NodeRuntime({
        nodeId,
        role,
        bus,
        leases: new RedisLeaseManager(bus.client, `${prefix}lease:`),
        membership: new RedisMembership({ nodeId, role, startedAt: Date.now(), capacity: 1 }, bus.client, { prefix, heartbeatMs: 100, ttlMs: MEMBER_TTL }),
        transactions: storeTransactions(fx.store),
        kinds: [
          { definition: tableDef, log: new PostgresTableLog(fx.store.repos) },
          { definition: directorDef, log: new PostgresDirectorLog(fx.store.repos) },
        ],
        catalog,
        leaseTtlMs: LEASE_TTL,
        leaseRenewMs: LEASE_RENEW,
        leaseSafetyMs: 150,
        rebalanceIntervalMs: 200,
        requestTimeoutMs: 5000,
        verifyOnRecovery: true,
      });
      nodes.push(node);
      return node;
    };
    return { catalog, add, nodeId: (name: string) => `${name}-${process.pid}-${tag}` };
  }

  it('fails over: B takes over a crashed owner after the lease TTL, recovers the exact state, and a gateway keeps reaching it', async () => {
    const c = makeCluster('fo');
    const workers = [c.nodeId('A'), c.nodeId('B')].map((nodeId) => ({ nodeId, role: 'worker' as const, capacity: 1 }));
    // Pick a table that placement assigns to A while both workers are alive.
    let id = '';
    for (let i = 0; !id; i++) if (placeActor(actorAddress('table', `tbl_fo_${i}`), 'worker', workers) === c.nodeId('A')) id = `tbl_fo_${i}`;
    await fx.table(id);
    c.catalog.add('table', id);

    const a = c.add('A', 'worker');
    const b = c.add('B', 'worker');
    const gw = c.add('C', 'gateway');
    await a.start();
    await b.start();
    await gw.start();
    await waitFor(() => a.host.isActive('table', id));
    expect(b.host.isHosted('table', id)).toBe(false);

    // Through the gateway (bus RPC) and through B (not the owner: also RPC).
    expect(await gw.submit('table', id, open('a', 100_000))).toEqual({ ok: true, seq: 1 });
    expect(await b.submit('table', id, open('b', 100_000))).toEqual({ ok: true, seq: 2 });
    for (let i = 0; i < 30; i++) {
      expect(await gw.submit<BankReply>('table', id, transfer(`f${i}`, i % 2 ? 'a' : 'b', i % 2 ? 'b' : 'a', 100 + i))).toEqual({ ok: true, seq: 3 + i });
    }
    // An interest timer armed on A that only comes due after A has died.
    await gw.submit('table', id, { type: 'START_INTEREST', rateBp: 100, everyMs: 4000 });
    await a.host.idle();
    const beforeCrash = structuredClone(a.host.stateOf<BankState>('table', id)!);
    expect(beforeCrash.version).toBe(33);

    await a.kill();
    const crashedAt = Date.now();
    await waitFor(() => b.host.isActive('table', id), 10_000, 5);
    const failoverMs = Date.now() - crashedAt;
    expect(b.host.stateOf('table', id)).toEqual(beforeCrash);
    expect(b.host.stat('table', id)!.seq).toBe(33);
    expect(failoverMs).toBeLessThan(5000);
    console.log(`[runtime] failover took ${failoverMs} ms (membership TTL ${MEMBER_TTL} ms, lease TTL ${LEASE_TTL} ms)`);

    // The gateway reaches the new owner; the log stays gap-free.
    expect(await gw.submit('table', id, transfer('after-1', 'a', 'b', 1))).toEqual({ ok: true, seq: 34 });
    // The timer armed on A fires on B.
    await waitFor(() => (b.host.stateOf<BankState>('table', id)?.interestRuns ?? 0) >= 1, 10_000);
    await b.host.idle();
    const seqs = await fx.db.query<{ seq: number }>(`SELECT seq FROM table_commands WHERE table_id = $1 ORDER BY seq`, [id]);
    const last = b.host.stat('table', id)!.seq;
    expect(seqs.rows.map((r) => r.seq)).toEqual(Array.from({ length: last }, (_, i) => i + 1));
    const recovered = await recoverActor(tableDef, new PostgresTableLog(fx.store.repos), id, { useSnapshot: false, verify: true });
    expect(recovered.state).toEqual(b.host.stateOf('table', id));
  }, 30_000);

  it('rebalances when a node joins and when it leaves; directors stay on the orchestrator', async () => {
    const c = makeCluster('rb');
    const ids: string[] = [];
    for (let i = 0; i < 16; i++) ids.push(await fx.table(`tbl_rb_${i}`));
    for (const id of ids) c.catalog.add('table', id);
    const tid = await fx.tournament('trn_rb_dir');
    c.catalog.add('director', tid);

    const a = c.add('A', 'worker');
    const o = c.add('O', 'orchestrator');
    await a.start();
    await o.start();
    await waitFor(() => ids.every((id) => a.host.isActive('table', id)) && o.host.isActive('director', tid));
    expect(a.host.isHosted('director', tid)).toBe(false);
    for (const id of ids) expect(await o.submit('table', id, open('a', 1))).toEqual({ ok: true, seq: 1 });
    expect(await a.submit('director', tid, open('z', 1))).toEqual({ ok: true, seq: 1 });

    const b = c.add('B', 'worker');
    await b.start();
    const workers = [c.nodeId('A'), c.nodeId('B')].map((nodeId) => ({ nodeId, role: 'worker' as const, capacity: 1 }));
    const ownerOf = (id: string) => placeActor(actorAddress('table', id), 'worker', workers);
    const moved = ids.filter((id) => ownerOf(id) === c.nodeId('B'));
    expect(moved.length).toBeGreaterThan(0);
    expect(moved.length).toBeLessThan(ids.length);
    await waitFor(() => ids.every((id) => (ownerOf(id) === c.nodeId('B') ? b.host.isActive('table', id) && !a.host.isHosted('table', id) : a.host.isActive('table', id) && !b.host.isHosted('table', id))), 10_000);

    // Hand-offs were graceful: final snapshot written, state carried over (idempotency memory included).
    for (const id of moved) {
      expect((await fx.store.repos.tableLogs.latestSnapshot(id))?.commandSeq).toBe(1);
      expect(await o.submit('table', id, open('a', 1))).toEqual({ ok: true, seq: 1, duplicate: true });
      expect(await a.submit('table', id, open('b', 1))).toEqual({ ok: true, seq: 2 });
    }
    expect(o.host.isActive('director', tid)).toBe(true);

    // B leaves gracefully: A takes everything back without waiting for lease expiry.
    const leftAt = Date.now();
    await b.stop();
    await waitFor(() => ids.every((id) => a.host.isActive('table', id)), 10_000);
    expect(Date.now() - leftAt).toBeLessThan(LEASE_TTL * 3);
    for (const id of moved) expect(await o.submit('table', id, transfer('back', 'a', 'b', 1))).toEqual({ ok: true, seq: 3 });
  }, 30_000);
});
