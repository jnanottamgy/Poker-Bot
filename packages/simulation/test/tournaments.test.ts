import { describe, expect, it } from 'vitest';
import type { TournamentEvent } from '@jpb/shared-types';
import { replayRun, runDigest, runSimulatedTournament, SIM_T0, simulationConfig, simulationServerSeed, simulationTournamentId } from '../src';

const kinds = (events: TournamentEvent[], kind: TournamentEvent['kind']) => events.filter((e) => e.kind === kind);

describe('complete tournaments through the real engines', () => {
  for (const players of [2, 3, 5, 8, 9, 10, 16, 17, 24, 50, 100]) {
    it(`${players} players: one champion, every position once, chips conserved, prizes match`, () => {
      const r = runSimulatedTournament({ players, seed: `t${players}` });
      expect(r.finished).toBe(true);
      expect(r.problems).toEqual([]);
      expect(r.host.alerts).toEqual([]);
      const ev = r.host.tournamentEvents;
      expect(kinds(ev, 'TOURNAMENT_COMPLETED')).toHaveLength(1);
      expect(kinds(ev, 'FINAL_TABLE_FORMED')).toHaveLength(1);
      expect(kinds(ev, 'PLAYER_ELIMINATED')).toHaveLength(players - 1);
    });
  }

  it('16 players (the spec’s first demo): 2 tables of 8, then a final table', () => {
    const r = runSimulatedTournament({ players: 16, seed: 'first-demo' });
    expect(r.problems).toEqual([]);
    const created = kinds(r.host.tournamentEvents, 'TABLE_CREATED');
    expect(created).toHaveLength(3);
    const firstSeating = [...r.host.tableInits.values()].slice(0, 2).map((t) => t.maxSeats);
    expect(firstSeating).toEqual([9, 9]);
    const initialSeats = [...r.host.tableInits.keys()].slice(0, 2).map(
      (id) => (r.host.tableLogs.get(id) ?? []).filter((env) => env.command.type === 'SEAT_PLAYER' && env.command.moveId === null).length,
    );
    expect(initialSeats).toEqual([8, 8]);
  });

  it('1,000 players: 125 tables + final table', () => {
    const r = runSimulatedTournament({ players: 1000, seed: 'thousand', checkInvariants: false, recordEvents: false });
    expect(r.problems).toEqual([]);
    expect(r.tablesCreated).toBe(126);
  }, 120_000);

  it('timeout-heavy and passive fields still finish', () => {
    for (const strategyMix of [{ TIMEOUT_ALWAYS: 2, RANDOM_LEGAL_ACTION: 2, ALL_IN_RANDOMLY: 1 }, { CALL_HEAVY: 3, ALWAYS_FOLD: 2, ALL_IN_RANDOMLY: 1 }]) {
      const r = runSimulatedTournament({ players: 30, seed: JSON.stringify(strategyMix), strategyMix });
      expect(r.problems).toEqual([]);
    }
  }, 120_000);

  it('a field that busts straight to the bubble still merges and finishes', () => {
    // Seeds that stalled before the fix: hand-for-hand started at the bubble while the field
    // already fit the final table, and when the bubble burst no balancing ever ran again —
    // the last players sat alone at separate tables forever.
    const stalled: Array<[number, string, [number, number] | undefined]> = [
      [20, 'hunt-89', undefined],
      [20, 'hunt-124', undefined],
      [20, 'hunt-137', undefined],
      [27, 'hunt-92', undefined],
      [27, 'hunt-145', undefined],
      [20, 'hunt-80', [0, 300]],
      [27, 'hunt-94', [0, 300]],
    ];
    for (const [players, seed, latency] of stalled) {
      const r = runSimulatedTournament({ players, seed, strategyMix: { SHOVE_HEAVY: 1 }, maxVirtualMs: 6 * 3_600_000, ...(latency ? { linkLatencyMs: latency } : {}) });
      expect(r.finished, `${players}/${seed}: ${r.host.director.status}, ${r.host.director.counters.active} active`).toBe(true);
      expect(r.problems).toEqual([]);
      expect(kinds(r.host.tournamentEvents, 'FINAL_TABLE_FORMED')).toHaveLength(1);
    }
  });

  it('hand-for-hand runs at the bubble when several tables remain', () => {
    let seen = false;
    for (let s = 0; s < 6 && !seen; s++) {
      const r = runSimulatedTournament({ players: 64, seed: `bubble-${s}`, paidPercent: 25 });
      expect(r.problems).toEqual([]);
      seen = kinds(r.host.tournamentEvents, 'HAND_FOR_HAND').some((e) => e.kind === 'HAND_FOR_HAND' && e.enabled);
    }
    expect(seen).toBe(true);
  }, 120_000);

  it('levels advance and scheduled breaks happen in a long tournament', () => {
    const config = simulationConfig(40);
    const slow = {
      ...config,
      breaks: [{ everyLevels: 2, durationSeconds: 60 }],
      blindSchedule: config.blindSchedule.map((l) => ({ ...l, durationSeconds: 60 })),
    };
    const r = runSimulatedTournament({ players: 40, seed: 'breaks', config: slow, strategyMix: { CALL_HEAVY: 3, ALWAYS_FOLD: 1 } });
    expect(r.problems).toEqual([]);
    expect(kinds(r.host.tournamentEvents, 'BLIND_LEVEL_CHANGED').length).toBeGreaterThan(2);
    expect(kinds(r.host.tournamentEvents, 'BREAK_STARTED').length).toBeGreaterThan(0);
    expect(kinds(r.host.tournamentEvents, 'BREAK_ENDED').length).toBe(kinds(r.host.tournamentEvents, 'BREAK_STARTED').length);
  }, 120_000);
});

