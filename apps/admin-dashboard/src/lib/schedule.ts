import type { BlindClockState, BlindLevel, BreakRule } from '@jpb/shared-types';

/**
 * Blind-schedule projections FOR DISPLAY ONLY (projected wall-clock times in
 * the Clock & Structure screen). The director's clock on the server is the
 * authority; these numbers are labelled "projected" wherever shown.
 */

/** The break rule that applies after `level` (1-based) ends, if any. */
export function breakAfterLevel(breaks: readonly BreakRule[], level: number): BreakRule | null {
  for (const b of breaks) {
    if (b.afterLevel !== undefined && b.afterLevel === level) return b;
    if (b.everyLevels !== undefined && b.everyLevels > 0 && level % b.everyLevels === 0) return b;
  }
  return null;
}

export interface ProjectedBreak {
  durationSeconds: number;
  message: string | null;
  startsAt: number;
  endsAt: number;
}

export interface ProjectedLevel {
  index: number;
  level: BlindLevel;
  startsAt: number;
  endsAt: number;
  /** Break taken after this level, if any. */
  breakAfter: ProjectedBreak | null;
  isCurrent: boolean;
}

export interface Projection {
  levels: ProjectedLevel[];
  /** Times assume the clock resumes now (clock paused or frozen). */
  tentative: boolean;
}

/** End of the current level as the server clock describes it (or as if resumed now). */
export function currentLevelEnd(clock: BlindClockState, schedule: readonly BlindLevel[], serverNow: number): { endsAt: number; tentative: boolean } {
  const duration = (schedule[clock.levelIndex]?.durationSeconds ?? 0) * 1000;
  if (clock.breakEndsAt !== null) return { endsAt: clock.breakEndsAt + (clock.pausedRemainingMs ?? duration), tentative: false };
  if (clock.levelEndsAt !== null) return { endsAt: clock.levelEndsAt, tentative: false };
  return { endsAt: serverNow + (clock.pausedRemainingMs ?? duration), tentative: true };
}

/** Current level and every later level with projected start/end times and breaks. */
export function projectSchedule(schedule: readonly BlindLevel[], breaks: readonly BreakRule[], clock: BlindClockState, serverNow: number): Projection {
  const { endsAt: firstEnd, tentative } = currentLevelEnd(clock, schedule, serverNow);
  const out: ProjectedLevel[] = [];
  let end = firstEnd;
  for (let i = clock.levelIndex; i < schedule.length; i++) {
    const level = schedule[i]!;
    const isCurrent = i === clock.levelIndex;
    const duration = level.durationSeconds * 1000;
    const startsAt = isCurrent ? (clock.levelStartedAt ?? end - duration) : end;
    const endsAt = isCurrent ? end : startsAt + duration;
    const rule = breakAfterLevel(breaks, level.level);
    const brk = rule && i < schedule.length - 1 ? { durationSeconds: rule.durationSeconds, message: rule.message ?? null, startsAt: endsAt, endsAt: endsAt + rule.durationSeconds * 1000 } : null;
    out.push({ index: i, level, startsAt, endsAt, breakAfter: brk, isCurrent });
    end = brk ? brk.endsAt : endsAt;
  }
  return { levels: out, tentative };
}

export interface PlacedClock {
  clock: BlindClockState;
  onBreak: boolean;
}

/** Where a clock that started at `startedAt` and never paused stands at `now` (mock data generation). */
export function placeClock(schedule: readonly BlindLevel[], breaks: readonly BreakRule[], startedAt: number, now: number): PlacedClock {
  let t = startedAt;
  for (let i = 0; i < schedule.length; i++) {
    const dur = schedule[i]!.durationSeconds * 1000;
    if (now < t + dur) {
      return { onBreak: false, clock: { levelIndex: i, levelStartedAt: t, levelEndsAt: t + dur, pausedRemainingMs: null, breakEndsAt: null, pendingBreakAfterLevel: null } };
    }
    t += dur;
    const rule = breakAfterLevel(breaks, schedule[i]!.level);
    if (rule && i + 1 < schedule.length) {
      const brEnd = t + rule.durationSeconds * 1000;
      if (now < brEnd) {
        const nextDur = schedule[i + 1]!.durationSeconds * 1000;
        return { onBreak: true, clock: { levelIndex: i + 1, levelStartedAt: null, levelEndsAt: null, pausedRemainingMs: nextDur, breakEndsAt: brEnd, pendingBreakAfterLevel: schedule[i]!.level } };
      }
      t = brEnd;
    }
  }
  const last = schedule.length - 1;
  return { onBreak: false, clock: { levelIndex: last, levelStartedAt: t, levelEndsAt: now + 60_000, pausedRemainingMs: null, breakEndsAt: null, pendingBreakAfterLevel: null } };
}
