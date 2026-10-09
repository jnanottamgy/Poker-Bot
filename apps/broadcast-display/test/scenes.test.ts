import { describe, expect, it } from 'vitest';
import { INITIAL_DISPLAY_STATE, displayReducer } from '../src/model/reducer';
import { ANNOUNCEMENT_HOLD_MS, availableScenes, nextScene, resolveScene, rotationScenes } from '../src/model/scenes';
import type { DisplayAction, DisplayState } from '../src/model/types';
import { elimination, frame, snapshotFrame, summary, tourFrame, view } from './fixtures';

const run = (actions: DisplayAction[], from: DisplayState = INITIAL_DISPLAY_STATE): DisplayState => actions.reduce(displayReducer, from);
const ctx = (over: Partial<Parameters<typeof resolveScene>[1]> = {}) => ({ rotationIndex: 0, now: 10_000, localPick: null, ...over });
const leaderboard: DisplayAction = {
  type: 'leaderboard',
  at: 1,
  data: { mode: 'stack', label: 'Current stack ranking', rows: [{ rank: 1, playerId: 'p1', publicId: 'P1', displayName: 'Lead', stack: 90_000, finishPosition: null, tiedCount: 1, prizeMinor: 0, status: 'SEATED', tableNumber: 2 }], total: 20, offset: 0, limit: 10 },
};

describe('scene logic', () => {
  it('before the start only the overview rotates', () => {
    const s = run([snapshotFrame(null, summary({}, 'REGISTRATION'))]);
    expect(rotationScenes(s)).toEqual(['OVERVIEW']);
    expect(resolveScene(s, ctx({ rotationIndex: 5 }))).toBe('OVERVIEW');
  });

  it('rotates overview -> featured table -> leaderboard while running', () => {
    const s = run([snapshotFrame(view()), leaderboard]);
    expect(rotationScenes(s)).toEqual(['OVERVIEW', 'FEATURED_TABLE', 'LEADERBOARD']);
    expect([0, 1, 2, 3].map((i) => resolveScene(s, ctx({ rotationIndex: i })))).toEqual(['OVERVIEW', 'FEATURED_TABLE', 'LEADERBOARD', 'OVERVIEW']);
    // Without ranking data or eliminations there is no leaderboard scene.
    expect(rotationScenes(run([snapshotFrame(view())]))).toEqual(['OVERVIEW', 'FEATURED_TABLE']);
  });

  it('the featured table becomes the FINAL TABLE scene once the final table plays', () => {
    const s = run([snapshotFrame(view()), tourFrame(11, { kind: 'FINAL_TABLE_FORMED', tableId: 'tbl_1', players: [] })]);
    expect(rotationScenes(s)).toEqual(['OVERVIEW', 'FINAL_TABLE']); // no ranking data and no eliminations yet: no leaderboard
    expect(availableScenes(s)).not.toContain('FEATURED_TABLE');
    const byStatus = run([snapshotFrame(view(), summary({}, 'FINAL_TABLE'))]);
    expect(rotationScenes(byStatus)).toContain('FINAL_TABLE');
  });

  it('precedence: S-key pick > fresh announcement > admin choice > champion > break > rotation', () => {
    const base = run([snapshotFrame(view()), leaderboard, frame({ t: 'display_scene', st: 1, scene: 'LEADERBOARD', tableId: null })]);
    expect(resolveScene(base, ctx())).toBe('LEADERBOARD');
    const announced = run([tourFrame(11, { kind: 'ANNOUNCEMENT', text: 'Hi', from: 'ADMIN' }, 9_000)], base);
    expect(resolveScene(announced, ctx())).toBe('ANNOUNCEMENT');
    expect(resolveScene(announced, ctx({ now: 9_000 + ANNOUNCEMENT_HOLD_MS }))).toBe('LEADERBOARD');
    expect(resolveScene(announced, ctx({ localPick: { scene: 'OVERVIEW', until: 20_000 } }))).toBe('OVERVIEW');
    expect(resolveScene(announced, ctx({ localPick: { scene: 'OVERVIEW', until: 5_000 } }))).toBe('ANNOUNCEMENT');

    const onBreak = run([snapshotFrame(view(), summary({ clock: { ...summary().clock, breakEndsAt: 50_000 } }, 'BREAK'))]);
    expect(resolveScene(onBreak, ctx({ rotationIndex: 1 }))).toBe('BREAK');

    const done = run([snapshotFrame(view()), tourFrame(11, { kind: 'TOURNAMENT_COMPLETED', winnerId: 'p1', winnerName: 'Mira', completedAt: 1 }, 1, summary({ lastSeq: 11 }, 'COMPLETED'))]);
    expect(resolveScene(done, ctx({ rotationIndex: 2 }))).toBe('CHAMPION');
  });

  it('an admin choice that is not available falls back to the rotation', () => {
    const s = run([snapshotFrame(null), frame({ t: 'display_scene', st: 1, scene: 'FEATURED_TABLE', tableId: null })]);
    expect(resolveScene(s, ctx())).toBe('OVERVIEW');
    // CHAMPION is never shown without a champion.
    const c = run([snapshotFrame(view()), frame({ t: 'display_scene', st: 1, scene: 'CHAMPION', tableId: null })]);
    expect(resolveScene(c, ctx({ rotationIndex: 1 }))).toBe('FEATURED_TABLE');
  });

  it('S cycles through every available scene', () => {
    const s = run([snapshotFrame(view()), leaderboard, tourFrame(11, elimination(20, 19))]);
    expect(availableScenes(s)).toEqual(['OVERVIEW', 'FEATURED_TABLE', 'LEADERBOARD']);
    expect(nextScene(s, 'OVERVIEW')).toBe('FEATURED_TABLE');
    expect(nextScene(s, 'LEADERBOARD')).toBe('OVERVIEW');
    expect(nextScene(s, 'ANNOUNCEMENT')).toBe('OVERVIEW');
  });
});
