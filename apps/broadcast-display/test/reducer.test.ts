import { describe, expect, it } from 'vitest';
import { INITIAL_DISPLAY_STATE, MAX_TICKER, SPLASH_MAX_AGE_MS, displayReducer, parseAdminScene, turnFrom } from '../src/model/reducer';
import type { DisplayAction, DisplayState } from '../src/model/types';
import { deepFreeze, elimination, frame, seat, snapshotFrame, summary, tev, tourFrame, updateFrame, view } from './fixtures';

const run = (actions: DisplayAction[], from: DisplayState = INITIAL_DISPLAY_STATE): DisplayState =>
  actions.reduce((s, a) => displayReducer(deepFreeze(s), a), from);

describe('display reducer: snapshot and connection', () => {
  it('a DISPLAY snapshot sets the tournament and the featured table and marks the feed synced', () => {
    const s = run([{ type: 'connection', status: 'open' }, snapshotFrame(view())]);
    expect(s.synced).toBe(true);
    expect(s.tournament?.name).toBe('Test Cup');
    expect(s.featured?.tableId).toBe('tbl_1');
    expect(s.featuredSeq).toBe(50);
    expect(s.lastTournamentSeq).toBe(10);
  });

  it('any non-open connection status marks the data not live (never stale-as-live)', () => {
    const s = run([{ type: 'connection', status: 'open' }, snapshotFrame(view()), { type: 'connection', status: 'reconnecting' }]);
    expect(s.synced).toBe(false);
    expect(s.tournament).not.toBeNull(); // kept for display, but the UI greys it out
    const back = run([{ type: 'connection', status: 'open' }], s);
    expect(back.synced).toBe(false); // only a fresh snapshot makes it live again
    expect(run([snapshotFrame(view())], back).synced).toBe(true);
  });

  it('a snapshot for another featured table (re-point) drops the old showdown', () => {
    const showdown = run([
      snapshotFrame(view()),
      updateFrame(view({ version: 6 }), [tev('tbl_1', { kind: 'POT_AWARDED', potIndex: 0, potType: 'MAIN', amount: 900, eligibleSeats: [0, 1], winners: [{ seat: 1, playerId: 'p1', amount: 900, oddChips: 0 }], winningHand: null }, 51)], 51, 51),
    ]);
    expect(showdown.showdown?.winners).toEqual({ 1: 900 });
    const repointed = run([snapshotFrame(view({ tableId: 'tbl_9', tableNumber: 9 }))], showdown);
    expect(repointed.featured?.tableNumber).toBe(9);
    expect(repointed.showdown).toBeNull();
  });

  it('stores refusals as errors', () => {
    const s = run([frame({ t: 'error', st: 1, code: 'DISPLAY_NOT_ALLOWED', message: 'The broadcast display is disabled for this tournament.' })]);
    expect(s.error?.code).toBe('DISPLAY_NOT_ALLOWED');
  });
});

