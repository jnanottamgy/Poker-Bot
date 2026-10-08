import { CANONICAL_DECK } from '@jpb/shared-types';
import { describe, expect, it } from 'vitest';
import { cardsNeeded, clockwiseFrom, dealFromDeck, dealPlan, dealingSeatOrder, distributePots, splitPot } from '../src';
import type { Pot } from '../src';

const pot = (index: number, amount: number, eligibleSeats: number[]): Pot => ({
  index,
  type: index === 0 ? 'MAIN' : 'SIDE',
  amount,
  eligibleSeats,
  contributorSeats: eligibleSeats,
});

describe('splitPot (odd-chip rule 13)', () => {
  it('even split has no odd chips', () => {
    expect(splitPot(300, [2, 5], 0, 9)).toEqual([
      { seat: 2, amount: 150, oddChips: 0 },
      { seat: 5, amount: 150, oddChips: 0 },
    ]);
  });
  it('3-way split of an odd pot: one chip each, clockwise from the first seat after the button', () => {
    // 301 / 3 = 100 r1. Button 4: order is 6, 1, 3.
    expect(splitPot(301, [1, 3, 6], 4, 9)).toEqual([
      { seat: 6, amount: 101, oddChips: 1 },
      { seat: 1, amount: 100, oddChips: 0 },
      { seat: 3, amount: 100, oddChips: 0 },
    ]);
    // 302 / 3 = 100 r2.
    expect(splitPot(302, [1, 3, 6], 4, 9).map((s) => s.amount)).toEqual([101, 101, 100]);
  });
  it('the button seat itself is last in odd-chip order', () => {
    expect(splitPot(101, [3, 7], 3, 9).map((s) => [s.seat, s.amount])).toEqual([
      [7, 51],
      [3, 50],
    ]);
  });
  it('works with a dead (empty) button seat', () => {
    expect(splitPot(5, [0, 8], 5, 9).map((s) => [s.seat, s.amount])).toEqual([
      [8, 3],
      [0, 2],
    ]);
  });
  it('is deterministic and conserves chips', () => {
    for (let amount = 0; amount < 50; amount++) {
      const a = splitPot(amount, [0, 2, 4, 6], 3, 10);
      expect(a).toEqual(splitPot(amount, [6, 4, 2, 0], 3, 10));
      expect(a.reduce((s, x) => s + x.amount, 0)).toBe(amount);
      expect(Math.max(...a.map((x) => x.amount)) - Math.min(...a.map((x) => x.amount))).toBeLessThanOrEqual(1);
    }
  });
});

describe('distributePots', () => {
  it('awards from the last side pot to the main pot; best hand per pot', () => {
    const r = distributePots({
      pots: [pot(0, 300, [0, 1, 2]), pot(1, 400, [1, 2])],
      scores: [
        { seat: 0, score: 900 },
        { seat: 1, score: 500 },
        { seat: 2, score: 700 },
      ],
      buttonSeat: 0,
      maxSeats: 9,
    });
    expect(r.map((d) => [d.potIndex, d.winnerSeats])).toEqual([
      [1, [2]],
      [0, [0]],
    ]);
  });
  it('tied side pot is split while the main pot goes to the short stack', () => {
    const r = distributePots({
      pots: [pot(0, 301, [0, 1, 2]), pot(1, 401, [1, 2])],
      scores: [
        { seat: 0, score: 900 },
        { seat: 1, score: 700 },
        { seat: 2, score: 700 },
      ],
      buttonSeat: 1,
      maxSeats: 3,
    });
    expect(r[0]?.shares).toEqual([
      { seat: 2, amount: 201, oddChips: 1 },
      { seat: 1, amount: 200, oddChips: 0 },
    ]);
    expect(r[1]?.shares).toEqual([{ seat: 0, amount: 301, oddChips: 0 }]);
  });
  it('uncontested pot needs no score', () => {
    const r = distributePots({ pots: [pot(0, 150, [4])], scores: [], buttonSeat: 0, maxSeats: 9 });
    expect(r[0]?.shares).toEqual([{ seat: 4, amount: 150, oddChips: 0 }]);
  });
  it('throws when a contested pot lacks a score (programmer error)', () => {
    expect(() =>
      distributePots({ pots: [pot(0, 150, [1, 2])], scores: [{ seat: 1, score: 1 }], buttonSeat: 0, maxSeats: 9 }),
    ).toThrow();
  });
});

describe('dealing order', () => {
  it('starts with the first seat after the button and wraps', () => {
    expect(dealingSeatOrder([0, 2, 5, 7], 5, 9)).toEqual([7, 0, 2, 5]);
    expect(clockwiseFrom([0, 2, 5, 7], 5, 9)).toEqual([7, 0, 2, 5]);
  });
  it('dead button: starts with the first occupied seat after the empty button seat', () => {
    expect(dealingSeatOrder([0, 2, 7], 5, 9)).toEqual([7, 0, 2]);
  });
  it('plan: one card each round, then burn/flop, burn/turn, burn/river', () => {
    const plan = dealPlan([1, 3, 6], 3, 9);
    expect(plan.seatOrder).toEqual([6, 1, 3]);
    expect(plan.holeCards).toEqual([
      { seat: 6, deckIndices: [0, 3] },
      { seat: 1, deckIndices: [1, 4] },
      { seat: 3, deckIndices: [2, 5] },
    ]);
    expect(plan.burns).toEqual([6, 10, 12]);
    expect(plan.flop).toEqual([7, 8, 9]);
    expect(plan.turn).toBe(11);
    expect(plan.river).toBe(13);
    expect(cardsNeeded(3)).toBe(14);
  });
  it('dealFromDeck maps the plan onto a deck', () => {
    const d = dealFromDeck(CANONICAL_DECK, [0, 1], 0, 2);
    // Order: seat 1 first, then seat 0.
    expect(d.holeCards).toEqual([
      { seat: 1, cards: ['2c', '4c'] },
      { seat: 0, cards: ['3c', '5c'] },
    ]);
    expect(d.burns).toEqual(['6c', 'Tc', 'Qc']);
    expect(d.board).toEqual(['7c', '8c', '9c', 'Jc', 'Kc']);
    expect(() => dealFromDeck(CANONICAL_DECK.slice(0, 10), [0, 1], 0, 2)).toThrow(RangeError);
  });
});
