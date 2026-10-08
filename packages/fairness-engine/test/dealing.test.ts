import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CardCode, SeatIndex } from '@jpb/shared-types';
import { cardsNeeded, dealingOrder, dealPositions, expectedDeal } from '../src';
import { tableConfig } from './arbitraries';
import { GOLDEN } from './fixtures';

describe('dealingOrder', () => {
  it('starts with the first seat clockwise after the button; an occupied button seat is dealt last', () => {
    expect(dealingOrder([0, 2, 3, 5], 3, 6)).toEqual([5, 0, 2, 3]);
    expect(dealingOrder([0, 1, 2], 0, 9)).toEqual([1, 2, 0]);
    expect(dealingOrder([8, 0, 4], 8, 9)).toEqual([0, 4, 8]);
  });

  it('works with a dead (empty) button seat', () => {
    expect(dealingOrder([0, 2, 5], 4, 6)).toEqual([5, 0, 2]);
    expect(dealingOrder([1, 3], 2, 9)).toEqual([3, 1]);
  });

  it('heads-up: the button is dealt second', () => {
    expect(dealingOrder([2, 7], 2, 9)).toEqual([7, 2]);
    expect(dealingOrder([2, 7], 7, 9)).toEqual([2, 7]);
  });

  it('does not depend on input order and does not mutate the input', () => {
    fc.assert(
      fc.property(tableConfig, ({ seats, buttonSeat, maxSeats }) => {
        const copy = seats.slice();
        const order = dealingOrder(seats, buttonSeat, maxSeats);
        expect(seats).toEqual(copy);
        expect(dealingOrder(seats.slice().reverse(), buttonSeat, maxSeats)).toEqual(order);
        expect(order.slice().sort((a, b) => a - b)).toEqual(seats.slice().sort((a, b) => a - b));
        // Clockwise walk from the button visits the seats in exactly this order.
        const walk: SeatIndex[] = [];
        for (let step = 1; step <= maxSeats; step += 1) {
          const s = (buttonSeat + step) % maxSeats;
          if (seats.includes(s)) walk.push(s);
        }
        expect(order).toEqual(walk);
      }),
      { numRuns: 500 },
    );
  });

  it('rejects invalid seats, buttons and table sizes', () => {
    expect(() => dealingOrder([0, 6], 0, 6)).toThrow(RangeError);
    expect(() => dealingOrder([0, -1], 0, 6)).toThrow(RangeError);
    expect(() => dealingOrder([0, 1.5], 0, 6)).toThrow(RangeError);
    expect(() => dealingOrder([0, 0], 0, 6)).toThrow(RangeError);
    expect(() => dealingOrder([0, 1], 6, 6)).toThrow(RangeError);
    expect(() => dealingOrder([0, 1], 0, 0)).toThrow(RangeError);
  });
});

describe('expectedDeal / dealPositions', () => {
  it('golden hand: 4 seats, button on seat 3', () => {
    const deal = expectedDeal(GOLDEN.deck, [5, 0, 2, 3]);
    expect(deal.holeCards).toEqual(GOLDEN.holeCards.map((h) => ({ seat: h.seat, cards: h.cards })));
    expect(deal.burns).toEqual(GOLDEN.burns);
    expect(deal.board).toEqual(GOLDEN.board);
  });

  it('normative positions: hole k = [k, N+k]; burn 2N; flop 2N+1..2N+3; burn 2N+4; turn 2N+5; burn 2N+6; river 2N+7', () => {
    for (let n = 1; n <= 22; n += 1) {
      const p = dealPositions(n);
      expect(p.holeCards).toEqual(Array.from({ length: n }, (_, k) => [k, n + k]));
      expect(p.burns).toEqual([2 * n, 2 * n + 4, 2 * n + 6]);
      expect(p.board).toEqual([2 * n + 1, 2 * n + 2, 2 * n + 3, 2 * n + 5, 2 * n + 7]);
      const all = [...p.holeCards.flat(), ...p.burns, ...p.board].sort((a, b) => a - b);
      expect(all).toEqual(Array.from({ length: cardsNeeded(n) }, (_, i) => i));
    }
  });

  it('every card of a full deal is distinct and comes from the top of the deck', () => {
    fc.assert(
      fc.property(tableConfig, ({ seats, buttonSeat, maxSeats }) => {
        const deck = Array.from({ length: 52 }, (_, i) => `c${i}` as unknown as CardCode);
        const deal = expectedDeal(deck, dealingOrder(seats, buttonSeat, maxSeats));
        const used = [...deal.holeCards.flatMap((h) => h.cards), ...deal.burns, ...deal.board];
        expect(new Set(used).size).toBe(used.length);
        expect(used.slice().sort()).toEqual(deck.slice(0, cardsNeeded(seats.length)).sort());
      }),
    );
  });

  it('rejects impossible deals', () => {
    expect(() => expectedDeal(GOLDEN.deck, [])).toThrow(RangeError);
    expect(() => expectedDeal(GOLDEN.deck, [1, 1])).toThrow(RangeError);
    expect(() => expectedDeal(GOLDEN.deck.slice(0, 11), [0, 1])).toThrow(RangeError);
    expect(() =>
      expectedDeal(
        GOLDEN.deck,
        Array.from({ length: 23 }, (_, i) => i),
      ),
    ).toThrow(RangeError);
    expect(() => dealPositions(0)).toThrow(RangeError);
  });
});

/**
 * The poker engine must deal in exactly this order. Its package is built
 * concurrently and is not a dependency of this one, so it is loaded
 * dynamically and the cross-check is skipped if it is unavailable.
 */
interface PokerDealing {
  dealFromDeck(
    deck: readonly CardCode[],
    seats: readonly SeatIndex[],
    buttonSeat: SeatIndex,
    maxSeats: number,
  ): { holeCards: Array<{ seat: SeatIndex; cards: [CardCode, CardCode] }>; burns: CardCode[]; board: CardCode[] };
}
const POKER_ENGINE = '@jpb/poker-engine';
const poker = (await import(/* @vite-ignore */ POKER_ENGINE).catch(() => null)) as Partial<PokerDealing> | null;

describe.skipIf(typeof poker?.dealFromDeck !== 'function')('cross-check with @jpb/poker-engine dealFromDeck', () => {
  it('identical hole cards, burns and board for random tables', () => {
    const dealFromDeck = (poker as PokerDealing).dealFromDeck;
    fc.assert(
      fc.property(tableConfig, ({ seats, buttonSeat, maxSeats }) => {
        const ours = expectedDeal(GOLDEN.deck, dealingOrder(seats, buttonSeat, maxSeats));
        const theirs = dealFromDeck(GOLDEN.deck, seats, buttonSeat, maxSeats);
        expect(theirs.holeCards).toEqual(ours.holeCards);
        expect(theirs.burns).toEqual(ours.burns);
        expect(theirs.board).toEqual(ours.board);
      }),
      { numRuns: 500 },
    );
  });
});
