// Debug harness: two nodes on Redis, crash the director's node, watch the survivor.
import type { TournamentPublicSummary } from '@jpb/shared-types';
import { buildServer } from '../src/server';
import type { JpbServer } from '../src/server';
import { createTestDatabase } from '../test/helpers/db';
import { Http } from '../test/helpers/client';
import { ORIGIN, ResilientBot, chaosEnv, setupTournament, waitFor, wsUrlOf } from '../../../tests/chaos/helpers';

const REDIS = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379';
const db = await createTestDatabase(`dbgfo_${process.pid}`);
const prefix = `jpb:test:dbgfo:${process.pid}:${Date.now()}:`;
const common = { db, redisPrefix: prefix, membershipTiming: { heartbeatMs: 150, ttlMs: 700 }, runtimeOverrides: { leaseTtlMs: 1500, leaseRenewMs: 300, rebalanceIntervalMs: 300, catalogGraceMs: 2000, verifyOnRecovery: true }, monitorEveryMs: 1000 };
const a = await buildServer(chaosEnv('A', { REDIS_URL: REDIS }), common);
const b = await buildServer(chaosEnv('B', { REDIS_URL: REDIS }), { ...common, skipMigrations: true });
const servers: JpbServer[] = [a, b];
const bases = [await a.listen(), await b.listen()];
await waitFor(() => a.runtime.node.membership.members().length === 2 && b.runtime.node.membership.members().length === 2, 10_000);
const { admin, tournament, https } = await setupTournament(bases, 24, 'DBGFO');
const dead = new Set<string>();
const live = (p: string) => (dead.has(p) ? bases.find((u) => !dead.has(u))! : p);
const bots = https.map((h, i) => new ResilientBot(h, tournament.id, () => wsUrlOf(live(bases[i % 2]!))));
await Promise.all(bots.map((x) => x.start()));
await admin.ok('POST', `/api/admin/tournaments/${tournament.id}/start`, {});
const pub = (base: string) => new Http(base, ORIGIN).ok<TournamentPublicSummary>('GET', `/api/public/tournaments/${tournament.joinCode}/summary`);
await waitFor(async () => (await pub(bases[0]!)).counters.handsCompleted >= 6, 120_000);
const show = (s: JpbServer) => s.runtime.node.stats().actors.map((x) => `${x.kind}:${x.actorId.slice(-3)}:${x.status}:${x.seq}:t${x.timers}${x.faulted ? ':F ' + x.fault?.message : ''}`).join(' ');
console.log('A', show(a));
console.log('B', show(b));
const vi = a.runtime.node.host.isHosted('director', tournament.id) ? 0 : 1;
const victim = servers[vi]!;
const survivor = servers[1 - vi]!;
dead.add(bases[vi]!);
console.log('crashing', vi === 0 ? 'A' : 'B');
await victim.crash();
console.log('crashed');
for (let i = 0; i < 25; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const s = await pub(bases[1 - vi]!).catch((e) => ({ err: String(e) }) as never);
  console.log(i, JSON.stringify((s as TournamentPublicSummary).counters), (s as TournamentPublicSummary).status, '|', show(survivor), '| members', survivor.runtime.node.membership.members().map((m) => m.nodeId).join(','), '| outbox', await survivor.store.repos.outbox.countPending(), JSON.stringify(survivor.runtime.dispatcher.stats()).slice(0, 300));
  if ((s as TournamentPublicSummary).status === 'COMPLETED') break;
}
for (const x of bots) x.stop();
await survivor.close();
await db.close();
process.exit(0);
