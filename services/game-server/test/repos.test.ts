import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TournamentConfig } from '@jpb/shared-types';
import { createTestDatabase } from './helpers/db';
import { Store } from '../src/persistence/store';
import { DuplicateSequenceError } from '../src/persistence/repos/logs';
import { TournamentConfigLockedError } from '../src/persistence/repos/tournaments';

const url = process.env.TEST_DATABASE_URL;

function config(): TournamentConfig {
  return {
    name: 'Repo Test',
    joinCode: 'REPO01',
    game: 'NLH',
    minPlayers: 2,
    maxPlayers: 100,
    tables: { targetSize: 8, maxSize: 9, minSize: 2, finalTableSize: 9 },
    startingStack: 10_000,
    blindSchedule: [
      { level: 1, smallBlind: 50, bigBlind: 100, ante: 0, durationSeconds: 480 },
      { level: 2, smallBlind: 75, bigBlind: 150, ante: 0, durationSeconds: 480 },
    ],
    anteType: 'NONE',
    breaks: [],
    timing: {
      actionTimerSeconds: 15,
      awayActionTimerSeconds: 5,
      awayAfterTimeouts: 2,
      actionGraceMs: 500,
      timeoutBehavior: 'CHECK_ELSE_FOLD',
      betweenHandsDelayMs: 2000,
      showdownDelayMs: 2000,
      startCountdownSeconds: 30,
    },
    lateRegistration: { enabled: false, untilLevel: 0 },
    reentry: { enabled: false, maxEntriesPerPlayer: 1, untilLevel: 0 },
    prizeStructure: { currency: 'INR', places: [{ position: 1, amountMinor: 10_000_000 }, { position: 2, amountMinor: 6_000_000 }] },
    registration: { fields: [{ key: 'name', required: true }], requireApproval: false, accessCode: null },
    startTime: null,
    autoStart: false,
    registrationDeadline: null,
    spectators: { enabled: true, allowEliminatedPlayers: true, publicWatch: false, delaySeconds: 0 },
    balancing: { maxImbalance: 1, recentMoveWindowHands: 10, weights: { position: 1, blindFairness: 1, recentMove: 1, seatCompatibility: 0.1 }, consolidateBy: 'TARGET' },
    handForHand: { autoAtBubble: true },
    features: { spectatorMode: true, advancedFairnessAudit: true, lateRegistration: false, soundEffects: true, haptics: true, broadcastDisplay: true },
    speedMode: false,
  };
}

