import type { RandomSource } from '@jpb/randomness';
import type { SeatIndex } from '@jpb/shared-types';

const TWO_POW_32 = 2 ** 32;

/**
 * Unbiased integer in [0, n) — the normative CONTRACTS §1 algorithm, kept
 * byte-for-byte identical to `uniformInt` in @jpb/randomness so that seat
 * draws are reproducible by the public verifier:
 *
 *   limit = floor(2^32 / n) * n;  repeat u = nextUint32() until u < limit;  return u mod n
 *
 * One value is always consumed, even for n = 1.
 */
export function drawIndex(rng: RandomSource, n: number): number {
  if (!Number.isSafeInteger(n) || n < 1 || n > TWO_POW_32) throw new RangeError(`n must be an integer in [1, 2^32], got ${n}`);
  const limit = Math.floor(TWO_POW_32 / n) * n;
  for (;;) {
    const u = rng.nextUint32();
    if (!Number.isInteger(u) || u < 0 || u >= TWO_POW_32) throw new RangeError(`RandomSource returned a non-uint32 value: ${u}`);
    if (u < limit) return u % n;
  }
}

/**
 * Durstenfeld Fisher–Yates (CONTRACTS §1): for i = n-1 down to 1,
 * j = uniformInt(i+1), swap(a[i], a[j]). Returns a new array.
 */
export function shuffled<T>(items: readonly T[], rng: RandomSource): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i >= 1; i -= 1) {
    const j = drawIndex(rng, i + 1);
    const tmp = a[i] as T;
    a[i] = a[j] as T;
    a[j] = tmp;
  }
  return a;
}

/** Uniform choice among the occupied seats (sorted ascending first, so input order never matters). */
export function drawButtonSeat(occupiedSeats: readonly SeatIndex[], rng: RandomSource): SeatIndex {
  if (occupiedSeats.length === 0) throw new RangeError('cannot draw a button among zero occupied seats');
  const sorted = occupiedSeats.slice().sort((a, b) => a - b);
  return sorted[drawIndex(rng, sorted.length)] as SeatIndex;
}

/** Deterministic, locale-independent string order (UTF-16 code units) used to canonicalise player lists. */
export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
