import { z } from 'zod';
import type { RegistrationConfig, RegistrationFieldConfig, RegistrationFieldKey } from '@jpb/shared-types';
import { INPUT_LIMITS, REGISTRATION_FIELD_LABELS, REGISTRATION_FIELD_LIMITS } from '../constants';
import { effectiveRegistrationFields } from '../config/registration';
import { validateWith } from '../errors';
import { WHEN_VALID, boundedSanitizer } from '../primitives';
import type { ValidationResult } from '../errors';
import { codePointLength, containsMarkup, hasExcessiveCombiningMarks, hasLetterOrDigit, sanitizeText } from '../text';

/**
 * Player registration input (spec §7, §148), built dynamically from the
 * tournament's RegistrationConfig. Only configured fields are collected
 * (unknown keys inside `fields` are dropped); every value is sanitized,
 * length-limited and format-checked; the output holds normalized values.
 */

export type RegistrationFields = Partial<Record<RegistrationFieldKey, string>>;

export interface RegistrationInput {
  fields: RegistrationFields;
  /** Trimmed and uppercased, or null when not given. */
  accessCode: string | null;
  /** Lowercase hex (32..128 chars), or null when not given. */
  clientSeed: string | null;
}

export type FieldCheck = { ok: true; value: string } | { ok: false; message: string };

const emailFormat = z.email();
const PHONE_SEPARATORS = /[\s().-]/g;
/** E.164 allows at most 15 digits; 7 is the shortest realistic subscriber number. */
const PHONE = /^\+?[0-9]{7,15}$/;
const ID_TEXT = /^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/;

function lengthCheck(key: RegistrationFieldKey, value: string, label: string): string | null {
  const { min, max } = REGISTRATION_FIELD_LIMITS[key];
  const n = codePointLength(value);
  return n < min || n > max ? `${label} must be ${min}–${max} characters.` : null;
}

/**
 * Validates and normalizes one non-empty, already sanitized value:
 * - name / nickname: at least one letter or digit;
 * - email: lowercased, Zod email format;
 * - phone: spaces, dots, dashes and parentheses removed, then "+" optional
 *   followed by 7–15 digits;
 * - participantId / collegeId: letters, digits, space, ". _ / -", starting
 *   with a letter or digit.
 * Every field rejects markup and stacked combining marks and enforces
 * REGISTRATION_FIELD_LIMITS (code points, on the normalized value).
 */
export function normalizeRegistrationValue(key: RegistrationFieldKey, clean: string, label: string): FieldCheck {
  if (containsMarkup(clean)) return { ok: false, message: `${label} must not contain "<", ">" or HTML codes.` };
  if (hasExcessiveCombiningMarks(clean)) return { ok: false, message: `${label} contains too many stacked accent marks.` };
  let value = clean;
  switch (key) {
    case 'name':
    case 'nickname':
      if (!hasLetterOrDigit(value)) return { ok: false, message: `${label} must contain at least one letter or digit.` };
      break;
    case 'email':
      value = value.toLowerCase();
      if (!emailFormat.safeParse(value).success) return { ok: false, message: 'Enter a valid email address.' };
      break;
    case 'phone':
      value = value.replace(PHONE_SEPARATORS, '');
      if (!PHONE.test(value)) return { ok: false, message: 'Enter a valid phone number (7–15 digits, optional leading +).' };
      break;
    case 'participantId':
    case 'collegeId':
      if (!ID_TEXT.test(value)) return { ok: false, message: `${label} may only use letters, digits, spaces and . _ / -` };
      break;
  }
  const lengthProblem = lengthCheck(key, value, label);
  return lengthProblem === null ? { ok: true, value } : { ok: false, message: lengthProblem };
}

function fieldLabel(field: RegistrationFieldConfig): string {
  return field.label ?? REGISTRATION_FIELD_LABELS[field.key];
}

