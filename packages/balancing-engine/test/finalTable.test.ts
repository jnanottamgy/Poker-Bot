import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { spreadSeats } from '@jpb/seating-engine';
import { planFinalTable } from '../src';
import { scriptedRng, testRng } from './fixtures';

const players = (n: number) => Array.from({ length: n }, (_, i) => ({ playerId: `p${i}`, stack: 1000 + i }));

describe('planFinalTable', () => {
  it('nine players fill seats 0..8, button on an occupied seat', () => {
    const plan = planFinalTable({ players: players(9), maxSeats: 9, rng: testRng(1) });
    expect(plan.seats.map((s) => s.seat)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(plan.seats.map((s) => s.playerId)).size).toBe(9);
    expect(plan.seats.map((s) => s.seat)).toContain(plan.buttonSeat);
  });

  it('documents the exact draw', () => {
    // ids sorted [p0, p1, p2]; i=2: j = 0 % 3 = 0 -> [p2, p1, p0]; i=1: j = 1 % 2 = 1 -> no swap
    // seats spreadSeats(3, 9) = [0, 3, 6]; button: 5 % 3 = 2 -> seat 6
    const rng = scriptedRng([0, 1, 5]);
    expect(planFinalTable({ players: players(3), maxSeats: 9, rng })).toEqual({
      seats: [
        { playerId: 'p2', seat: 0 },
        { playerId: 'p1', seat: 3 },
        { playerId: 'p0', seat: 6 },
      ],
      buttonSeat: 6,
    });
    expect(rng.consumed()).toBe(3);
  });

  it('is deterministic and independent of input order; stacks do not matter', () => {
    const a = planFinalTable({ players: players(7), maxSeats: 9, rng: testRng(42) });
    const shuffledInput = players(7)
      .reverse()
      .map((p) => ({ ...p, stack: 1 }));
    expect(planFinalTable({ players: shuffledInput, maxSeats: 9, rng: testRng(42) })).toEqual(a);
    expect(planFinalTable({ players: players(7), maxSeats: 9, rng: testRng(43) })).not.toEqual(a);
  });

  it('rejects invalid input', () => {
    expect(() => planFinalTable({ players: [], maxSeats: 9, rng: testRng(1) })).toThrow(RangeError);
    expect(() => planFinalTable({ players: players(10), maxSeats: 9, rng: testRng(1) })).toThrow(RangeError);
    expect(() => planFinalTable({ players: [...players(2), { playerId: 'p0', stack: 5 }], maxSeats: 9, rng: testRng(1) })).toThrow(RangeError);
    expect(() => planFinalTable({ players: [{ playerId: 'x', stack: 0 }], maxSeats: 9, rng: testRng(1) })).toThrow(RangeError);
  });

  it('valid for any field size (fast-check)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 10 }).chain((m) => fc.tuple(fc.constant(m), fc.integer({ min: 1, max: m }))), fc.integer(), ([maxSeats, n], seed) => {
        const plan = planFinalTable({ players: players(n), maxSeats, rng: testRng(seed) });
        expect(plan.seats.map((s) => s.seat)).toEqual(spreadSeats(n, maxSeats));
        expect(new Set(plan.seats.map((s) => s.playerId)).size).toBe(n);
        expect(plan.seats.map((s) => s.seat)).toContain(plan.buttonSeat);
      }),
    );
  });

  it('seat draw is unbiased (smoke test: who gets seat 0)', () => {
    const counts = new Map<string, number>();
    const trials = 9_000;
    for (let s = 0; s < trials; s += 1) {
      const plan = planFinalTable({ players: players(9), maxSeats: 9, rng: testRng(s + 1) });
      const at0 = plan.seats[0]?.playerId as string;
      counts.set(at0, (counts.get(at0) ?? 0) + 1);
    }
    const expected = trials / 9;
    let chi = 0;
    for (let i = 0; i < 9; i += 1) chi += ((counts.get(`p${i}`) ?? 0) - expected) ** 2 / expected;
    expect(chi).toBeLessThan(26.1); // 8 dof, p = 0.001
  });
});
