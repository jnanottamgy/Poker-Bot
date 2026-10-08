import type { AnteType, BlindLevel, BreakRule, Chips, TimingConfig, TournamentConfig } from '@jpb/shared-types';
import { CONFIG_LIMITS } from '../constants';
import { breakAfterLevel } from '../config/breaks';
import { BIG_BLIND_LADDER, SCALING_GRID, floorGridIndex, nearestGridIndex } from './ladder';

export type BlindPresetName = 'STANDARD' | 'TURBO' | 'HYPER' | 'SPEED_TEST';

export const BLIND_PRESET_NAMES: readonly BlindPresetName[] = ['STANDARD', 'TURBO', 'HYPER', 'SPEED_TEST'];

export interface BlindPreset {
  name: BlindPresetName;
  description: string;
  /** Duration of every generated level. */
  levelDurationSeconds: number;
  /** Target starting depth: level-1 big blind ≈ startingStack / startingDepthBB (snapped to the ladder). */
  startingDepthBB: number;
  /** Number of levels generated. */
  levels: number;
  breaks: readonly BreakRule[];
  timing: Readonly<TimingConfig>;
  /** SPEED_TEST needs speed mode (levels shorter than 60 s, 2 s action timer). */
  speedMode: boolean;
}

const STANDARD_TIMING: TimingConfig = {
  actionTimerSeconds: 15,
  awayActionTimerSeconds: 5,
  awayAfterTimeouts: 2,
  actionGraceMs: 500,
  timeoutBehavior: 'CHECK_ELSE_FOLD',
  betweenHandsDelayMs: 2_000,
  showdownDelayMs: 2_000,
  startCountdownSeconds: 30,
};

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

/** The preset table (documented in the README). Frozen: never mutated at runtime. */
export const BLIND_PRESETS: Readonly<Record<BlindPresetName, BlindPreset>> = deepFreeze({
  STANDARD: {
    name: 'STANDARD',
    description: '8-minute levels, 100 big blinds deep, 10-minute break every 6 levels.',
    levelDurationSeconds: 480,
    startingDepthBB: 100,
    levels: 20,
    breaks: [{ everyLevels: 6, durationSeconds: 600, message: 'Scheduled break' }],
    timing: STANDARD_TIMING,
    speedMode: false,
  },
  TURBO: {
    name: 'TURBO',
    description: '5-minute levels, 100 big blinds deep, 5-minute break every 8 levels.',
    levelDurationSeconds: 300,
    startingDepthBB: 100,
    levels: 20,
    breaks: [{ everyLevels: 8, durationSeconds: 300, message: 'Scheduled break' }],
    timing: STANDARD_TIMING,
    speedMode: false,
  },
  HYPER: {
    name: 'HYPER',
    description: '3-minute levels, 50 big blinds deep, 10-second decisions, 5-minute break every 10 levels.',
    levelDurationSeconds: 180,
    startingDepthBB: 50,
    levels: 20,
    breaks: [{ everyLevels: 10, durationSeconds: 300, message: 'Scheduled break' }],
    timing: { ...STANDARD_TIMING, actionTimerSeconds: 10, awayActionTimerSeconds: 5 },
    speedMode: false,
  },
  SPEED_TEST: {
    name: 'SPEED_TEST',
    description: 'Simulation only: 10-second levels, 25 big blinds deep, 2-second decisions, no breaks (needs speed mode).',
    levelDurationSeconds: 10,
    startingDepthBB: 25,
    levels: 30,
    breaks: [],
    timing: {
      actionTimerSeconds: 2,
      awayActionTimerSeconds: 1,
      awayAfterTimeouts: 2,
      actionGraceMs: 250,
      timeoutBehavior: 'CHECK_ELSE_FOLD',
      betweenHandsDelayMs: 200,
      showdownDelayMs: 200,
      startCountdownSeconds: 1,
    },
    speedMode: true,
  },
});

export interface BlindScheduleOptions {
  startingStack: Chips;
  /** Default STANDARD. */
  preset?: BlindPresetName;
  /** Overrides the preset's level count (1..MAX_BLIND_LEVELS). */
  levels?: number;
  /** Overrides the preset's level duration. */
  levelDurationSeconds?: number;
  /** Overrides the preset's starting depth in big blinds. */
  startingDepthBB?: number;
  /** Default 'NONE' (all antes 0). */
  anteType?: AnteType;
  /** First level with an ante (default 1). Earlier levels have ante 0. */
  anteFromLevel?: number;
}

