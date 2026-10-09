import type { AnteType, BlindLevel, BreakRule, TournamentConfig } from '@jpb/shared-types';
import {
  BIG_BLIND_LADDER,
  BLIND_PRESETS,
  CONFIG_LIMITS,
  applyPreset,
  generateBlindSchedule,
  generatedAnte,
  projectSchedule,
  scaleBlindSchedule,
  startingDepthInBigBlinds,
} from '@jpb/validation';
import type { BlindPresetName, ScheduleProjection } from '@jpb/validation';
import { isNum } from './format';

/**
 * Pure blind-schedule operations for the editor. Every structural change
 * renumbers levels 1..N (the validator requires it), so the operator never
 * types a level number.
 */

/** Duration given to a level appended to an empty schedule (the STANDARD preset's). */
const DEFAULT_LEVEL_SECONDS = BLIND_PRESETS.STANDARD.levelDurationSeconds;

export function renumber(levels: readonly BlindLevel[]): BlindLevel[] {
  return levels.map((l, i) => (l.level === i + 1 ? l : { ...l, level: i + 1 }));
}

/** Ante for level `level` under the generator rule, honouring "antes start at level N". */
export function anteFor(anteType: AnteType, bigBlind: number, level: number, anteFromLevel: number): number {
  if (!isNum(bigBlind) || level < anteFromLevel) return 0;
  return generatedAnte(anteType, bigBlind);
}

/** The ladder rung above `bigBlind` (or double it beyond the ladder). */
export function nextBigBlind(bigBlind: number): number {
  if (!isNum(bigBlind) || bigBlind < 1) return BIG_BLIND_LADDER[0]!;
  return BIG_BLIND_LADDER.find((v) => v > bigBlind) ?? bigBlind * 2;
}

/** A new level after the last one: the next ladder rung, SB = floor(BB/2), ante by type. */
export function appendLevel(levels: readonly BlindLevel[], anteType: AnteType, anteFromLevel: number): BlindLevel[] {
  const last = levels[levels.length - 1];
  const bigBlind = last ? nextBigBlind(last.bigBlind) : BIG_BLIND_LADDER[0]!;
  const level = levels.length + 1;
  return [
    ...levels,
    { level, smallBlind: Math.floor(bigBlind / 2), bigBlind, ante: anteFor(anteType, bigBlind, level, anteFromLevel), durationSeconds: isNum(last?.durationSeconds) ? last.durationSeconds : DEFAULT_LEVEL_SECONDS },
  ];
}

/** Inserts a copy of level `index` right after it (same blinds keep the schedule non-decreasing). */
export function insertAfter(levels: readonly BlindLevel[], index: number): BlindLevel[] {
  const src = levels[index];
  if (!src) return [...levels];
  return renumber([...levels.slice(0, index + 1), { ...src }, ...levels.slice(index + 1)]);
}

export function removeAt(levels: readonly BlindLevel[], index: number): BlindLevel[] {
  return renumber(levels.filter((_, i) => i !== index));
}

/** Moves level `index` one place up (-1) or down (+1); blinds travel with the row. */
export function moveLevel(levels: readonly BlindLevel[], index: number, delta: -1 | 1): BlindLevel[] {
  const to = index + delta;
  if (to < 0 || to >= levels.length) return [...levels];
  const next = [...levels];
  [next[index], next[to]] = [next[to]!, next[index]!];
  return renumber(next);
}

export function setLevelField(levels: readonly BlindLevel[], index: number, field: 'smallBlind' | 'bigBlind' | 'ante' | 'durationSeconds', value: number): BlindLevel[] {
  return levels.map((l, i) => (i === index ? { ...l, [field]: value } : l));
}

export function setAllDurations(levels: readonly BlindLevel[], seconds: number): BlindLevel[] {
  return levels.map((l) => ({ ...l, durationSeconds: seconds }));
}

/** Recomputes every ante for `anteType` (NONE → all 0; BB_ANTE → BB; ALL_PLAYERS → max(1, floor(BB/10))). */
export function recomputeAntes(levels: readonly BlindLevel[], anteType: AnteType, anteFromLevel: number): BlindLevel[] {
  return levels.map((l) => ({ ...l, ante: anteFor(anteType, l.bigBlind, l.level, anteFromLevel) }));
}

/** First level that has an ante (for "antes start at level N"); 1 when none. */
export function firstAnteLevel(levels: readonly BlindLevel[]): number {
  return levels.find((l) => isNum(l.ante) && l.ante > 0)?.level ?? 1;
}

