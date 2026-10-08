import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compareIds, drawButtonSeat, drawIndex, shuffled, spreadSeats } from '../src';
import { scriptedRng, testRng } from './fixtures';

describe('spreadSeats', () => {
  it('matches the documented examples', () => {
    expect(spreadSeats(9, 9)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(spreadSeats(8, 9)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(spreadSeats(5, 9)).toEqual([0, 1, 3, 5, 7]);
    expect(spreadSeats(3, 9)).toEqual([0, 3, 6]);
    expect(spreadSeats(2, 9)).toEqual([0, 4]);
    expect(spreadSeats(1, 9)).toEqual([0]);
    expect(spreadSeats(0, 9)).toEqual([]);
    expect(spreadSeats(4, 10)).toEqual([0, 2, 5, 7]);
  });

  it('rejects impossible requests', () => {
    expect(() => spreadSeats(10, 9)).toThrow(RangeError);
    expect(() => spreadSeats(-1, 9)).toThrow(RangeError);
    expect(() => spreadSeats(2, 0)).toThrow(RangeError);
  });

  it('is strictly ascending, in range, and gaps differ by at most one (fast-check)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }).chain((m) => fc.tuple(fc.constant(m), fc.integer({ min: 1, max: m }))),
        ([maxSeats, n]) => {
          const seats = spreadSeats(n, maxSeats);
          expect(seats.length).toBe(n);
          const gaps: number[] = [];
          for (let i = 0; i < n; i += 1) {
            const s = seats[i] as number;
            expect(s).toBeGreaterThanOrEqual(0);
            expect(s).toBeLessThan(maxSeats);
            const next = i + 1 < n ? (seats[i + 1] as number) : (seats[0] as number) + maxSeats;
            gaps.push(next - s);
          }
          expect(gaps.every((g) => g >= 1)).toBe(true);
          expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);
        },
      ),
    );
  });
});

describe('drawIndex (normative uniformInt)', () => {
  it('rejects the biased tail and returns u mod n', () => {
    // n = 3: limit = floor(2^32 / 3) * 3 = 4294967295, so 4294967295 is rejected.
    const rng = scriptedRng([4294967295, 7]);
    expect(drawIndex(rng, 3)).toBe(1);
    expect(rng.consumed()).toBe(2);
  });

  it('consumes one value even for n = 1', () => {
    const rng = scriptedRng([123]);
    expect(drawIndex(rng, 1)).toBe(0);
    expect(rng.consumed()).toBe(1);
  });

  it('accepts n = 2^32 (no rejection possible)', () => {
    expect(drawIndex(scriptedRng([4294967295]), 2 ** 32)).toBe(4294967295);
  });

  it('rejects invalid n and broken sources', () => {
    expect(() => drawIndex(testRng(1), 0)).toThrow(RangeError);
    expect(() => drawIndex(testRng(1), 2 ** 32 + 1)).toThrow(RangeError);
    expect(() => drawIndex(testRng(1), 2.5)).toThrow(RangeError);
    expect(() => drawIndex(scriptedRng([-1]), 5)).toThrow(RangeError);
    expect(() => drawIndex(scriptedRng([2 ** 32]), 5)).toThrow(RangeError);
    expect(() => drawIndex(scriptedRng([1.5]), 5)).toThrow(RangeError);
  });

  it('always lands in range (fast-check)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 2 ** 32 }), fc.integer({ min: 0, max: 2 ** 32 - 1 }), (n, u) => {
        const rng = scriptedRng([u, 0]);
        const v = drawIndex(rng, n);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(n);
      }),
    );
  });
});

describe('shuffled (Durstenfeld Fisher–Yates)', () => {
  it('follows the normative swap sequence', () => {
    // n = 4: i=3 j=u%4, i=2 j=u%3, i=1 j=u%2
    const rng = scriptedRng([1, 2, 1]);
    // [a,b,c,d] -> swap(3,1) -> [a,d,c,b] -> swap(2,2) -> same -> swap(1,1) -> same
    expect(shuffled(['a', 'b', 'c', 'd'], rng)).toEqual(['a', 'd', 'c', 'b']);
    expect(rng.consumed()).toBe(3);
  });

  it('is a deterministic permutation that never mutates its input (fast-check)', () => {
    fc.assert(
      fc.property(fc.array(fc.integer(), { maxLength: 60 }), fc.integer(), (items, seed) => {
        const copy = items.slice();
        const a = shuffled(items, testRng(seed));
        const b = shuffled(items, testRng(seed));
        expect(items).toEqual(copy);
        expect(a).toEqual(b);
        expect(a.slice().sort((x, y) => x - y)).toEqual(copy.slice().sort((x, y) => x - y));
      }),
    );
  });

  it('chi-square smoke test: every permutation of 3 items is (roughly) equally likely', () => {
    const counts = new Map<string, number>();
    const rng = testRng(2024);
    const trials = 60_000;
    for (let i = 0; i < trials; i += 1) {
      const key = shuffled(['a', 'b', 'c'], rng).join('');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(counts.size).toBe(6);
    const expected = trials / 6;
    let chi = 0;
    for (const c of counts.values()) chi += (c - expected) ** 2 / expected;
    // 5 degrees of freedom: p = 0.001 critical value is 20.5.
    expect(chi).toBeLessThan(20.5);
  });
});

describe('drawButtonSeat / compareIds', () => {
  it('ignores input order', () => {
    expect(drawButtonSeat([6, 0, 3], scriptedRng([2]))).toBe(6);
    expect(drawButtonSeat([0, 3, 6], scriptedRng([2]))).toBe(6);
    expect(() => drawButtonSeat([], testRng(1))).toThrow(RangeError);
  });

  it('orders by UTF-16 code units', () => {
    expect(['b', 'B', 'a', 'aa', 'A'].sort(compareIds)).toEqual(['A', 'B', 'a', 'aa', 'b']);
  });
});