function requireInt(name: string, value: number, min: number, max: number): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer in [${min}, ${max}], got ${String(value)}`);
  }
}

/** Ante for a level under the generator's documented rule. */
export function generatedAnte(anteType: AnteType, bigBlind: number): number {
  switch (anteType) {
    case 'NONE':
      return 0;
    case 'BB_ANTE':
      return bigBlind;
    case 'ALL_PLAYERS':
      return Math.max(1, Math.floor(bigBlind / 10));
  }
}

/** Smallest ladder index the generator may start from: BB 2, so the small blind is at least 1. */
const MIN_START_INDEX = 0;

/**
 * Deterministic blind schedule from a preset:
 *
 *   BB(1) = ladder value nearest to startingStack / startingDepthBB
 *           (ties up), clamped to [2, largest ladder value <= startingStack]
 *   BB(k) = the ladder rung (k - 1) steps above BB(1)
 *   SB(k) = floor(BB(k) / 2)
 *   ante  = 0 before anteFromLevel; then NONE → 0, BB_ANTE → BB,
 *           ALL_PLAYERS → max(1, floor(BB / 10))
 *
 * Generation stops early if the ladder's top (largest safe value) is
 * reached. Throws RangeError on invalid options (programmer error).
 */
export function generateBlindSchedule(options: BlindScheduleOptions): BlindLevel[] {
  const preset = BLIND_PRESETS[options.preset ?? 'STANDARD'];
  const levels = options.levels ?? preset.levels;
  const duration = options.levelDurationSeconds ?? preset.levelDurationSeconds;
  const depth = options.startingDepthBB ?? preset.startingDepthBB;
  const anteType = options.anteType ?? 'NONE';
  const anteFrom = options.anteFromLevel ?? 1;
  requireInt('startingStack', options.startingStack, 2, Number.MAX_SAFE_INTEGER);
  requireInt('levels', levels, 1, CONFIG_LIMITS.MAX_BLIND_LEVELS);
  requireInt('levelDurationSeconds', duration, CONFIG_LIMITS.MIN_LEVEL_SECONDS, CONFIG_LIMITS.MAX_LEVEL_SECONDS);
  requireInt('startingDepthBB', depth, 1, Number.MAX_SAFE_INTEGER);
  requireInt('anteFromLevel', anteFrom, 1, Number.MAX_SAFE_INTEGER);

  const nearest = nearestGridIndex(BIG_BLIND_LADDER, { num: BigInt(options.startingStack), den: BigInt(depth) });
  const ceiling = floorGridIndex(BIG_BLIND_LADDER, options.startingStack);
  const start = Math.max(MIN_START_INDEX, Math.min(nearest, ceiling));

  const schedule: BlindLevel[] = [];
  for (let k = 0; k < levels && start + k < BIG_BLIND_LADDER.length; k++) {
    const bigBlind = BIG_BLIND_LADDER[start + k]!;
    const level = k + 1;
    schedule.push({
      level,
      smallBlind: Math.floor(bigBlind / 2),
      bigBlind,
      ante: level < anteFrom ? 0 : generatedAnte(anteType, bigBlind),
      durationSeconds: duration,
    });
  }
  return schedule;
}

function scaleToGrid(value: number, from: number, to: number): number {
  return SCALING_GRID[nearestGridIndex(SCALING_GRID, { num: BigInt(value) * BigInt(to), den: BigInt(from) })]!;
}

/**
 * Rescales a schedule built for `fromStartingStack` to `toStartingStack`
 * (same depth in big blinds). Every amount is multiplied by to/from and
 * snapped to the nearest SCALING_GRID value (exact arithmetic, ties up):
 *
 *   BB'   = snap(BB × to / from)
 *   SB'   = floor(BB' / 2) if SB was exactly half the BB,
 *           else min(BB', snap(SB × to / from))
 *   ante' = 0 if ante was 0; BB' if ante equalled the BB (BB ante);
 *           else snap(ante × to / from)
 *
 * Level numbers and durations are kept; big blinds stay non-decreasing
 * (snapping is monotone). When from === to the schedule is copied unchanged.
 */
export function scaleBlindSchedule(
  schedule: readonly BlindLevel[],
  fromStartingStack: Chips,
  toStartingStack: Chips,
): BlindLevel[] {
  requireInt('fromStartingStack', fromStartingStack, 1, Number.MAX_SAFE_INTEGER);
  requireInt('toStartingStack', toStartingStack, 1, Number.MAX_SAFE_INTEGER);
  if (fromStartingStack === toStartingStack) return schedule.map((l) => ({ ...l }));
  return schedule.map((l) => {
    const bigBlind = scaleToGrid(l.bigBlind, fromStartingStack, toStartingStack);
    const smallBlind =
      l.smallBlind * 2 === l.bigBlind
        ? Math.max(1, Math.floor(bigBlind / 2))
        : Math.min(bigBlind, scaleToGrid(l.smallBlind, fromStartingStack, toStartingStack));
    const ante =
      l.ante === 0 ? 0 : l.ante === l.bigBlind ? bigBlind : scaleToGrid(l.ante, fromStartingStack, toStartingStack);
    return { level: l.level, smallBlind, bigBlind, ante, durationSeconds: l.durationSeconds };
  });
}

/** A fresh copy of a preset's recommended timing. */
export function presetTiming(name: BlindPresetName): TimingConfig {
  return { ...BLIND_PRESETS[name].timing };
}

/** A fresh copy of a preset's break rules. */
export function presetBreaks(name: BlindPresetName): BreakRule[] {
  return BLIND_PRESETS[name].breaks.map((b) => ({ ...b }));
}

/**
 * Returns a new config with the preset's schedule (for the config's starting
 * stack and ante type), breaks, timing and speed mode. Other fields are kept.
 */
export function applyPreset(config: TournamentConfig, name: BlindPresetName): TournamentConfig {
  const preset = BLIND_PRESETS[name];
  return {
    ...config,
    blindSchedule: generateBlindSchedule({ startingStack: config.startingStack, preset: name, anteType: config.anteType }),
    breaks: presetBreaks(name),
    timing: presetTiming(name),
    speedMode: preset.speedMode,
  };
}

export interface ProjectedLevel {
  level: number;
  smallBlind: Chips;
  bigBlind: Chips;
  ante: Chips;
  /** Seconds from the start of level 1 (clock time only; pauses not included). */
  startsAtSeconds: number;
  endsAtSeconds: number;
  /** Break taken after this level, if any. */
  breakAfter: { durationSeconds: number; message: string | null } | null;
}

export interface ScheduleProjection {
  levels: ProjectedLevel[];
  /** End of the last level, counting breaks between levels (not one after the last level). */
  totalSeconds: number;
}

/** Projected clock times of every level (for the wizard's "projected duration" and the clock screen). */
export function projectSchedule(schedule: readonly BlindLevel[], breaks: readonly BreakRule[]): ScheduleProjection {
  const levels: ProjectedLevel[] = [];
  let t = 0;
  schedule.forEach((l, i) => {
    const startsAtSeconds = t;
    const endsAtSeconds = t + l.durationSeconds;
    const rule = breakAfterLevel(breaks, l.level);
    const breakAfter = rule === null ? null : { durationSeconds: rule.durationSeconds, message: rule.message ?? null };
    levels.push({ level: l.level, smallBlind: l.smallBlind, bigBlind: l.bigBlind, ante: l.ante, startsAtSeconds, endsAtSeconds, breakAfter });
    t = endsAtSeconds + (breakAfter !== null && i < schedule.length - 1 ? breakAfter.durationSeconds : 0);
  });
  return { levels, totalSeconds: levels.length === 0 ? 0 : levels[levels.length - 1]!.endsAtSeconds };
}

/** Starting stack in level-1 big blinds (display only), or null for an empty schedule. */
export function startingDepthInBigBlinds(startingStack: Chips, schedule: readonly BlindLevel[]): number | null {
  const first = schedule[0];
  return first === undefined || first.bigBlind <= 0 ? null : startingStack / first.bigBlind;
}