export function stackIsUsable(stack: number): boolean {
  return isNum(stack) && Number.isSafeInteger(stack) && stack >= 2;
}

export interface GeneratorOptions {
  preset: BlindPresetName;
  levels: number;
  levelDurationSeconds: number;
  startingDepthBB: number;
  anteFromLevel: number;
}

export function generatorDefaults(preset: BlindPresetName, anteFromLevel = 1): GeneratorOptions {
  const p = BLIND_PRESETS[preset];
  return { preset, levels: p.levels, levelDurationSeconds: p.levelDurationSeconds, startingDepthBB: p.startingDepthBB, anteFromLevel };
}

/** Problems with generator options (empty = can generate). */
export function generatorProblems(o: GeneratorOptions, startingStack: number): string[] {
  const out: string[] = [];
  if (!stackIsUsable(startingStack)) out.push('Set a starting stack of at least 2 chips first.');
  if (!Number.isSafeInteger(o.levels) || o.levels < 1 || o.levels > CONFIG_LIMITS.MAX_BLIND_LEVELS) out.push(`Levels: 1 to ${CONFIG_LIMITS.MAX_BLIND_LEVELS}.`);
  if (!Number.isSafeInteger(o.levelDurationSeconds) || o.levelDurationSeconds < CONFIG_LIMITS.MIN_LEVEL_SECONDS || o.levelDurationSeconds > CONFIG_LIMITS.MAX_LEVEL_SECONDS) out.push('Level duration: 1 second to 24 hours.');
  if (!Number.isSafeInteger(o.startingDepthBB) || o.startingDepthBB < 1) out.push('Starting depth: a whole number of big blinds, at least 1.');
  if (!Number.isSafeInteger(o.anteFromLevel) || o.anteFromLevel < 1) out.push('Antes start at level 1 or later.');
  return out;
}

/** Deterministic schedule from the generator (@jpb/validation generateBlindSchedule); null when options are invalid. */
export function generate(o: GeneratorOptions, startingStack: number, anteType: AnteType): BlindLevel[] | null {
  if (generatorProblems(o, startingStack).length > 0) return null;
  try {
    return generateBlindSchedule({
      startingStack,
      preset: o.preset,
      levels: o.levels,
      levelDurationSeconds: o.levelDurationSeconds,
      startingDepthBB: o.startingDepthBB,
      anteType,
      anteFromLevel: o.anteFromLevel,
    });
  } catch {
    return null;
  }
}

/** Preset: schedule (for the current stack + ante type), breaks, timing and speed mode. Null when the stack is unusable. */
export function withPreset(config: TournamentConfig, name: BlindPresetName): TournamentConfig | null {
  if (!stackIsUsable(config.startingStack)) return null;
  try {
    return applyPreset(config, name);
  } catch {
    return null;
  }
}

/** The preset whose generated schedule, breaks and timing equal the config's (to highlight it), or null. */
export function matchingBlindPreset(config: TournamentConfig): BlindPresetName | null {
  for (const name of Object.keys(BLIND_PRESETS) as BlindPresetName[]) {
    const applied = withPreset(config, name);
    if (applied && JSON.stringify(applied.blindSchedule) === JSON.stringify(config.blindSchedule) && JSON.stringify(applied.breaks) === JSON.stringify(config.breaks)) return name;
  }
  return null;
}

/** Same depth in big blinds for a new starting stack (@jpb/validation scaleBlindSchedule). */
export function scaleTo(levels: readonly BlindLevel[], fromStack: number, toStack: number): BlindLevel[] | null {
  if (!stackIsUsable(fromStack) || !stackIsUsable(toStack) || levels.some((l) => !isNum(l.smallBlind) || !isNum(l.bigBlind) || !isNum(l.ante))) return null;
  try {
    return scaleBlindSchedule(levels, fromStack, toStack);
  } catch {
    return null;
  }
}

/** Clock-time projection of the schedule (null while a duration is not a number yet). */
export function projection(levels: readonly BlindLevel[], breaks: readonly BreakRule[]): ScheduleProjection | null {
  if (levels.length === 0 || levels.some((l) => !isNum(l.durationSeconds) || !isNum(l.bigBlind))) return null;
  const usable = breaks.filter((b) => isNum(b.durationSeconds) && (isNum(b.afterLevel) || isNum(b.everyLevels)));
  return projectSchedule(levels, usable);
}

export function startingDepth(stack: number, levels: readonly BlindLevel[]): number | null {
  if (!isNum(stack)) return null;
  const d = startingDepthInBigBlinds(stack, levels);
  return d === null || !Number.isFinite(d) ? null : d;
}