describe('determinism and replay', () => {
  it('the same seed reproduces the exact same tournament; another seed does not', () => {
    const a = runSimulatedTournament({ players: 24, seed: 'same' });
    const b = runSimulatedTournament({ players: 24, seed: 'same' });
    const c = runSimulatedTournament({ players: 24, seed: 'other' });
    expect(runDigest(a.host)).toBe(runDigest(b.host));
    expect(a.host.tournamentEvents).toEqual(b.host.tournamentEvents);
    expect(runDigest(c.host)).not.toBe(runDigest(a.host));
  });

  it('every actor rebuilt from its own log alone equals the live state (crash recovery model)', () => {
    for (const players of [10, 33]) {
      const seed = `replay-${players}`;
      const r = runSimulatedTournament({ players, seed });
      const replayed = replayRun(r.host, { tournamentId: simulationTournamentId(players, seed), serverSeed: simulationServerSeed(seed), startAt: SIM_T0 });
      expect(replayed.director).toEqual(r.host.director);
      for (const [id, live] of r.host.tables) expect(replayed.tables.get(id)).toEqual(live);
    }
  });
});

describe('asynchronous delivery (production-like races between moves, busts and reports)', () => {
  const cases: Array<[number, [number, number], string]> = [
    [18, [5, 400], 'async-a'],
    [60, [50, 3000], 'async-b'],
    [120, [1, 1500], 'async-c'],
    [200, [100, 5000], 'async-d'],
  ];
  for (const [players, latency, seed] of cases) {
    it(`${players} players with ${latency[0]}–${latency[1]} ms link latency finish cleanly and replay from logs`, () => {
      const r = runSimulatedTournament({ players, seed, linkLatencyMs: latency });
      expect(r.finished).toBe(true);
      expect(r.problems).toEqual([]);
      expect(r.host.alerts).toEqual([]);
      const replayed = replayRun(r.host, { tournamentId: simulationTournamentId(players, seed), serverSeed: simulationServerSeed(seed), startAt: SIM_T0 });
      expect(replayed.director).toEqual(r.host.director);
      const again = runSimulatedTournament({ players, seed, linkLatencyMs: latency, recordEvents: false });
      expect(runDigest(again.host)).toBe(runDigest(r.host));
    }, 120_000);
  }
});
