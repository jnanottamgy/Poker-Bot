import { z } from 'zod';
import { DANGEROUS_OPERATIONS } from '@jpb/shared-types';
import type { DangerousOperation, DemoRequest } from '@jpb/shared-types';
import { CONFIG_LIMITS, INPUT_LIMITS } from '../constants';
import { tournamentConfigSchema } from '../config/tournamentConfig';
import { validateWith } from '../errors';
import type { ValidationResult } from '../errors';
import { WHEN_VALID, boundedSanitizer, chipsSchema, displayTextSchema, idSchema, intInRange, seatIndexSchema } from '../primitives';
import { codePointLength, sanitizeText } from '../text';
import type { Assert, Extends } from '../typeAssert';

/**
 * Admin request bodies (docs/API.md, docs/ADMIN_CONTROL_ROOM.md §4).
 * Danger level 2 operations carry a mandatory reason (>= 3 characters after
 * sanitization) and the exact confirmation word shown in the UI's
 * double-confirm dialog; every override is audit-logged with that reason.
 */

// ---------------------------------------------------------------- reasons

const REASON_REQUIRED = `A reason of at least ${INPUT_LIMITS.REASON_MIN_LENGTH} characters is required.`;
const RAW_REASON_MAX = INPUT_LIMITS.REASON_MAX_LENGTH * 4;

/** Mandatory reason: sanitized (control/zero-width characters removed), 3..500 characters. */
export const adminReasonSchema = z
  .string({ error: REASON_REQUIRED })
  .overwrite(boundedSanitizer(sanitizeText, RAW_REASON_MAX))
  .superRefine((reason, ctx) => {
    const n = codePointLength(reason);
    if (n < INPUT_LIMITS.REASON_MIN_LENGTH) ctx.addIssue({ code: 'custom', message: REASON_REQUIRED });
    else if (n > INPUT_LIMITS.REASON_MAX_LENGTH) {
      ctx.addIssue({ code: 'custom', message: `The reason must be at most ${INPUT_LIMITS.REASON_MAX_LENGTH} characters.` });
    }
  });

/** Optional reason: missing / null / blank → null, otherwise as adminReasonSchema. */
export const optionalAdminReasonSchema = z
  .union([z.null(), z.string().max(RAW_REASON_MAX)])
  .optional()
  .transform((raw, ctx): string | null => {
    const clean = raw === undefined || raw === null ? '' : sanitizeText(raw);
    if (clean === '') return null;
    const checked = adminReasonSchema.safeParse(clean);
    if (!checked.success) {
      for (const issue of checked.error.issues) ctx.addIssue({ code: 'custom', message: issue.message });
      return null;
    }
    return checked.data;
  });

// ---------------------------------------------------------------- confirmation words

/** Every confirmation word the control room asks an admin to type (mirrors the server's CONFIRM_WORDS). */
export const CONFIRM_WORDS = {
  FREEZE: 'FREEZE',
  CANCEL: 'CANCEL',
  LEVEL: 'LEVEL',
  BREAK: 'BREAK',
  REVEAL: 'REVEAL',
  RESTORE: 'RESTORE',
  DISQUALIFY: 'DISQUALIFY',
  ADJUST: 'ADJUST',
  ELIMINATE: 'ELIMINATE',
  REVOKE: 'REVOKE',
  EDIT: 'EDIT',
  USER: 'USER',
} as const;

export type ConfirmWord = (typeof CONFIRM_WORDS)[keyof typeof CONFIRM_WORDS];

/** Confirmation word of each DangerousOperation. */
export const DANGEROUS_OPERATION_CONFIRM_WORDS = {
  CANCEL_TOURNAMENT: CONFIRM_WORDS.CANCEL,
  FORCE_ELIMINATE: CONFIRM_WORDS.ELIMINATE,
  DISQUALIFY_PLAYER: CONFIRM_WORDS.DISQUALIFY,
  SET_BLIND_LEVEL: CONFIRM_WORDS.LEVEL,
  RESTORE_PLAYER: CONFIRM_WORDS.RESTORE,
  ADJUST_STACK: CONFIRM_WORDS.ADJUST,
  EMERGENCY_FREEZE: CONFIRM_WORDS.FREEZE,
  BREAK_TABLE: CONFIRM_WORDS.BREAK,
  REVEAL_SEED: CONFIRM_WORDS.REVEAL,
} as const satisfies Record<DangerousOperation, ConfirmWord>;

/**
 * Generic level-2 body: the operation's own fields plus `reason` (required)
 * and `confirm` (the exact word). Unknown keys are rejected.
 */
export function confirmedActionSchema<W extends ConfirmWord, Shape extends z.ZodRawShape = Record<never, never>>(
  word: W,
  payload?: Shape,
) {
  return z.strictObject({
    ...(payload ?? ({} as Shape)),
    reason: adminReasonSchema,
    confirm: z.literal(word, { error: `Type ${word} to confirm.` }),
  });
}

