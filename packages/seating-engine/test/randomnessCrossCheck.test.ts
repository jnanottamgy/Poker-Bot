import { describe, expect, it } from 'vitest';
import type { RandomSource } from '@jpb/randomness';
import { drawIndex, shuffled } from '../src';
import { testRng } from './fixtures';

/**
 * drawIndex / shuffled re-implement the normative CONTRACTS §1 algorithms so
 * that this package only depends on the RandomSource *type*. This test proves
 * they are byte-for-byte identical to @jpb/randomness once that package is
 * present (it is built concurrently; until it exists the suite is skipped).
 */
interface RandomnessModule {
  uniformInt(src: RandomSource, maxExclusive: number): number;
  fisherYatesShuffle<T>(items: readonly T[], src: RandomSource): T[];
}

const SPECIFIER = '@jpb/randomness';
const randomness = (await import(/* @vite-ignore */ SPECIFIER).catch(() => null)) as Partial<RandomnessModule> | null;
const available = typeof randomness?.uniformInt === 'function' && typeof randomness.fisherYatesShuffle === 'function';

describe.skipIf(!available)('cross-check with @jpb/randomness', () => {
  const mod = randomness as RandomnessModule;

  it('drawIndex === uniformInt for the same stream', () => {
    for (const n of [1, 2, 3, 7, 9, 10, 52, 1000, 2 ** 31 + 1, 2 ** 32 - 1, 2 ** 32]) {
      const a = testRng(n);
      const b = testRng(n);
      for (let i = 0; i < 200; i += 1) expect(drawIndex(a, n)).toBe(mod.uniformInt(b, n));
    }
  });

  it('shuffled === fisherYatesShuffle for the same stream', () => {
    const items = Array.from({ length: 100 }, (_, i) => `p${i}`);
    for (let seed = 0; seed < 50; seed += 1) {
      expect(shuffled(items, testRng(seed))).toEqual(mod.fisherYatesShuffle(items, testRng(seed)));
    }
  });
});
