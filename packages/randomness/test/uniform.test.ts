import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { HmacDrbgSource, MAX_CONSECUTIVE_REJECTIONS, UINT32_RANGE, uniformInt } from '../src';
import { GOLDEN_KEY, GOLDEN_LABEL, scriptedSource } from './helpers';

const MAX_U32 = UINT32_RANGE - 1;
const limitFor = (n: number): number => Math.floor(UINT32_RANGE / n) * n;

describe('uniformInt — normative rejection sampling', () => {
  it('returns u mod n for accepted values', () => {
    expect(uniformInt(scriptedSource([0]), 52)).toBe(0);
    expect(uniformInt(scriptedSource([53]), 52)).toBe(1);
    expect(uniformInt(scriptedSource([limitFor(52) - 1]), 52)).toBe((limitFor(52) - 1) % 52);
  });

  it('rejects every value in the biased tail [limit, 2^32) and consumes exactly one value per attempt', () => {
    for (const n of [3, 7, 52, 1000, 2 ** 31 + 1, 3_000_000_000]) {
      const limit = limitFor(n);
      expect(limit).toBeLessThan(UINT32_RANGE);
      const tail = [...new Set([limit, Math.min(limit + 1, MAX_U32), MAX_U32, Math.floor((limit + MAX_U32) / 2)])];
      const src = scriptedSource([...tail, 5]);
      expect(uniformInt(src, n)).toBe(5 % n);
      expect(src.consumed()).toBe(tail.length + 1);
    }
  });

  it('the largest accepted value is limit - 1 (boundary is exclusive)', () => {
    const n = 7;
    const limit = limitFor(n);
    const src = scriptedSource([limit - 1]);
    expect(uniformInt(src, n)).toBe((limit - 1) % n);
    expect(src.consumed()).toBe(1);
  });

  it('powers of two never reject', () => {
    for (const n of [1, 2, 4, 1024, 2 ** 31, 2 ** 32]) {
      expect(limitFor(n)).toBe(UINT32_RANGE);
      const src = scriptedSource([MAX_U32]);
      expect(uniformInt(src, n)).toBe(MAX_U32 % n);
      expect(src.consumed()).toBe(1);
    }
  });

  it('n = 1 always returns 0 but still consumes one value', () => {
    const src = scriptedSource([MAX_U32, 0]);
    expect(uniformInt(src, 1)).toBe(0);
    expect(src.consumed()).toBe(1);
  });

  it('n = 2^32 returns the raw value', () => {
    expect(uniformInt(scriptedSource([MAX_U32]), UINT32_RANGE)).toBe(MAX_U32);
    expect(uniformInt(scriptedSource([123456789]), UINT32_RANGE)).toBe(123456789);
  });

  it('rejects invalid n', () => {
    for (const bad of [
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      UINT32_RANGE + 1,
      2 ** 53,
      '5' as unknown as number,
    ]) {
      expect(() => uniformInt(scriptedSource([0]), bad)).toThrow(RangeError);
    }
  });

  it('rejects a source that returns non-uint32 values', () => {
    for (const bad of [-1, 1.5, UINT32_RANGE, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => uniformInt(scriptedSource([bad]), 10)).toThrow(RangeError);
    }
  });

  it('a source stuck in the biased tail fails loudly instead of hanging', () => {
    const stuck = { nextUint32: () => MAX_U32 };
    expect(() => uniformInt(stuck, 3)).toThrow(/broken/);
    const almost = scriptedSource([...Array<number>(MAX_CONSECUTIVE_REJECTIONS - 1).fill(MAX_U32), 4]);
    expect(uniformInt(almost, 3)).toBe(1);
  });

  it('is always in range (property, real DRBG stream)', () => {
    const src = new HmacDrbgSource(GOLDEN_KEY, GOLDEN_LABEL);
    fc.assert(
      fc.property(fc.integer({ min: 1, max: UINT32_RANGE }), (n) => {
        const v = uniformInt(src, n);
        expect(Number.isInteger(v) && v >= 0 && v < n).toBe(true);
      }),
      { numRuns: 2000 },
    );
  });

  it('is always in range and equals u mod n for arbitrary scripted sources (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: UINT32_RANGE }),
        fc.array(fc.nat({ max: MAX_U32 }), { minLength: 1, maxLength: 20 }),
        (n, raw) => {
          const values = [...raw, 0];
          const src = scriptedSource(values);
          const v = uniformInt(src, n);
          const firstAccepted = values.find((u) => u < limitFor(n)) as number;
          expect(v).toBe(firstAccepted % n);
          expect(src.consumed()).toBe(values.indexOf(firstAccepted) + 1);
        },
      ),
      { numRuns: 1000 },
    );
  });

  it('known answers on the golden stream (n = 52 and n = 3e9, where two values are rejected)', () => {
    const s52 = new HmacDrbgSource(GOLDEN_KEY, GOLDEN_LABEL);
    expect(Array.from({ length: 10 }, () => uniformInt(s52, 52))).toEqual([51, 7, 51, 31, 4, 32, 24, 16, 18, 15]);
    const s3e9 = new HmacDrbgSource(GOLDEN_KEY, GOLDEN_LABEL);
    expect(Array.from({ length: 10 }, () => uniformInt(s3e9, 3e9))).toEqual([
      817883351, 1716366235, 739160452, 1210778172, 1073696388, 2059518412, 1402597838, 502888895, 1751638337,
      1165535938,
    ]);
  });
});
