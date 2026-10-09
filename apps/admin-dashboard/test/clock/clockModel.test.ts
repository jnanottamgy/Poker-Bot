import { describe, expect, it } from 'vitest';
import type { BlindClockState, BlindLevel, BreakRule } from '@jpb/shared-types';
import { clockModel, shownRemaining } from '../../src/lib/clock';
import { breakAfterLevel, breakRuleAfter, projectSchedule } from '../../src/lib/schedule';

const MIN = 60_000;
const T0 = 1_800_000_000_000;
const level = (n: number, bb: number, minutes = 20): BlindLevel => ({ level: n, smallBlind: bb / 2, bigBlind: bb, ante: bb, durationSeconds: minutes * 60 });
const schedule: BlindLevel[] = [level(1, 200), level(2, 400), level(3, 600), level(4, 800), level(5, 1000)];
const breaks: BreakRule[] = [{ afterLevel: 2, durationSeconds: 600, message: 'Dinner' }];
const clock = (c: Partial<BlindClockState>): BlindClockState => ({ levelIndex: 0, levelStartedAt: null, levelEndsAt: null, pausedRemainingMs: null, breakEndsAt: null, pendingBreakAfterLevel: null, ...c });

describe('clockModel', () => {
  it('is not started before the tournament runs', () => {
    expect(clockModel({ status: 'REGISTRATION', frozen: false, clock: clock({}), hasNextLevel: true }).phase).toBe('not-started');
  });

  it('counts down to the level end while running', () => {
    const m = clockModel({ status: 'RUNNING', frozen: false, clock: clock({ levelStartedAt: T0, levelEndsAt: T0 + 20 * MIN }), hasNextLevel: true });
    expect(m).toMatchObject({ phase: 'running', ticking: true, deadline: T0 + 20 * MIN, playIndex: 0 });
    expect(shownRemaining(m, 1234)).toBe(1234);
  });

  it('treats a running last level without an end as open-ended, not paused', () => {
    const m = clockModel({ status: 'RUNNING', frozen: false, clock: clock({ levelIndex: 4, levelStartedAt: T0 }), hasNextLevel: false });
    expect(m.phase).toBe('last-level');
    expect(m.ticking).toBe(false);
  });

  it('holds the captured remaining time while paused or frozen', () => {
    const paused = clockModel({ status: 'PAUSED', frozen: false, clock: clock({ pausedRemainingMs: 5 * MIN }), hasNextLevel: true });
    expect(paused).toMatchObject({ phase: 'paused', heldRemainingMs: 5 * MIN, ticking: false });
    expect(shownRemaining(paused, 999)).toBe(5 * MIN);
    expect(clockModel({ status: 'RUNNING', frozen: true, clock: clock({ pausedRemainingMs: MIN }), hasNextLevel: true }).phase).toBe('frozen');
  });

  it('resumes with the NEXT level after a scheduled break and the SAME level after an ad-hoc break', () => {
    const scheduled = clockModel({ status: 'BREAK', frozen: false, clock: clock({ levelIndex: 1, breakEndsAt: T0 + 10 * MIN, pendingBreakAfterLevel: 1 }), hasNextLevel: true });
    expect(scheduled).toMatchObject({ phase: 'break', onBreak: true, scheduledBreak: true, playIndex: 2, deadline: T0 + 10 * MIN });
    const adHoc = clockModel({ status: 'BREAK', frozen: false, clock: clock({ levelIndex: 1, breakEndsAt: T0 + 5 * MIN, pausedRemainingMs: 7 * MIN }), hasNextLevel: true });
    expect(adHoc).toMatchObject({ phase: 'break', scheduledBreak: false, playIndex: 1 });
  });
});

describe('breakRuleAfter', () => {
  it('finds one-off and recurring rules (first match wins)', () => {
    const rules: BreakRule[] = [{ everyLevels: 4, durationSeconds: 600 }, { afterLevel: 6, durationSeconds: 900 }];
    expect(breakRuleAfter(rules, 4)?.index).toBe(0);
    expect(breakRuleAfter(rules, 6)?.index).toBe(1);
    expect(breakAfterLevel(rules, 5)).toBeNull();
  });
});

