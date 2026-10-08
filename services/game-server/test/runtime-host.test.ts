import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalBus } from '../src/bus/local-bus';
import { createMetricsCatalog } from '../src/observability/catalog';
import { ActorHost } from '../src/runtime/actor-host';
import type { ActorFault } from '../src/runtime/actor-host';
import { ManualClock } from '../src/runtime/clock';
import { ActorRuntimeError } from '../src/runtime/errors';
import { MemoryLeaseManager } from '../src/runtime/lease';
import type { Lease, LeaseManager } from '../src/runtime/lease';
import { PostgresTableLog } from '../src/runtime/pg-actor-log';
import { storeTransactions } from '../src/runtime/transactions';
import type { TransactionRunner } from '../src/runtime/transactions';
import type { BankCommand, BankReply, BankState, PgFixture } from './runtime-fixtures';
import { TEST_DATABASE_URL, bankActor, deferred, lcg, open, pgFixture, transfer } from './runtime-fixtures';

const KIND = 'table';
const TTL = 10_000;
const RENEW = 3_000;

describe.skipIf(!TEST_DATABASE_URL)('ActorHost on PostgreSQL', () => {
  let fx: PgFixture;
  beforeAll(async () => {
    fx = await pgFixture('runtime_host');
  });
  afterAll(async () => fx?.close());

  function makeHost(opts: { nodeId?: string; leases?: LeaseManager; clock?: ManualClock; transactions?: TransactionRunner; bus?: LocalBus; onFault?: (f: ActorFault) => void; onDeactivated?: (i: { reason: string }) => void; metrics?: ReturnType<typeof createMetricsCatalog> } = {}) {
    return new ActorHost({
      nodeId: opts.nodeId ?? 'node-1',
      transactions: opts.transactions ?? storeTransactions(fx.store),
      leases: opts.leases ?? new MemoryLeaseManager(),
      bus: opts.bus ?? new LocalBus(),
      clock: opts.clock ?? new ManualClock(),
      leaseTtlMs: TTL,
      leaseRenewMs: RENEW,
      ...(opts.onFault ? { onFault: opts.onFault } : {}),
      ...(opts.onDeactivated ? { onDeactivated: opts.onDeactivated } : {}),
      ...(opts.metrics ? { metrics: opts.metrics } : {}),
    }).register({ definition: bankActor({ projection: true }), log: new PostgresTableLog(fx.store.repos) });
  }

  const commandSeqs = async (id: string) =>
    (await fx.db.query<{ seq: number }>(`SELECT seq FROM table_commands WHERE table_id = $1 ORDER BY seq`, [id])).rows.map((r) => r.seq);

  /** Applies commands with the pure step, skipping noops: the expected outcome of sequential processing. */
  function model(commands: BankCommand[]): { state: BankState; replies: BankReply[] } {
    const def = bankActor();
    let state = def.initialState('m');
    let seq = 0;
    const replies: BankReply[] = [];
    for (const command of commands) {
      const r = def.step(state, { actorId: 'm', seq: seq + 1, commandId: 'x', at: 0, command });
      replies.push(r.reply);
      if (!r.noop) {
        state = r.state;
        seq++;
      }
    }
    return { state, replies };
  }

  it('processes 1,000 concurrent submits strictly one at a time with a gap-free log', async () => {
    const id = await fx.table('tbl_seq');
    const bus = new LocalBus();
    const published: number[] = [];
    await bus.subscribe(`bank:${id}:events`, (m) => published.push((m as { seq: number }).seq));
    const metrics = createMetricsCatalog();
    const host = makeHost({ bus, metrics });
    await host.activate(KIND, id);

    const accounts = ['a', 'b', 'c', 'd', 'e'];
    const setup = accounts.map((a) => open(a, 1000));
    for (const c of setup) await host.submit(KIND, id, c);
    const rnd = lcg(42);
    const pick = () => accounts[Math.floor(rnd() * accounts.length)]!;
    const transfers = Array.from({ length: 1000 }, (_, i) => transfer(`t${i}`, pick(), pick(), 1 + Math.floor(rnd() * 400)));

    const replies = await Promise.all(transfers.map((c) => host.submit<BankReply>(KIND, id, c)));

    const expected = model([...setup, ...transfers]);
    expect(replies).toEqual(expected.replies.slice(setup.length));
    const state = host.stateOf<BankState>(KIND, id)!;
    expect(state).toEqual(expected.state);
    const total = Object.values(state.accounts).reduce((s, v) => s + v, 0);
    expect(total).toBe(5000);

    const applied = expected.state.version;
    expect(host.stat(KIND, id)?.seq).toBe(applied);
    expect(await commandSeqs(id)).toEqual(Array.from({ length: applied }, (_, i) => i + 1));
    expect(await fx.balances(id)).toEqual(state.accounts);
    const snap = await fx.store.repos.tableLogs.latestSnapshot<BankState>(id);
    expect(snap?.commandSeq).toBe(Math.floor(applied / 250) * 250);
    const meta = await fx.store.repos.tableLogs.getTable(id);
    expect(meta?.lastCommandSeq).toBe(applied);

    await host.idle();
    await new Promise((r) => setTimeout(r, 10));
    expect(published).toEqual(Array.from({ length: applied }, (_, i) => i + 1));
    expect(metrics.registry.render()).toMatch(/jpb_command_latency_ms_count\{kind="table"\} 1005/);
    const stats = host.stat(KIND, id)!;
    expect(stats).toMatchObject({ status: 'active', queueLength: 0, faulted: false, processed: applied });
    expect(stats.lastProgressAt).not.toBeNull();
    await host.stop();
  }, 60_000);

  it('treats duplicates and rejected commands as noops: replied, never persisted', async () => {
    const id = await fx.table('tbl_dup');
    const host = makeHost();
    await host.activate(KIND, id);
    await host.submit(KIND, id, open('a', 100));
    await host.submit(KIND, id, open('b', 100));
    const first = await host.submit<BankReply>(KIND, id, transfer('r1', 'a', 'b', 10));
    const again = await Promise.all([host.submit<BankReply>(KIND, id, transfer('r1', 'a', 'b', 10)), host.submit<BankReply>(KIND, id, transfer('r1', 'a', 'b', 10))]);
    expect(first).toEqual({ ok: true, seq: 3 });
    expect(again).toEqual([
      { ok: true, seq: 3, duplicate: true },
      { ok: true, seq: 3, duplicate: true },
    ]);
    expect(await host.submit(KIND, id, transfer('r2', 'a', 'b', 1_000))).toEqual({ ok: false, code: 'INSUFFICIENT' });
    expect(await commandSeqs(id)).toEqual([1, 2, 3]);
    expect(host.stateOf<BankState>(KIND, id)!.accounts).toEqual({ a: 90, b: 110 });
    await host.stop();
  });

  it('a failing transaction does not advance state, replies a typed retryable error, and the next command succeeds', async () => {
    const id = await fx.table('tbl_dbfail');
    const base = storeTransactions(fx.store);
    let failNext: 'sql' | 'down' | null = null;
    const faulty: TransactionRunner = {
      run(fn) {
        if (failNext === 'down') {
          failNext = null;
          return Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:5432'));
        }
        return base.run(async (tx) => {
          const result = await fn(tx);
          if (failNext === 'sql') {
            failNext = null;
            // A real PostgreSQL error AFTER the append + projection inside the same transaction.
            await tx.repos.q.query('SELECT 1 / 0');
          }
          return result;
        });
      },
    };
    const bus = new LocalBus();
    const published: unknown[] = [];
    await bus.subscribe(`bank:${id}:events`, (m) => published.push(m));
    const host = makeHost({ transactions: faulty, bus });
    await host.activate(KIND, id);
    await host.submit(KIND, id, open('a', 100));
    await host.submit(KIND, id, open('b', 100));
    await host.idle();
    const before = structuredClone(host.stateOf<BankState>(KIND, id));
    const projectionBefore = await fx.balances(id);
    const publishedBefore = published.length;

    for (const mode of ['sql', 'down'] as const) {
      failNext = mode;
      const err = await host.submit(KIND, id, transfer('x1', 'a', 'b', 30)).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ActorRuntimeError);
      expect(err).toMatchObject({ code: 'PERSISTENCE_FAILED', retryable: true });
      expect(host.stateOf(KIND, id)).toEqual(before);
      expect(host.stat(KIND, id)?.seq).toBe(2);
      expect(await commandSeqs(id)).toEqual([1, 2]);
      expect(await fx.balances(id)).toEqual(projectionBefore);
    }
    await new Promise((r) => setTimeout(r, 10));
    expect(published.length).toBe(publishedBefore);

    // Retrying the same request id now succeeds with the next seq.
    expect(await host.submit(KIND, id, transfer('x1', 'a', 'b', 30))).toEqual({ ok: true, seq: 3 });
    expect(await commandSeqs(id)).toEqual([1, 2, 3]);
    expect(await fx.balances(id)).toEqual({ a: 70, b: 130 });
    await host.stop();
  });

  it('a throwing step faults the actor: nothing persisted, onFault fires, later commands rejected until reset', async () => {
    const id = await fx.table('tbl_fault');
    const faults: ActorFault[] = [];
    const host = makeHost({ onFault: (f) => faults.push(f) });
    await host.activate(KIND, id);
    await host.submit(KIND, id, open('a', 100));
    const queued = [host.submit(KIND, id, { type: 'BOOM' }), host.submit(KIND, id, open('b', 5))];
    const [boom, after] = await Promise.allSettled(queued);
    expect(boom).toMatchObject({ status: 'rejected', reason: { code: 'FAULTED', retryable: false } });
    expect(after).toMatchObject({ status: 'rejected', reason: { code: 'FAULTED' } });
    expect(faults).toHaveLength(1);
    expect(faults[0]).toMatchObject({ kind: KIND, actorId: id, seq: 2, phase: 'step' });
    expect(host.stat(KIND, id)).toMatchObject({ status: 'faulted', faulted: true, seq: 1 });
    await expect(host.submit(KIND, id, open('c', 1))).rejects.toMatchObject({ code: 'FAULTED' });
    expect(await commandSeqs(id)).toEqual([1]);
    expect(host.stateOf<BankState>(KIND, id)!.accounts).toEqual({ a: 100 });

    await host.resetFaulted(KIND, id);
    expect(host.statusOf(KIND, id)).toBe('active');
    expect(await host.submit(KIND, id, open('b', 5))).toEqual({ ok: true, seq: 2 });
    await host.stop();
  });

  it('fencing: when two hosts are forced to own one actor, the stale one fails with FENCED and deactivates', async () => {
    const id = await fx.table('tbl_fence');
    const deactivations: string[] = [];
    // Separate lease managers = both believe they hold the lease (split brain).
    const h1 = makeHost({ nodeId: 'node-a' });
    const h2 = makeHost({ nodeId: 'node-b', onDeactivated: (i) => deactivations.push(i.reason) });
    await h1.activate(KIND, id);
    await h2.activate(KIND, id);
    expect(await h1.submit(KIND, id, open('a', 100))).toEqual({ ok: true, seq: 1 });
    const err = await h2.submit(KIND, id, open('b', 100)).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'FENCED', retryable: true });
    expect(h2.isHosted(KIND, id)).toBe(false);
    expect(deactivations).toEqual(['fenced at seq 1']);
    await expect(h2.submit(KIND, id, open('c', 1))).rejects.toMatchObject({ code: 'NOT_OWNER' });
    // The legitimate owner is unaffected.
    expect(await h1.submit(KIND, id, open('b', 100))).toEqual({ ok: true, seq: 2 });
    expect(await commandSeqs(id)).toEqual([1, 2]);
    await h1.stop();
    await h2.stop();
  });

  it('an idempotency-key collision in the database is CONFLICT, not fencing', async () => {
    const id = await fx.table('tbl_conflict');
    // Logged command 1 opened "z" but its row carries action id "open-a" (e.g. a foreign/restored row).
    await fx.db.query(`INSERT INTO table_commands (table_id, seq, command_id, at, type, command, action_id) VALUES ($1, 1, 'foreign', 0, 'OPEN', $2, 'open-a')`, [
      id,
      JSON.stringify(open('z', 1)),
    ]);
    const host = makeHost();
    await host.activate(KIND, id);
    // The actor has never seen request "open-a", but the UNIQUE(table_id, action_id) index has.
    const err = await host.submit(KIND, id, open('a', 100)).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'CONFLICT', retryable: false });
    expect(host.statusOf(KIND, id)).toBe('active');
    expect(await host.submit(KIND, id, open('b', 1))).toEqual({ ok: true, seq: 2 });
    await host.stop();
  });

  it('lease loss stops processing immediately: queued commands are rejected NOT_OWNER', async () => {
    const id = await fx.table('tbl_lease');
    const clock = new ManualClock();
    const leases = new MemoryLeaseManager();
    const gate = deferred();
    let gated = false;
    const base = storeTransactions(fx.store);
    const transactions: TransactionRunner = {
      run: (fn) =>
        base.run(async (tx) => {
          if (gated) await gate.promise;
          return fn(tx);
        }),
    };
    const host = makeHost({ clock, leases, transactions });
    await host.start();
    await host.activate(KIND, id);
    await host.submit(KIND, id, open('a', 100));
    await host.submit(KIND, id, open('b', 100));

    gated = true;
    const settled: Array<{ i: number; ok: boolean; code?: string }> = [];
    const pending = Array.from({ length: 10 }, (_, i) =>
      host.submit(KIND, id, transfer(`l${i}`, 'a', 'b', 1)).then(
        () => settled.push({ i, ok: true }),
        (e: ActorRuntimeError) => settled.push({ i, ok: false, code: e.code }),
      ),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(host.stat(KIND, id)?.queueLength).toBe(9);

    // Another node steals the lease; the next renewal is refused.
    const stat = host.stat(KIND, id)!;
    const lease: Lease = { resource: `${KIND}:${id}`, owner: 'node-1', epoch: stat.leaseEpoch!, expiresAt: stat.leaseExpiresAt! };
    await leases.release(lease);
    expect(await leases.acquire(`${KIND}:${id}`, 'thief', TTL, clock.now())).not.toBeNull();
    await clock.advance(RENEW);
    await new Promise((r) => setTimeout(r, 10));

    expect(settled.filter((s) => !s.ok)).toHaveLength(9);
    expect(settled.every((s) => s.ok || s.code === 'NOT_OWNER')).toBe(true);
    expect(host.isHosted(KIND, id)).toBe(false);
    await expect(host.submit(KIND, id, open('c', 1))).rejects.toMatchObject({ code: 'NOT_OWNER' });

    // The single command already inside its transaction may still commit (seq fencing protects the new owner).
    gate.resolve();
    await Promise.all(pending);
    expect(settled.find((s) => s.i === 0)).toEqual({ i: 0, ok: true });
    expect(await commandSeqs(id)).toEqual([1, 2, 3]);
    await host.stop();
  });

  it('answers reads from committed state without waiting behind a command in flight', async () => {
    const id = await fx.table('tbl_read');
    const gate = deferred();
    let gated = false;
    const base = storeTransactions(fx.store);
    const transactions: TransactionRunner = {
      run: (fn) =>
        base.run(async (tx) => {
          if (gated) await gate.promise;
          return fn(tx);
        }),
    };
    const host = makeHost({ transactions });
    await host.activate(KIND, id);
    await host.submit(KIND, id, open('a', 100));
    await host.submit(KIND, id, open('b', 0));

    gated = true;
    const inFlight = host.submit(KIND, id, transfer('r1', 'a', 'b', 40));
    const queued = host.submit(KIND, id, transfer('r2', 'a', 'b', 10));
    await new Promise((r) => setTimeout(r, 20));
    expect(host.stat(KIND, id)?.queueLength).toBe(1);

    // Reads resolve at once with the last committed state: the uncommitted transfer is invisible.
    expect(await host.read(KIND, id, { account: 'a' })).toBe(100);
    expect(await host.read(KIND, id, {})).toEqual({ version: 2, accounts: { a: 100, b: 0 } });

    gate.resolve();
    expect(await inFlight).toEqual({ ok: true, seq: 3 });
    expect(await queued).toEqual({ ok: true, seq: 4 });
    expect(await host.read(KIND, id, {})).toEqual({ version: 4, accounts: { a: 50, b: 50 } });
    await host.stop();
  });

  it('refuses reads for actors it does not host or no longer owns', async () => {
    const id = await fx.table('tbl_read_owner');
    const clock = new ManualClock();
    const leases = new MemoryLeaseManager();
    const host = makeHost({ clock, leases });
    await host.start();
    await expect(host.read(KIND, id, {})).rejects.toMatchObject({ code: 'NOT_OWNER' });
    await host.activate(KIND, id);
    await host.submit(KIND, id, open('a', 5));
    expect(await host.read(KIND, id, { account: 'a' })).toBe(5);

    const stat = host.stat(KIND, id)!;
    await leases.release({ resource: `${KIND}:${id}`, owner: 'node-1', epoch: stat.leaseEpoch!, expiresAt: stat.leaseExpiresAt! });
    expect(await leases.acquire(`${KIND}:${id}`, 'thief', TTL, clock.now())).not.toBeNull();
    await clock.advance(RENEW);
    await new Promise((r) => setTimeout(r, 10));
    await expect(host.read(KIND, id, {})).rejects.toMatchObject({ code: 'NOT_OWNER' });
    await host.stop();
  });

  it('stops processing when the lease cannot be renewed before it expires (renewals hanging)', async () => {
    const id = await fx.table('tbl_lease_hang');
    const clock = new ManualClock();
    const inner = new MemoryLeaseManager();
    const hanging: LeaseManager = {
      acquire: (...a) => inner.acquire(...a),
      renew: () => new Promise(() => undefined),
      release: (l) => inner.release(l),
    };
    const host = makeHost({ clock, leases: hanging });
    await host.start();
    await host.activate(KIND, id);
    expect(await host.submit(KIND, id, open('a', 1))).toEqual({ ok: true, seq: 1 });
    // ttl 10 s, safety 2 s: at t+8 s the lease is no longer trusted locally.
    await clock.advance(TTL - TTL / 5);
    await expect(host.submit(KIND, id, open('b', 1))).rejects.toMatchObject({ code: 'NOT_OWNER' });
    expect(host.isHosted(KIND, id)).toBe(false);
    expect(await commandSeqs(id)).toEqual([1]);
    await host.stop();
  });
});
