import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { BotStrategy } from '@jpb/simulation';
import { replayRun, runDigest, runSimulatedTournament, SIM_T0, simulationServerSeed, simulationTournamentId } from '@jpb/simulation';

const STRATEGIES: BotStrategy[] = ['ALWAYS_FOLD', 'RANDOM_LEGAL_ACTION', 'CALL_HEAVY', 'RAISE_HEAVY', 'ALL_IN_RANDOMLY', 'TIMEOUT_ALWAYS'];

const mixArb = fc
  .array(fc.integer({ min: 0, max: 5 }), { minLength: STRATEGIES.length, maxLength: STRATEGIES.length })
  .filter((w) => w.some((x) => x > 0) && w[0]! + w[5]! < w.reduce((a, b) => a + b, 0)) // not only folders/timeouts
  .map((w) => Object.fromEntries(STRATEGIES.map((s, i) => [s, w[i]!])) as Partial<Record<BotStrategy, number>>);

const latencyArb = fc.option(
  fc.tuple(fc.integer({ min: 0, max: 200 }), fc.integer({ min: 1, max: 3000 })).map(([lo, span]) => [lo, lo + span] as [number, number]),
  { nil: undefined },
);

/**
 * Whole-system properties over Johnny + the table engine: for ANY field size,
 * strategy mix, seed and (asynchronous) delivery latency, a tournament ends
 * with exactly one champion, every position assigned once, every chip
 * accounted for, the configured prizes paid, zero integrity alerts — and the
 * run is deterministic and reproducible from the command logs alone.
 */
describe('tournament properties (random fields, mixes, seeds, latencies)', () => {
  it('always completes correctly', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 70 }), mixArb, fc.stringMatching(/^[a-z0-9-]{1,12}$/), latencyArb, (players, mix, seed, latency) => {
        const r = runSimulatedTournament({ players, seed, strategyMix: mix, recordEvents: false, ...(latency ? { linkLatencyMs: latency } : {}) });
        expect(r.finished, `not finished: ${r.host.director.status}`).toBe(true);
        expect(r.problems).toEqual([]);
        expect(r.host.alerts).toEqual([]);
        expect(r.host.director.counters.totalChips).toBe(players * r.host.initialConfig.startingStack);
      }),
      { numRuns: 150 },
    );
  }, 300_000);

  it('is deterministic and replays from its logs', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 40 }), mixArb, fc.stringMatching(/^[a-z0-9-]{1,12}$/), latencyArb, (players, mix, seed, latency) => {
        const opts = { players, seed, strategyMix: mix, ...(latency ? { linkLatencyMs: latency } : {}) };
        const a = runSimulatedTournament(opts);
        const b = runSimulatedTournament({ ...opts, recordEvents: false });
        expect(runDigest(b.host)).toBe(runDigest(a.host));
        const replayed = replayRun(a.host, { tournamentId: simulationTournamentId(players, seed), serverSeed: simulationServerSeed(seed), startAt: SIM_T0 });
        expect(replayed.director).toEqual(a.host.director);
        for (const [id, live] of a.host.tables) expect(replayed.tables.get(id)).toEqual(live);
      }),
      { numRuns: 40 },
    );
  }, 300_000);
});
