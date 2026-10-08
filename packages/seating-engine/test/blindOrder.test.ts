import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { SeatIndex, TableSummary } from '@jpb/shared-types';
import {
  currentHandPositions,
  handsUntilBigBlind,
  isStrictlyBetween,
  nextHandParticipants,
  planningBlindState,
  positionsForNextHand,
  predictBigBlindOrder,
  statsAtDeparture,
} from '../src';
import { makeTable, stats } from './fixtures';

// ---------------------------------------------------------------------------
// Reference model: the table-engine dead-button rules (CONTRACTS §4) written
// out literally, independent of the implementation under test.
// ---------------------------------------------------------------------------
interface Sim {
  maxSeats: number;
  occupied: Set<SeatIndex>;
  button: SeatIndex | null;
  lastSB: SeatIndex | null;
  lastBB: SeatIndex | null;
}

function firstOccupiedAfter(sim: Sim, seat: SeatIndex): SeatIndex {
  for (let d = 1; d <= sim.maxSeats; d += 1) {
    const s = (seat + d) % sim.maxSeats;
    if (sim.occupied.has(s)) return s;
  }
  throw new Error('empty table');
}

function refNextHand(sim: Sim): { button: SeatIndex; sb: SeatIndex; bb: SeatIndex } {
  const occ = [...sim.occupied].sort((a, b) => a - b);
  if (sim.lastBB === null) {
    const button = sim.button ?? (occ[0] as SeatIndex);
    if (occ.length === 2) {
      const sb = sim.occupied.has(button) ? button : firstOccupiedAfter(sim, button);
      return { button: sb, sb, bb: firstOccupiedAfter(sim, sb) };
    }
    const sb = firstOccupiedAfter(sim, button);
    return { button, sb, bb: firstOccupiedAfter(sim, sb) };
  }
  const bb = firstOccupiedAfter(sim, sim.lastBB);
  if (occ.length === 2) {
    const other = occ[0] === bb ? (occ[1] as SeatIndex) : (occ[0] as SeatIndex);
    return { button: other, sb: other, bb };
  }
  return { button: sim.lastSB as SeatIndex, sb: sim.lastBB, bb };
}

function refPlay(sim: Sim): SeatIndex {
  const h = refNextHand(sim);
  sim.button = h.button;
  sim.lastSB = h.sb;
  sim.lastBB = h.bb;
  return h.bb;
}

function toSummary(sim: Sim, extra: Partial<TableSummary> = {}): TableSummary {
  return {
    ...makeTable({
      maxSeats: sim.maxSeats,
      seats: [...sim.occupied],
      button: sim.button,
      lastSB: sim.lastSB,
      lastBB: sim.lastBB,
    }),
    ...extra,
  };
}

const simArb = fc
  .integer({ min: 2, max: 10 })
  .chain((maxSeats) =>
    fc.record({
      maxSeats: fc.constant(maxSeats),
      seats: fc.uniqueArray(fc.integer({ min: 0, max: maxSeats - 1 }), { minLength: 2, maxLength: maxSeats }),
      button: fc.option(fc.integer({ min: 0, max: maxSeats - 1 }), { nil: null }),
      warmup: fc.integer({ min: 0, max: 12 }),
      churn: fc.array(fc.tuple(fc.boolean(), fc.integer({ min: 0, max: maxSeats - 1 })), { maxLength: 30 }),
    }),
  );

