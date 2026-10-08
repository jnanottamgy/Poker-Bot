import { z } from 'zod';
import type { TournamentConfig } from '@jpb/shared-types';
import { CONFIG_LIMITS, JOIN_CODE_PATTERN } from '../constants';
import { failure, validateWith } from '../errors';
import type { PathSegment, ValidationResult } from '../errors';
import { codeSchema, displayTextSchema, epochMsSchema, intInRange, positiveChipsSchema } from '../primitives';
import type { Assert, Equals, Extends } from '../typeAssert';
import { anteTypeSchema, blindScheduleSchema } from './blinds';
import { breakRulesSchema } from './breaks';
import { CROSS_CHECKS } from './crossChecks';
import type { CrossCheck } from './crossChecks';
import { prizeStructureSchema } from './prizes';
import { registrationConfigSchema } from './registration';
import {
  balancingConfigSchema,
  featureFlagsSchema,
  handForHandConfigSchema,
  lateRegistrationConfigSchema,
  reentryConfigSchema,
  spectatorConfigSchema,
} from './sections';
import { tableSizeConfigSchema } from './tables';
import { timingConfigSchema } from './timing';

const playerCount = () => intInRange(CONFIG_LIMITS.MIN_PLAYERS, CONFIG_LIMITS.MAX_PLAYERS);

/** Structural schema: every field, every per-section rule; no cross-field rules. */
export const tournamentConfigShapeSchema = z.strictObject({
  name: displayTextSchema({ max: CONFIG_LIMITS.NAME_MAX_LENGTH }),
  joinCode: codeSchema(JOIN_CODE_PATTERN, 'Use 4–12 letters A–Z or digits 0–9 for the join code.'),
  game: z.literal('NLH'),
  minPlayers: playerCount(),
  maxPlayers: playerCount(),
  tables: tableSizeConfigSchema,
  startingStack: positiveChipsSchema,
  blindSchedule: blindScheduleSchema,
  anteType: anteTypeSchema,
  breaks: breakRulesSchema,
  timing: timingConfigSchema,
  lateRegistration: lateRegistrationConfigSchema,
  reentry: reentryConfigSchema,
  prizeStructure: prizeStructureSchema,
  registration: registrationConfigSchema,
  startTime: epochMsSchema.nullable(),
  autoStart: z.boolean(),
  registrationDeadline: epochMsSchema.nullable(),
  spectators: spectatorConfigSchema,
  balancing: balancingConfigSchema,
  handForHand: handForHandConfigSchema,
  features: featureFlagsSchema,
  speedMode: z.boolean(),
});

interface PayloadIssue {
  readonly code?: string;
  readonly path?: readonly PropertyKey[];
}

/**
 * A cross-field rule runs only when every top-level field it reads is itself
 * valid (no issue at all under that field) and the root is an object. Issues
 * elsewhere, including unknown extra keys, never block it — so the admin
 * wizard sees every independent problem at once.
 */
function depsAreUsable(deps: ReadonlyArray<string>) {
  return (payload: { issues: readonly PayloadIssue[] }): boolean =>
    !payload.issues.some((issue) => {
      const head = issue.path?.[0];
      if (head === undefined) return issue.code !== 'unrecognized_keys';
      return deps.includes(String(head));
    });
}

function withCrossCheck<S extends z.ZodType<TournamentConfig>>(schema: S, check: CrossCheck): S {
  return schema.superRefine(
    (cfg, ctx) => {
      check.run(cfg, (path: PathSegment[], message: string) => ctx.addIssue({ code: 'custom', path, message }));
    },
    { when: depsAreUsable(check.deps) },
  );
}

/**
 * The complete TournamentConfig schema (structure + cross-field rules).
 * Parsing returns the normalized config (trimmed/sanitized text, uppercased
 * codes). Prefer `validateTournamentConfig` for friendly messages.
 */
export const tournamentConfigSchema = CROSS_CHECKS.reduce(withCrossCheck, tournamentConfigShapeSchema);

export type TournamentConfigInput = z.input<typeof tournamentConfigSchema>;

export interface TournamentConfigValidationOptions {
  /**
   * When false, `speedMode: true` is rejected (production servers without
   * SPEED_MODE_ALLOWED). Default true.
   */
  allowSpeedMode?: boolean;
}

/** Validates a configuration. Never throws; returns the normalized config or friendly issues. */
export function validateTournamentConfig(
  input: unknown,
  options: TournamentConfigValidationOptions = {},
): ValidationResult<TournamentConfig> {
  const result = validateWith(tournamentConfigSchema, input);
  if (!result.ok || options.allowSpeedMode !== false || !result.value.speedMode) return result;
  return failure([{ segments: ['speedMode'], message: 'Speed mode is disabled on this server.' }]);
}

// ---------------------------------------------------------------- compile-time contract checks

/**
 * The parsed output type is exactly TournamentConfig (deep equality: any field
 * added, removed or retyped in shared-types without updating this schema
 * fails compilation), and every TournamentConfig is an acceptable input.
 */
type _ConfigOutputExact = Assert<Equals<z.output<typeof tournamentConfigSchema>, TournamentConfig>>;
type _ConfigInputAccepted = Assert<Extends<TournamentConfig, z.input<typeof tournamentConfigSchema>>>;