describe('display reducer: table updates', () => {
  it('replaces the view with newer versions and ignores older ones', () => {
    const s0 = run([snapshotFrame(view({ version: 5 }))]);
    const newer = run([updateFrame(view({ version: 7, seats: [seat(0, { stack: 1 }), null, null, null, null, null] }), [], 51, 52)], s0);
    expect(newer.featured?.version).toBe(7);
    expect(newer.featuredSeq).toBe(52);
    const older = run([updateFrame(view({ version: 6 }))], newer);
    expect(older).toBe(newer);
  });

  it('collects showdown reveals, pot winners and the final board; the next hand clears them', () => {
    const s0 = run([snapshotFrame(view())]);
    const events = [
      tev('tbl_1', {
        kind: 'SHOWDOWN',
        reveals: [
          { seat: 0, playerId: 'p0', cards: ['Qs', 'Qd'], mucked: false, hand: { category: 'ONE_PAIR', score: 1, bestFive: ['Qs', 'Qd', 'Ah', 'Kd', '7c'], description: 'One Pair, Queens' } },
          { seat: 1, playerId: 'p1', cards: ['Ac', 'As'], mucked: false, hand: { category: 'THREE_OF_A_KIND', score: 2, bestFive: ['Ac', 'As', 'Ah', 'Kd', '7c'], description: 'Three of a Kind, Aces' } },
          { seat: 3, playerId: 'p3', cards: null, mucked: true, hand: null },
        ],
      }, 51),
      tev('tbl_1', { kind: 'POT_AWARDED', potIndex: 0, potType: 'MAIN', amount: 5_000, eligibleSeats: [0, 1], winners: [{ seat: 1, playerId: 'p1', amount: 5_000, oddChips: 0 }], winningHand: { category: 'THREE_OF_A_KIND', description: 'Three of a Kind, Aces', bestFive: ['Ac', 'As', 'Ah', 'Kd', '7c'] } }, 52),
      tev('tbl_1', { kind: 'POT_AWARDED', potIndex: 1, potType: 'SIDE', amount: 800, eligibleSeats: [0, 1, 3], winners: [{ seat: 1, playerId: 'p1', amount: 800, oddChips: 0 }], winningHand: { category: 'ONE_PAIR', description: 'Side pot hand', bestFive: [] } }, 53),
      tev('tbl_1', { kind: 'HAND_COMPLETED', handId: 'h1', handNumber: 9, board: ['Ah', 'Kd', '7c', '2s', '3h'], totalPot: 5_800, finalStacks: [], bustedSeats: [] }, 54),
    ];
    const s = run([updateFrame(view({ version: 6, hand: null }), events, 51, 54)], s0);
    expect(s.showdown).toMatchObject({
      handNumber: 9,
      winners: { 1: 5_800 },
      description: 'Three of a Kind, Aces',
      bestFive: ['Ac', 'As', 'Ah', 'Kd', '7c'],
      reveals: { 0: 'One Pair, Queens', 1: 'Three of a Kind, Aces' },
      board: ['Ah', 'Kd', '7c', '2s', '3h'],
      complete: true,
    });
    // Replayed events (seq <= featuredSeq) are not applied twice.
    const replay = run([updateFrame(view({ version: 7, hand: null }), events, 51, 54)], s);
    expect(replay.showdown?.winners).toEqual({ 1: 5_800 });
    const next = run(
      [
        updateFrame(view({ version: 8 }), [
          tev('tbl_1', { kind: 'HAND_STARTED', handId: 'h2', handNumber: 10, buttonSeat: 1, smallBlindSeat: 3, bigBlindSeat: 0, smallBlind: 300, bigBlind: 600, ante: 75, anteType: 'BB_ANTE', players: [] }, 55),
        ], 55, 55),
      ],
      replay,
    );
    expect(next.showdown).toBeNull();
  });

  it('derives the acting seat timer from ACTION_REQUESTED, else from the first sighting', () => {
    const v = view();
    expect(turnFrom(v, null, [])).toEqual({ seat: 1, deadline: 2_000_000, totalMs: 15_000 });
    const req = tev('tbl_1', { kind: 'ACTION_REQUESTED', seat: 1, playerId: 'p1', legal: {} as never, deadline: 2_000_000, timerMs: 20_000, turnVersion: 3 });
    expect(turnFrom(v, null, [req])).toEqual({ seat: 1, deadline: 2_000_000, totalMs: 20_000 });
    const prev = { seat: 1, deadline: 2_000_000, totalMs: 20_000 };
    expect(turnFrom(v, prev, [])).toBe(prev);
    expect(turnFrom(view({ hand: null }), prev, [])).toBeNull();
  });
});

