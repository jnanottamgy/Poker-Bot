import { describe, expect, it } from 'vitest';
import type { BlindLevel, BreakRule } from '@jpb/shared-types';
import {
  addBreakAfter,
  createDraft,
  draftChanges,
  draftSchedule,
  insertLevel,
  nextLevelGuess,
  removeBreak,
  removeLevel,
  restoreBreaks,
  scheduleDiff,
  updateBreak,
  updateLevel,
  validateDraft,
} from '../../src/sections/clock/levelDraft';
import type { DraftContext } from '../../src/sections/clock/levelDraft';
import { parseAdjust } from '../../src/sections/clock/ClockControls';
import { setLevelKind } from '../../src/sections/clock/SetLevelDialog';
import { formatDelta } from '../../src/sections/clock/useClockActions';

const level = (n: number, bb: number): BlindLevel => ({ level: n, smallBlind: bb / 2, bigBlind: bb, ante: bb, durationSeconds: 1200 });
const schedule: BlindLevel[] = [level(1, 200), level(2, 400), level(3, 600), level(4, 800), level(5, 1000), level(6, 1200)];
const breaks: BreakRule[] = [{ everyLevels: 4, durationSeconds: 600, message: 'Stretch' }, { afterLevel: 5, durationSeconds: 900 }];
const ctx = (over: Partial<DraftContext> = {}): DraftContext => ({ schedule, breaks, anteType: 'BB_ANTE', speedMode: false, minLevels: 3, editableBreaksFrom: 2, ...over });

/** Draft while level 2 (index 1) is being played. */
const fresh = () => createDraft(schedule, breaks, 1);

describe('levelDraft', () => {
  it('only future levels are in the draft; an untouched draft has no changes and no errors', () => {
    const d = fresh();
    expect(d.levels).toHaveLength(4);
    expect(draftSchedule(ctx(), d)).toEqual(schedule);
    expect(draftChanges(ctx(), d)).toEqual({});
    expect(validateDraft(ctx(), d).count).toBe(0);
  });

  it('validates blinds, ante type, durations and that big blinds never decrease', () => {
    let d = fresh();
    const [l3, l4] = d.levels;
    d = updateLevel(d, l3!.key, { bigBlind: '300' }); // below level 2 (400)
    d = updateLevel(d, l4!.key, { smallBlind: '0', minutes: '0.5', ante: '1.5' });
    const v = validateDraft(ctx(), d);
    expect(v.levels[l3!.key]?.bigBlind).toMatch(/Not below level 2/);
    expect(v.levels[l4!.key]).toMatchObject({ smallBlind: expect.any(String), minutes: expect.any(String), ante: expect.any(String) });
    expect(validateDraft(ctx({ speedMode: true }), updateLevel(fresh(), l4!.key, { minutes: '0.5' })).levels[l4!.key]).toBeUndefined();
    expect(validateDraft(ctx({ anteType: 'NONE' }), fresh()).levels[l3!.key]?.ante).toMatch(/no antes/);
  });

  it('keeps enough levels for late registration / re-entry', () => {
    let d = fresh();
    for (const l of [...d.levels]) d = removeLevel(ctx(), d, l.key);
    expect(validateDraft(ctx({ minLevels: 4 }), d).general[0]).toMatch(/at least 4 levels/);
  });

  it('inserting a level guesses between its neighbours and keeps one-off breaks attached to their level', () => {
    let d = fresh();
    d = insertLevel(ctx(), d, 0); // after level 3 (600), before level 4 (800)
    const inserted = d.levels[1]!;
    expect(Number(inserted.bigBlind)).toBeGreaterThanOrEqual(600);
    expect(Number(inserted.bigBlind)).toBeLessThanOrEqual(800);
    expect(d.breaks.find((b) => b.kind === 'after')?.at).toBe('6'); // was after level 5
    expect(validateDraft(ctx(), d).count).toBe(0);
    d = removeLevel(ctx(), d, inserted.key);
    expect(d.breaks.find((b) => b.kind === 'after')?.at).toBe('5');
  });

  it('nextLevelGuess grows by about half at the end of the schedule', () => {
    expect(nextLevelGuess(level(9, 2000), 'BB_ANTE')).toMatchObject({ bigBlind: '3000', smallBlind: '1500', ante: '3000', minutes: '20' });
    expect(nextLevelGuess(level(9, 2000), 'NONE').ante).toBe('0');
  });

  it('adds, edits, removes and restores breaks; flags overlaps and played levels', () => {
    let d = addBreakAfter(fresh(), 3, 600);
    const added = d.breaks[d.breaks.length - 1]!;
    expect(validateDraft(ctx(), d).breaks[added.key]).toBeUndefined();
    d = updateBreak(d, added.key, { at: '4' }); // overlaps the recurring break after level 4
    expect(validateDraft(ctx(), d).breaks[added.key]?.at).toMatch(/Overlaps/);
    d = updateBreak(d, added.key, { at: '1' }); // already played
    expect(validateDraft(ctx(), d).breaks[added.key]?.at).toMatch(/already been played/);
    d = updateBreak(d, added.key, { at: '6' }); // last level never ends
    expect(validateDraft(ctx(), d).breaks[added.key]?.at).toMatch(/last level/);

    let r = removeBreak(fresh(), 'b1');
    expect(r.breaks.find((b) => b.key === 'b1')?.removed).toBe(true);
    expect(draftChanges(ctx(), r).breaks).toEqual([breaks[0]]);
    r = restoreBreaks(r);
    expect(draftChanges(ctx(), r)).toEqual({});
  });

  it('sends only the changed fields and builds a readable before/after preview', () => {
    let d = fresh();
    d = updateLevel(d, d.levels[0]!.key, { minutes: '25' });
    d = updateBreak(d, 'b1', { minutes: '20', message: 'Dinner' });
    const changes = draftChanges(ctx(), d);
    expect(changes.blindSchedule?.[2]).toEqual({ ...schedule[2], durationSeconds: 1500 });
    expect(changes.blindSchedule?.slice(0, 2)).toEqual(schedule.slice(0, 2));
    expect(changes.breaks?.[1]).toEqual({ afterLevel: 5, durationSeconds: 1200, message: 'Dinner' });
    const rows = scheduleDiff(schedule, changes.blindSchedule!, breaks, d);
    expect(rows).toEqual([
      { label: 'Level 3', before: '300 / 600 · ante 600 · 20 min', after: '300 / 600 · ante 600 · 25 min' },
      { label: 'Break after level 5', before: '15 min', after: '20 min · “Dinner”' },
    ]);
  });
});

describe('clock helpers', () => {
  it('parses custom adjustments', () => {
    expect(parseAdjust('2')).toBe(120_000);
    expect(parseAdjust('2.5')).toBe(150_000);
    expect(parseAdjust('2:30')).toBe(150_000);
    expect(parseAdjust('45s')).toBe(45_000);
    expect(parseAdjust('abc')).toBeNull();
    expect(parseAdjust('2:75')).toBeNull();
  });

  it('formats deltas and describes level jumps', () => {
    expect(formatDelta(60_000)).toBe('+1 min');
    expect(formatDelta(-150_000)).toBe('−2 min 30 s');
    expect(setLevelKind(5, 2).warn).toBe(true);
    expect(setLevelKind(5, 6)).toEqual({ text: 'Same as “Advance level”', warn: false });
    expect(setLevelKind(5, 9).text).toMatch(/Skips 3 levels/);
  });
});
