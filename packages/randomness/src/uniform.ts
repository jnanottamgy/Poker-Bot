import type { RandomSource } from './types';

/** 2^32: the number of distinct values a RandomSource produces. */
export const UINT32_RANGE = 2 ** 32;

/**
 * Safety valve, not part of the normative algorithm: a functioning source is
 * rejected with probability < 1/2 per draw, so 1024 consecutive rejections
 * happen with probability < 2^-1024. Reaching it means the source is broken
 * (e.g. stuck in the biased tail), and an error beats an infinite loop.
 */
export const MAX_CONSECUTIVE_REJECTIONS = 1024;

/**
 * Unbiased integer in [0, maxExclusive) by rejection sampling (NORMATIVE —
 * CONTRACTS §1):
 *
 *   require 1 <= n <= 2^32
 *   limit = floor(2^32 / n) * n
 *   repeat u = nextUint32() until u < limit
 *   return u mod n
 *
 * Exactly one value is consumed per attempt, including for n = 1, so the
 * stream position is identical in every implementation.
 */
export function uniformInt(src: RandomSource, maxExclusive: number): number {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > UINT32_RANGE) {
    throw new RangeError(`uniformInt: maxExclusive must be an integer in [1, 2^32], got ${maxExclusive}`);
  }
  const limit = Math.floor(UINT32_RANGE / maxExclusive) * maxExclusive;
  for (let attempt = 0; attempt < MAX_CONSECUTIVE_REJECTIONS; attempt += 1) {
    const u = src.nextUint32();
    if (!Number.isInteger(u) || u < 0 || u >= UINT32_RANGE) {
      throw new RangeError(`uniformInt: RandomSource returned a value outside [0, 2^32): ${u}`);
    }
    if (u < limit) return u % maxExclusive;
  }
  throw new Error(`uniformInt: ${MAX_CONSECUTIVE_REJECTIONS} consecutive rejections; the RandomSource is broken`);
}
