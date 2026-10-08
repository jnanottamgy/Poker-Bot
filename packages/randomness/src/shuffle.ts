import type { RandomSource } from './types';
import { uniformInt } from './uniform';

/**
 * Durstenfeld Fisher–Yates (NORMATIVE — CONTRACTS §1):
 *
 *   for i = n-1 down to 1: j = uniformInt(i+1); swap(a[i], a[j])
 *
 * Returns a new array; `items` is never mutated. With an unbiased
 * `uniformInt`, every one of the n! permutations is equally likely.
 */
export function fisherYatesShuffle<T>(items: readonly T[], src: RandomSource): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i >= 1; i -= 1) {
    const j = uniformInt(src, i + 1);
    const tmp = a[i] as T;
    a[i] = a[j] as T;
    a[j] = tmp;
  }
  return a;
}
