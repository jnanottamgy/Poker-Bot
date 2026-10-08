import { z } from 'zod';
import { INPUT_LIMITS } from './constants';
import { codePointLength, containsMarkup, hasExcessiveCombiningMarks, sanitizeMultilineText, sanitizeText } from './text';

/**
 * Building blocks shared by every schema. `z.number()` already rejects NaN
 * and ±Infinity; `intInRange` additionally restricts to safe integers.
 */

/**
 * Any safe integer in [min, max]. Implemented as a continuable refinement
 * rather than `.int()`: Zod's `.int()` issue aborts every later refinement of
 * the enclosing object, which would hide the cross-field checks.
 */
export function intInRange(min: number, max: number = Number.MAX_SAFE_INTEGER) {
  return z.number().superRefine((n, ctx) => {
    if (!Number.isInteger(n)) {
      ctx.addIssue({ code: 'custom', message: 'Must be a whole number.' });
    } else if (n < min || n < Number.MIN_SAFE_INTEGER) {
      ctx.addIssue({ code: 'too_small', origin: 'number', minimum: Math.max(min, Number.MIN_SAFE_INTEGER), inclusive: true, input: n });
    } else if (n > max || n > Number.MAX_SAFE_INTEGER) {
      ctx.addIssue({ code: 'too_big', origin: 'number', maximum: Math.min(max, Number.MAX_SAFE_INTEGER), inclusive: true, input: n });
    }
  });
}

/**
 * Refinement option: run only when the value produced no issue so far (the
 * fields a multi-field rule compares are each valid). Zod skips `when`
 * checks after an explicitly aborting issue; no schema here produces one.
 */
export const WHEN_VALID = { when: (payload: { issues: readonly unknown[] }) => payload.issues.length === 0 };

/**
 * Bounded sanitizer for `.overwrite`: inputs longer than `rawMax` UTF-16
 * units are cut to rawMax + 1 units instead of being processed (they then
 * fail the length check), so oversized input costs O(rawMax).
 */
export function boundedSanitizer(sanitize: (s: string) => string, rawMax: number): (s: string) => string {
  return (s) => (s.length > rawMax ? s.slice(0, rawMax + 1) : sanitize(s));
}

/** Chip amount: non-negative safe integer. */
export const chipsSchema = intInRange(0);

/** Positive chip amount (blinds, starting stack). */
export const positiveChipsSchema = intInRange(1);

/** Money in integer minor units (never mixed with chips). */
export const moneyMinorSchema = intInRange(0);

/** Epoch milliseconds measured by the server clock. */
export const epochMsSchema = intInRange(0);

/** Finite, non-negative scoring weight. */
export function weightSchema(max: number) {
  return z.number().min(0).max(max);
}

/** Opaque server-generated id (tournament, table, player, entry ...). */
export const idSchema = z
  .string()
  .max(INPUT_LIMITS.ID_MAX_LENGTH)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/, { error: 'Must be a valid identifier.' });

/** Seat index at a table: 0-based. */
export const seatIndexSchema = intInRange(0, 9);

export interface DisplayTextOptions {
  /** Minimum code points after sanitization (default 1). */
  min?: number;
  /** Maximum code points after sanitization. */
  max: number;
  /** Reject "<", ">" and HTML character references (default true). */
  rejectMarkup?: boolean;
  /** Keep line breaks (notes). Default false. */
  multiline?: boolean;
}

/**
 * Human-readable text: sanitized (see text.ts), then length-checked in code
 * points, optionally rejecting markup. The output is the sanitized string.
 */
export function displayTextSchema(opts: DisplayTextOptions) {
  const min = opts.min ?? 1;
  const sanitize = opts.multiline === true ? sanitizeMultilineText : sanitizeText;
  const rawMax = Math.max(INPUT_LIMITS.MAX_RAW_TEXT_LENGTH, opts.max * 4);
  return z
    .string()
    .overwrite(boundedSanitizer(sanitize, rawMax))
    .superRefine((text, ctx) => {
      const length = codePointLength(text);
      if (length < min) {
        ctx.addIssue({ code: 'custom', message: min === 1 ? 'Must not be empty.' : `Must be at least ${min} characters.` });
        return;
      }
      if (length > opts.max) ctx.addIssue({ code: 'custom', message: `Must be at most ${opts.max} characters.` });
      if (opts.rejectMarkup !== false && containsMarkup(text)) {
        ctx.addIssue({ code: 'custom', message: 'Must not contain "<", ">" or HTML codes.' });
      }
      if (hasExcessiveCombiningMarks(text)) ctx.addIssue({ code: 'custom', message: 'Contains too many stacked accent marks.' });
    });
}

/** Uppercases and trims, then matches `pattern` (join codes, currencies, access codes). */
export function codeSchema(pattern: RegExp, message: string) {
  return z
    .string()
    .overwrite(boundedSanitizer((s) => s.trim().toUpperCase(), INPUT_LIMITS.MAX_RAW_TEXT_LENGTH))
    .regex(pattern, { error: message });
}
