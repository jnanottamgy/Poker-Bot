import { runSimulatedTournament } from '@jpb/simulation';
const sizes = process.argv[2]!.split(',').map(Number);
const seeds = Number(process.argv[3] ?? 3);
const mixName = process.argv[4] ?? 'default';
const mixes: Record<string, Record<string, number> | undefined> = {
  default: undefined,
  timeouts: { TIMEOUT_ALWAYS: 2, RANDOM_LEGAL_ACTION: 3, ALL_IN_RANDOMLY: 1 },
  passive: { CALL_HEAVY: 4, ALWAYS_FOLD: 2, ALL_IN_RANDOMLY: 1 },
  aggro: { RAISE_HEAVY: 3, ALL_IN_RANDOMLY: 3 },
};
const latency = process.argv[5] ? (process.argv[5].split('-').map(Number) as [number, number]) : undefined;
let bad = 0;
for (const n of sizes) for (let s = 0; s < seeds; s++) {
  try {
    const r = runSimulatedTournament({ players: n, seed: `${mixName}-${n}-${s}`, strategyMix: mixes[mixName] as never, checkInvariants: n <= 1000, recordEvents: false, ...(latency ? { linkLatencyMs: latency } : {}) });
    const ok = r.finished && r.problems.length === 0 && r.host.alerts.length === 0;
    if (!ok) bad++;
    console.log(`${ok ? 'OK ' : 'BAD'} n=${n} seed=${s} hands=${r.handsPlayed} tables=${r.tablesCreated} moves=${r.host.director.seq.move} vmin=${Math.round(r.virtualDurationMs / 60000)} wall=${Math.round(r.wallClockMs)}ms ${ok ? '' : JSON.stringify({ p: r.problems.slice(0, 3), a: r.host.alerts.slice(0, 2), st: r.host.director.status })}`);
  } catch (e) {
    bad++;
    console.log(`ERR n=${n} seed=${s} ${(e as Error).message.slice(0, 300)}`);
  }
}
console.log(`failures: ${bad}`);
