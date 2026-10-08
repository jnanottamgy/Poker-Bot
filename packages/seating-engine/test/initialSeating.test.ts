import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { computeTableCount, distributeSizes, initialSeating, spreadSeats } from '../src';
import type { InitialSeatingResult } from '../src';
import { DEFAULT_TABLE_CFG, scriptedRng, testRng } from './fixtures';

function ids(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `player-${String(i).padStart(7, '0')}`);
}

function assertValid(result: InitialSeatingResult, playerIds: readonly string[]): void {
  const n = playerIds.length;
  const tableCount = computeTableCount(n, DEFAULT_TABLE_CFG, 'TARGET');
  expect(result.tables.length).toBe(tableCount);
  const expectedSizes = distributeSizes(n, tableCount, DEFAULT_TABLE_CFG.maxSize);
  const seen = new Set<string>();
  result.tables.forEach((table, i) => {
    expect(table.tableNumber).toBe(i + 1);
    expect(table.maxSeats).toBe(DEFAULT_TABLE_CFG.maxSize);
    expect(table.seats.length).toBe(expectedSizes[i]);
    expect(table.seats.map((s) => s.seat)).toEqual(spreadSeats(table.seats.length, table.maxSeats));
    expect(new Set(table.seats.map((s) => s.seat)).size).toBe(table.seats.length);
    expect(table.seats.map((s) => s.seat)).toContain(table.buttonSeat);
    for (const s of table.seats) {
      expect(seen.has(s.playerId)).toBe(false);
      seen.add(s.playerId);
    }
  });
  expect(seen.size).toBe(n);
  for (const id of playerIds) expect(seen.has(id)).toBe(true);
}

