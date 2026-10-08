import { describe, expect, it } from 'vitest';
import { LocalBus } from '../src/bus/local-bus';
import { ActorHost } from '../src/runtime/actor-host';
import type { ActorRegistration } from '../src/runtime/actor-host';
import { MemoryActorLog } from '../src/runtime/actor-log';
import { ManualClock, settle } from '../src/runtime/clock';
import type { Clock, ClockTimer } from '../src/runtime/clock';
import { canonicalCopy } from '../src/runtime/canonical';
import { ActorRuntimeError, ReplayStepError } from '../src/runtime/errors';
import { MemoryLeaseManager } from '../src/runtime/lease';
import type { Lease, LeaseManager } from '../src/runtime/lease';
import { recoverActor } from '../src/runtime/recovery';
import { ActorRouter } from '../src/runtime/router';
import { memoryTransactions } from '../src/runtime/transactions';
import type { ActorTransaction, TransactionRunner } from '../src/runtime/transactions';
import type { BankCommand, BankReply, BankState } from './runtime-fixtures';
import { INTEREST_KEY, bankActor, deferred, lcg, open, transfer } from './runtime-fixtures';

/**
 * Adversarial review of the actor runtime — durability and concurrency
 * (in-memory log, deterministic ManualClock).
 */

const TTL = 10_000;
const RENEW = 3_000;

/**
 * Transaction runner that can report a failure AFTER the unit of work
 * committed — exactly what a connection lost during COMMIT looks like to
 * the caller (pg throws, but the server committed).
 */
class AmbiguousCommitRunner implements TransactionRunner {
  private readonly inner = memoryTransactions();
  commitThenFail = 0;
  failNext(err?: Error): void {
    this.inner.failNext(err);
  }
  async run<T>(fn: (tx: ActorTransaction) => Promise<T>): Promise<T> {
    const result = await this.inner.run(fn);
    if (this.commitThenFail > 0) {
      this.commitThenFail--;
      throw new Error('Connection terminated unexpectedly (during COMMIT)');
    }
    return result;
  }
}

function makeHost(opts: { transactions?: TransactionRunner; clock?: Clock; leases?: LeaseManager; log?: MemoryActorLog; nodeId?: string; snapshotEvery?: number; timerRetryMs?: number } = {}) {
  const log = opts.log ?? new MemoryActorLog();
  const def = bankActor({ snapshotEvery: opts.snapshotEvery ?? 250 });
  const reg: ActorRegistration = { definition: def, log };
  const host = new ActorHost({
    nodeId: opts.nodeId ?? 'node-1',
    transactions: opts.transactions ?? memoryTransactions(),
    leases: opts.leases ?? new MemoryLeaseManager(),
    bus: new LocalBus(),
    clock: opts.clock ?? new ManualClock(),
    leaseTtlMs: TTL,
    leaseRenewMs: RENEW,
    ...(opts.timerRetryMs !== undefined ? { timerRetryMs: opts.timerRetryMs } : {}),
  }).register(reg);
  return { host, log, def };
}

