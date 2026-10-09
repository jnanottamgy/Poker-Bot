import type { BlindClockState, BlindLevel, BreakRule } from '@jpb/shared-types';
import type { ClockModel } from './clock';

/**
 * Blind-schedule projections FOR DISPLAY ONLY (projected wall-clock times in
 * the Clock & Structure screen). The director's clock on the server is the
 * authority; these numbers are labelled "projected" wherever shown.
 */

/** The break rule after `level` together with its index in `breaks` (for editing). */
export function breakRuleAfter(breaks: readonly BreakRule[], level: number): { rule: BreakRule; index: number } | null {
  for (let i = 0; i < breaks.length; i++) {
    const b = breaks[i]!;
    if (b.afterLevel !== undefined && b.afterLevel === level) return { rule: b, index: i };
    if (b.everyLevels !== undefined && b.everyLevels > 0 && level % b.everyLevels === 0) return { rule: b, index: i };
  }
  return null;
}

/** The break rule that applies after `level` (1-based) ends, if any (the first matching rule wins). */
export function breakAfterLevel(breaks: readonly BreakRule[], level: number): BreakRule | null {
  return breakRuleAfter(breaks, level)?.rule ?? null;
}

export interface ProjectedBreak {
  ruleIndex: number;
  recurring: boolean;
  durationSeconds: number;
  message: string | null;
  startsAt: number;
  endsAt: number;
}

export interface ProjectedLevel {
  index: number;
  level: BlindLevel;
  /** Already played (no projected times). */
  played: boolean;
  /** Being played now (or interrupted by an ad-hoc break and resuming after it). */
  isCurrent: boolean;
  startsAt: number | null;
  /** Null for the last level: it never ends, blinds stop increasing. */
  endsAt: number | null;
  /** Break taken after this level, if any. */
  breakAfter: ProjectedBreak | null;
}

export interface Projection {
  levels: ProjectedLevel[];
  /** The break being taken right now (null when not on a break or its end is unknown). */
  currentBreak: { endsAt: number; scheduled: boolean } | null;
  /** Times assume the clock (re)starts now: not started, paused or frozen. */
  tentative: boolean;
}

export interface ProjectionInput {
  schedule: readonly BlindLevel[];
  breaks: readonly BreakRule[];
  clock: BlindClockState | null;
  model: ClockModel;
  /** Server time now (client clock + offset). */
  now: number;
  /** Before the start: the scheduled start time, when known. */
  startTime?: number | null;
}

/**
 * Every level with projected wall-clock start/end times and the breaks
 * between them, from the director clock as it stands. Display only.
 */
export function projectSchedule({ schedule, breaks, clock, model, now, startTime = null }: ProjectionInput): Projection {
  const first = Math.min(Math.max(0, model.playIndex), Math.max(0, schedule.length - 1));
  const lastIndex = schedule.length - 1;
  const dur = (i: number) => (schedule[i]?.durationSeconds ?? 0) * 1000;
  let tentative = false;
  let currentBreak: Projection['currentBreak'] = null;
  let start: number;
  let end: number | null;

  if (model.phase === 'not-started' || !clock) {
    tentative = true;
    start = startTime !== null && startTime > now ? startTime : now;
    end = start + dur(first);
  } else if (model.onBreak) {
    const breakEnd = model.deadline ?? null;
    if (breakEnd !== null) currentBreak = { endsAt: breakEnd, scheduled: model.scheduledBreak };
    else tentative = true;
    start = breakEnd ?? now;
    const remaining = model.scheduledBreak ? dur(first) : (clock.pausedRemainingMs ?? dur(first));
    end = start + remaining;
    if (model.phase !== 'break') tentative = true;
  } else if (model.phase === 'running' && model.deadline !== null) {
    end = model.deadline;
    start = clock.levelStartedAt ?? end - dur(first);
  } else if (model.phase === 'last-level') {
    start = clock.levelStartedAt ?? now;
    end = null;
  } else {
    tentative = true;
    start = clock.levelStartedAt ?? now;
    end = now + (model.heldRemainingMs ?? dur(first));
  }

  const levels: ProjectedLevel[] = [];
  for (let i = 0; i < first; i++) levels.push({ index: i, level: schedule[i]!, played: true, isCurrent: false, startsAt: null, endsAt: null, breakAfter: null });

  let cursorStart = start;
  let cursorEnd: number | null = first === lastIndex ? null : end;
  for (let i = first; i <= lastIndex; i++) {
    const level = schedule[i]!;
    const isCurrent = i === first && model.phase !== 'not-started' && !(model.onBreak && model.scheduledBreak);
    const found = i < lastIndex ? breakRuleAfter(breaks, level.level) : null;
    const brk: ProjectedBreak | null =
      found && cursorEnd !== null
        ? { ruleIndex: found.index, recurring: found.rule.everyLevels !== undefined, durationSeconds: found.rule.durationSeconds, message: found.rule.message ?? null, startsAt: cursorEnd, endsAt: cursorEnd + found.rule.durationSeconds * 1000 }
        : null;
    levels.push({ index: i, level, played: false, isCurrent, startsAt: cursorStart, endsAt: cursorEnd, breakAfter: brk });
    if (cursorEnd === null) break;
    cursorStart = brk ? brk.endsAt : cursorEnd;
    cursorEnd = i + 1 === lastIndex ? null : cursorStart + dur(i + 1);
  }
  return { levels, currentBreak, tentative };
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
