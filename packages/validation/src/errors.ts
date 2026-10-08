import { z } from 'zod';

/**
 * User-facing validation errors. Zod issues are turned into short sentences
 * with a machine-readable path; no stack trace, raw exception text or echoed
 * input value ever reaches a user.
 */

export type PathSegment = string | number;

export interface ValidationIssue {
  /** Dotted path for programmatic field linking, e.g. "blindSchedule[2].bigBlind" ("" = the whole input). */
  path: string;
  segments: PathSegment[];
  /** Zod issue code ("too_small", "custom", ...). */
  code: string;
  /** Short sentence without the field name, e.g. "Must be at least 1." */
  message: string;
  /** Human field label + message, e.g. "Blind schedule › #3 › Big blind: Must be at least 1." */
  text: string;
}

export interface FormattedValidationError {
  /** One-line summary suitable for a toast or an API error body. */
  message: string;
  issues: ValidationIssue[];
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: FormattedValidationError };

/** Issues listed in `message` before "(and N more problems)". */
const SUMMARY_ISSUES = 1;
/** Unknown keys listed by name in an "Unknown field" message. */
const MAX_LISTED_KEYS = 5;
const MAX_LISTED_KEY_LENGTH = 32;

const GENERIC_MESSAGE = 'The input could not be validated.';

// ---------------------------------------------------------------- friendly default messages

type RawIssue = z.core.$ZodRawIssue;

function describeExpected(expected: string): string {
  switch (expected) {
    case 'int':
      return 'a whole number';
    case 'number':
      return 'a number';
    case 'string':
      return 'text';
    case 'boolean':
      return 'true or false';
    case 'object':
      return 'an object';
    case 'array':
      return 'a list';
    case 'null':
      return 'null';
    default:
      return `a value of type ${expected}`;
  }
}

function invalidTypeMessage(issue: RawIssue & { code: 'invalid_type' }): string {
  if (issue.input === undefined) return 'This field is required.';
  if (issue.expected === 'int' && typeof issue.input === 'number') return 'Must be a whole number.';
  if (issue.expected === 'number' && typeof issue.input === 'number') return 'Must be a finite number.';
  return `Must be ${describeExpected(issue.expected)}.`;
}

function boundText(value: number | bigint): string {
  const n = Number(value);
  return Number.isSafeInteger(n) ? n.toLocaleString('en-US') : String(value);
}

function sizeMessage(
  origin: string,
  bound: number | bigint,
  inclusive: boolean | undefined,
  direction: 'min' | 'max',
): string {
  const atLeast = direction === 'min';
  switch (origin) {
    case 'string':
      if (atLeast && Number(bound) === 1) return 'Must not be empty.';
      return `Must be ${atLeast ? 'at least' : 'at most'} ${boundText(bound)} characters.`;
    case 'array':
    case 'set':
      if (atLeast && Number(bound) === 1) return 'Must contain at least one item.';
      return `Must contain ${atLeast ? 'at least' : 'at most'} ${boundText(bound)} items.`;
    default:
      if (inclusive === false) return `Must be ${atLeast ? 'greater' : 'less'} than ${boundText(bound)}.`;
      return `Must be ${atLeast ? 'at least' : 'at most'} ${boundText(bound)}.`;
  }
}

function formatName(format: string): string {
  switch (format) {
    case 'email':
      return 'Must be a valid email address.';
    case 'regex':
      return 'Has an invalid format.';
    default:
      return `Must be a valid ${format}.`;
  }
}

function safeKeyText(key: unknown): string {
  const text = String(key).replace(/[^\x20-\x7E]/g, '?');
  return text.length > MAX_LISTED_KEY_LENGTH ? `${text.slice(0, MAX_LISTED_KEY_LENGTH)}…` : text;
}

function listKeys(keys: readonly unknown[]): string {
  const shown = keys.slice(0, MAX_LISTED_KEYS).map((k) => `"${safeKeyText(k)}"`);
  const extra = keys.length - shown.length;
  return extra > 0 ? `${shown.join(', ')} and ${extra} more` : shown.join(', ');
}

function literalText(value: unknown): string {
  return typeof value === 'string' ? `"${value}"` : String(value);
}

/**
 * Error map producing friendly default messages. Pass it to `safeParse(x, {
 * error: friendlyErrorMap })`; messages written on a schema still take
 * precedence. Never echoes the offending input value.
 */