describe('initialSeating', () => {
  it('seats 100 players at 13 balanced tables (8x9 + 7x4)', () => {
    const playerIds = ids(100);
    const result = initialSeating({ playerIds, cfg: DEFAULT_TABLE_CFG, consolidateBy: 'TARGET', rng: testRng(7) });
    assertValid(result, playerIds);
    expect(result.tables.map((t) => t.seats.length)).toEqual([8, 8, 8, 8, 8, 8, 8, 8, 8, 7, 7, 7, 7]);
  });

  it('is fully deterministic given the rng, and independent of input order', () => {
    const playerIds = ids(50);
    const a = initialSeating({ playerIds, cfg: DEFAULT_TABLE_CFG, consolidateBy: 'TARGET', rng: testRng(99) });
    const b = initialSeating({ playerIds: playerIds.slice().reverse(), cfg: DEFAULT_TABLE_CFG, consolidateBy: 'TARGET', rng: testRng(99) });
    expect(b).toEqual(a);
    const c = initialSeating({ playerIds, cfg: DEFAULT_TABLE_CFG, consolidateBy: 'TARGET', rng: testRng(100) });
    expect(c).not.toEqual(a);
  });

  it('consumes exactly n-1 shuffle draws then one button draw per table (when no rejection happens)', () => {
    // Small values are never rejected: limit >= 2^32 - n for every n used here.
    const n = 20; // 3 tables (7, 7, 6)
    const tables = computeTableCount(n, DEFAULT_TABLE_CFG, 'TARGET');
    const rng = scriptedRng(new Array(n - 1 + tables).fill(0));
    const result = initialSeating({ playerIds: ids(n), cfg: DEFAULT_TABLE_CFG, consolidateBy: 'TARGET', rng });
    expect(rng.consumed()).toBe(n - 1 + tables);
    // All-zero draws: j = 0 at every step, so the button is the lowest occupied seat.
    for (const t of result.tables) expect(t.buttonSeat).toBe(0);
  });

  it('documents the exact draw for a tiny field', () => {
    // ids sorted: [a, b, c]; i=2: j = 5 % 3 = 2 (no swap); i=1: j = 1 % 2 = 1 (no swap) -> order a, b, c
    // one table of 3 at seats spreadSeats(3, 9) = [0, 3, 6]; button draw 4 % 3 = 1 -> seat 3
    const rng = scriptedRng([5, 1, 4]);
    const result = initialSeating({ playerIds: ['c', 'a', 'b'], cfg: DEFAULT_TABLE_CFG, consolidateBy: 'TARGET', rng });
    expect(result).toEqual({
      tables: [
        {
          tableNumber: 1,
          maxSeats: 9,
          seats: [
            { seat: 0, playerId: 'a' },
            { seat: 3, playerId: 'b' },
            { seat: 6, playerId: 'c' },
          ],
          buttonSeat: 3,
        },
      ],
    });
  });

  it('draws buttons from buttonSource(tableNumber) when provided', () => {
    const playerIds = ids(30);
    const requested: number[] = [];
    const result = initialSeating({
      playerIds,
      cfg: DEFAULT_TABLE_CFG,
      consolidateBy: 'TARGET',
      rng: testRng(5),
      buttonSource: (tableNumber) => {
        requested.push(tableNumber);
        return scriptedRng([tableNumber]);
      },
    });
    expect(requested).toEqual([1, 2, 3, 4]);
    for (const t of result.tables) {
      const occupied = t.seats.map((s) => s.seat);
      expect(t.buttonSeat).toBe(occupied[t.tableNumber % occupied.length]);
    }
    // The seating itself is identical to the run without buttonSource.
    const plain = initialSeating({ playerIds, cfg: DEFAULT_TABLE_CFG, consolidateBy: 'TARGET', rng: testRng(5) });
    expect(result.tables.map((t) => t.seats)).toEqual(plain.tables.map((t) => t.seats));
  });

  it('rejects empty and duplicate player lists', () => {
    expect(() => initialSeating({ playerIds: [], cfg: DEFAULT_TABLE_CFG, consolidateBy: 'TARGET', rng: testRng(1) })).toThrow(RangeError);
    expect(() => initialSeating({ playerIds: ['a', 'b', 'a'], cfg: DEFAULT_TABLE_CFG, consolidateBy: 'TARGET', rng: testRng(1) })).toThrow(
      RangeError,
    );
  });

  it('every player seated exactly once, no collisions, balanced sizes (fast-check)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1500 }), fc.integer(), (n, seed) => {
        const playerIds = ids(n);
        assertValid(initialSeating({ playerIds, cfg: DEFAULT_TABLE_CFG, consolidateBy: 'TARGET', rng: testRng(seed) }), playerIds);
      }),
      { numRuns: 60 },
    );
  });

  it('seats 10,000 players quickly', () => {
    const playerIds = ids(10_000);
    const started = performance.now();
    const result = initialSeating({ playerIds, cfg: DEFAULT_TABLE_CFG, consolidateBy: 'TARGET', rng: testRng(3) });
    expect(performance.now() - started).toBeLessThan(2_000);
    assertValid(result, playerIds);
  });

  it('table assignment is unbiased (smoke test: each player equally likely at table 1)', () => {
    const playerIds = ids(18); // 3 tables of 6
    const atTableOne = new Map<string, number>();
    const trials = 3_000;
    for (let s = 0; s < trials; s += 1) {
      const result = initialSeating({ playerIds, cfg: DEFAULT_TABLE_CFG, consolidateBy: 'TARGET', rng: testRng(s * 7919 + 1) });
      for (const seat of result.tables[0]?.seats ?? []) atTableOne.set(seat.playerId, (atTableOne.get(seat.playerId) ?? 0) + 1);
    }
    const expected = trials / 3;
    let chi = 0;
    for (const id of playerIds) chi += ((atTableOne.get(id) ?? 0) - expected) ** 2 / expected;
    // 17 degrees of freedom: p = 0.001 critical value is 40.8.
    expect(chi).toBeLessThan(40.8);
  });
});
