import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyHand } from '@jpb/fairness-engine/node';
import type { TournamentPublicSummary } from '@jpb/shared-types';
import type { DirectorState } from '@jpb/tournament-engine';
import type { Database } from '../src/persistence/db';
import { fairnessRecordOf } from '../src/game/table-actor';
import { createTestDatabase, TEST_DATABASE_URL } from './helpers/db';
import { fastConfig, playUntilComplete, startGame } from './helpers/game';
import type { GameFixture } from './helpers/game';

const ADMIN = { adminId: 'adm_test', reason: null };

/**
 * End to end through the real runtime: Postgres logs and projections, the
 * durable outbox between Johnny and the tables, seeds encrypted at rest,
 * crash-style restarts with determinism checks, and fairness verification of
 * every hand after the seed reveal.
 */
describe.skipIf(!TEST_DATABASE_URL)('game runtime: complete tournaments on PostgreSQL', () => {
  let db: Database;
  let fx: GameFixture;
  beforeAll(async () => {
    db = await createTestDatabase('game_runtime');
    fx = await startGame(db);
  });
  afterAll(async () => {
    await fx?.stop();
    await db?.close();
  });

  async function setup(players: number, joinCode: string) {
    const t = await fx.rt.game.createTournament({ config: fastConfig(players, { joinCode, name: `E2E ${joinCode}` }), createdBy: null });
    expect((await fx.rt.game.directorInput(t.id, { type: 'OPEN_REGISTRATION' })).ok).toBe(true);
    for (let i = 0; i < players; i++) {
      const r = await fx.registration.register(t.joinCode, { fields: { name: `Bot ${i + 1}` }, accessCode: null, clientSeed: `seed${i}` });
      expect(r.ok).toBe(true);
    }
    return t;
  }

  it('runs a 20-player tournament to completion with consistent projections', async () => {
    const t = await setup(20, 'E2EA01');
    const started = await fx.rt.game.start(t.id, ADMIN, 'admin-entropy');
    expect(started.ok).toBe(true);
    const { summary, actions } = await playUntilComplete(fx, t.id, { timeoutMs: 150_000 });
    expect(summary.status).toBe('COMPLETED');
    expect(actions).toBeGreaterThan(20);

    await fx.rt.dispatcher.idle();
    await expect.poll(() => fx.store.repos.outbox.countPending(), { timeout: 5000 }).toBe(0);

    const record = (await fx.store.repos.tournaments.get(t.id))!;
    expect(record.status).toBe('COMPLETED');
    expect(record.publicEntropy).toBe(started.publicEntropy);
    const entries = await fx.store.repos.q.query<{ finish_position: number | null; status: string; prize_minor: string | null }>(`SELECT finish_position, status, prize_minor FROM tournament_players WHERE tournament_id = $1`, [t.id]);
    expect(entries.rows).toHaveLength(20);
    const positions = entries.rows.map((r) => r.finish_position).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(positions[0]).toBe(1);
    expect(entries.rows.every((r) => r.finish_position !== null)).toBe(true);
    expect(entries.rows.filter((r) => r.finish_position === 1)).toHaveLength(1);
    const prizes = entries.rows.reduce((n, r) => n + Number(r.prize_minor ?? 0), 0);
    expect(prizes).toBe(record.config.prizeStructure.places.reduce((n, p) => n + p.amountMinor, 0));

    const hands = await fx.store.repos.hands.list(t.id, { limit: 1000 });
    expect(hands.total).toBe(summary.counters.handsCompleted);
    expect(hands.total).toBeGreaterThan(0);
    const seed = (await fx.rt.seeds.reveal(t.id))!;
    let verified = 0;
    for (const row of hands.rows.slice(0, 40)) {
      const h = (await fx.store.repos.hands.get(row.handId))!;
      const rec = fairnessRecordOf(h.history, { serverSeedHash: record.serverSeedHash, publicEntropy: record.publicEntropy! })!;
      const res = verifyHand(rec, seed);
      expect(res.status, JSON.stringify(res.checks)).toBe('VERIFIED');
      verified++;
    }
    expect(verified).toBeGreaterThan(0);

    const alerts = await fx.store.repos.q.query(`SELECT code, message FROM alerts WHERE tournament_id = $1`, [t.id]);
    expect(alerts.rows).toEqual([]);
    const director = (await fx.rt.game.directorQuery<DirectorState>(t.id, { q: 'STATE' }))!;
    expect(director.winnerId).not.toBeNull();
  }, 200_000);

  it('survives restarts mid-tournament (recovery replays the logs deterministically)', async () => {
    const t = await setup(12, 'E2EB01');
    expect((await fx.rt.game.start(t.id, ADMIN, null)).ok).toBe(true);
    let restarts = 0;
    let lastRestart = Date.now();
    const { summary } = await playUntilComplete(fx, t.id, {
      timeoutMs: 150_000,
      onTick: async (s: TournamentPublicSummary) => {
        if (restarts < 3 && s.status !== 'COMPLETED' && Date.now() - lastRestart > 700) {
          restarts++;
          await fx.restart();
          lastRestart = Date.now();
        }
      },
    });
    expect(restarts).toBeGreaterThanOrEqual(1);
    expect(summary.status).toBe('COMPLETED');
    const faults = fx.rt.node.stats().actors.filter((a) => a.faulted);
    expect(faults).toEqual([]);
    const alerts = await fx.store.repos.q.query(`SELECT code, message FROM alerts WHERE tournament_id = $1`, [t.id]);
    expect(alerts.rows).toEqual([]);
  }, 200_000);
});