describe('positions for the next hand (examples)', () => {
  it('first hand: button given -> SB, BB are the next occupied seats', () => {
    const t = makeTable({ seats: [0, 2, 4, 6], button: 2 });
    expect(positionsForNextHand(t, nextHandParticipants(t))).toMatchObject({ buttonSeat: 2, smallBlindSeat: 4, bigBlindSeat: 6, firstHand: true });
    expect(predictBigBlindOrder(t)).toEqual([6, 0, 2, 4]);
  });

  it('first hand: no button -> the first occupied seat is the button', () => {
    const t = makeTable({ seats: [0, 2, 4, 6] });
    expect(predictBigBlindOrder(t)).toEqual([4, 6, 0, 2]);
  });

  it('first hand: button on an empty seat', () => {
    const t = makeTable({ seats: [0, 2, 4, 6], button: 3 });
    expect(positionsForNextHand(t, nextHandParticipants(t))).toMatchObject({ buttonSeat: 3, smallBlindSeat: 4, bigBlindSeat: 6 });
  });

  it('first hand heads-up: the button posts the small blind', () => {
    expect(predictBigBlindOrder(makeTable({ seats: [1, 5], button: 1 }))).toEqual([5, 1]);
    expect(predictBigBlindOrder(makeTable({ seats: [1, 5], button: 5 }))).toEqual([1, 5]);
    const emptyButton = makeTable({ seats: [1, 5], button: 3 });
    expect(positionsForNextHand(emptyButton, [1, 5])).toMatchObject({ buttonSeat: 5, smallBlindSeat: 5, bigBlindSeat: 1, headsUp: true });
  });

  it('dead button: BB moves to the next occupied seat, SB = last BB, button = last SB', () => {
    const t = makeTable({ seats: [0, 2, 4, 6, 8], lastSB: 2, lastBB: 4, button: 0 });
    expect(positionsForNextHand(t, nextHandParticipants(t))).toMatchObject({
      buttonSeat: 2,
      smallBlindSeat: 4,
      smallBlindPosted: true,
      bigBlindSeat: 6,
    });
    expect(predictBigBlindOrder(t)).toEqual([6, 8, 0, 2, 4]);
  });

  it('dead small blind when the last big blind left the table', () => {
    const t = makeTable({ seats: [0, 2, 6, 8], lastSB: 2, lastBB: 4 });
    expect(positionsForNextHand(t, nextHandParticipants(t))).toMatchObject({ buttonSeat: 2, smallBlindSeat: 4, smallBlindPosted: false, bigBlindSeat: 6 });
    expect(predictBigBlindOrder(t)).toEqual([6, 8, 0, 2]);
  });

  it('dead button when the last small blind left the table', () => {
    const t = makeTable({ seats: [0, 4, 6, 8], lastSB: 2, lastBB: 4 });
    expect(positionsForNextHand(t, nextHandParticipants(t))).toMatchObject({ buttonSeat: 2, smallBlindSeat: 4, bigBlindSeat: 6 });
  });

  it('a player who was due the BB busted: the BB skips to the next occupied seat', () => {
    const t = makeTable({ seats: [0, 2, 4, 8], lastSB: 2, lastBB: 4 });
    expect(predictBigBlindOrder(t)).toEqual([8, 0, 2, 4]);
  });

  it('wraps around the table', () => {
    const t = makeTable({ seats: [0, 2, 4, 8], lastSB: 4, lastBB: 8 });
    expect(predictBigBlindOrder(t)).toEqual([0, 2, 4, 8]);
  });

  it('heads-up after play: the non-BB player is button and posts SB', () => {
    const t = makeTable({ seats: [3, 7], lastSB: 1, lastBB: 3 });
    expect(positionsForNextHand(t, [3, 7])).toMatchObject({ buttonSeat: 3, smallBlindSeat: 3, bigBlindSeat: 7, headsUp: true });
    expect(predictBigBlindOrder(t)).toEqual([7, 3]);
  });

  it('falls back to the last button (then the seat before the SB) when lastSmallBlindSeat is unknown', () => {
    const withButton = makeTable({ seats: [0, 2, 4, 6], lastBB: 4, button: 1 });
    expect(positionsForNextHand(withButton, [0, 2, 4, 6])?.buttonSeat).toBe(1);
    const without = makeTable({ seats: [0, 2, 4, 6], lastBB: 4 });
    expect(positionsForNextHand(without, [0, 2, 4, 6])?.buttonSeat).toBe(2);
  });

  it('degenerate tables', () => {
    expect(predictBigBlindOrder(makeTable({ seats: [] }))).toEqual([]);
    expect(predictBigBlindOrder(makeTable({ seats: [4], lastBB: 1 }))).toEqual([4]);
    expect(positionsForNextHand(makeTable({ seats: [4] }), [4])).toBeNull();
  });
});

describe('participants: movingOut and reserved seats', () => {
  it('players moving out are not dealt in; reserved seats are', () => {
    const t = makeTable({ seats: [0, 2, { seat: 4, movingOut: true }, 6], reserved: [5], lastSB: 0, lastBB: 2 });
    expect(nextHandParticipants(t)).toEqual([0, 2, 5, 6]);
    expect(predictBigBlindOrder(t)).toEqual([5, 6, 0, 2]);
  });
});