describe('review: ambiguous commits (COMMIT succeeded, error reported)', () => {
  it('control: the actor catches up from the log before its next command, so a retry with the same key is answered as a duplicate', async () => {
    const tx = new AmbiguousCommitRunner();
    const { host, log } = makeHost({ transactions: tx });
    await host.activate('table', 'T');
    await host.submit('table', 'T', open('a', 100));
    await host.submit('table', 'T', open('b', 100));
    tx.commitThenFail = 1;
    await expect(host.submit('table', 'T', transfer('t1', 'a', 'b', 100))).rejects.toMatchObject({ code: 'PERSISTENCE_FAILED', processed: 'unknown' });
    expect(log.commandCount('T')).toBe(3);
    // Same owner, no fencing round trip: the retry sees the committed command.
    expect(await host.submit('table', 'T', transfer('t1', 'a', 'b', 100))).toEqual({ ok: true, seq: 3, duplicate: true });
    expect(host.isActive('table', 'T')).toBe(true);
    expect(host.stat('table', 'T')).toMatchObject({ seq: 3, reconciling: false });
    expect(host.stateOf<BankState>('table', 'T')!.accounts).toEqual({ a: 0, b: 200 });
    await host.stop();
  });

  it('a failure while the log is unreachable pauses the mailbox until the log answers, then catches up', async () => {
    const clock = new ManualClock();
    const tx = new AmbiguousCommitRunner();
    const log = new MemoryActorLog();
    let down = false;
    const read = log.commandsAfter.bind(log);
    log.commandsAfter = async (...args) => {
      if (down) throw new Error('ECONNREFUSED');
      return read(...args);
    };
    const { host } = makeHost({ transactions: tx, clock, log });
    await host.activate('table', 'T');
    await host.submit('table', 'T', open('a', 100));
    await host.submit('table', 'T', open('b', 100));
    down = true;
    tx.commitThenFail = 1;
    await expect(host.submit('table', 'T', transfer('t1', 'a', 'b', 100))).rejects.toMatchObject({ code: 'PERSISTENCE_FAILED' });
    const waiting = host.submit<BankReply>('table', 'T', transfer('t2', 'b', 'a', 150));
    await clock.advance(2_500); // two retries fail
    expect(host.stat('table', 'T')).toMatchObject({ reconciling: true, queueLength: 1, seq: 2 });
    down = false;
    await clock.advance(1_000);
    expect(await waiting).toEqual({ ok: true, seq: 4 });
    expect(host.stateOf<BankState>('table', 'T')!.accounts).toEqual({ a: 150, b: 50 });
    await host.stop();
  });

  it('a unit of work that never settles times out as an ambiguous failure instead of wedging the mailbox', async () => {
    const clock = new ManualClock();
    let hang = false;
    const inner = memoryTransactions();
    const tx: TransactionRunner = { run: (fn) => (hang ? new Promise<never>(() => undefined) : inner.run(fn)) };
    const log = new MemoryActorLog();
    const host = new ActorHost({ nodeId: 'n', transactions: tx, leases: new MemoryLeaseManager(), bus: new LocalBus(), clock, leaseTtlMs: TTL, leaseRenewMs: RENEW, commitTimeoutMs: 2_000 }).register({
      definition: bankActor(),
      log,
    });
    await host.activate('table', 'T');
    await host.submit('table', 'T', open('a', 100));
    hang = true;
    const stuck = host.submit('table', 'T', open('b', 1)).catch((e: unknown) => e);
    await settle();
    await clock.advance(2_000);
    expect(await stuck).toMatchObject({ code: 'PERSISTENCE_FAILED', processed: 'unknown' });
    hang = false;
    expect(await host.submit('table', 'T', open('c', 1))).toEqual({ ok: true, seq: 2 });
    await host.stop();
  });

  it('BUG: after an ambiguous commit the actor keeps answering definitive (noop) rejections from a state that is behind the durable log', async () => {
    const tx = new AmbiguousCommitRunner();
    const { host, log, def } = makeHost({ transactions: tx });
    await host.activate('table', 'T');
    await host.submit('table', 'T', open('a', 100));
    await host.submit('table', 'T', open('b', 100));
    tx.commitThenFail = 1;
    await expect(host.submit('table', 'T', transfer('t1', 'a', 'b', 100))).rejects.toMatchObject({ code: 'PERSISTENCE_FAILED' });

    // Durable truth: t1 committed, b = 200.
    const durable = await recoverActor(def, log, 'T');
    expect(durable.state.accounts).toEqual({ a: 0, b: 200 });

    // b -> a 150 is valid against the durable state. The live actor still thinks b = 100
    // and answers a FINAL business rejection (not retryable, nothing logged, no fencing).
    const reply = await host.submit<BankReply>('table', 'T', transfer('t2', 'b', 'a', 150)).catch((e: unknown) => e);
    expect(reply).not.toEqual({ ok: false, code: 'INSUFFICIENT' });
    await host.stop();
  });

  it('BUG: timers requested by an ambiguously committed command are never armed until some later command happens to be fenced', async () => {
    const clock = new ManualClock();
    const tx = new AmbiguousCommitRunner();
    const { host, log } = makeHost({ transactions: tx, clock });
    await host.activate('table', 'T');
    await host.submit('table', 'T', open('a', 10_000));
    tx.commitThenFail = 1;
    await expect(host.submit('table', 'T', { type: 'START_INTEREST', rateBp: 100, everyMs: 1_000 })).rejects.toMatchObject({ code: 'PERSISTENCE_FAILED' });
    expect(log.commandCount('T')).toBe(2); // START_INTEREST is durable

    // Durable state says interest is due every second. Nothing fires: the actor is silently stalled
    // (for a poker table: the next player's turn timer is never armed).
    await clock.advance(5_000);
    await host.idle();
    expect(host.timers.timersOf('table:T').map((t) => t.key)).toContain(INTEREST_KEY);
    expect(log.commandCount('T')).toBeGreaterThan(2);
    await host.stop();
  });
});

