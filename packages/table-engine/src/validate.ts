import type { AnteType, CurrentBlinds, SeatPositionStats, TableTimingState } from '@jpb/shared-types';
import { MAX_TABLE_SEATS, MAX_TIMER_MS, MIN_TABLE_SEATS } from './constants';

/**
 * Structural validation of untrusted command payloads. Every function returns
 * a human-readable problem or null; nothing here throws.
 */

const ANTE_TYPES: readonly AnteType[] = ['NONE', 'BB_ANTE', 'ALL_PLAYERS'];

export const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** A safe integer >= min (and <= max when given). */
export function isInt(v: unknown, min: number, max: number = Number.MAX_SAFE_INTEGER): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
}

export function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

export function isSeatIndex(v: unknown, maxSeats: number): v is number {
  return isInt(v, 0, maxSeats - 1);
}

export function maxSeatsProblem(maxSeats: unknown): string | null {
  return isInt(maxSeats, MIN_TABLE_SEATS, MAX_TABLE_SEATS)
    ? null
    : `maxSeats must be an integer in [${MIN_TABLE_SEATS}, ${MAX_TABLE_SEATS}]`;
}

export function timingProblem(t: unknown): string | null {
  if (!isObject(t)) return 'timing must be an object';
  if (!isInt(t.actionTimerMs, 1, MAX_TIMER_MS)) return 'timing.actionTimerMs must be an integer in [1, 86400000]';
  if (!isInt(t.awayActionTimerMs, 1, MAX_TIMER_MS)) return 'timing.awayActionTimerMs must be an integer in [1, 86400000]';
  if (!isInt(t.awayAfterTimeouts, 1)) return 'timing.awayAfterTimeouts must be an integer >= 1';
  if (!isInt(t.actionGraceMs, 0, MAX_TIMER_MS)) return 'timing.actionGraceMs must be an integer in [0, 86400000]';
  if (!isInt(t.betweenHandsDelayMs, 0, MAX_TIMER_MS)) return 'timing.betweenHandsDelayMs must be an integer in [0, 86400000]';
  if (!isInt(t.showdownDelayMs, 0, MAX_TIMER_MS)) return 'timing.showdownDelayMs must be an integer in [0, 86400000]';
  return null;
}

export function blindsProblem(b: unknown): string | null {
  if (!isObject(b)) return 'blinds must be an object';
  if (!isInt(b.level, 0)) return 'blinds.level must be a non-negative integer';
  if (!isInt(b.bigBlind, 1)) return 'blinds.bigBlind must be a positive integer';
  if (!isInt(b.smallBlind, 0, b.bigBlind)) return 'blinds.smallBlind must be an integer in [0, bigBlind]';
  if (!isInt(b.ante, 0)) return 'blinds.ante must be a non-negative integer';
  if (typeof b.anteType !== 'string' || !ANTE_TYPES.includes(b.anteType as AnteType)) return 'blinds.anteType is invalid';
  return null;
}

export function statsProblem(s: unknown): string | null {
  if (!isObject(s)) return 'stats must be an object';
  for (const key of ['handsDealtAtTable', 'handsSinceBigBlind', 'handsSinceSmallBlind', 'handsPlayedTotal'] as const) {
    if (!isInt(s[key], 0)) return `stats.${key} must be a non-negative integer`;
  }
  return null;
}

/** Plain copies: commands are never stored by reference. */
export function copyTiming(t: TableTimingState): TableTimingState {
  return {
    actionTimerMs: t.actionTimerMs,
    awayActionTimerMs: t.awayActionTimerMs,
    awayAfterTimeouts: t.awayAfterTimeouts,
    actionGraceMs: t.actionGraceMs,
    betweenHandsDelayMs: t.betweenHandsDelayMs,
    showdownDelayMs: t.showdownDelayMs,
  };
}

export function copyBlinds(b: CurrentBlinds): CurrentBlinds {
  return { level: b.level, smallBlind: b.smallBlind, bigBlind: b.bigBlind, ante: b.ante, anteType: b.anteType };
}

export function copyStats(s: SeatPositionStats): SeatPositionStats {
  return {
    handsDealtAtTable: s.handsDealtAtTable,
    handsSinceBigBlind: s.handsSinceBigBlind,
    handsSinceSmallBlind: s.handsSinceSmallBlind,
    handsPlayedTotal: s.handsPlayedTotal,
  };
}
