/**
 * Input validation shared by derivation and verification. Each `*Problem`
 * returns a human-readable reason or null; derivation APIs throw on a
 * problem (programmer error), verification reports it as a FAILED check.
 */
import { isHex, isLowerHex, isWellFormedString } from '@jpb/randomness';
import { FIELD_SEPARATOR, HASH_BYTES, SERVER_SEED_BYTES } from './constants';

/** A label field (ids, purposes): non-empty, well-formed, and free of the "|" separator. */
export function labelFieldProblem(name: string, value: unknown): string | null {
  if (typeof value !== 'string') return `${name} must be a string`;
  if (value.length === 0) return `${name} must not be empty`;
  if (value.includes(FIELD_SEPARATOR)) return `${name} must not contain "${FIELD_SEPARATOR}"`;
  if (!isWellFormedString(value)) return `${name} contains an unpaired UTF-16 surrogate`;
  return null;
}

export function handNumberProblem(value: unknown): string | null {
  return Number.isSafeInteger(value) && (value as number) >= 0
    ? null
    : 'handNumber must be a non-negative safe integer';
}

/** Public entropy is used verbatim inside labels, so only the canonical lowercase form is accepted. */
export function publicEntropyProblem(value: unknown): string | null {
  return isLowerHex(value, HASH_BYTES) ? null : 'publicEntropy must be 64 lowercase hexadecimal characters';
}

/** The seed is used as bytes, so either hex case denotes the same seed. */
export function serverSeedProblem(value: unknown): string | null {
  return isHex(value, SERVER_SEED_BYTES) ? null : 'server seed must be 64 hexadecimal characters (32 bytes)';
}

/** A SHA-256 hex digest (commitment / deck hash); compared case-insensitively. */
export function digestProblem(name: string, value: unknown): string | null {
  return isHex(value, HASH_BYTES) ? null : `${name} must be 64 hexadecimal characters`;
}

export function firstProblem(...problems: Array<string | null>): string | null {
  for (const p of problems) if (p !== null) return p;
  return null;
}

/** Throws a RangeError for the first problem (derivation APIs: invalid input is a programmer error). */
export function assertNoProblem(...problems: Array<string | null>): void {
  const p = firstProblem(...problems);
  if (p !== null) throw new RangeError(p);
}
