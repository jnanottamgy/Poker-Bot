import type { TournamentConfig } from '@jpb/shared-types';
import { BLIND_PRESETS, generateBlindSchedule, presetBreaks, presetTiming } from './presets';

/** Recursive partial: nested objects merge, arrays and scalars replace. */
export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

export type TournamentConfigOverrides = DeepPartial<TournamentConfig>;

/** Starting stack of the default config (spec). */
export const DEFAULT_STARTING_STACK = 10_000;

/**
 * The spec defaults: NLH, 8-handed target / 9 max / min 2 / final table 9,
 * 10,000 chips, 15 s action timer, the STANDARD schedule (50/100, 75/150,
 * 100/200, 150/300, 200/400, 300/600, 500/1000, 750/1500, 1000/2000, … to
 * level 20) with 8-minute levels, a 10-minute break every 6 levels, no late
 * registration, no re-entry, INR, spectators on, hand-for-hand automatically
 * at the bubble. Prize amounts are placeholders the organizer must edit.
 */
function baseDefaults(): TournamentConfig {
  return {
    name: "Johnny's Poker Tournament",
    joinCode: 'JOHNNY',
    game: 'NLH',
    minPlayers: 2,
    maxPlayers: 10_000,
    tables: { targetSize: 8, maxSize: 9, minSize: 2, finalTableSize: 9 },
    startingStack: DEFAULT_STARTING_STACK,
    blindSchedule: generateBlindSchedule({ startingStack: DEFAULT_STARTING_STACK, preset: 'STANDARD' }),
    anteType: 'NONE',
    breaks: presetBreaks('STANDARD'),
    timing: presetTiming('STANDARD'),
    lateRegistration: { enabled: false, untilLevel: 0 },
    reentry: { enabled: false, maxEntriesPerPlayer: 1, untilLevel: 0 },
    prizeStructure: {
      currency: 'INR',
      places: [
        { position: 1, amountMinor: 500_000 },
        { position: 2, amountMinor: 300_000 },
        { position: 3, amountMinor: 200_000 },
      ],
    },
    registration: {
      fields: [
        { key: 'name', required: true },
        { key: 'nickname', required: false },
      ],
      requireApproval: false,
      accessCode: null,
    },
    startTime: null,
    autoStart: false,
    registrationDeadline: null,
    spectators: { enabled: true, allowEliminatedPlayers: true, publicWatch: true, delaySeconds: 0 },
    balancing: {
      maxImbalance: 1,
      recentMoveWindowHands: 10,
      weights: { position: 1, blindFairness: 1, recentMove: 1, seatCompatibility: 0.1 },
      consolidateBy: 'TARGET',
    },
    handForHand: { autoAtBubble: true },
    features: {
      spectatorMode: true,
      advancedFairnessAudit: true,
      lateRegistration: false,
      soundEffects: true,
      haptics: true,
      broadcastDisplay: true,
    },
    speedMode: BLIND_PRESETS.STANDARD.speedMode,
  };
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Deep copy of plain JSON data (arrays and plain objects). */
function cloneJson<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v: unknown) => cloneJson(v)) as T;
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (!FORBIDDEN_KEYS.has(k)) out[k] = cloneJson(v);
    return out as T;
  }
  return value;
}

function mergeInto(base: Record<string, unknown>, overrides: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined || FORBIDDEN_KEYS.has(key)) continue;
    const current = out[key];
    out[key] = isPlainObject(value) && isPlainObject(current) ? mergeInto(current, value) : cloneJson(value);
  }
  return out;
}

/**
 * A fresh, valid default configuration with optional deep overrides
 * (objects merge, arrays/scalars replace; `undefined` is ignored). The result
 * shares no references with the overrides or other calls. Overrides are
 * applied literally — e.g. a different `startingStack` does not rescale the
 * schedule (use `applyPreset` / `scaleBlindSchedule`) — so validate the
 * result with `validateTournamentConfig` when overrides are user-supplied.
 */
export function defaultTournamentConfig(overrides: TournamentConfigOverrides = {}): TournamentConfig {
  return mergeInto(baseDefaults() as unknown as Record<string, unknown>, overrides as Record<string, unknown>) as unknown as TournamentConfig;
}
