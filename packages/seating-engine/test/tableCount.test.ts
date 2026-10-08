import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { TableSizeConfig } from '@jpb/shared-types';
import { assertTableSizeConfig, computeTableCount, distributeSizes } from '../src';
import { DEFAULT_TABLE_CFG } from './fixtures';

function maxOf(xs: readonly number[]): number {
  let m = -Infinity;
  for (const x of xs) if (x > m) m = x;
  return m;
}

function minOf(xs: readonly number[]): number {
  let m = Infinity;
  for (const x of xs) if (x < m) m = x;
  return m;
}

function summarize(sizes: number[]): string {
  const counts = new Map<number, number>();
  for (const s of sizes) counts.set(s, (counts.get(s) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([size, n]) => `${size}x${n}`)
    .join(' + ');
}

describe('computeTableCount (TARGET, target 8 / max 9 / min 2 / final 9)', () => {
  const cases: Array<[number, number, string]> = [
    [2, 1, '2x1'],
    [5, 1, '5x1'],
    [9, 1, '9x1'],
    [10, 2, '5x2'],
    [16, 2, '8x2'],
    [17, 3, '6x2 + 5x1'],
    [24, 3, '8x3'],
    [100, 13, '8x9 + 7x4'],
    [1_000, 125, '8x125'],
    [10_000, 1_250, '8x1250'],
    [100_000, 12_500, '8x12500'],
    [1_000_000, 125_000, '8x125000'],
  ];
  it.each(cases)('%i players -> %i tables (%s)', (players, tables, shape) => {
    const count = computeTableCount(players, DEFAULT_TABLE_CFG, 'TARGET');
    expect(count).toBe(tables);
    const sizes = distributeSizes(players, count, DEFAULT_TABLE_CFG.maxSize);
    expect(summarize(sizes)).toBe(shape);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(players);
  });

  it('0 and 1 players need one table', () => {
    expect(computeTableCount(0, DEFAULT_TABLE_CFG, 'TARGET')).toBe(1);
    expect(computeTableCount(1, DEFAULT_TABLE_CFG, 'TARGET')).toBe(1);
  });
});

describe('computeTableCount (MAX)', () => {
  it('sizes by maxSize', () => {
    expect(computeTableCount(100, DEFAULT_TABLE_CFG, 'MAX')).toBe(12);
    expect(summarize(distributeSizes(100, 12, 9))).toBe('9x4 + 8x8');
    expect(computeTableCount(18, DEFAULT_TABLE_CFG, 'MAX')).toBe(2);
    expect(computeTableCount(19, DEFAULT_TABLE_CFG, 'MAX')).toBe(3);
    expect(computeTableCount(1_000_000, DEFAULT_TABLE_CFG, 'MAX')).toBe(111_112);
  });
});

describe('computeTableCount precedence rules', () => {
  it('never consolidates to one table above finalTableSize', () => {
    const cfg: TableSizeConfig = { targetSize: 9, maxSize: 9, minSize: 2, finalTableSize: 6 };
    expect(computeTableCount(7, cfg, 'TARGET')).toBe(2);
  });

  it('honours minSize when maxSize allows it (soft lower bound)', () => {
    const cfg: TableSizeConfig = { targetSize: 8, maxSize: 9, minSize: 6, finalTableSize: 9 };
    // ceil(17/8) = 3 tables would give 6,6,5 (< minSize); 2 tables (9,8) fit under maxSize.
    expect(computeTableCount(17, cfg, 'TARGET')).toBe(2);
  });

  it('maxSize wins over minSize when both cannot hold', () => {
    const cfg: TableSizeConfig = { targetSize: 6, maxSize: 6, minSize: 6, finalTableSize: 6 };
    // 13 players: floor(13/6) = 2 tables would need 7 seats; maxSize forces 3 tables (5,4,4).
    expect(computeTableCount(13, cfg, 'TARGET')).toBe(3);
  });

  it('rejects invalid inputs', () => {
    expect(() => computeTableCount(-1, DEFAULT_TABLE_CFG, 'TARGET')).toThrow(RangeError);
    expect(() => computeTableCount(1.5, DEFAULT_TABLE_CFG, 'TARGET')).toThrow(RangeError);
    expect(() => computeTableCount(Number.NaN, DEFAULT_TABLE_CFG, 'TARGET')).toThrow(RangeError);
    expect(() => assertTableSizeConfig({ ...DEFAULT_TABLE_CFG, targetSize: 10 })).toThrow(RangeError);
    expect(() => assertTableSizeConfig({ ...DEFAULT_TABLE_CFG, maxSize: 11, targetSize: 8 })).toThrow(RangeError);
    expect(() => assertTableSizeConfig({ ...DEFAULT_TABLE_CFG, finalTableSize: 10 })).toThrow(RangeError);
    expect(() => assertTableSizeConfig({ ...DEFAULT_TABLE_CFG, minSize: 0 })).toThrow(RangeError);
    expect(() => assertTableSizeConfig({ ...DEFAULT_TABLE_CFG, targetSize: 7.5 })).toThrow(RangeError);
  });
});

describe('distributeSizes', () => {
  it('is balanced and descending', () => {
    expect(distributeSizes(29, 4, 9)).toEqual([8, 7, 7, 7]);
    expect(distributeSizes(0, 3, 9)).toEqual([0, 0, 0]);
    expect(distributeSizes(0, 0, 9)).toEqual([]);
  });

  it('throws when impossible', () => {
    expect(() => distributeSizes(19, 2, 9)).toThrow(RangeError);
    expect(() => distributeSizes(1, 0, 9)).toThrow(RangeError);
    expect(() => distributeSizes(-1, 2, 9)).toThrow(RangeError);
    expect(() => distributeSizes(5, 2, 0)).toThrow(RangeError);
    expect(() => distributeSizes(5, 2.5, 9)).toThrow(RangeError);
  });
});

const cfgArb = fc
  .record({
    maxSize: fc.integer({ min: 2, max: 10 }),
    targetFrac: fc.double({ min: 0, max: 1, noNaN: true }),
    minFrac: fc.double({ min: 0, max: 1, noNaN: true }),
    finalFrac: fc.double({ min: 0, max: 1, noNaN: true }),
  })
  .map(({ maxSize, targetFrac, minFrac, finalFrac }): TableSizeConfig => {
    const targetSize = 1 + Math.floor(targetFrac * (maxSize - 1));
    return {
      maxSize,
      targetSize,
      minSize: 1 + Math.floor(minFrac * (targetSize - 1)),
      finalTableSize: 1 + Math.floor(finalFrac * (maxSize - 1)),
    };
  });

describe('distribution properties (fast-check)', () => {
  it('default config: sum preserved, max-min <= 1, within [minSize, targetSize], T minimal, N up to 1,000,000', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), (n) => {
        const t = computeTableCount(n, DEFAULT_TABLE_CFG, 'TARGET');
        const sizes = distributeSizes(n, t, DEFAULT_TABLE_CFG.maxSize);
        expect(sizes.length).toBe(t);
        expect(sizes.reduce((a, b) => a + b, 0)).toBe(n);
        const max = maxOf(sizes);
        const min = minOf(sizes);
        expect(max - min).toBeLessThanOrEqual(1);
        if (n > DEFAULT_TABLE_CFG.finalTableSize) {
          expect(t).toBeGreaterThanOrEqual(2);
          expect(max).toBeLessThanOrEqual(DEFAULT_TABLE_CFG.targetSize);
          expect(min).toBeGreaterThanOrEqual(DEFAULT_TABLE_CFG.minSize);
          // Minimality: one table fewer would push some table above targetSize (or below the 2-table floor).
          if (t > 2) expect(Math.ceil(n / (t - 1))).toBeGreaterThan(DEFAULT_TABLE_CFG.targetSize);
        } else {
          expect(t).toBe(1);
        }
        let descending = true;
        for (let i = 1; i < sizes.length; i += 1) if ((sizes[i] as number) > (sizes[i - 1] as number)) descending = false;
        expect(descending).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('any valid config and mode: sizes never exceed maxSize and respect minSize whenever feasible', () => {
    fc.assert(
      fc.property(cfgArb, fc.integer({ min: 0, max: 200_000 }), fc.constantFrom('TARGET' as const, 'MAX' as const), (cfg, n, mode) => {
        const t = computeTableCount(n, cfg, mode);
        const sizes = distributeSizes(n, t, cfg.maxSize);
        expect(sizes.reduce((a, b) => a + b, 0)).toBe(n);
        expect(maxOf(sizes) - minOf(sizes)).toBeLessThanOrEqual(1);
        expect(maxOf(sizes)).toBeLessThanOrEqual(cfg.maxSize);
        if (n <= cfg.finalTableSize) {
          expect(t).toBe(1);
          return;
        }
        expect(t).toBeGreaterThanOrEqual(2);
        const feasible = Math.max(2, Math.ceil(n / cfg.maxSize)) <= Math.floor(n / cfg.minSize);
        if (feasible) expect(minOf(sizes)).toBeGreaterThanOrEqual(cfg.minSize);
        const divisor = mode === 'TARGET' ? cfg.targetSize : cfg.maxSize;
        expect(t).toBeLessThanOrEqual(Math.max(2, Math.ceil(n / divisor)));
      }),
      { numRuns: 500 },
    );
  });
});
