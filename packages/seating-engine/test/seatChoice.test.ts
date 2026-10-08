import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  adjacencyPenalty,
  checkTableSummary,
  chooseSeatForIncoming,
  expectedHandsUntilBigBlind,
  freeSeats,
  handsUntilBigBlind,
  nextHandParticipants,
  participantsWith,
  planningBlindState,
  scoreSeatsForIncoming,
  skipPenalty,
} from '../src';
import { EQUAL_WEIGHTS, makeTable, stats } from './fixtures';

const BLIND_ONLY = { position: 0, blindFairness: 1, recentMove: 0, seatCompatibility: 0 };

describe('expectedHandsUntilBigBlind', () => {
  it('= max(0, orbit - 1 - handsSinceBigBlind)', () => {
    expect(expectedHandsUntilBigBlind(0, 5)).toBe(4);
    expect(expectedHandsUntilBigBlind(3, 5)).toBe(1);
    expect(expectedHandsUntilBigBlind(4, 5)).toBe(0);
    expect(expectedHandsUntilBigBlind(40, 5)).toBe(0);
  });
});

describe('skipPenalty', () => {
  const t = makeTable({ seats: [0, 2, 4, 6], lastSB: 0, lastBB: 2 });
  const state = planningBlindState(t);

  it('is 1 strictly between the next button (last SB) and the next SB (last BB)', () => {
    expect(skipPenalty(state, participantsWith(t, 1), 1)).toBe(1);
    for (const seat of [3, 5, 7, 8]) expect(skipPenalty(state, participantsWith(t, seat), seat)).toBe(0);
  });

  it('is 0 before the first hand and when the next hand is heads-up', () => {
    const first = makeTable({ seats: [0, 2, 4, 6], button: 0 });
    expect(skipPenalty(planningBlindState(first), participantsWith(first, 1), 1)).toBe(0);
    const lonely = makeTable({ seats: [0], lastSB: 7, lastBB: 0 });
    expect(skipPenalty(planningBlindState(lonely), participantsWith(lonely, 8), 8)).toBe(0);
  });

  it('covers the whole arc when the button is dead', () => {
    const t2 = makeTable({ seats: [0, 6, 7], lastSB: 2, lastBB: 5, maxSeats: 9 });
    // next button 2 (empty), next SB 5 (empty, dead SB): seats 3 and 4 are strictly between.
    const st = planningBlindState(t2);
    expect([1, 3, 4, 8].map((s) => skipPenalty(st, participantsWith(t2, s), s))).toEqual([0, 1, 1, 0]);
  });
});

describe('adjacencyPenalty', () => {
  it('is the occupied fraction of distinct neighbours', () => {
    expect(adjacencyPenalty([0, 2], 1, 9)).toBe(1);
    expect(adjacencyPenalty([0], 1, 9)).toBe(0.5);
    expect(adjacencyPenalty([5], 1, 9)).toBe(0);
    expect(adjacencyPenalty([8], 0, 9)).toBe(0.5); // wraps
    expect(adjacencyPenalty([1], 0, 2)).toBe(1); // both neighbours are seat 1
    expect(adjacencyPenalty([], 0, 1)).toBe(0);
  });
});

