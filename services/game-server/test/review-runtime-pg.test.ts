import type { EventEmitter } from 'node:events';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalBus } from '../src/bus/local-bus';
import { Database } from '../src/persistence/db';
import { noopResult, stepResult } from '../src/runtime/actor';
import type { ActorDefinition } from '../src/runtime/actor';
import { ActorHost } from '../src/runtime/actor-host';
import type { ActorRegistration } from '../src/runtime/actor-host';
import { MemoryActorLog } from '../src/runtime/actor-log';
import { ManualClock, settle } from '../src/runtime/clock';
import { MemoryLeaseManager, RedisLeaseManager } from '../src/runtime/lease';
import type { Lease, LeaseManager } from '../src/runtime/lease';
import { PostgresTableLog } from '../src/runtime/pg-actor-log';
import type { TableLogMeta } from '../src/runtime/pg-actor-log';
import { recoverActor } from '../src/runtime/recovery';
import { memoryTransactions, storeTransactions } from '../src/runtime/transactions';
import type { TransactionRunner } from '../src/runtime/transactions';
import type { BankState, PgFixture } from './runtime-fixtures';
import { TEST_DATABASE_URL, TEST_REDIS_URL, bankActor, deferred, open, pgFixture, transfer, waitFor } from './runtime-fixtures';

/**
 * Adversarial review of the actor runtime against real PostgreSQL / Redis:
 * replay fidelity of JSONB storage, lease expiry during a transaction,
 * backend termination, Redis connection loss and data loss.
 */

interface KeysState {
  eventSeq: number;
  /** Insertion-ordered map, as a reducer would naturally build it (seats, players, stacks...). */
  map: Record<string, number>;
}
type KeysCommand = { type: 'PUT'; values: Record<string, number> } | { type: 'LIST' } | { type: 'TIMER'; key: string; token: string };

/** Pure actor whose output depends on object key order (e.g. "first player in the map acts first"). */
function keysActor(snapshotEvery: number): ActorDefinition<KeysState, KeysCommand, string[], TableLogMeta> {
  return {
    kind: 'table',
    snapshotEvery,
    initialState: () => ({ eventSeq: 0, map: {} }),
    step: (s, env) => {
      const c = env.command;
      if (c.type !== 'PUT') return noopResult(s, Object.keys(s.map));
      const map = { ...s.map, ...c.values };
      const event = { seq: s.eventSeq + 1, version: s.eventSeq + 1, at: env.at, kind: 'PUT', visibility: 'PUBLIC' as const, privateTo: null, payload: { order: Object.keys(c.values) } };
      return stepResult({ eventSeq: event.seq, map }, Object.keys(map), { events: [event] });
    },
    commandType: (c) => c.type,
    actionIdOf: () => null,
    timerCommand: (key, token) => ({ type: 'TIMER', key, token }),
    pendingTimers: () => [],
    logMeta: (s) => ({ status: 'BETWEEN_HANDS', playerCount: Object.keys(s.map).length, handsPlayed: 0, progressed: true }),
    eventSeqOf: (s) => s.eventSeq,
  };
}