describe.skipIf(!url)('postgres repositories (requires TEST_DATABASE_URL)', () => {
  let store: Store;
  beforeAll(async () => {
    store = new Store(await createTestDatabase('repos'));
  });
  afterAll(async () => store?.close());

  it('admins: create, lookup case-insensitively, lockout after failures', async () => {
    const { admins } = store.repos;
    const a = await admins.create({ id: 'adm_1', username: 'Director', displayName: 'TD', role: 'TOURNAMENT_DIRECTOR', passwordHash: 'x', tournamentScope: null, createdBy: null });
    expect(a.username).toBe('director');
    expect((await admins.findByUsername('DIRECTOR'))?.id).toBe('adm_1');
    for (let i = 0; i < 5; i++) await admins.recordLoginFailure('adm_1');
    const locked = await admins.findById('adm_1');
    expect(locked?.failedLogins).toBe(5);
    expect(locked?.lockedUntil).not.toBeNull();
    await admins.recordLoginSuccess('adm_1');
    expect((await admins.findById('adm_1'))?.lockedUntil).toBeNull();
  });

  it('tournaments: config lock, registration sequence, normalized blind levels', async () => {
    const { tournaments } = store.repos;
    const t = await tournaments.create({ id: 'trn_1', joinCode: 'REPO01', config: config(), serverSeedHash: 'h', serverSeedEnc: 'e', isSimulation: false, createdBy: 'adm_1' });
    expect(t.status).toBe('DRAFT');
    expect((await tournaments.getByJoinCode('repo01'))?.id).toBe('trn_1');
    const levels = await store.repos.q.query(`SELECT count(*)::int AS n FROM blind_levels WHERE tournament_id='trn_1'`);
    expect(levels.rows[0].n).toBe(2);
    expect(await tournaments.nextRegistrationSeq('trn_1')).toBe(1);
    expect(await tournaments.nextRegistrationSeq('trn_1')).toBe(2);
    await tournaments.lockConfig('trn_1');
    await expect(tournaments.updateConfig('trn_1', config())).rejects.toBeInstanceOf(TournamentConfigLockedError);
    await tournaments.updateStatus('trn_1', 'RUNNING');
    expect((await tournaments.get('trn_1'))?.startedAt).not.toBeNull();
  });

  it('players: registration, search, listing, payments', async () => {
    const { players } = store.repos;
    for (const [i, name] of ['Rahul Sharma', 'Arjun', 'Karthik'].entries()) {
      await players.createPlayer({ id: `ply_${i}`, tournamentId: 'trn_1', publicId: `JPN-000${i}`, displayName: name, nickname: i === 1 ? 'AJ' : null, participantId: null, email: null, phone: null, collegeId: null });
      await players.createEntry({ entryId: `ent_${i}`, tournamentId: 'trn_1', playerId: `ply_${i}`, registrationSeq: i + 1, entryNumber: 1, status: 'REGISTERED', clientSeed: `ab${i}`, stack: 10_000 });
    }
    expect((await players.search('trn_1', 'kar')).map((p) => p.displayName)).toEqual(['Karthik']);
    expect((await players.search('trn_1', 'aj')).map((p) => p.displayName)).toEqual(['Arjun']);
    expect((await players.search('trn_1', 'sharma')).map((p) => p.displayName)).toEqual(['Rahul Sharma']);
    expect((await players.search('trn_1', 'jpn-0002')).map((p) => p.displayName)).toEqual(['Karthik']);
    expect(await players.search('trn_1', '%')).toEqual([]);
    await players.updateEntryState('ent_2', { stack: 25_000, status: 'SEATED', tableId: null, seat: 3 });
    const list = await players.listEntries('trn_1', { sort: 'stack_desc' });
    expect(list.total).toBe(3);
    expect(list.rows[0]?.displayName).toBe('Karthik');
    const paid = await players.setPayment('ent_0', { status: 'PAID', processedBy: 'adm_1', reference: 'UTR123' });
    expect(paid?.paymentStatus).toBe('PAID');
    expect(paid?.paidAt).not.toBeNull();
    expect((await players.listClientSeeds('trn_1')).sort()).toEqual(['ab0', 'ab1', 'ab2']);
  });

  it('audit: chained appends verify and survive concurrency', async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        store.transaction((r) =>
          r.audit.append({ id: `aud_${i}`, at: 1_760_000_000_123 + i, tournamentId: 'trn_1', adminId: 'adm_1', adminUsername: 'director', action: 'PAUSE', target: 'tournament', reason: `r${i}`, beforeState: { s: 'RUNNING' }, afterState: { s: 'PAUSED' }, ip: '127.0.0.1' }),
        ),
      ),
    );
    const v = await store.repos.audit.verify();
    expect(v).toEqual({ checked: 20, brokenAtSeq: null });
    expect((await store.repos.audit.list({ tournamentId: 'trn_1', limit: 5 })).length).toBe(5);
  });

  it('table logs: gap-free append, duplicate seq fencing, snapshots, replay reads, idempotency lookup', async () => {
    const { tableLogs } = store.repos;
    await tableLogs.createTable({ id: 'trn_1:T1', tournamentId: 'trn_1', tableNumber: 1, maxSeats: 9, status: 'WAITING', isFinalTable: false });
    await store.transaction((r) =>
      r.tableLogs.append('trn_1:T1', { seq: 1, commandId: 'c1', at: 1000, type: 'PLAYER_ACTION', command: { a: 1 }, actionId: 'ACT-1' }, [
        { seq: 1, version: 1, at: 1000, kind: 'PLAYER_ACTED', visibility: 'PUBLIC', privateTo: null, payload: { x: 1 } },
        { seq: 2, version: 1, at: 1000, kind: 'HOLE_CARDS_DEALT', visibility: 'PRIVATE', privateTo: 'ply_0', payload: { c: ['As', 'Kd'] } },
      ], { status: 'IN_HAND', playerCount: 2, handsPlayed: 0, progressed: true }),
    );
    await expect(
      store.transaction((r) => r.tableLogs.append('trn_1:T1', { seq: 1, commandId: 'c1b', at: 1001, type: 'X', command: {}, actionId: null }, [], { status: 'IN_HAND', playerCount: 2, handsPlayed: 0, progressed: false })),
    ).rejects.toBeInstanceOf(DuplicateSequenceError);
    expect((await tableLogs.findByActionId('trn_1:T1', 'ACT-1'))?.seq).toBe(1);
    await tableLogs.saveSnapshot('trn_1:T1', { commandSeq: 1, version: 1, at: 1000, state: { hello: 'world' } });
    expect((await tableLogs.latestSnapshot<{ hello: string }>('trn_1:T1'))?.state.hello).toBe('world');
    expect(await tableLogs.commandsAfter('trn_1:T1', 0)).toHaveLength(1);
    expect((await tableLogs.eventsAfter('trn_1:T1', 1))[0]?.privateTo).toBe('ply_0');
    const meta = await tableLogs.getTable('trn_1:T1');
    expect(meta?.lastEventSeq).toBe(2);
    expect(meta?.status).toBe('IN_HAND');
    await tableLogs.setSeat('trn_1:T1', 4, 'ply_0', 9000);
    await tableLogs.setSeat('trn_1:T1', 5, 'ply_0', 9000);
    const seats = await store.repos.q.query(`SELECT seat_index FROM seats WHERE player_id = 'ply_0'`);
    expect(seats.rows.map((r: { seat_index: number }) => r.seat_index)).toEqual([5]);
  });

  it('alerts: dedupe open alerts and acknowledge', async () => {
    const { alerts } = store.repos;
    await alerts.create({ id: 'al_1', tournamentId: 'trn_1', severity: 'WARNING', code: 'TABLE_STALLED', message: 'Table 37 stalled', target: 'table:37' });
    expect(await alerts.findOpen('trn_1', 'TABLE_STALLED', 'table:37')).not.toBeNull();
    expect((await alerts.acknowledge('al_1', 'adm_1'))?.acknowledgedBy).toBe('adm_1');
    expect(await alerts.resolveByCode('trn_1', 'TABLE_STALLED', 'table:37')).toBe(1);
    expect(await alerts.findOpen('trn_1', 'TABLE_STALLED', 'table:37')).toBeNull();
  });
});