describe('handsUntilBigBlind', () => {
  const t = makeTable({ seats: [0, 2, 4, 6], lastSB: 0, lastBB: 2 });

  it('for occupied seats equals the position in the BB order', () => {
    expect([4, 6, 0, 2].map((s) => handsUntilBigBlind(t, s))).toEqual([0, 1, 2, 3]);
  });

  it('for a hypothetical seat being filled', () => {
    expect(handsUntilBigBlind(t, 3)).toBe(0); // between the last BB and the next BB: posts BB next hand
    expect(handsUntilBigBlind(t, 5)).toBe(1);
    expect(handsUntilBigBlind(t, 7)).toBe(2);
    expect(handsUntilBigBlind(t, 8)).toBe(2);
    expect(handsUntilBigBlind(t, 1)).toBe(3); // between button and SB: last before the old BB
  });

  it('rejects out-of-range seats', () => {
    expect(() => handsUntilBigBlind(t, 9)).toThrow(RangeError);
    expect(() => handsUntilBigBlind(t, -1)).toThrow(RangeError);
  });
});

describe('tables in a hand: predictions start with the hand after the current one', () => {
  it('derives the in-progress hand and skips it', () => {
    const t = makeTable({ seats: [0, 2, 4, 6], lastSB: 0, lastBB: 2, inHand: true });
    expect(currentHandPositions(t)).toMatchObject({ buttonSeat: 0, smallBlindSeat: 2, bigBlindSeat: 4 });
    expect(planningBlindState(t)).toEqual({ maxSeats: 9, buttonSeat: 0, lastSmallBlindSeat: 2, lastBigBlindSeat: 4 });
    expect(predictBigBlindOrder(t)).toEqual([6, 0, 2, 4]);
    expect(handsUntilBigBlind(t, 4)).toBe(3);
    expect(handsUntilBigBlind(t, 5)).toBe(0);
  });

  it('players moving out still play the current hand', () => {
    const t = makeTable({ seats: [0, 2, { seat: 4, movingOut: true }, 6], lastSB: 0, lastBB: 2, inHand: true });
    // current hand: BB 4 (moving out). next hand: BB = first participant after 4 = 6; SB position 4 is dead.
    expect(predictBigBlindOrder(t)).toEqual([6, 0, 2]);
  });

  it('first hand in progress', () => {
    const t = makeTable({ seats: [0, 3, 6], button: 6, inHand: true });
    // current: button 6, SB 0, BB 3 -> next BB 6
    expect(predictBigBlindOrder(t)).toEqual([6, 0, 3]);
  });

  it('statsAtDeparture advances counters for the hand being played', () => {
    const t = makeTable({ seats: [0, 2, 4, 6], lastSB: 0, lastBB: 2, inHand: true });
    const s = stats({ handsSinceBigBlind: 5, handsSinceSmallBlind: 2, handsPlayedTotal: 40, handsDealtAtTable: 7 });
    expect(statsAtDeparture(t, 4, s)).toEqual({ handsSinceBigBlind: 0, handsSinceSmallBlind: 3, handsPlayedTotal: 41, handsDealtAtTable: 8 });
    expect(statsAtDeparture(t, 2, s)).toEqual({ handsSinceBigBlind: 6, handsSinceSmallBlind: 0, handsPlayedTotal: 41, handsDealtAtTable: 8 });
    expect(statsAtDeparture({ ...t, inHand: false }, 4, s)).toBe(s);
  });
});

describe('isStrictlyBetween', () => {
  it('handles wrap-around', () => {
    expect(isStrictlyBetween(1, 0, 2, 9)).toBe(true);
    expect(isStrictlyBetween(0, 0, 2, 9)).toBe(false);
    expect(isStrictlyBetween(2, 0, 2, 9)).toBe(false);
    expect(isStrictlyBetween(0, 7, 2, 9)).toBe(true);
    expect(isStrictlyBetween(8, 7, 2, 9)).toBe(true);
    expect(isStrictlyBetween(5, 7, 2, 9)).toBe(false);
  });
});

