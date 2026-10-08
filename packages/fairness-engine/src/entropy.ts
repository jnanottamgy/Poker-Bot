import { isWellFormedString, sha256Hex } from '@jpb/randomness';
import type { PublicEntropyInputs } from '@jpb/shared-types';
import {
  CLIENT_SEED_PATTERN,
  CLIENT_SEED_SEPARATOR,
  ENTROPY_PURPOSE,
  FIELD_SEPARATOR,
  LABEL_PREFIX,
  MAX_CLIENT_SEED_LENGTH,
} from './constants';

/** Reason a client seed is unusable, or null. See CLIENT_SEED_PATTERN. */
export function clientSeedProblem(seed: unknown): string | null {
  if (typeof seed !== 'string') return 'client seed must be a string';
  if (seed.length === 0 || seed.length > MAX_CLIENT_SEED_LENGTH)
    return `client seed must be 1..${MAX_CLIENT_SEED_LENGTH} characters`;
  if (!CLIENT_SEED_PATTERN.test(seed)) return 'client seed must be printable ASCII without "," or "|"';
  return null;
}

function inputsProblem(input: PublicEntropyInputs): string | null {
  if (!Array.isArray(input.clientSeeds)) return 'clientSeeds must be an array';
  for (const seed of input.clientSeeds) {
    const p = clientSeedProblem(seed);
    if (p !== null) return p;
  }
  const admin = input.adminEntropy;
  if (admin !== null && admin !== undefined) {
    if (typeof admin !== 'string') return 'adminEntropy must be a string or null';
    if (!isWellFormedString(admin)) return 'adminEntropy contains an unpaired UTF-16 surrogate';
  }
  return null;
}

/** Ascending by UTF-16 code unit; for the ASCII-only client seeds this equals byte order in every language. */
function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The exact string whose UTF-8 bytes are hashed:
 *   "JPB/v1/entropy|" + sorted(clientSeeds).join(",") + "|" + (adminEntropy ?? "")
 * Duplicates are kept; null and "" admin entropy are equivalent.
 */
export function publicEntropyPreimage(input: PublicEntropyInputs): string {
  const problem = inputsProblem(input);
  if (problem !== null) throw new RangeError(problem);
  const seeds = input.clientSeeds.slice().sort(compareCodeUnits).join(CLIENT_SEED_SEPARATOR);
  return `${LABEL_PREFIX}${ENTROPY_PURPOSE}${FIELD_SEPARATOR}${seeds}${FIELD_SEPARATOR}${input.adminEntropy ?? ''}`;
}

/**
 * Tournament public entropy (CONTRACTS §2), frozen and published at START:
 *   lowercase hex( SHA-256( UTF-8( publicEntropyPreimage(input) ) ) )
 * Independent of the order in which client seeds are supplied.
 */
export function computePublicEntropy(input: PublicEntropyInputs): string {
  return sha256Hex(publicEntropyPreimage(input));
}