describe('projectSchedule', () => {
  it('projects levels and breaks from the running clock; the last level never ends', () => {
    const c = clock({ levelIndex: 1, levelStartedAt: T0, levelEndsAt: T0 + 20 * MIN });
    const model = clockModel({ status: 'RUNNING', frozen: false, clock: c, hasNextLevel: true });
    const p = projectSchedule({ schedule, breaks, clock: c, model, now: T0 + MIN });
    expect(p.tentative).toBe(false);
    expect(p.levels.map((l) => [l.level.level, l.played, l.isCurrent])).toEqual([
      [1, true, false],
      [2, false, true],
      [3, false, false],
      [4, false, false],
      [5, false, false],
    ]);
    const l2 = p.levels[1]!;
    expect(l2.startsAt).toBe(T0);
    expect(l2.breakAfter).toMatchObject({ startsAt: T0 + 20 * MIN, endsAt: T0 + 30 * MIN, message: 'Dinner', recurring: false });
    expect(p.levels[2]!.startsAt).toBe(T0 + 30 * MIN);
    expect(p.levels[4]!.endsAt).toBeNull();
  });

  it('is tentative while paused: times assume the clock resumes now', () => {
    const c = clock({ levelIndex: 0, levelStartedAt: T0, pausedRemainingMs: 4 * MIN });
    const model = clockModel({ status: 'PAUSED', frozen: false, clock: c, hasNextLevel: true });
    const now = T0 + 60 * MIN;
    const p = projectSchedule({ schedule, breaks, clock: c, model, now });
    expect(p.tentative).toBe(true);
    expect(p.levels[0]!.endsAt).toBe(now + 4 * MIN);
    expect(p.levels[1]!.startsAt).toBe(now + 4 * MIN);
  });

  it('during a scheduled break the ended level is played and the next level starts at the break end', () => {
    const c = clock({ levelIndex: 1, levelStartedAt: T0, breakEndsAt: T0 + 30 * MIN, pendingBreakAfterLevel: 1 });
    const model = clockModel({ status: 'BREAK', frozen: false, clock: c, hasNextLevel: true });
    const p = projectSchedule({ schedule, breaks, clock: c, model, now: T0 + 25 * MIN });
    expect(p.currentBreak).toEqual({ endsAt: T0 + 30 * MIN, scheduled: true });
    expect(p.levels[1]!.played).toBe(true);
    expect(p.levels[2]).toMatchObject({ played: false, isCurrent: false, startsAt: T0 + 30 * MIN, endsAt: T0 + 50 * MIN });
  });

  it('after an ad-hoc break the same level resumes with the time it had left', () => {
    const c = clock({ levelIndex: 0, levelStartedAt: T0, breakEndsAt: T0 + 15 * MIN, pausedRemainingMs: 3 * MIN });
    const model = clockModel({ status: 'BREAK', frozen: false, clock: c, hasNextLevel: true });
    const p = projectSchedule({ schedule, breaks, clock: c, model, now: T0 + 10 * MIN });
    expect(p.levels[0]).toMatchObject({ isCurrent: true, startsAt: T0 + 15 * MIN, endsAt: T0 + 18 * MIN });
  });

  it('before the start projects from the scheduled start time', () => {
    const model = clockModel({ status: 'REGISTRATION', frozen: false, clock: clock({}), hasNextLevel: true });
    const p = projectSchedule({ schedule, breaks, clock: clock({}), model, now: T0, startTime: T0 + 60 * MIN });
    expect(p.tentative).toBe(true);
    expect(p.levels[0]!.startsAt).toBe(T0 + 60 * MIN);
    expect(p.levels.every((l) => !l.played && !l.isCurrent)).toBe(true);
  });
});