export function friendlyErrorMap(issue: RawIssue): string {
  switch (issue.code) {
    case 'invalid_type':
      return invalidTypeMessage(issue);
    case 'too_small':
      return sizeMessage(issue.origin, issue.minimum, issue.inclusive, 'min');
    case 'too_big':
      return sizeMessage(issue.origin, issue.maximum, issue.inclusive, 'max');
    case 'invalid_format':
      return formatName(issue.format);
    case 'not_multiple_of':
      return `Must be a multiple of ${String(issue.divisor)}.`;
    case 'unrecognized_keys':
      return `Unknown field${issue.keys.length === 1 ? '' : 's'}: ${listKeys(issue.keys)}.`;
    case 'invalid_union': {
      const note = (issue as { note?: unknown }).note;
      if (note === 'No matching discriminator') return 'Unknown or missing type.';
      return 'Does not match any allowed form.';
    }
    case 'invalid_value':
      if (issue.values.length === 1) return `Must be ${literalText(issue.values[0])}.`;
      return `Must be one of: ${issue.values.map(literalText).join(', ')}.`;
    case 'invalid_key':
      return 'Contains an invalid key.';
    case 'invalid_element':
      return 'Contains an invalid element.';
    case 'custom':
      return 'Is invalid.';
    default:
      return 'Is invalid.';
  }
}

// ---------------------------------------------------------------- paths

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function toSegments(path: readonly PropertyKey[]): PathSegment[] {
  return path.map((p) => (typeof p === 'number' ? p : typeof p === 'symbol' ? (p.description ?? 'symbol') : p));
}

/** "blindSchedule[2].bigBlind"; non-identifier keys are quoted: 'fields["my key"]'. */
export function formatPath(segments: readonly PathSegment[]): string {
  let out = '';
  for (const seg of segments) {
    if (typeof seg === 'number') out += `[${seg}]`;
    else if (IDENTIFIER.test(seg)) out += out === '' ? seg : `.${seg}`;
    else out += `[${JSON.stringify(safeKeyText(seg))}]`;
  }
  return out;
}

function humanizeKey(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .trim();
  return spaced === '' ? key : spaced[0]!.toUpperCase() + spaced.slice(1);
}

/** "Blind schedule › #3 › Big blind" (array indices are shown 1-based). */
export function humanizePath(segments: readonly PathSegment[]): string {
  return segments.map((s) => (typeof s === 'number' ? `#${s + 1}` : humanizeKey(safeKeyText(s)))).join(' › ');
}

// ---------------------------------------------------------------- formatting

function toValidationIssue(issue: z.core.$ZodIssue): ValidationIssue {
  const segments = toSegments(issue.path);
  const message = typeof issue.message === 'string' && issue.message !== '' ? issue.message : 'Is invalid.';
  const label = humanizePath(segments);
  return {
    path: formatPath(segments),
    segments,
    code: issue.code,
    message,
    text: label === '' ? message : `${label}: ${message}`,
  };
}

function summarize(issues: readonly ValidationIssue[]): string {
  if (issues.length === 0) return GENERIC_MESSAGE;
  const shown = issues.slice(0, SUMMARY_ISSUES).map((i) => i.text);
  const rest = issues.length - shown.length;
  return rest > 0 ? `${shown.join(' ')} (and ${rest} more problem${rest === 1 ? '' : 's'})` : shown.join(' ');
}

/**
 * Turns any error into a user-friendly structure. A ZodError yields one entry
 * per issue (in Zod's deterministic order); anything else yields a generic
 * message (never the exception text or stack).
 */
export function formatZodError(error: unknown): FormattedValidationError {
  if (!(error instanceof z.ZodError)) return { message: GENERIC_MESSAGE, issues: [] };
  const issues = error.issues.map(toValidationIssue);
  return { message: summarize(issues), issues };
}

/** Builds a failed result with explicit issues (used by checks that run outside Zod). */
export function failure<T>(issues: ReadonlyArray<{ segments: PathSegment[]; message: string; code?: string }>): ValidationResult<T> {
  const formatted = issues.map((i) => {
    const label = humanizePath(i.segments);
    return {
      path: formatPath(i.segments),
      segments: [...i.segments],
      code: i.code ?? 'custom',
      message: i.message,
      text: label === '' ? i.message : `${label}: ${i.message}`,
    };
  });
  return { ok: false, error: { message: summarize(formatted), issues: formatted } };
}

/**
 * Validates `input` with `schema` using the friendly error map. Never throws:
 * even hostile inputs (throwing getters, proxies) produce `{ ok: false }`.
 */
export function validateWith<S extends z.ZodType>(schema: S, input: unknown): ValidationResult<z.output<S>> {
  try {
    const result = schema.safeParse(input, { error: friendlyErrorMap });
    if (result.success) return { ok: true, value: result.data };
    return { ok: false, error: formatZodError(result.error) };
  } catch {
    return { ok: false, error: { message: GENERIC_MESSAGE, issues: [] } };
  }
}
