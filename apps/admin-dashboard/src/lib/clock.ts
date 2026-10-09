import type { BlindClockState, TournamentStatus } from '@jpb/shared-types';

/**
 * How to DISPLAY the director's blind clock (display only — the server's
 * clock is the authority). Mirrors the director rules
 * (packages/tournament-engine/src/clock.ts):
 *
 * - Running level: `levelEndsAt` is the deadline. The LAST level never ends
 *   (`levelEndsAt` null while running) — blinds simply stop increasing.
 * - Pause / emergency freeze: the remaining time is captured in
 *   `pausedRemainingMs` and no deadline runs.
 * - Break: `breakEndsAt` is the deadline. A SCHEDULED break
 *   (`pendingBreakAfterLevel` = index of the level that just ended) resumes
 *   with the NEXT level; an AD-HOC break ("start break now",
 *   `pendingBreakAfterLevel` null) resumes the SAME level with the time it
 *   had left (`pausedRemainingMs`).
 */
export type ClockPhase = 'not-started' | 'running' | 'last-level' | 'paused' | 'frozen' | 'break' | 'ended';

export interface ClockModel {
  phase: ClockPhase;
  /** A deadline is counting down right now (render with useServerCountdown). */
  ticking: boolean;
  /** Server epoch ms the countdown targets (level end or break end), else null. */
  deadline: number | null;
  /** Remaining ms to show when not ticking (paused / frozen); null = unknown or open-ended. */
  heldRemainingMs: number | null;
  onBreak: boolean;
  /** Break from the schedule (next level follows) rather than an ad-hoc break. */
  scheduledBreak: boolean;
  /** Index of the level that is being played, or that plays when the break ends. */
  playIndex: number;
  /** Short word for pills / screen readers. */
  label: string;
}

const PRE_START: readonly TournamentStatus[] = ['DRAFT', 'REGISTRATION', 'REGISTRATION_CLOSED', 'STARTING'];

export interface ClockInput {
  status: TournamentStatus | null;
  frozen: boolean;
  clock: BlindClockState | null;
  /** False on the last level of the schedule. */
  hasNextLevel: boolean;
}

export function clockModel({ status, frozen, clock, hasNextLevel }: ClockInput): ClockModel {
  const base = { ticking: false, deadline: null, heldRemainingMs: null, onBreak: false, scheduledBreak: false, playIndex: clock?.levelIndex ?? 0 };
  if (!clock || status === null || PRE_START.includes(status)) return { ...base, phase: 'not-started', label: 'Not started' };
  if (status === 'COMPLETED' || status === 'CANCELLED') return { ...base, phase: 'ended', label: status === 'COMPLETED' ? 'Completed' : 'Cancelled' };

  const onBreak = status === 'BREAK' || clock.breakEndsAt !== null;
  const scheduledBreak = onBreak && clock.pendingBreakAfterLevel !== null;
  const playIndex = scheduledBreak ? clock.pendingBreakAfterLevel! + 1 : clock.levelIndex;
  const common = { ...base, onBreak, scheduledBreak, playIndex };

  if (frozen) return { ...common, phase: 'frozen', heldRemainingMs: clock.pausedRemainingMs, label: 'Frozen' };
  if (status === 'PAUSED') return { ...common, phase: 'paused', heldRemainingMs: clock.pausedRemainingMs, label: 'Paused' };
  if (onBreak) {
    return clock.breakEndsAt !== null
      ? { ...common, phase: 'break', ticking: true, deadline: clock.breakEndsAt, label: 'On break' }
      : { ...common, phase: 'paused', heldRemainingMs: null, label: 'Break paused' };
  }
  if (clock.levelEndsAt !== null) return { ...common, phase: 'running', ticking: true, deadline: clock.levelEndsAt, label: 'Running' };
  if (!hasNextLevel && clock.pausedRemainingMs === null) return { ...common, phase: 'last-level', label: 'Last level' };
  return { ...common, phase: 'paused', heldRemainingMs: clock.pausedRemainingMs, label: 'Stopped' };
}

/** Remaining ms to display: the live countdown when ticking, else the held value (0 if unknown). */
export function shownRemaining(model: ClockModel, liveRemainingMs: number): number {
  return model.ticking ? liveRemainingMs : (model.heldRemainingMs ?? 0);
}