describe('display reducer: tournament events', () => {
  it('dedupes by seq, takes the frame summary and writes ticker lines', () => {
    const s0 = run([snapshotFrame(view())]);
    const s1 = run([tourFrame(11, elimination(20, 19, 'Asha'), 5_000, summary({ lastSeq: 11 }))], s0);
    expect(s1.lastTournamentSeq).toBe(11);
    expect(s1.ticker.at(-1)?.text).toBe('Asha finishes in 20th place · 19 remain');
    expect(s1.eliminations[0]).toMatchObject({ displayName: 'Asha', finishPosition: 20 });
    expect(run([tourFrame(11, elimination(19, 18))], s1)).toBe(s1);
    expect(run([tourFrame(9, elimination(19, 18))], s1)).toBe(s1);
  });

  it('bounds the ticker', () => {
    const actions = Array.from({ length: MAX_TICKER + 5 }, (_, i) => tourFrame(20 + i, { kind: 'MILESTONE', code: `M${i}`, text: `MILESTONE ${i}`, playersRemaining: 9 }));
    const s = run([snapshotFrame(view()), ...actions]);
    expect(s.ticker).toHaveLength(MAX_TICKER);
    expect(s.ticker.at(-1)?.text).toBe(`Milestone ${MAX_TICKER + 4}`);
  });

  it('splashes eliminations only deep in the field, and always final table / milestones', () => {
    const s = run([
      snapshotFrame(view()),
      tourFrame(11, elimination(300, 299)),
      tourFrame(12, elimination(9, 8, 'Ravi')),
      tourFrame(13, { kind: 'FINAL_TABLE_FORMED', tableId: 'tbl_1', players: [] }),
      tourFrame(14, { kind: 'MILESTONE', code: 'TABLES_2_3', text: 'TABLES REDUCED TO 2', playersRemaining: 12 }),
    ]);
    expect(s.splashes.map((x) => x.kind)).toEqual(['ELIMINATION', 'FINAL_TABLE']);
    expect(s.splashes[0]).toMatchObject({ title: 'Ravi', subtitle: 'finishes in 9th place · 8 remain' });
    expect(s.finalTableId).toBe('tbl_1');
  });

  it('drops a shown splash, and expired ones with it', () => {
    const s = run([snapshotFrame(view()), tourFrame(11, elimination(9, 8), 1_000), tourFrame(12, elimination(8, 7), 50_000)]);
    expect(s.splashes).toHaveLength(2);
    const after = run([{ type: 'splash_done', id: 'nope', now: 1_000 + SPLASH_MAX_AGE_MS + 1 }], s);
    expect(after.splashes.map((x) => x.id)).toEqual(['s12']);
  });

  it('tracks pause / freeze / resume and keeps pause consistent with the status', () => {
    const paused = run([snapshotFrame(view()), tourFrame(11, { kind: 'TOURNAMENT_PAUSED', mode: 'EMERGENCY_FREEZE', reason: 'Power check' }, 5_000, summary({ status: 'PAUSED', lastSeq: 11 }))]);
    expect(paused.pause).toEqual({ mode: 'EMERGENCY_FREEZE', reason: 'Power check' });
    const resumed = run([tourFrame(12, { kind: 'TOURNAMENT_RESUMED' }, 6_000, summary({ lastSeq: 12 }))], paused);
    expect(resumed.pause).toBeNull();
    // A snapshot that says PAUSED without any event still shows the overlay.
    expect(run([snapshotFrame(view(), summary({}, 'PAUSED'))]).pause).toEqual({ mode: 'AFTER_HAND', reason: null });
  });

  it('records announcements, break messages and the champion', () => {
    const s = run([
      snapshotFrame(view()),
      tourFrame(11, { kind: 'ANNOUNCEMENT', text: 'Dinner at 9', from: 'DIRECTOR' }, 7_000),
      tourFrame(12, { kind: 'BREAK_STARTED', endsAt: 9_000, nextLevel: null, message: 'Chip race now' }),
      tourFrame(13, { kind: 'TOURNAMENT_COMPLETED', winnerId: 'p1', winnerName: 'Mira', completedAt: 9 }, 8_000, summary({ status: 'COMPLETED', lastSeq: 13 })),
    ]);
    expect(s.announcement).toMatchObject({ text: 'Dinner at 9', at: 7_000 });
    expect(s.breakMessage).toBe('Chip race now');
    expect(s.champion).toEqual({ playerId: 'p1', name: 'Mira' });
  });
});

describe('display reducer: admin scene frames', () => {
  it('parses the scene leniently; unknown scenes mean auto-rotation', () => {
    expect(parseAdminScene('leaderboard')).toBe('LEADERBOARD');
    expect(parseAdminScene('FINAL_TABLE')).toBe('FINAL_TABLE');
    expect(parseAdminScene('SOMETHING_NEW')).toBe('AUTO');
    const s = run([snapshotFrame(view()), frame({ t: 'display_scene', st: 1, scene: 'LEADERBOARD', tableId: null }, 4_000)]);
    expect(s.adminScene).toEqual({ scene: 'LEADERBOARD', tableId: null, at: 4_000 });
  });

  it('the admin choice is cleared when the tournament completes (the champion takes over)', () => {
    const s = run([
      snapshotFrame(view()),
      frame({ t: 'display_scene', st: 1, scene: 'OVERVIEW', tableId: null }),
      tourFrame(11, { kind: 'TOURNAMENT_COMPLETED', winnerId: 'p1', winnerName: 'Mira', completedAt: 9 }, 8_000, summary({ status: 'COMPLETED', lastSeq: 11 })),
    ]);
    expect(s.adminScene).toBeNull();
  });
});