describe.skipIf(!TEST_DATABASE_URL)('review: runtime on PostgreSQL', () => {
  let fx: PgFixture;
  beforeAll(async () => {
    fx = await pgFixture('review_runtime_pg');
  });
  afterAll(async () => fx?.close());

  function makeHost(reg: ActorRegistration, opts: { nodeId?: string; clock?: ManualClock; leases?: LeaseManager; transactions?: TransactionRunner; verify?: boolean } = {}) {
    return new ActorHost({
      nodeId: opts.nodeId ?? 'node-1',
      transactions: opts.transactions ?? storeTransactions(fx.store),
      leases: opts.leases ?? new MemoryLeaseManager(),
      bus: new LocalBus(),
      clock: opts.clock ?? new ManualClock(),
      leaseTtlMs: 10_000,
      leaseRenewMs: 3_000,
      verifyOnRecovery: opts.verify ?? true,
    }).register(reg);
  }

  it('BUG: commands stored as JSONB replay with different key order than they were processed live (verified recovery reports NONDETERMINISTIC)', async () => {
    const id = await fx.table('rv_cmd_order');
    const reg = { definition: keysActor(1000), log: new PostgresTableLog(fx.store.repos) };
    const h1 = makeHost(reg, { nodeId: 'n1' });
    await h1.activate('table', id);
    // Live: the step sees the canonical command (keys sorted), whatever order the submitter used.
    // "ab" vs "z": JSONB puts the shorter key first, so storage order differs from the canonical order.
    expect(await h1.submit('table', id, { type: 'PUT', values: { zz: 1, ab: 3, z: 2 } })).toEqual(['ab', 'z', 'zz']);
    await h1.abandon();

    // Recovery reads the command back from JSONB (order z, ab, zz) and canonicalizes it again.
    const h2 = makeHost(reg, { nodeId: 'n2' });
    const report = await h2.activate('table', id).catch((e: unknown) => e);
    expect(report).toMatchObject({ seq: 1, verified: true });
    expect(await h2.submit('table', id, { type: 'LIST' })).toEqual(['ab', 'z', 'zz']);
    await h2.stop();
  });

  it('BUG: snapshots stored as JSONB recover a state whose key order differs from the live state (behaviour diverges after failover)', async () => {
    const id = await fx.table('rv_snap_order');
    const reg = { definition: keysActor(1), log: new PostgresTableLog(fx.store.repos) };
    const h1 = makeHost(reg, { nodeId: 'n1', verify: false });
    await h1.activate('table', id);
    await h1.submit('table', id, { type: 'PUT', values: { zz: 1 } });
    await h1.submit('table', id, { type: 'PUT', values: { a: 2 } });
    const liveOrder = await h1.submit('table', id, { type: 'LIST' });
    expect(liveOrder).toEqual(['zz', 'a']);
    await h1.abandon();

    const h2 = makeHost(reg, { nodeId: 'n2', verify: false });
    expect(await h2.activate('table', id)).toMatchObject({ snapshotSeq: 2, replayedCommands: 0 });
    // Same committed history, different answer.
    expect(await h2.submit('table', id, { type: 'LIST' })).toEqual(liveOrder);
    await h2.stop();
  });

  it('control: lease expiry while a command is inside its transaction — the old owner commits, the new owner is fenced, nothing is lost or duplicated', async () => {
    const id = await fx.table('rv_lease_mid_tx');
    const reg = { definition: bankActor(), log: new PostgresTableLog(fx.store.repos) };
    const clock = new ManualClock();
    const shared = new MemoryLeaseManager();
    const partitioned: LeaseManager = {
      acquire: (r, o, t, n) => shared.acquire(r, o, t, n),
      renew: async () => {
        throw new Error('lease store unreachable');
      },
      release: (l: Lease) => shared.release(l),
    };
    let hold: Promise<void> | null = null;
    const held = deferred();
    const inner = storeTransactions(fx.store);
    const slowTx: TransactionRunner = {
      run: (fn) =>
        inner.run(async (tx) => {
          const r = await fn(tx);
          if (hold) {
            held.resolve(); // the INSERT of seq 3 is done, COMMIT not yet
            await hold;
          }
          return r;
        }),
    };
    const h1 = makeHost(reg, { nodeId: 'old', clock, leases: partitioned, transactions: slowTx });
    await h1.activate('table', id);
    await h1.submit('table', id, open('a', 100));
    await h1.submit('table', id, open('b', 100));

    const gate = deferred();
    hold = gate.promise;
    const inFlight = h1.submit('table', id, transfer('old-tx', 'a', 'b', 10));
    // (pg_stat_activity is database-wide: other test files' sessions made a poll on it racy.)
    await held.promise;
    await clock.advance(10_001); // A's lease expires (renewals fail); A stops accepting work
    expect(h1.isHosted('table', id)).toBe(false);

    const h2 = makeHost(reg, { nodeId: 'new', clock, leases: shared });
    await h2.activate('table', id); // recovers seq 2: the in-flight row is not visible
    expect(h2.stat('table', id)!.seq).toBe(2);
    const competing = h2.submit('table', id, transfer('new-tx', 'b', 'a', 5)).catch((e: unknown) => e);
    await new Promise((r) => setTimeout(r, 150)); // h2's INSERT now blocks on A's uncommitted seq 3
    hold = null;
    gate.resolve();
    expect(await inFlight).toEqual({ ok: true, seq: 3 });
    expect(await competing).toMatchObject({ code: 'FENCED' });

    const rec = await recoverActor(reg.definition, reg.log, id, { verify: true });
    expect(rec.seq).toBe(3);
    expect((rec.state as BankState).accounts).toEqual({ a: 90, b: 110 });
    expect((rec.state as BankState).requests['new-tx']).toBeUndefined();
    await h1.abandon();
    await h2.stop();
  });

  it('a PostgreSQL backend killed mid-transaction yields PERSISTENCE_FAILED, state is not advanced, and later commands succeed', async () => {
    const id = await fx.table('rv_pg_kill');
    const reg = { definition: bankActor(), log: new PostgresTableLog(fx.store.repos) };
    let kill = 0;
    const inner = storeTransactions(fx.store);
    const tx: TransactionRunner = {
      run: (fn) =>
        inner.run(async (t) => {
          const r = await fn(t);
          if (kill > 0) {
            kill--;
            // The unlistened client 'error' is a separate defect (see the next test); absorb it here.
            (t.repos.q as unknown as EventEmitter).on('error', () => undefined);
            await t.repos.q.query('SELECT pg_terminate_backend(pg_backend_pid())');
          }
          return r;
        }),
    };
    const h = makeHost(reg, { transactions: tx });
    await h.activate('table', id);
    await h.submit('table', id, open('a', 100));
    kill = 3; // three consecutive connections die (a PostgreSQL restart)
    for (let i = 0; i < 3; i++) {
      await expect(h.submit('table', id, open(`k${i}`, 1))).rejects.toMatchObject({ code: 'PERSISTENCE_FAILED', processed: 'unknown' });
    }
    expect(h.stat('table', id)!.seq).toBe(1);
    // Every later command must succeed: no broken client may be handed back by the pool.
    for (let i = 0; i < 25; i++) expect(await h.submit('table', id, open(`after${i}`, 1))).toEqual({ ok: true, seq: i + 2 });
    await h.stop();
  });

  it('BUG: a PostgreSQL backend dying (restart, failover, idle kill) emits an \'error\' that nobody listens to — an uncaught exception that crashes the node', async () => {
    const db = new Database(TEST_DATABASE_URL!, 1);
    const unhandled: string[] = [];
    // Count 'error' emissions that would hit an EventEmitter with no listener (Node then throws), without crashing the test run.
    const guard = (emitter: EventEmitter, name: string) => {
      const emit = emitter.emit.bind(emitter);
      emitter.emit = ((event: string | symbol, ...args: unknown[]) => {
        if (event === 'error' && emitter.listenerCount('error') === 0) {
          unhandled.push(`${name}: ${(args[0] as Error)?.message}`);
          return true;
        }
        return emit(event, ...args);
      }) as typeof emitter.emit;
    };
    guard(db.pool, 'pool');
    const failed = await db
      .transaction(async (client) => {
        guard(client, 'checked-out client');
        await client.query('SELECT pg_terminate_backend(pg_backend_pid())');
      })
      .catch((e: unknown) => e);
    expect(failed).toBeInstanceOf(Error); // the transaction itself fails cleanly...
    await new Promise((r) => setTimeout(r, 200));
    // An IDLE pooled connection killed by the server (PostgreSQL restart) surfaces as pool 'error'.
    const { rows } = await db.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
    await fx.db.query('SELECT pg_terminate_backend($1)', [rows[0]!.pid]);
    await new Promise((r) => setTimeout(r, 200));
    // Both 'error' events are emitted with no listener; outside this guard each one is an uncaught exception.
    expect(unhandled).toEqual([]);
    await db.close();
  });
});