/**
 * Body schema for a DangerousOperation: `payload` fields + `reason`
 * (required, >= 3 characters) + `confirm` (the operation's confirmation word).
 */
export function adminOverrideSchema<Op extends DangerousOperation, Shape extends z.ZodRawShape = Record<never, never>>(
  operation: Op,
  payload?: Shape,
) {
  return confirmedActionSchema(DANGEROUS_OPERATION_CONFIRM_WORDS[operation], payload);
}

/** Ready-made bodies for every DangerousOperation (targets such as playerId/tableId travel in the URL). */
export const DANGEROUS_OPERATION_SCHEMAS = {
  CANCEL_TOURNAMENT: adminOverrideSchema('CANCEL_TOURNAMENT'),
  FORCE_ELIMINATE: adminOverrideSchema('FORCE_ELIMINATE'),
  DISQUALIFY_PLAYER: adminOverrideSchema('DISQUALIFY_PLAYER'),
  SET_BLIND_LEVEL: adminOverrideSchema('SET_BLIND_LEVEL', { level: intInRange(1, CONFIG_LIMITS.MAX_BLIND_LEVELS) }),
  RESTORE_PLAYER: adminOverrideSchema('RESTORE_PLAYER'),
  ADJUST_STACK: adminOverrideSchema('ADJUST_STACK', { newStack: chipsSchema }),
  EMERGENCY_FREEZE: adminOverrideSchema('EMERGENCY_FREEZE'),
  BREAK_TABLE: adminOverrideSchema('BREAK_TABLE'),
  REVEAL_SEED: adminOverrideSchema('REVEAL_SEED'),
} as const satisfies Record<DangerousOperation, z.ZodType>;

export type DangerousOperationBody<Op extends DangerousOperation> = z.output<(typeof DANGEROUS_OPERATION_SCHEMAS)[Op]>;

/** Validates the body of a DangerousOperation. Never throws. */
export function validateAdminOverride<Op extends DangerousOperation>(
  operation: Op,
  input: unknown,
): ValidationResult<DangerousOperationBody<Op>> {
  if (!(DANGEROUS_OPERATIONS as readonly string[]).includes(operation)) {
    return { ok: false, error: { message: 'Unknown operation.', issues: [] } };
  }
  return validateWith(DANGEROUS_OPERATION_SCHEMAS[operation], input) as ValidationResult<DangerousOperationBody<Op>>;
}

// ---------------------------------------------------------------- level 0/1 bodies

/** Body of a simple level-1 action (pause, resume, hold, release, advance, rebalance ...): optional reason. */
export const adminSimpleActionSchema = z.strictObject({ reason: optionalAdminReasonSchema }).prefault({});

/** POST clock/add-time `{ ms }`: non-zero whole milliseconds, at most one day either way. */
export const adminAddTimeSchema = z
  .strictObject({
    ms: intInRange(-INPUT_LIMITS.MAX_ADD_TIME_MS, INPUT_LIMITS.MAX_ADD_TIME_MS),
    reason: optionalAdminReasonSchema,
  })
  .superRefine((b, ctx) => {
    if (b.ms === 0) ctx.addIssue({ code: 'custom', path: ['ms'], message: 'Add or remove at least 1 millisecond.' });
  }, WHEN_VALID);

/** POST break/start `{ durationSeconds }`. */
export const adminStartBreakSchema = z.strictObject({
  durationSeconds: intInRange(CONFIG_LIMITS.MIN_BREAK_SECONDS, CONFIG_LIMITS.MAX_BREAK_SECONDS),
  reason: optionalAdminReasonSchema,
});

/** POST hand-for-hand `{ enabled }`. */
export const adminHandForHandSchema = z.strictObject({ enabled: z.boolean(), reason: optionalAdminReasonSchema });

/** POST players/:id/move `{ toTableId, toSeat?, reason }` (reason required). */
export const adminMovePlayerSchema = z.strictObject({
  toTableId: idSchema,
  toSeat: seatIndexSchema.optional(),
  reason: adminReasonSchema,
});

/** POST tables/:id/force-timeout `{ reason }` (reason required). */
export const adminForceTimeoutSchema = z.strictObject({ reason: adminReasonSchema });

const announcementText = () => displayTextSchema({ max: INPUT_LIMITS.ANNOUNCEMENT_MAX_LENGTH, rejectMarkup: false });

export const ANNOUNCEMENT_SCOPES = ['ALL', 'TABLE', 'PLAYER', 'DISPLAY'] as const;

