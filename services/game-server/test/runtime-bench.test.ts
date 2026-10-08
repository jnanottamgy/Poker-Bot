import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { LocalBus } from '../src/bus/local-bus';
import { createMetricsCatalog } from '../src/observability/catalog';
import { ActorHost } from '../src/runtime/actor-host';
import { MemoryActorLog } from '../src/runtime/actor-log';
import { MemoryLeaseManager } from '../src/runtime/lease';
import { memoryTransactions } from '../src/runtime/transactions';
import type { BankCommand, BankState } from './runtime-fixtures';
import { bankActor, open, transfer } from './runtime-fixtures';

const ACTORS = 100;
const COMMANDS_PER_ACTOR = 200;

describe('runtime micro-benchmark (in-memory log)', () => {
  it(`processes ${ACTORS} actors x ${COMMANDS_PER_ACTOR} commands concurrently`, async () => {
    const log = new MemoryActorLog();
    const metrics = createMetricsCatalog();
    const host = new ActorHost({
      nodeId: 'bench',
      transactions: memoryTransactions(),
      leases: new MemoryLeaseManager(),
      bus: new LocalBus(),
      metrics,
    }).register({ definition: bankActor({ snapshotEvery: 50 }), log });
    const ids = Array.from({ length: ACTORS }, (_, i) => `T${i}`);
    await Promise.all(ids.map((id) => host.activate('table', id)));

    const commands = (): BankCommand[] => [
      open('a', 1_000_000),
      open('b', 1_000_000),
      ...Array.from({ length: COMMANDS_PER_ACTOR - 2 }, (_, i) => transfer(`r${i}`, i % 2 ? 'a' : 'b', i % 2 ? 'b' : 'a', 1 + (i % 50))),
    ];
    const started = performance.now();
    await Promise.all(ids.flatMap((id) => commands().map((c) => host.submit('table', id, c))));
    const ms = performance.now() - started;
    const total = ACTORS * COMMANDS_PER_ACTOR;
    const perSecond = Math.round((total / ms) * 1000);
    console.log(`[runtime bench] ${total} commands across ${ACTORS} actors in ${ms.toFixed(0)} ms = ${perSecond} commands/s (in-memory log, snapshot every 50)`);

    for (const id of ids) {
      const s = host.stateOf<BankState>('table', id)!;
      expect(host.stat('table', id)!.seq).toBe(COMMANDS_PER_ACTOR);
      expect(s.accounts.a! + s.accounts.b!).toBe(2_000_000);
      expect(log.commandCount(id)).toBe(COMMANDS_PER_ACTOR);
    }
    // Generous bound: the runtime overhead must not be the bottleneck in front of PostgreSQL.
    expect(ms).toBeLessThan(10_000);
    await host.stop();
  }, 30_000);
});