describe('chooseSeatForIncoming (worked example: seats 0,2,4,6 of 9, last SB 0, last BB 2)', () => {
  const t = makeTable({ seats: [0, 2, 4, 6], lastSB: 0, lastBB: 2 });

  it('a player due the big blind is seated to post it next hand', () => {
    const choice = chooseSeatForIncoming(t, { playerId: 'due', stats: stats({ handsSinceBigBlind: 20 }) }, EQUAL_WEIGHTS);
    expect(choice.seat).toBe(3);
    expect(handsUntilBigBlind(t, 3)).toBe(0);
    expect(choice.breakdown).toMatchObject({
      handsUntilBigBlind: 0,
      expectedHandsUntilBigBlind: 0,
      blindFairnessDeviation: 0,
      skipPenalty: 0,
      adjacencyPenalty: 1,
      score: 1,
    });
  });

  it('a player who just posted the big blind is not put in the big blind (nor between button and SB)', () => {
    const choice = chooseSeatForIncoming(t, { playerId: 'fresh', stats: stats({ handsSinceBigBlind: 0 }) }, EQUAL_WEIGHTS);
    expect(choice.seat).toBe(7);
    expect(choice.breakdown).toMatchObject({ handsUntilBigBlind: 2, expectedHandsUntilBigBlind: 4, skipPenalty: 0, adjacencyPenalty: 0.5, score: 2.5 });
    const scores = Object.fromEntries(scoreSeatsForIncoming(t, { playerId: 'fresh', stats: stats() }, EQUAL_WEIGHTS).map((c) => [c.seat, c.score]));
    expect(scores).toEqual({ 1: 3, 3: 5, 5: 4, 7: 2.5, 8: 2.5 });
  });

  it('with only blind fairness weighted, the zero-skip rule can be overridden explicitly', () => {
    const choice = chooseSeatForIncoming(t, { playerId: 'fresh', stats: stats() }, BLIND_ONLY);
    expect(choice.seat).toBe(1);
  });

  it('score = blindFairnessTerm + positionTerm + seatCompatibilityTerm, sorted best first', () => {
    const weights = { position: 3, blindFairness: 2, recentMove: 0, seatCompatibility: 0.5 };
    const all = scoreSeatsForIncoming(t, { playerId: 'x', stats: stats({ handsSinceBigBlind: 2 }) }, weights);
    for (const c of all) {
      const b = c.breakdown;
      expect(b.blindFairnessTerm).toBe(2 * (b.blindFairnessDeviation as number));
      expect(b.positionTerm).toBe(3 * (b.skipPenalty as number));
      expect(b.seatCompatibilityTerm).toBe(0.5 * (b.adjacencyPenalty as number));
      expect(c.score).toBe((b.blindFairnessTerm as number) + (b.positionTerm as number) + (b.seatCompatibilityTerm as number));
    }
    for (let i = 1; i < all.length; i += 1) {
      const prev = all[i - 1] as (typeof all)[number];
      const cur = all[i] as (typeof all)[number];
      expect(prev.score < cur.score || (prev.score === cur.score && prev.seat < cur.seat)).toBe(true);
    }
  });

  it('ties go to the lowest seat', () => {
    const empty = makeTable({ seats: [], maxSeats: 6 });
    expect(chooseSeatForIncoming(empty, { playerId: 'x', stats: stats() }, EQUAL_WEIGHTS).seat).toBe(0);
  });
});

describe('seat availability', () => {
  it('never picks occupied, moving-out or reserved seats', () => {
    const t = makeTable({ seats: [0, 1, { seat: 2, movingOut: true }, 3], reserved: [4, 5], maxSeats: 7, lastSB: 0, lastBB: 1 });
    expect(freeSeats(t)).toEqual([6]);
    expect(chooseSeatForIncoming(t, { playerId: 'x', stats: stats() }, EQUAL_WEIGHTS).seat).toBe(6);
  });

  it('throws on a full table', () => {
    const t = makeTable({ seats: [0, 1, 2], reserved: [3], maxSeats: 4 });
    expect(() => chooseSeatForIncoming(t, { playerId: 'x', stats: stats() }, EQUAL_WEIGHTS)).toThrow(/no free seat/);
  });

  it('rejects invalid weights', () => {
    const t = makeTable({ seats: [0] });
    const bad = [{ ...EQUAL_WEIGHTS, position: -1 }, { ...EQUAL_WEIGHTS, blindFairness: Number.NaN }, { ...EQUAL_WEIGHTS, seatCompatibility: Infinity }];
    for (const w of bad) expect(() => chooseSeatForIncoming(t, { playerId: 'x', stats: stats() }, w)).toThrow(RangeError);
  });
});