describe('review: interleavings of concurrent submits, timer fires, transaction failures and crashes', () => {
  it('log stays gap-free, every acknowledged command is durable, and live state == replay (with and without snapshot)', async () => {
    const clock = new ManualClock();
    const log = new MemoryActorLog();
    const tx = memoryTransactions();
    const leases = new MemoryLeaseManager();
    const rnd = lcg(2024);
    let { host, def } = makeHost({ transactions: tx, clock, log, leases, snapshotEvery: 7, timerRetryMs: 50 });
    await host.activate('table', 'T');
    for (const a of ['a', 'b', 'c']) await host.submit('table', 'T', open(a, 1_000_000));
    await host.submit('table', 'T', { type: 'START_INTEREST', rateBp: 1, everyMs: 37 });

    const acked = new Set<string>();
    let reqNo = 0;
    for (let round = 0; round < 40; round++) {
      const batch: Array<Promise<unknown>> = [];
      for (let i = 0; i < 15; i++) {
        const id = `r${reqNo++}`;
        const accts = ['a', 'b', 'c'];
        const cmd: BankCommand = transfer(id, accts[Math.floor(rnd() * 3)]!, accts[Math.floor(rnd() * 3)]!, 1 + Math.floor(rnd() * 50));
        if (rnd() < 0.15) tx.failNext();
        batch.push(
          host.submit<BankReply>('table', 'T', cmd).then(
            (r) => {
              if (r.ok && !r.duplicate) acked.add(id);
            },
            (e: unknown) => {
              if (!(e instanceof ActorRuntimeError)) throw e;
            },
          ),
        );
        if (rnd() < 0.3) await clock.advance(Math.floor(rnd() * 40));
      }
      await Promise.all(batch);
      await host.idle();
      if (round % 10 === 9) {
        // Crash and fail over to a fresh host (no final snapshot, no release).
        const live = structuredClone(host.stateOf<BankState>('table', 'T'));
        await host.abandon();
        await clock.advance(TTL + 1);
        ({ host, def } = makeHost({ transactions: tx, clock, log, leases, nodeId: `node-${round}`, snapshotEvery: 7, timerRetryMs: 50 }));
        await host.activate('table', 'T');
        expect(host.stateOf('table', 'T')).toEqual(live);
      }
    }
    await clock.advance(500);
    await host.idle();

    const live = host.stateOf<BankState>('table', 'T')!;
    const seqs = (await log.commandsAfter('T', 0, 1_000_000)).map((c) => c.seq);
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
    for (const id of acked) expect(live.requests[id]).toBeDefined();
    const fromSnap = await recoverActor(def, log, 'T', { verify: true });
    const fromScratch = await recoverActor(def, log, 'T', { useSnapshot: false, verify: true });
    expect(JSON.stringify(fromSnap.state)).toBe(JSON.stringify(live));
    expect(JSON.stringify(fromScratch.state)).toBe(JSON.stringify(live));
    expect(live.interestRuns).toBeGreaterThan(10);
    // Exactly one interest timer survives all the crashes.
    expect(host.timers.timersOf('table:T')).toHaveLength(1);
    await host.stop();
  });

  it('snapshot boundaries: recovery from every snapshot cadence (1..6) equals full replay at every prefix length', async () => {
    for (let every = 1; every <= 6; every++) {
      const { host, log, def } = makeHost({ snapshotEvery: every });
      await host.activate('table', 'S');
      await host.submit('table', 'S', open('a', 1000));
      await host.submit('table', 'S', open('b', 1000));
      for (let i = 0; i < 13; i++) {
        await host.submit('table', 'S', transfer(`x${i}`, i % 2 ? 'a' : 'b', i % 2 ? 'b' : 'a', i + 1));
        const snap = await recoverActor(def, log, 'S');
        const full = await recoverActor(def, log, 'S', { useSnapshot: false });
        expect(snap.seq).toBe(full.seq);
        expect(snap.lastAt).toBe(full.lastAt);
        expect(JSON.stringify(snap.state)).toBe(JSON.stringify(full.state));
        expect(JSON.stringify(snap.state)).toBe(JSON.stringify(host.stateOf('table', 'S')));
      }
      await host.stop();
    }
  });

  it('a timer firing while a command is mid-transaction is processed after it, against the committed state', async () => {
    const clock = new ManualClock();
    let hold: Promise<void> | null = null;
    const inner = memoryTransactions();
    const tx: TransactionRunner = {
      run: (fn) =>
        inner.run(async (t) => {
          const r = await fn(t);
          if (hold) await hold;
          return r;
        }),
    };
    const { host } = makeHost({ transactions: tx, clock });
    await host.activate('table', 'T');
    await host.submit('table', 'T', open('a', 10_000));
    await host.submit('table', 'T', { type: 'START_INTEREST', rateBp: 100, everyMs: 1_000 });
    const gate = deferred();
    hold = gate.promise;
    const slow = host.submit('table', 'T', transfer('slow', 'a', 'a', 1));
    await settle();
    await clock.advance(1_000); // the interest timer fires while 'slow' is inside its transaction
    expect(host.stateOf<BankState>('table', 'T')!.interestRuns).toBe(0);
    hold = null;
    gate.resolve();
    await slow;
    await host.idle();
    const s = host.stateOf<BankState>('table', 'T')!;
    expect(s.interestRuns).toBe(1);
    expect(s.requests.slow).toBe(3);
    await host.stop();
  });
});