/** POST announce `{ text, scope, targetId? }`: TABLE/PLAYER need a target, ALL/DISPLAY must not have one. */
export const adminAnnounceSchema = z
  .strictObject({
    text: announcementText(),
    scope: z.enum(ANNOUNCEMENT_SCOPES),
    targetId: idSchema.nullish(),
  })
  .superRefine((b, ctx) => {
    const needsTarget = b.scope === 'TABLE' || b.scope === 'PLAYER';
    const hasTarget = b.targetId !== undefined && b.targetId !== null;
    if (needsTarget && !hasTarget) {
      ctx.addIssue({ code: 'custom', path: ['targetId'], message: `Choose the ${b.scope === 'TABLE' ? 'table' : 'player'} to announce to.` });
    } else if (!needsTarget && hasTarget) {
      ctx.addIssue({ code: 'custom', path: ['targetId'], message: `A ${b.scope} announcement has no target.` });
    }
  }, WHEN_VALID)
  .transform((b) => ({ text: b.text, scope: b.scope, targetId: b.targetId ?? null }));

/** POST players/:id/notice `{ text }`. */
export const adminPlayerNoticeSchema = z.strictObject({ text: announcementText() });

const nullableNote = (max: number) =>
  z
    .union([z.null(), z.string().max(max * 4)])
    .optional()
    .transform((raw, ctx): string | null => {
      const clean = raw === undefined || raw === null ? '' : sanitizeText(raw);
      if (codePointLength(clean) > max) ctx.addIssue({ code: 'custom', message: `Must be at most ${max} characters.` });
      return clean === '' ? null : clean;
    });

/** PATCH entries/:id/payment `{ status, reference, note }`. */
export const adminPaymentUpdateSchema = z.strictObject({
  status: z.enum(['UNPAID', 'PROCESSING', 'PAID']),
  reference: nullableNote(INPUT_LIMITS.PAYMENT_REFERENCE_MAX_LENGTH),
  note: nullableNote(INPUT_LIMITS.PAYMENT_NOTE_MAX_LENGTH),
});

/**
 * POST start `{ adminEntropy? }`: optional extra public entropy typed by the
 * director, printable ASCII (space to "~"), 1..256 characters.
 */
export const adminStartTournamentSchema = z
  .strictObject({
    adminEntropy: z
      .string()
      .max(INPUT_LIMITS.ADMIN_ENTROPY_MAX_LENGTH)
      .regex(/^[\x20-\x7E]*$/, { error: 'Use printable ASCII characters only.' })
      .nullish()
      .transform((s) => (s === undefined || s === null || s.trim() === '' ? null : s)),
  })
  .prefault({});

/** POST tournaments `{ config }`. */
export const adminCreateTournamentSchema = z.strictObject({ config: tournamentConfigSchema });

/** PUT tournaments/:id/config `{ config, reason? }` (DRAFT/REGISTRATION only). */
export const adminUpdateConfigSchema = z.strictObject({ config: tournamentConfigSchema, reason: optionalAdminReasonSchema });

/**
 * PATCH tournaments/:id/config/running `{ config, reason, confirm: "EDIT" }`.
 * The config itself is checked with `checkRunningConfigEdit` against the
 * current one (only MUTABLE_WHILE_RUNNING fields may change).
 */
export const adminRunningConfigEditSchema = confirmedActionSchema(CONFIRM_WORDS.EDIT, { config: z.unknown() });

// ---------------------------------------------------------------- simulation

export const DEMO_STRATEGIES = [
  'ALWAYS_FOLD',
  'RANDOM_LEGAL_ACTION',
  'CALL_HEAVY',
  'RAISE_HEAVY',
  'ALL_IN_RANDOMLY',
  'TIMEOUT_ALWAYS',
  'FLAKY',
] as const;

const DEMO_WEIGHT_MAX = 1_000_000;

/** POST demo `{ players, strategyMix, speedMode, name? }`: at least one strategy with a positive weight. */
export const demoRequestSchema = z
  .strictObject({
    players: intInRange(CONFIG_LIMITS.MIN_PLAYERS, INPUT_LIMITS.MAX_DEMO_PLAYERS),
    strategyMix: z.partialRecord(z.enum(DEMO_STRATEGIES), z.number().min(0).max(DEMO_WEIGHT_MAX)),
    speedMode: z.boolean(),
    name: displayTextSchema({ max: CONFIG_LIMITS.NAME_MAX_LENGTH }).optional(),
  })
  .superRefine((d, ctx) => {
    if (!Object.values(d.strategyMix).some((w) => w !== undefined && w > 0)) {
      ctx.addIssue({ code: 'custom', path: ['strategyMix'], message: 'Give at least one bot strategy a positive weight.' });
    }
  }, WHEN_VALID);

type _DemoOutput = Assert<Extends<z.output<typeof demoRequestSchema>, DemoRequest>>;
