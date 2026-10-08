// Debug harness: runs one tournament through the real runtime and dumps state when it stalls.
import type { DirectorState, DirectorTable } from '@jpb/tournament-engine';
import { bmValues } from '@jpb/tournament-engine';
import { createTestDatabase } from '../test/helpers/db';
import { fastConfig, playUntilComplete, startGame } from '../test/helpers/game';

const players = Number(process.argv[2] ?? 20);
const db = await createTestDatabase(`dbg_${process.pid}`);
const fx = await startGame(db);
try {
  const t = await fx.rt.game.createTournament({ config: fastConfig(players, { joinCode: 'DBG001' }), createdBy: null });
  await fx.rt.game.directorInput(t.id, { type: 'OPEN_REGISTRATION' });
  for (let i = 0; i < players; i++) await fx.registration.register(t.joinCode, { fields: { name: `Bot ${i + 1}` }, accessCode: null, clientSeed: null });
  const st = await fx.rt.game.start(t.id, { adminId: 'a', reason: null }, null);
  console.log('start', st.ok, st.code, st.message);
  let last = -1;
  let stuckSince = Date.now();
  try {
    await playUntilComplete(fx, t.id, {
      timeoutMs: Number(process.argv[3] ?? 60_000),
      onTick: (s) => {
        if (s.counters.handsCompleted !== last) {
          last = s.counters.handsCompleted;
          stuckSince = Date.now();
        } else if (Date.now() - stuckSince > 8000) throw new Error('stalled');
      },
    });
    console.log('COMPLETED', JSON.stringify((await fx.store.repos.q.query('SELECT count(*)::int AS n FROM hands')).rows), JSON.stringify((await fx.store.repos.q.query('SELECT count(*)::int AS n, max(seq) AS m FROM table_events')).rows));
  } catch (err) {
    console.log('ERROR', String(err));
    const d = (await fx.rt.game.directorQuery<DirectorState>(t.id, { q: 'STATE' }))!;
    console.log('director', d.status, 'frozen', d.frozen, 'hfh', JSON.stringify(d.handForHand), 'final', JSON.stringify(d.finalTable));
    console.log('pendingMoves', JSON.stringify(d.pendingMoves, null, 1));
    console.log('counters', JSON.stringify(d.counters));
    for (const tb of bmValues(d.tables) as DirectorTable[]) {
      if (tb.summary.status === 'CLOSED') continue;
      console.log('dtable', tb.summary.tableNumber, tb.summary.tableId, tb.summary.status, tb.status, 'holds', tb.holds, 'seats', tb.summary.seats.map((s) => `${s.seat}:${s.playerId.slice(-4)}:${s.stack}${s.movingOut ? 'M' : ''}`).join(' '));
      const snap = await fx.rt.game.tableQuery<{ status: string; holds: string[]; frozen: boolean; seated: number; handNumber: number }>(tb.summary.tableId, { q: 'STATE' });
      console.log('   actor', JSON.stringify(snap));
      const upd = await fx.rt.game.tableSnapshot(tb.summary.tableId);
      console.log('   hand', JSON.stringify(upd?.publicView.hand));
    }
    console.log('outbox', await fx.store.repos.outbox.countPending(), JSON.stringify((await fx.store.repos.q.query('SELECT id, source_kind, target_id, attempts, last_error, payload FROM actor_outbox ORDER BY id LIMIT 10')).rows));
    console.log('alerts', JSON.stringify((await fx.store.repos.q.query('SELECT code, message FROM alerts')).rows));
    console.log('dispatcher', JSON.stringify(fx.rt.dispatcher.stats()));
    console.log('faults', JSON.stringify(fx.rt.node.stats().actors.filter((a) => a.faulted || a.status !== 'active')));
    const ev = await fx.store.repos.directorLogs.recentEvents(t.id, null, 15);
    for (const e of ev) console.log('event', e.seq, e.kind, JSON.stringify(e.payload).slice(0, 300));
  }
} finally {
  await fx.stop();
  await db.close();
}