describe('agreement with the reference dead-button model (fast-check)', () => {
  it('the predicted next BB matches the reference after arbitrary joins and leaves', () => {
    fc.assert(
      fc.property(simArb, ({ maxSeats, seats, button, warmup, churn }) => {
        const sim: Sim = { maxSeats, occupied: new Set(seats), button, lastSB: null, lastBB: null };
        expect(predictBigBlindOrder(toSummary(sim))[0]).toBe(refNextHand(sim).bb);
        for (let i = 0; i < warmup; i += 1) refPlay(sim);
        for (const [join, seat] of churn) {
          if (join) sim.occupied.add(seat);
          else if (sim.occupied.size > 2) sim.occupied.delete(seat);
          const predicted = predictBigBlindOrder(toSummary(sim));
          const previousBB = sim.lastBB;
          const bb = refPlay(sim);
          expect(predicted[0]).toBe(bb);
          // Nobody posts the BB twice in a row while two or more players are dealt in.
          if (previousBB !== null && sim.occupied.has(previousBB)) expect(bb).not.toBe(previousBB);
        }
      }),
      { numRuns: 400 },
    );
  });

  it('with a stable table, the whole predicted order and handsUntilBigBlind match the reference', () => {
    fc.assert(
      fc.property(simArb, ({ maxSeats, seats, button, warmup }) => {
        const sim: Sim = { maxSeats, occupied: new Set(seats), button, lastSB: null, lastBB: null };
        for (let i = 0; i < warmup; i += 1) refPlay(sim);
        const summary = toSummary(sim);
        const predicted = predictBigBlindOrder(summary);
        const actual: SeatIndex[] = [];
        for (let i = 0; i < sim.occupied.size; i += 1) actual.push(refPlay(sim));
        expect(predicted).toEqual(actual);
        for (const seat of seats) expect(handsUntilBigBlind(summary, seat)).toBe(actual.indexOf(seat));
      }),
      { numRuns: 400 },
    );
  });

  it('handsUntilBigBlind for a hypothetical empty seat matches the reference after the player sits', () => {
    fc.assert(
      fc.property(simArb, fc.integer({ min: 0, max: 9 }), ({ maxSeats, seats, button, warmup }, pick) => {
        const sim: Sim = { maxSeats, occupied: new Set(seats), button, lastSB: null, lastBB: null };
        for (let i = 0; i < warmup; i += 1) refPlay(sim);
        const empty = Array.from({ length: maxSeats }, (_, s) => s).filter((s) => !sim.occupied.has(s));
        if (empty.length === 0) return;
        const seat = empty[pick % empty.length] as SeatIndex;
        const predicted = handsUntilBigBlind(toSummary(sim), seat);
        sim.occupied.add(seat);
        let hands = 0;
        while (refPlay(sim) !== seat) hands += 1;
        expect(predicted).toBe(hands);
      }),
      { numRuns: 400 },
    );
  });

  it('in-hand tables: predictions describe the hands after the current one, including departures and arrivals', () => {
    fc.assert(
      fc.property(
        simArb,
        fc.array(fc.integer({ min: 0, max: 9 }), { maxLength: 3 }),
        fc.array(fc.integer({ min: 0, max: 9 }), { maxLength: 3 }),
        ({ maxSeats, seats, button, warmup }, leaving, arriving) => {
          const sim: Sim = { maxSeats, occupied: new Set(seats), button, lastSB: null, lastBB: null };
          for (let i = 0; i < warmup; i += 1) refPlay(sim);
          const out = new Set(leaving.map((x) => x % maxSeats).filter((s) => sim.occupied.has(s)));
          const reserved = [...new Set(arriving.map((x) => x % maxSeats))].filter((s) => !sim.occupied.has(s));
          if (sim.occupied.size - out.size + reserved.length < 2) return;
          const summary = makeTable({
            maxSeats,
            seats: [...sim.occupied].map((s) => ({ seat: s, movingOut: out.has(s) })),
            reserved,
            button: sim.button,
            lastSB: sim.lastSB,
            lastBB: sim.lastBB,
            inHand: true,
          });
          const predicted = predictBigBlindOrder(summary);
          refPlay(sim); // the hand in progress, with everyone currently seated
          for (const s of out) sim.occupied.delete(s);
          for (const s of reserved) sim.occupied.add(s);
          const actual: SeatIndex[] = [];
          for (let i = 0; i < sim.occupied.size; i += 1) actual.push(refPlay(sim));
          expect(predicted).toEqual(actual);
        },
      ),
      { numRuns: 400 },
    );
  });
});
