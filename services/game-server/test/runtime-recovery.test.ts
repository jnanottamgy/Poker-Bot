import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalBus } from '../src/bus/local-bus';
import { ActorHost } from '../src/runtime/actor-host';
import type { ActorFault } from '../src/runtime/actor-host';
import { ManualClock } from '../src/runtime/clock';
import { DeterminismError } from '../src/runtime/errors';
import { MemoryLeaseManager } from '../src/runtime/lease';
import type { ActorLog } from '../src/runtime/actor-log';
import { PostgresDirectorLog, PostgresTableLog } from '../src/runtime/pg-actor-log';
import { recoverActor } from '../src/runtime/recovery';
import { storeTransactions } from '../src/runtime/transactions';
import type { BankReply, BankState, PgFixture } from './runtime-fixtures';
import { INTEREST_KEY, TEST_DATABASE_URL, bankActor, lcg, open, pgFixture, transfer } from './runtime-fixtures';

const TTL = 10_000;

describe.skipIf(!TEST_DATABASE_URL)('actor recovery from PostgreSQL', () => {
  let fx: PgFixture;
  beforeAll(async () => {
    fx = await pgFixture('runtime_recovery');
  });
  afterAll(async () => fx?.close());

  const tableDef = bankActor({ projection: true });

  function makeHost(opts: { nodeId: string; clock: ManualClock; leases: MemoryLeaseManager; kind?: 'table' | 'director'; verify?: boolean; onFault?: (f: ActorFault) => void }) {
    const director = opts.kind === 'director';
    const log: ActorLog<never> = director ? new PostgresDirectorLog(fx.store.repos) : new PostgresTableLog(fx.store.repos);
    return new ActorHost({
      nodeId: opts.nodeId,
      transactions: storeTransactions(fx.store),
      leases: opts.leases,
      bus: new LocalBus(),
      clock: opts.clock,
      leaseTtlMs: TTL,
      leaseRenewMs: 3000,
      verifyOnRecovery: opts.verify ?? true,
      ...(opts.onFault ? { onFault: opts.onFault } : {}),
    }).register({ definition: director ? bankActor({ kind: 'director' }) : tableDef, log });
  }

  it('crash recovery: a new host rebuilds the exact state from PostgreSQL and its timers keep firing', async () => {
    const id = await fx.table('tbl_crash');
    const clock = new ManualClock();
    const leases = new MemoryLeaseManager();
    const h1 = makeHost({ nodeId: 'node-1', clock, leases });
    await h1.start();
    await h1.activate('table', id);
    await h1.submit('table', id, open('a', 10_000));
    await h1.submit('table', id, open('b', 20_000));
    await h1.submit('table', id, { type: 'START_INTEREST', rateBp: 100, everyMs: 60_000 });
    for (let i = 0; i < 20; i++) await h1.submit('table', id, transfer(`c${i}`, i % 2 ? 'a' : 'b', i % 2 ? 'b' : 'a', 50 + i));
    await clock.advance(60_000);
    await h1.idle();
    const before = structuredClone(h1.stateOf<BankState>('table', id)!);
    expect(before.interestRuns).toBe(1);
    const seqBefore = h1.stat('table', id)!.seq;

    // Crash: no final snapshot, no lease release.
    await h1.abandon();

    const h2 = makeHost({ nodeId: 'node-2', clock, leases });
    await h2.start();
    // node-1's lease is still live: activation must wait for it to expire.
    const activation = h2.activate('table', id);
    let activated = false;
    void activation.then(() => (activated = true));
    await clock.advance(TTL / 2);
    expect(activated).toBe(false);
    await clock.advance(TTL);
    const report = await activation;
    expect(report).toMatchObject({ snapshotSeq: 0, replayedCommands: seqBefore, seq: seqBefore, verified: true });
    expect(h2.stateOf('table', id)).toEqual(before);
    expect(h2.stat('table', id)!.leaseEpoch).toBe(2);

    // The interest timer was re-armed from state and fires on the new owner.
    expect(h2.timers.timersOf(`table:${id}`)).toEqual([{ key: INTEREST_KEY, at: before.interest!.nextAt, token: before.interest!.token }]);
    await clock.advance(before.interest!.nextAt - clock.now());
    await h2.idle();
    const after = h2.stateOf<BankState>('table', id)!;
    expect(after.interestRuns).toBe(2);
    expect(after.accounts.a).toBe(before.accounts.a! + Math.floor(before.accounts.a! / 100));
    expect(await fx.balances(id)).toEqual(after.accounts);
    expect(await h2.submit('table', id, transfer('post', 'a', 'b', 1))).toEqual({ ok: true, seq: seqBefore + 2 });
    await h2.stop();
  });

  it('snapshot + replay equivalence over 5,100 commands with a snapshot every 250', async () => {
    const id = await fx.table('tbl_snap');
    const clock = new ManualClock();
    const host = makeHost({ nodeId: 'node-1', clock, leases: new MemoryLeaseManager(), verify: false });
    await host.activate('table', id);
    const accounts = Array.from({ length: 10 }, (_, i) => `acct${i}`);
    for (const a of accounts) await host.submit('table', id, open(a, 1_000_000_000));
    const rnd = lcg(7);
    const pick = () => accounts[Math.floor(rnd() * accounts.length)]!;
    const replies = await Promise.all(Array.from({ length: 5090 }, (_, i) => host.submit<BankReply>('table', id, transfer(`s${i}`, pick(), pick(), 1 + Math.floor(rnd() * 1000)))));
    expect(replies.every((r) => r.ok)).toBe(true);
    expect(host.stat('table', id)!.seq).toBe(5100);

    const snaps = await fx.db.query<{ command_seq: number }>(`SELECT command_seq FROM table_snapshots WHERE table_id = $1 ORDER BY command_seq`, [id]);
    expect(snaps.rows.map((r) => r.command_seq)).toEqual([4500, 4750, 5000]);

    const live = host.stateOf<BankState>('table', id);
    const log = new PostgresTableLog(fx.store.repos);
    const fromSnapshot = await recoverActor(tableDef, log, id, { verify: true });
    expect(fromSnapshot.report).toEqual({ snapshotSeq: 5000, replayedCommands: 100, replayedEvents: 100, seq: 5100, verified: true });
    expect(fromSnapshot.state).toEqual(live);
    const fromScratch = await recoverActor(tableDef, log, id, { useSnapshot: false, verify: true });
    expect(fromScratch.report).toMatchObject({ snapshotSeq: 0, replayedCommands: 5100, replayedEvents: 5100, verified: true });
    expect(fromScratch.state).toEqual(live);

    // Graceful deactivation writes a final snapshot: the next activation replays nothing.
    await host.deactivate('table', id);
    const again = makeHost({ nodeId: 'node-1', clock, leases: new MemoryLeaseManager() });
    expect(await again.activate('table', id)).toMatchObject({ snapshotSeq: 5100, replayedCommands: 0, verified: true });
    expect(again.stateOf('table', id)).toEqual(live);
    await again.stop();
  }, 120_000);

  it('the determinism check rejects a log whose events the replay does not reproduce', async () => {
    const id = await fx.table('tbl_tamper');
    const clock = new ManualClock();
    const h1 = makeHost({ nodeId: 'node-1', clock, leases: new MemoryLeaseManager() });
    await h1.activate('table', id);
    await h1.submit('table', id, open('a', 100));
    await h1.submit('table', id, open('b', 100));
    await h1.submit('table', id, transfer('t1', 'a', 'b', 40));
    await h1.stop();
    // stop() wrote a final snapshot at seq 3; drop it so recovery replays (and verifies) every command.
    await fx.db.query(`DELETE FROM table_snapshots WHERE table_id = $1`, [id]);
    const log = new PostgresTableLog(fx.store.repos);
    await expect(recoverActor(tableDef, log, id, { verify: true })).resolves.toMatchObject({ report: { verified: true, replayedEvents: 3 } });

    await fx.db.query(`UPDATE table_events SET payload = '{"from":"a","to":"b","amount":4000}' WHERE table_id = $1 AND seq = 3`, [id]);
    await expect(recoverActor(tableDef, log, id, { verify: true })).rejects.toBeInstanceOf(DeterminismError);
    // Without verification the (command-log-authoritative) state still recovers.
    await expect(recoverActor(tableDef, log, id)).resolves.toMatchObject({ seq: 3 });

    const faults: ActorFault[] = [];
    const h2 = makeHost({ nodeId: 'node-2', clock, leases: new MemoryLeaseManager(), onFault: (f) => faults.push(f) });
    await expect(h2.activate('table', id)).rejects.toMatchObject({ code: 'NONDETERMINISTIC' });
    expect(faults).toMatchObject([{ phase: 'determinism', actorId: id }]);
    expect(h2.stat('table', id)).toMatchObject({ status: 'faulted' });
    await expect(h2.submit('table', id, open('c', 1))).rejects.toMatchObject({ code: 'FAULTED' });
    await h2.stop();

    await fx.db.query(`DELETE FROM table_commands WHERE table_id = $1 AND seq = 2`, [id]);
    await expect(recoverActor(tableDef, log, id)).rejects.toThrow(/gap/);
  });

  it('timers: replace and cancel are honoured live and across recovery', async () => {
    const id = await fx.table('tbl_timers');
    const clock = new ManualClock();
    const leases = new MemoryLeaseManager();
    const h1 = makeHost({ nodeId: 'node-1', clock, leases });
    await h1.activate('table', id);
    await h1.submit('table', id, open('a', 10_000));
    await h1.submit('table', id, { type: 'START_INTEREST', rateBp: 100, everyMs: 10_000 });
    // Replace: the same key re-armed further out; the first deadline must not fire.
    await h1.submit('table', id, { type: 'START_INTEREST', rateBp: 200, everyMs: 30_000 });
    expect(h1.timers.timersOf(`table:${id}`)).toHaveLength(1);
    await clock.advance(10_000);
    await h1.idle();
    expect(h1.stateOf<BankState>('table', id)!.interestRuns).toBe(0);
    await clock.advance(20_000);
    await h1.idle();
    expect(h1.stateOf<BankState>('table', id)!).toMatchObject({ interestRuns: 1, accounts: { a: 10_200 } });

    // Recovery re-arms the replaced timer only.
    await h1.abandon();
    const h2 = makeHost({ nodeId: 'node-2', clock, leases: new MemoryLeaseManager() });
    await h2.activate('table', id);
    const t = h2.timers.timersOf(`table:${id}`);
    expect(t).toEqual([{ key: INTEREST_KEY, at: clock.now() + 30_000, token: h2.stateOf<BankState>('table', id)!.interest!.token }]);

    // Cancel: stopping interest removes the timer, and a recovered actor has none.
    await h2.submit('table', id, { type: 'STOP_INTEREST' });
    expect(h2.timers.timersOf(`table:${id}`)).toEqual([]);
    await clock.advance(60_000);
    await h2.idle();
    expect(h2.stateOf<BankState>('table', id)!.interestRuns).toBe(1);
    await h2.stop();
    const h3 = makeHost({ nodeId: 'node-3', clock, leases: new MemoryLeaseManager() });
    await h3.activate('table', id);
    expect(h3.timers.size).toBe(0);
    await h3.stop();
  });

  it('director actors log to director_inputs / tournament_events / director_snapshots and recover', async () => {
    const id = await fx.tournament('trn_dir_1');
    const clock = new ManualClock();
    const h1 = makeHost({ nodeId: 'orch-1', clock, leases: new MemoryLeaseManager(), kind: 'director' });
    await h1.activate('director', id);
    await h1.submit('director', id, open('a', 500));
    await h1.submit('director', id, open('b', 500));
    expect(await h1.submit('director', id, transfer('d1', 'a', 'b', 5))).toEqual({ ok: true, seq: 3 });
    expect(await h1.submit('director', id, transfer('d1', 'a', 'b', 5))).toEqual({ ok: true, seq: 3, duplicate: true });
    const live = structuredClone(h1.stateOf<BankState>('director', id));
    await h1.abandon();

    const inputs = await fx.db.query<{ seq: number; type: string; input: { commandId: string; actionId: string | null } }>(
      `SELECT seq, type, input FROM director_inputs WHERE tournament_id = $1 ORDER BY seq`,
      [id],
    );
    expect(inputs.rows.map((r) => [r.seq, r.type, r.input.actionId])).toEqual([
      [1, 'OPEN', 'open-a'],
      [2, 'OPEN', 'open-b'],
      [3, 'TRANSFER', 'd1'],
    ]);
    expect(inputs.rows.every((r) => typeof r.input.commandId === 'string')).toBe(true);
    const events = await fx.store.repos.directorLogs.eventsAfter(id, 0);
    expect(events.map((e) => e.kind)).toEqual(['OPENED', 'OPENED', 'TRANSFERRED']);

    const h2 = makeHost({ nodeId: 'orch-2', clock, leases: new MemoryLeaseManager(), kind: 'director' });
    expect(await h2.activate('director', id)).toMatchObject({ replayedCommands: 3, verified: true });
    expect(h2.stateOf('director', id)).toEqual(live);
    await h2.stop();
    expect((await fx.store.repos.directorLogs.latestSnapshot(id))?.inputSeq).toBe(3);
  });
});
