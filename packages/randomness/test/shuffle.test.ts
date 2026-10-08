import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fisherYatesShuffle, HmacDrbgSource } from '../src';
import { createNodeHmacDrbg } from '../src/node';
import { chiSquareCritical, GOLDEN_KEY, GOLDEN_LABEL, scriptedSource } from './helpers';

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);
/** z for the critical values: one-sided p ≈ 2.9e-7. The tests are seeded, so they are deterministic — never flaky. */
const Z = 5;

describe('fisherYatesShuffle', () => {
  it('known answers on the golden stream (computed independently with node:crypto)', () => {
    expect(fisherYatesShuffle(range(10), new HmacDrbgSource(GOLDEN_KEY, GOLDEN_LABEL))).toEqual([
      5, 7, 9, 0, 2, 6, 4, 8, 3, 1,
    ]);
    expect(fisherYatesShuffle(range(52), new HmacDrbgSource(GOLDEN_KEY, GOLDEN_LABEL))).toEqual([
      40, 31, 23, 44, 46, 16, 24, 15, 42, 5, 19, 28, 47, 3, 22, 20, 13, 49, 2, 7, 50, 45, 48, 29, 43, 41, 27, 17, 10, 9,
      14, 32, 12, 1, 6, 30, 34, 36, 21, 18, 11, 8, 25, 26, 37, 38, 33, 4, 39, 35, 0, 51,
    ]);
  });

  it('follows the Durstenfeld order exactly: j = uniformInt(i+1) for i = n-1 down to 1', () => {
    // n = 4: draws for i = 3, 2, 1 with ranges 4, 3, 2. Values 1, 2, 0 → j = 1, 2, 0.
    const src = scriptedSource([1, 2, 0]);
    // [a,b,c,d] → swap(3,1) → [a,d,c,b] → swap(2,2) → [a,d,c,b] → swap(1,0) → [d,a,c,b]
    expect(fisherYatesShuffle(['a', 'b', 'c', 'd'], src)).toEqual(['d', 'a', 'c', 'b']);
    expect(src.consumed()).toBe(3);
  });

  it('returns a permutation and never mutates the input (property)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer(), { maxLength: 80 }),
        fc.uint8Array({ minLength: 1, maxLength: 32 }),
        (items, key) => {
          const before = items.slice();
          const out = fisherYatesShuffle(items, new HmacDrbgSource(key, 'perm'));
          expect(items).toEqual(before);
          expect(out).not.toBe(items);
          expect(out.slice().sort((a, b) => a - b)).toEqual(before.slice().sort((a, b) => a - b));
        },
      ),
      { numRuns: 300 },
    );
  });

  it('is deterministic for the same key/label and differs across labels and keys', () => {
    const deck = range(52);
    const a = fisherYatesShuffle(deck, new HmacDrbgSource(GOLDEN_KEY, 'JPB/v1/deck|t|t:T1|1|e'));
    expect(fisherYatesShuffle(deck, new HmacDrbgSource(GOLDEN_KEY, 'JPB/v1/deck|t|t:T1|1|e'))).toEqual(a);
    expect(fisherYatesShuffle(deck, createNodeHmacDrbg(GOLDEN_KEY, 'JPB/v1/deck|t|t:T1|1|e'))).toEqual(a);
    expect(fisherYatesShuffle(deck, new HmacDrbgSource(GOLDEN_KEY, 'JPB/v1/deck|t|t:T1|2|e'))).not.toEqual(a);
    expect(fisherYatesShuffle(deck, new HmacDrbgSource(GOLDEN_KEY, 'JPB/v1/deck|t|t:T2|1|e'))).not.toEqual(a);
    expect(fisherYatesShuffle(deck, new HmacDrbgSource(Uint8Array.of(9), 'JPB/v1/deck|t|t:T1|1|e'))).not.toEqual(a);
  });

  it('handles empty and single-element arrays without consuming randomness', () => {
    const src = scriptedSource([]);
    expect(fisherYatesShuffle([], src)).toEqual([]);
    expect(fisherYatesShuffle(['x'], src)).toEqual(['x']);
    expect(src.consumed()).toBe(0);
  });

  it('chi-square: every card is uniformly distributed over every deck position (20,800 seeded shuffles)', () => {
    const n = 52;
    const shuffles = 400 * n;
    const counts = range(n).map(() => new Array<number>(n).fill(0));
    for (let k = 0; k < shuffles; k += 1) {
      const out = fisherYatesShuffle(range(n), createNodeHmacDrbg(GOLDEN_KEY, `JPB/v1/chi-square|${k}`));
      out.forEach((card, pos) => {
        const row = counts[pos]!;
        row[card] = row[card]! + 1;
      });
    }
    const expected = shuffles / n;
    let total = 0;
    const perPositionCritical = chiSquareCritical(n - 1, Z);
    for (const row of counts) {
      const stat = row.reduce((acc, c) => acc + (c - expected) ** 2 / expected, 0);
      expect(stat).toBeLessThan(perPositionCritical);
      total += stat;
    }
    const df = (n - 1) * (n - 1);
    expect(total).toBeLessThan(chiSquareCritical(df, Z));
    // Too-perfect agreement would also indicate a broken (non-random) generator.
    expect(total).toBeGreaterThan(chiSquareCritical(df, -Z));
  });

  it('chi-square: all 24 permutations of 4 items are equally likely (24,000 seeded shuffles)', () => {
    const shuffles = 24_000;
    const counts = new Map<string, number>();
    for (let k = 0; k < shuffles; k += 1) {
      const key = fisherYatesShuffle(['a', 'b', 'c', 'd'], new HmacDrbgSource(GOLDEN_KEY, `perm4|${k}`)).join('');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(counts.size).toBe(24);
    const expected = shuffles / 24;
    const stat = [...counts.values()].reduce((acc, c) => acc + (c - expected) ** 2 / expected, 0);
    expect(stat).toBeLessThan(chiSquareCritical(23, Z));
    expect(stat).toBeGreaterThan(chiSquareCritical(23, -Z));
  });
});
