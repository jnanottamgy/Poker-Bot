import type { BlindLevel, BreakRule } from '@jpb/shared-types';
import type { Draft } from './draft';
import { currentBlinds, emit, holdAll, openTables, releaseAll, tableCommand, transition } from './draft';
import type { DirectorState } from './types';

/**
 * BLIND CLOCK (normative):
 * - Level i runs for blindSchedule[i].durationSeconds from levelStartedAt.
 * - At levelEndsAt (TICK) the next level starts; tables receive SET_BLINDS,
 *   which each table applies from its NEXT hand (a hand is never interrupted).
 * - If a BreakRule matches the level that just ended, a break starts instead:
 *   every table is HELD (current hands finish), the break runs from the
 *   scheduled moment for its duration, then the next level starts.
 * - The last level never ends (levelEndsAt null) — blinds stop increasing.
 * - Pause/freeze capture the remaining level (or break) time; resume restores it.
 */

export function levelAt(state: DirectorState, index: number): BlindLevel | null {
  return state.config.blindSchedule[index] ?? null;
}

export function currentLevel(state: DirectorState): BlindLevel | null {
  return levelAt(state, state.clock.levelIndex);
}

export function nextLevel(state: DirectorState): BlindLevel | null {
  return levelAt(state, state.clock.levelIndex + 1);
}

/** The break rule (if any) that applies after `level` (1-based level number) ends. */
export function breakAfterLevel(breaks: readonly BreakRule[], level: number): BreakRule | null {
  for (const b of breaks) {
    if (b.afterLevel !== undefined && b.afterLevel === level) return b;
    if (b.everyLevels !== undefined && b.everyLevels > 0 && level % b.everyLevels === 0) return b;
  }
  return null;
}

function levelEnd(d: Draft, index: number, startedAt: number): number | null {
  const isLast = index >= d.s.config.blindSchedule.length - 1;
  if (isLast) return null;
  return startedAt + levelAt(d.s, index)!.durationSeconds * 1000;
}

/** Starts level `index` now and broadcasts the change to every table. */
export function startLevel(d: Draft, index: number): void {
  const schedule = d.s.config.blindSchedule;
  const bounded = Math.max(0, Math.min(index, schedule.length - 1));
  const from = d.s.clock.levelStartedAt === null ? null : levelAt(d.s, d.s.clock.levelIndex);
  d.s.clock = { ...d.s.clock, levelIndex: bounded, levelStartedAt: d.now, levelEndsAt: levelEnd(d, bounded, d.now), breakEndsAt: null, pendingBreakAfterLevel: null };
  const blinds = currentBlinds(d);
  for (const t of openTables(d)) tableCommand(d, t.summary.tableId, { type: 'SET_BLINDS', blinds });
  emit(d, { kind: 'BLIND_LEVEL_CHANGED', from, to: levelAt(d.s, bounded)!, levelEndsAt: d.s.clock.levelEndsAt });
}

/** Called on TICK: advances the level or starts/ends a break when due. */
export function advanceClockIfDue(d: Draft): void {
  if (d.s.frozen || d.s.status === 'PAUSED') return;
  const c = d.s.clock;
  if (d.s.status === 'BREAK') {
    if (c.breakEndsAt !== null && d.now >= c.breakEndsAt) endBreak(d);
    return;
  }
  if (d.s.status !== 'RUNNING' && d.s.status !== 'FINAL_TABLE') return;
  if (c.levelEndsAt === null || d.now < c.levelEndsAt) return;
  const ended = levelAt(d.s, c.levelIndex)!;
  const rule = breakAfterLevel(d.s.config.breaks, ended.level);
  if (rule) startBreak(d, rule.durationSeconds, rule.message ?? null, c.levelEndsAt);
  else startLevel(d, c.levelIndex + 1);
}

/**
 * Starts a break. `scheduledAt` is the clock moment the break was due (the
 * break time runs from it even if the tick arrived late).
 */
export function startBreak(d: Draft, durationSeconds: number, message: string | null, scheduledAt: number = d.now): void {
  d.s.resumeTo = d.s.status;
  transition(d, 'BREAK', 'scheduled break');
  const endsAt = scheduledAt + durationSeconds * 1000;
  d.s.clock = { ...d.s.clock, breakEndsAt: endsAt, levelEndsAt: null, pendingBreakAfterLevel: d.s.clock.levelIndex };
  holdAll(d, 'BREAK');
  emit(d, { kind: 'BREAK_STARTED', endsAt, nextLevel: nextLevel(d.s), message });
}

export function endBreak(d: Draft): void {
  const back = d.s.resumeTo ?? 'RUNNING';
  d.s.resumeTo = null;
  transition(d, back, 'break over');
  emit(d, { kind: 'BREAK_ENDED' });
  startLevel(d, d.s.clock.levelIndex + 1);
  releaseAll(d, 'BREAK');
}

/** Captures the remaining level/break time (pause or freeze). */
export function pauseClock(d: Draft): void {
  const c = d.s.clock;
  if (c.pausedAt !== null) return;
  d.s.clock = {
    ...c,
    pausedAt: d.now,
    pausedRemainingMs: c.levelEndsAt === null ? null : Math.max(0, c.levelEndsAt - d.now),
    pausedBreakRemainingMs: c.breakEndsAt === null ? null : Math.max(0, c.breakEndsAt - d.now),
    levelEndsAt: null,
    breakEndsAt: null,
  };
}

/** Restores the clock captured by pauseClock. */
export function resumeClock(d: Draft): void {
  const c = d.s.clock;
  if (c.pausedAt === null) return;
  d.s.clock = {
    ...c,
    pausedTotalMs: c.pausedTotalMs + (d.now - c.pausedAt),
    pausedAt: null,
    levelEndsAt: c.pausedRemainingMs === null ? null : d.now + c.pausedRemainingMs,
    breakEndsAt: c.pausedBreakRemainingMs === null ? null : d.now + c.pausedBreakRemainingMs,
    pausedRemainingMs: null,
    pausedBreakRemainingMs: null,
  };
}

/** The next moment the director needs a TICK, or null. */
export function nextTickAt(state: DirectorState): number | null {
  const c = state.clock;
  const candidates: number[] = [];
  if (state.status === 'STARTING' && c.startAt !== null) candidates.push(c.startAt);
  if (!state.frozen && state.status !== 'PAUSED') {
    if (c.levelEndsAt !== null && (state.status === 'RUNNING' || state.status === 'FINAL_TABLE')) candidates.push(c.levelEndsAt);
    if (c.breakEndsAt !== null && state.status === 'BREAK') candidates.push(c.breakEndsAt);
  }
  if (state.status === 'REGISTRATION' && state.config.registrationDeadline !== null) candidates.push(state.config.registrationDeadline);
  if (state.status === 'REGISTRATION_CLOSED' && state.config.autoStart && state.config.startTime !== null) candidates.push(state.config.startTime);
  return candidates.length ? Math.min(...candidates) : null;
}

/** Remaining ms of the current level (0 when unknown), as seen at `now`. */
export function levelRemainingMs(state: DirectorState, now: number): number | null {
  const c = state.clock;
  if (c.pausedRemainingMs !== null) return c.pausedRemainingMs;
  if (c.levelEndsAt === null) return null;
  return Math.max(0, c.levelEndsAt - now);
}