describe('review: replay enforces the same result checks as live processing', () => {
  it('a logged command whose replay breaks the gap-free event stream fails recovery with ReplayStepError', async () => {
    const log = new MemoryActorLog();
    const good = bankActor();
    const { host } = makeHost({ log });
    await host.activate('table', 'G');
    await host.submit('table', 'G', open('a', 1));
    await host.submit('table', 'G', open('b', 1));
    await host.stop();
    // A later build of the reducer skips an event seq on replay.
    const skipping = { ...good, step: (s: BankState, env: Parameters<typeof good.step>[1]) => {
      const r = good.step(s, env);
      return env.seq === 2 ? { ...r, events: r.events.map((e) => ({ ...e, seq: e.seq + 1 })) } : r;
    } };
    await expect(recoverActor(skipping, log, 'G', { useSnapshot: false })).rejects.toBeInstanceOf(ReplayStepError);
  });

  it('canonicalCopy sorts keys recursively and keeps a "__proto__" key as plain data', () => {
    const copy = canonicalCopy(JSON.parse('{"b":{"z":1,"a":[{"y":2,"x":1}]},"__proto__":{"polluted":true},"a":0}') as Record<string, unknown>);
    expect(JSON.stringify(copy)).toBe('{"__proto__":{"polluted":true},"a":0,"b":{"a":[{"x":1,"y":2}],"z":1}}');
    expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
    expect((copy as { polluted?: unknown }).polluted).toBeUndefined();
  });
});