describe('in-hand destination', () => {
  it('targets the hand after the current one', () => {
    // Current hand: BB 4. The next hand's BB is the first participant after 4.
    const t = makeTable({ seats: [0, 2, 4, 6], lastSB: 0, lastBB: 2, inHand: true });
    const choice = chooseSeatForIncoming(t, { playerId: 'due', stats: stats({ handsSinceBigBlind: 30 }) }, EQUAL_WEIGHTS);
    expect(choice.seat).toBe(5);
    expect(choice.breakdown.handsUntilBigBlind).toBe(0);
  });
});

describe('checkTableSummary', () => {
  it('accepts healthy tables and reports problems', () => {
    expect(checkTableSummary(makeTable({ seats: [0, 2], reserved: [5], lastBB: 2, lastSB: 0 }))).toEqual([]);
    const bad = makeTable({ seats: [0, 2], reserved: [2, 9], lastBB: 12 });
    const problems = checkTableSummary(bad);
    expect(problems.some((p) => p.includes('reserved seat 2 is occupied'))).toBe(true);
    expect(problems.some((p) => p.includes('reserved seat 9 out of range'))).toBe(true);
    expect(problems.some((p) => p.includes('lastBigBlindSeat 12 out of range'))).toBe(true);
  });
});

const tableArb = fc.integer({ min: 2, max: 10 }).chain((maxSeats) =>
  fc
    .record({
      seats: fc.uniqueArray(fc.integer({ min: 0, max: maxSeats - 1 }), { minLength: 0, maxLength: maxSeats - 1 }),
      lastBB: fc.option(fc.integer({ min: 0, max: maxSeats - 1 }), { nil: null }),
      lastSB: fc.option(fc.integer({ min: 0, max: maxSeats - 1 }), { nil: null }),
      button: fc.option(fc.integer({ min: 0, max: maxSeats - 1 }), { nil: null }),
      inHand: fc.boolean(),
      h: fc.integer({ min: 0, max: 30 }),
    })
    .map((r) => ({ table: makeTable({ maxSeats, seats: r.seats, lastBB: r.lastBB, lastSB: r.lastSB, button: r.button, inHand: r.inHand }), h: r.h })),
);

describe('seat choice properties (fast-check)', () => {
  it('always picks the free seat with the minimal score (ties: lowest seat) and is deterministic', () => {
    fc.assert(
      fc.property(tableArb, ({ table, h }) => {
        const player = { playerId: 'x', stats: stats({ handsSinceBigBlind: h }) };
        const choice = chooseSeatForIncoming(table, player, EQUAL_WEIGHTS);
        expect(freeSeats(table)).toContain(choice.seat);
        for (const c of scoreSeatsForIncoming(table, player, EQUAL_WEIGHTS)) {
          expect(c.score > choice.score || (c.score === choice.score && c.seat >= choice.seat)).toBe(true);
        }
        expect(chooseSeatForIncoming(table, player, EQUAL_WEIGHTS)).toEqual(choice);
      }),
    );
  });

  it('with blind fairness dominant, the deviation is the minimum achievable', () => {
    fc.assert(
      fc.property(tableArb, ({ table, h }) => {
        const weights = { position: 0.01, blindFairness: 1000, recentMove: 0, seatCompatibility: 0.01 };
        const choice = chooseSeatForIncoming(table, { playerId: 'x', stats: stats({ handsSinceBigBlind: h }) }, weights);
        const orbit = nextHandParticipants(table).length + 1;
        const expected = expectedHandsUntilBigBlind(h, orbit);
        const best = Math.min(...freeSeats(table).map((s) => Math.abs(handsUntilBigBlind(table, s) - expected)));
        expect(choice.breakdown.blindFairnessDeviation).toBe(best);
        expect(handsUntilBigBlind(table, choice.seat)).toBe(choice.breakdown.handsUntilBigBlind);
      }),
    );
  });
});
