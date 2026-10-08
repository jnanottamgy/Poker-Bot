// Profiles the director actor's step at scale (no database): CREATE, 10k REGISTER, START, then seated reports.
import { simulationConfig } from '@jpb/simulation';
import { createDirectorActorDefinition } from '../src/game/director-actor';
import type { DirectorActorCommand, DirectorActorState } from '../src/game/director-actor';
import type { ActorEnvelope } from '../src/runtime/actor';
import { createSeedCommitment } from '@jpb/fairness-engine/node';

const N = Number(process.argv[2] ?? 10000);
const { serverSeed, serverSeedHash } = createSeedCommitment();
const def = createDirectorActorDefinition({ seedFor: () => serverSeed, snapshotEvery: 250 });
let state: DirectorActorState = def.initialState('trn_prof');
let seq = 0;
let at = 1_800_000_000_000;
const run = (command: DirectorActorCommand) => {
  const env: ActorEnvelope<DirectorActorCommand> = { actorId: 'trn_prof', seq: ++seq, commandId: `c${seq}`, at: (at += 5), command };
  const t0 = performance.now();
  const r = def.step(state, env);
  const ms = performance.now() - t0;
  if (!r.noop) state = r.state;
  return { r, ms };
};
run({ kind: 'CREATE', input: { tournamentId: 'trn_prof', config: simulationConfig(N), createdAt: at, serverSeedHash } });
run({ kind: 'INPUT', input: { type: 'OPEN_REGISTRATION' } });
let t = performance.now();
for (let i = 0; i < N; i++) run({ kind: 'INPUT', input: { type: 'REGISTER_PLAYER', playerId: `p${i}`, entryId: `e${i}`, displayName: `P${i}`, publicId: `X${i}`, registrationSeq: i + 1, clientSeed: null, approved: true } });
console.log(`register ${N}: ${Math.round(performance.now() - t)} ms`);
const start = run({ kind: 'INPUT', input: { type: 'START', publicEntropy: 'a'.repeat(64) } });
console.log(`START: ${Math.round(start.ms)} ms, outbox ${start.r.outbox.length}, effects/events ${start.r.events.length}`);
// Collect SEAT_PLAYER commands from START's projection (we re-derive from director state instead).
const d = state.director!;
const seats: Array<{ tableId: string; playerId: string; seat: number; stack: number }> = [];
for (const b of Object.values(d.tables.buckets)) for (const tb of Object.values(b as Record<string, { summary: { tableId: string; reservedSeats: number[] } }>)) void tb;
for (const b of Object.values(d.players.buckets)) for (const p of Object.values(b as Record<string, { playerId: string; tableId: string | null; seat: number | null; stack: number }>)) if (p.tableId !== null && p.seat !== null) seats.push({ tableId: p.tableId, playerId: p.playerId, seat: p.seat, stack: p.stack });
console.log('seated players known to director:', seats.length);
const times: number[] = [];
let rseq = 0;
for (const s of seats.slice(0, 200)) {
  const { ms } = run({ kind: 'REPORT', tableId: s.tableId, rseq: ++rseq, input: { type: 'TABLE_PLAYER_SEATED', tableId: s.tableId, playerId: s.playerId, seat: s.seat, stack: s.stack || 1000, moveId: null } });
  times.push(ms);
}
times.sort((a, b) => a - b);
console.log(`TABLE_PLAYER_SEATED step: p50 ${times[100]!.toFixed(1)} ms, p95 ${times[190]!.toFixed(1)} ms, max ${times[199]!.toFixed(1)} ms`);
t = performance.now();
const q = run({ kind: 'QUERY', query: { q: 'SUMMARY' } });
console.log(`SUMMARY query ${q.ms.toFixed(2)} ms`);
void t;