describe('review: lease validity, timeouts and wedged transactions', () => {
  /** A clock whose wall time can be stepped backwards (NTP step) while timers keep real durations. */
  class SteppableClock implements Clock {
    offset = 0;
    constructor(private readonly base: ManualClock) {}
    now(): number {
      return this.base.now() + this.offset;
    }
    /** Real elapsed time (performance.now) is unaffected by the wall-clock step. */
    monotonic(): number {
      return this.base.monotonic();
    }
    setTimeout(fn: () => void, delayMs: number): ClockTimer {
      return this.base.setTimeout(fn, delayMs);
    }
    clearTimeout(t: ClockTimer): void {
      this.base.clearTimeout(t);
    }
  }

  it('BUG: lease validity is judged on the wall clock — after a backwards clock step a partitioned old owner keeps committing while another node holds the lease', async () => {
    const base = new ManualClock();
    const skewed = new SteppableClock(base);
    const shared = new MemoryLeaseManager();
    // Node A cannot reach the lease service any more (renewals error), acquire/release still delegate.
    const partitioned: LeaseManager = {
      acquire: (r, o, t, n) => shared.acquire(r, o, t, n),
      renew: async () => {
        throw new Error('ECONNREFUSED lease store');
      },
      release: (l: Lease) => shared.release(l),
    };
    const log = new MemoryActorLog();
    const a = makeHost({ nodeId: 'A', clock: skewed, leases: partitioned, log });
    await a.host.activate('table', 'T');
    await a.host.submit('table', 'T', open('x', 100));

    skewed.offset = -60_000; // NTP steps A's wall clock back one minute
    await base.advance(TTL + 1); // in real time A's lease has expired in the lease store

    const b = makeHost({ nodeId: 'B', clock: base, leases: shared, log });
    await b.host.activate('table', 'T'); // B legitimately owns the actor now
    expect(b.host.isActive('table', 'T')).toBe(true);

    // A must have stopped processing before its lease expired. It still commits.
    const late = await a.host.submit('table', 'T', open('y', 1)).catch((e: unknown) => e);
    expect(late).toBeInstanceOf(ActorRuntimeError);
    expect(late).toMatchObject({ code: 'NOT_OWNER' });
    await a.host.abandon();
    await b.host.stop();
  });

  it('BUG: router.submit ignores its deadline on the local fast path when the transaction hangs', async () => {
    let hang = false;
    const inner = memoryTransactions();
    const tx: TransactionRunner = { run: (fn) => (hang ? new Promise<never>(() => undefined) : inner.run(fn)) };
    const { host } = makeHost({ transactions: tx, clock: new ManualClock() });
    const router = new ActorRouter({ nodeId: 'node-1', role: 'all', host, bus: new LocalBus(), members: () => [{ nodeId: 'node-1', role: 'all', startedAt: 0, capacity: 1 }] });
    await host.activate('table', 'T');
    await host.submit('table', 'T', open('a', 1));
    hang = true; // e.g. the PostgreSQL socket is black-holed: no error, no reply
    const outcome = await Promise.race([
      router.submit('table', 'T', open('b', 1), { timeoutMs: 100 }).then(
        () => 'resolved',
        (e: unknown) => (e as ActorRuntimeError).code,
      ),
      new Promise((r) => setTimeout(() => r('still pending after 1s'), 1_000)),
    ]);
    expect(outcome).toBe('UNAVAILABLE');
    await host.abandon();
  });
});