describe.skipIf(!TEST_REDIS_URL)('review: leases on Redis', () => {
  const prefix = `jpb:test:review-runtime:${process.pid}:${Date.now()}:`;
  let admin: Redis;
  beforeAll(() => {
    admin = new Redis(TEST_REDIS_URL!);
  });
  afterAll(async () => {
    const keys = await admin.keys(`${prefix}*`);
    if (keys.length) await admin.del(...keys);
    admin.disconnect();
  });

  it('an owner keeps its lease across a dropped Redis connection (ioredis reconnects before the lease expires)', async () => {
    const conn = new Redis(TEST_REDIS_URL!, { connectionName: `review-lease-${process.pid}` });
    const leases = new RedisLeaseManager(conn, `${prefix}a:`);
    const h = new ActorHost({ nodeId: 'r1', transactions: memoryTransactions(), leases, bus: new LocalBus(), leaseTtlMs: 900, leaseRenewMs: 200, leaseSafetyMs: 150 }).register({
      definition: bankActor(),
      log: new MemoryActorLog(),
    });
    await h.activate('table', 'L');
    const id = await conn.client('ID');
    await admin.client('KILL', 'ID', String(id));
    await new Promise((r) => setTimeout(r, 1_200)); // longer than the TTL
    expect(h.isActive('table', 'L')).toBe(true);
    expect(await h.submit('table', 'L', open('a', 1))).toEqual({ ok: true, seq: 1 });
    await h.stop();
    conn.disconnect();
  });

  it('BUG: the lease epoch ("monotonically increasing fencing token") goes backwards after Redis loses its data (restart without persistence)', async () => {
    const leases = new RedisLeaseManager(admin, `${prefix}b:`);
    let last: Lease | null = null;
    for (let i = 0; i < 3; i++) {
      const next = await leases.acquire('table:E', `node-${i}`, 60_000, Date.now());
      // Epochs are seeded from the Redis server time (ms), not a 1-based counter: only their order is meaningful.
      if (last) expect(next!.epoch).toBeGreaterThan(last.epoch);
      last = next;
      await leases.release(last!);
    }
    // Redis restarts empty (or fails over to a replica that missed the INCR).
    const keys = await admin.keys(`${prefix}b:*`);
    await admin.del(...keys);
    const next = await leases.acquire('table:E', 'node-9', 60_000, Date.now());
    expect(next!.epoch).toBeGreaterThan(last!.epoch);
  });

  it('control: an owner whose lease key vanished (Redis data loss) stops processing at its next renewal', async () => {
    const leases = new RedisLeaseManager(admin, `${prefix}c:`);
    const clock = new ManualClock(Date.now());
    const h = new ActorHost({ nodeId: 'r2', transactions: memoryTransactions(), leases, bus: new LocalBus(), clock, leaseTtlMs: 10_000, leaseRenewMs: 3_000 }).register({
      definition: bankActor(),
      log: new MemoryActorLog(),
    });
    await h.activate('table', 'V');
    await admin.del(`${prefix}c:table:V`);
    await clock.advance(3_000);
    await settle(10);
    await waitFor(() => !h.isHosted('table', 'V'), 2_000);
    await expect(h.submit('table', 'V', open('a', 1))).rejects.toMatchObject({ code: 'NOT_OWNER' });
    await h.stop();
  });
});