/** Value schema for one configured field. Empty / null / missing → absent (error if required). */
function fieldValueSchema(field: RegistrationFieldConfig) {
  const label = fieldLabel(field);
  const value = z.unknown().transform((raw, ctx): string | undefined => {
    const fail = (message: string) => {
      ctx.addIssue({ code: 'custom', message });
      return undefined;
    };
    if (raw === undefined || raw === null) return field.required ? fail(`${label} is required.`) : undefined;
    if (typeof raw !== 'string') return fail(`${label} must be text.`);
    if (raw.length > INPUT_LIMITS.MAX_RAW_TEXT_LENGTH) return fail(`${label} is too long.`);
    const clean = sanitizeText(raw);
    if (clean === '') return field.required ? fail(`${label} is required.`) : undefined;
    const checked = normalizeRegistrationValue(field.key, clean, label);
    return checked.ok ? checked.value : fail(checked.message);
  });
  return field.required ? value : value.optional();
}

function dropUndefined(values: Record<string, string | undefined>): RegistrationFields {
  const out: RegistrationFields = {};
  for (const [k, v] of Object.entries(values)) if (v !== undefined) out[k as RegistrationFieldKey] = v;
  return out;
}

/**
 * Schema for the `fields` object. `name` is always collected (implicitly
 * required when the config does not list it). Unknown keys are dropped.
 */
export function registrationFieldsSchema(config: RegistrationConfig) {
  const shape: Record<string, z.ZodType<string | undefined>> = {};
  for (const field of effectiveRegistrationFields(config.fields)) {
    if (shape[field.key] === undefined) shape[field.key] = fieldValueSchema(field);
  }
  return z.object(shape).transform(dropUndefined);
}

/** Client seed: trimmed, lowercased, 32–128 hex characters; empty/null/missing → null. */
export const clientSeedSchema = z
  .string()
  .overwrite(boundedSanitizer((s) => s.trim().toLowerCase(), INPUT_LIMITS.CLIENT_SEED_MAX_LENGTH * 2))
  .regex(/^(?:[0-9a-f]{32,128})?$/, { error: 'The client seed must be 32–128 hexadecimal characters.' })
  .nullish()
  .transform((s) => (s === undefined || s === null || s === '' ? null : s));

/** Access code typed by a player: sanitized + uppercased; empty/null/missing → null. */
export const accessCodeInputSchema = z
  .string()
  .max(INPUT_LIMITS.ACCESS_CODE_MAX_LENGTH)
  .nullish()
  .transform((s) => {
    const clean = s === undefined || s === null ? '' : sanitizeText(s).toUpperCase();
    return clean === '' ? null : clean;
  });

export interface RegistrationRequestOptions {
  /** Require a non-empty access code (default: when the config sets one). Staff registrations pass false. */
  requireAccessCode?: boolean;
}

/** The public registration body `{ fields, accessCode?, clientSeed? }` (RegisterRequest). */
export function registrationRequestSchema(config: RegistrationConfig, options: RegistrationRequestOptions = {}) {
  const requireAccessCode = options.requireAccessCode ?? config.accessCode !== null;
  return z
    .strictObject({
      fields: registrationFieldsSchema(config).prefault({}),
      accessCode: accessCodeInputSchema,
      clientSeed: clientSeedSchema,
    })
    .superRefine((body, ctx) => {
      if (requireAccessCode && body.accessCode === null) {
        ctx.addIssue({ code: 'custom', path: ['accessCode'], message: 'Enter the access code given by the organizers.' });
      }
    }, WHEN_VALID)
    .transform((body): RegistrationInput => ({ fields: body.fields, accessCode: body.accessCode, clientSeed: body.clientSeed }));
}

/** Staff manual registration body `{ fields }` (no access code or client seed). */
export function manualRegistrationSchema(config: RegistrationConfig) {
  return z.strictObject({ fields: registrationFieldsSchema(config).prefault({}) });
}

/**
 * Validates a registration body. Never throws. Convenience wrapper that
 * builds the schema on every call (~0.5 ms); a server should build
 * `registrationRequestSchema(config)` once per tournament config and use
 * `validateWith(schema, body)`.
 */
export function validateRegistration(
  config: RegistrationConfig,
  input: unknown,
  options: RegistrationRequestOptions = {},
): ValidationResult<RegistrationInput> {
  return validateWith(registrationRequestSchema(config, options), input);
}

/** Display name at the table: nickname if given, else name. */
export function registrationDisplayName(fields: RegistrationFields): string | null {
  return fields.nickname ?? fields.name ?? null;
}
