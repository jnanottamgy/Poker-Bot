import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { positionsForNextHand } from '@jpb/seating-engine';
import { computePositions } from '../src';
import type { BlindState } from '../src';
import { handStarts, Harness } from './helpers';

const blind = (b: Partial<BlindState>): BlindState => ({
  maxSeats: 9,
  buttonSeat: null,
  lastSmallBlindSeat: null,
  lastBigBlindSeat: null,
  ...b,
});

describe('computePositions (pure rules)', () => {
  it('first hand: button given -> SB and BB are the next participants', () => {
    expect(computePositions(blind({ buttonSeat: 2 }), [0, 2, 4, 6])).toMatchObject({
      buttonSeat: 2,
      smallBlindPosition: 4,
      smallBlindPosted: true,
      bigBlindSeat: 6,
      firstHand: true,
      headsUp: false,
    });
  });

  it('first hand: no button -> the first occupied seat is the button', () => {
    expect(computePositions(blind({}), [1, 3, 5])).toMatchObject({
      buttonSeat: 1,
      smallBlindPosition: 3,
      bigBlindSeat: 5,
    });
  });

  it('first hand: button on an empty seat (dead) still works', () => {
    expect(computePositions(blind({ buttonSeat: 3 }), [0, 2, 4, 6])).toMatchObject({
      buttonSeat: 3,
      smallBlindPosition: 4,
      bigBlindSeat: 6,
    });
  });

  it('first hand heads-up: button posts SB; empty button seat moves to the next player', () => {
    expect(computePositions(blind({ buttonSeat: 1 }), [1, 5])).toMatchObject({
      buttonSeat: 1,
      smallBlindPosition: 1,
      bigBlindSeat: 5,
      headsUp: true,
    });
    expect(computePositions(blind({ buttonSeat: 3 }), [1, 5])).toMatchObject({
      buttonSeat: 5,
      smallBlindPosition: 5,
      bigBlindSeat: 1,
    });
  });

  it('later hands: BB advances, SB = last BB position, button = last SB position', () => {
    expect(
      computePositions(blind({ buttonSeat: 0, lastSmallBlindSeat: 2, lastBigBlindSeat: 4 }), [0, 2, 4, 6, 8]),
    ).toMatchObject({
      buttonSeat: 2,
      smallBlindPosition: 4,
      smallBlindPosted: true,
      bigBlindSeat: 6,
      firstHand: false,
    });
  });

  it('dead small blind when last hand’s BB left; dead button when last hand’s SB left', () => {
    expect(computePositions(blind({ lastSmallBlindSeat: 2, lastBigBlindSeat: 4 }), [0, 2, 6, 8])).toMatchObject({
      buttonSeat: 2,
      smallBlindPosition: 4,
      smallBlindPosted: false,
      bigBlindSeat: 6,
    });
    expect(computePositions(blind({ lastSmallBlindSeat: 2, lastBigBlindSeat: 4 }), [0, 4, 6, 8])).toMatchObject({
      buttonSeat: 2,
      smallBlindPosition: 4,
      smallBlindPosted: true,
      bigBlindSeat: 6,
    });
  });

  it('heads-up after play: the non-BB player is the button and posts SB', () => {
    expect(computePositions(blind({ lastSmallBlindSeat: 1, lastBigBlindSeat: 3 }), [3, 7])).toMatchObject({
      buttonSeat: 3,
      smallBlindPosition: 3,
      bigBlindSeat: 7,
      headsUp: true,
    });
  });

  it('fewer than two participants -> null', () => {
    expect(computePositions(blind({}), [4])).toBeNull();
    expect(computePositions(blind({}), [])).toBeNull();
  });

  it('property: the BB is never the previous BB seat while 2+ participants remain', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 10 }).chain((maxSeats) =>
          fc.record({
            maxSeats: fc.constant(maxSeats),
            participants: fc.uniqueArray(fc.integer({ min: 0, max: maxSeats - 1 }), {
              minLength: 2,
              maxLength: maxSeats,
            }),
            lastBB: fc.integer({ min: 0, max: maxSeats - 1 }),
            lastSB: fc.integer({ min: 0, max: maxSeats - 1 }),
          }),
        ),
        ({ maxSeats, participants, lastBB, lastSB }) => {
          const sorted = [...participants].sort((a, b) => a - b);
          const pos = computePositions(
            { maxSeats, buttonSeat: null, lastSmallBlindSeat: lastSB, lastBigBlindSeat: lastBB },
            sorted,
          );
          expect(pos).not.toBeNull();
          expect(pos?.bigBlindSeat).not.toBe(lastBB);
          expect(sorted).toContain(pos?.bigBlindSeat);
          if (pos?.smallBlindPosted) expect(sorted).toContain(pos.smallBlindPosition);
          expect(pos?.smallBlindPosition).not.toBe(pos?.bigBlindSeat);
        },
      ),
    );
  });
});

describe('agreement with @jpb/seating-engine (its predictions mirror this engine)', () => {
  it('computePositions equals seating-engine positionsForNextHand for random states', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 10 }).chain((maxSeats) =>
          fc.record({
            maxSeats: fc.constant(maxSeats),
            participants: fc.uniqueArray(fc.integer({ min: 0, max: maxSeats - 1 }), {
              minLength: 0,
              maxLength: maxSeats,
            }),
            buttonSeat: fc.option(fc.integer({ min: 0, max: maxSeats - 1 }), { nil: null }),
            lastSmallBlindSeat: fc.option(fc.integer({ min: 0, max: maxSeats - 1 }), { nil: null }),
            lastBigBlindSeat: fc.option(fc.integer({ min: 0, max: maxSeats - 1 }), { nil: null }),
          }),
        ),
        ({ participants, ...state }) => {
          const sorted = [...participants].sort((a, b) => a - b);
          const ours = computePositions(state, sorted);
          const theirs = positionsForNextHand(state, sorted);
          if (ours === null || theirs === null) {
            expect(ours).toBeNull();
            expect(theirs).toBeNull();
            return;
          }
          expect({
            buttonSeat: ours.buttonSeat,
            smallBlindSeat: ours.smallBlindPosition,
            smallBlindPosted: ours.smallBlindPosted,
            bigBlindSeat: ours.bigBlindSeat,
            headsUp: ours.headsUp,
            firstHand: ours.firstHand,
          }).toEqual(theirs);
        },
      ),
      { numRuns: 2_000 },
    );
  });
});

/** A table with players on the given seats (stacks 10k), started; returns after hand 1 is dealt. */
function table(seats: number[], opts: { button?: number; maxSeats?: number } = {}): Harness {
  const h = new Harness({ maxSeats: opts.maxSeats ?? 9, initialButtonSeat: opts.button ?? null });
  for (const s of seats) h.seat(`p${s}`, s);
  h.start();
  return h;
}

/** Folds the current hand around and deals the next one. */
function nextHand(h: Harness): void {
  h.foldAround();
  h.fireNextHand();
}

describe('dead button: explicit seat-by-seat scenarios through the reducer', () => {
  it('normal rotation with no changes moves every position one player clockwise', () => {
    const h = table([0, 2, 4, 6], { button: 0 });
    nextHand(h);
    nextHand(h);
    nextHand(h);
    expect(handStarts(h).map((x) => [x.button, x.sb, x.bb])).toEqual([
      [0, 2, 4],
      [2, 4, 6],
      [4, 6, 0],
      [6, 0, 2],
    ]);
  });

  it('player busts in the BB: next BB is the next player, SB is dead, button moves to last SB', () => {
    // hand 1: button 0, SB 2, BB 4. Player at 4 (BB) busts.
    const h = new Harness({ initialButtonSeat: 0 });
    h.seat('p0', 0);
    h.seat('p2', 2);
    h.seat('p4', 4, 1_000);
    h.seat('p6', 6);
    h.rigNextHand({ 6: ['As', 'Ah'], 4: ['7c', '2d'] }, ['Kd', 'Qc', '9s', '5h', '3c']);
    h.start();
    h.playAllInHand('p4', 'p6');
    expect(h.payloads('PLAYER_REMOVED')).toEqual([
      expect.objectContaining({ playerId: 'p4', reason: 'ELIMINATED', stack: 0 }),
    ]);
    h.fireNextHand();
    // hand 2: BB = first after 4 = 6; SB position = 4 (empty -> dead); button = 2.
    expect(handStarts(h)[1]).toEqual({ button: 2, sb: null, bb: 6, players: [0, 2, 6] });
    nextHand(h);
    // hand 3: BB = 0, SB = 6, button = 4 (empty -> dead button).
    expect(handStarts(h)[2]).toEqual({ button: 4, sb: 6, bb: 0, players: [0, 2, 6] });
    nextHand(h);
    expect(handStarts(h)[3]).toEqual({ button: 6, sb: 0, bb: 2, players: [0, 2, 6] });
  });

  it('player busts in the SB: next BB is the next player, SB posted by last BB, button is dead', () => {
    // hand 1: button 0, SB 2, BB 4. Player at 2 (SB) busts.
    const h = new Harness({ initialButtonSeat: 0 });
    h.seat('p0', 0);
    h.seat('p2', 2, 1_000);
    h.seat('p4', 4);
    h.seat('p6', 6);
    h.rigNextHand({ 6: ['As', 'Ah'], 2: ['7c', '2d'] }, ['Kd', 'Qc', '9s', '5h', '3c']);
    h.start();
    h.playAllInHand('p2', 'p6');
    expect(h.payloads('PLAYER_REMOVED').map((e) => e.playerId)).toEqual(['p2']);
    h.fireNextHand();
    // hand 2: BB 6, SB 4 (posted), button 2 (empty: dead button).
    expect(handStarts(h)[1]).toEqual({ button: 2, sb: 4, bb: 6, players: [0, 4, 6] });
    nextHand(h);
    expect(handStarts(h)[2]).toEqual({ button: 4, sb: 6, bb: 0, players: [0, 4, 6] });
  });

  it('player busts on the button: positions advance normally', () => {
    const h = new Harness({ initialButtonSeat: 0 });
    h.seat('p0', 0, 1_000);
    h.seat('p2', 2);
    h.seat('p4', 4);
    h.seat('p6', 6);
    h.rigNextHand({ 6: ['As', 'Ah'], 0: ['7c', '2d'] }, ['Kd', 'Qc', '9s', '5h', '3c']);
    h.start();
    h.playAllInHand('p0', 'p6');
    h.fireNextHand();
    expect(handStarts(h)[1]).toEqual({ button: 2, sb: 4, bb: 6, players: [2, 4, 6] });
    nextHand(h);
    expect(handStarts(h)[2]).toEqual({ button: 4, sb: 6, bb: 2, players: [2, 4, 6] });
  });

  it('two players bust in the same hand (SB and BB) leaving heads-up: BB goes to the next survivor', () => {
    const h = new Harness({ initialButtonSeat: 0 });
    h.seat('p0', 0);
    h.seat('p2', 2, 1_000);
    h.seat('p4', 4, 1_000);
    h.seat('p6', 6, 20_000);
    h.rigNextHand({ 6: ['As', 'Ah'], 2: ['7c', '2d'], 4: ['8c', '3d'] }, ['Kd', 'Qc', '9s', '5h', '4c']);
    h.start();
    // p2 and p4 all-in, p6 calls, p0 folds.
    let guard = 0;
    while (h.state.turn !== null && guard++ < 20) {
      const who = h.state.turn.playerId;
      const legal = h.legal();
      if (who === 'p2' || who === 'p4') h.act({ type: 'ALL_IN' });
      else if (who === 'p6') h.act(legal.canCall ? { type: 'CALL' } : { type: 'CHECK' });
      else h.act({ type: 'FOLD' });
    }
    const result = h.payloads('HAND_RESULT')[0]?.result;
    expect(result?.busted.map((b) => b.playerId).sort()).toEqual(['p2', 'p4']);
    h.fireNextHand();
    // Two players remain -> heads-up: BB = first participant after 4 = 6; the other (0) is button and SB.
    expect(handStarts(h)[1]).toEqual({ button: 0, sb: 0, bb: 6, players: [0, 6] });
  });

  it('SB and BB bust in the same hand at a 5-handed table: dead SB and dead button', () => {
    const h = new Harness({ initialButtonSeat: 0 });
    h.seat('p0', 0);
    h.seat('p2', 2, 1_000);
    h.seat('p4', 4, 1_000);
    h.seat('p6', 6, 20_000);
    h.seat('p8', 8);
    h.rigNextHand({ 6: ['As', 'Ah'], 2: ['7c', '2d'], 4: ['8c', '3d'] }, ['Kd', 'Qc', '9s', '5h', '4c']);
    h.start(); // button 0, SB 2, BB 4
    let guard = 0;
    while (h.state.turn !== null && guard++ < 20) {
      const who = h.state.turn.playerId;
      const legal = h.legal();
      if (who === 'p2' || who === 'p4') h.act({ type: 'ALL_IN' });
      else if (who === 'p6') h.act(legal.canCall ? { type: 'CALL' } : { type: 'CHECK' });
      else h.act({ type: 'FOLD' });
    }
    expect(h.payloads('PLAYER_REMOVED').map((e) => [e.playerId, e.reason])).toEqual([
      ['p2', 'ELIMINATED'],
      ['p4', 'ELIMINATED'],
    ]);
    h.fireNextHand();
    // BB = first participant after 4 = 6; SB position 4 empty -> dead SB; button = 2 (empty -> dead button).
    expect(handStarts(h)[1]).toEqual({ button: 2, sb: null, bb: 6, players: [0, 6, 8] });
    nextHand(h);
    expect(handStarts(h)[2]).toEqual({ button: 4, sb: 6, bb: 8, players: [0, 6, 8] });
    nextHand(h);
    expect(handStarts(h)[3]).toEqual({ button: 6, sb: 8, bb: 0, players: [0, 6, 8] });
  });

  it('a new player arriving right after the BB posts the BB next hand', () => {
    const h = table([0, 2, 4, 6], { button: 0 }); // hand 1: BB 4
    h.seat('p5', 5); // arrives between the BB (4) and seat 6 during the hand
    expect(h.occupant('p5')?.waitingForNextHand).toBe(true);
    nextHand(h);
    expect(handStarts(h)[1]).toEqual({ button: 2, sb: 4, bb: 5, players: [0, 2, 4, 5, 6] });
    nextHand(h);
    expect(handStarts(h)[2]).toEqual({ button: 4, sb: 5, bb: 6, players: [0, 2, 4, 5, 6] });
  });

  it('a new player arriving between button and SB waits a full orbit for the BB (no blind skipped twice)', () => {
    const h = table([0, 2, 4, 6], { button: 0 }); // hand 1: button 0, SB 2, BB 4
    h.seat('p1', 1);
    const bbs: number[] = [4];
    for (let i = 0; i < 5; i += 1) {
      nextHand(h);
      bbs.push(handStarts(h).at(-1)?.bb as number);
    }
    expect(bbs).toEqual([4, 6, 0, 1, 2, 4]);
  });

  it('3-handed to heads-up when the button busts', () => {
    const h = new Harness({ initialButtonSeat: 0 });
    h.seat('p0', 0, 1_000);
    h.seat('p3', 3);
    h.seat('p6', 6);
    h.rigNextHand({ 6: ['As', 'Ah'], 0: ['7c', '2d'] }, ['Kd', 'Qc', '9s', '5h', '3c']);
    h.start(); // button 0, SB 3, BB 6
    h.playAllInHand('p0', 'p6');
    h.fireNextHand();
    // heads-up: BB = first after 6 = 3; the other (6) is button and SB.
    expect(handStarts(h)[1]).toEqual({ button: 6, sb: 6, bb: 3, players: [3, 6] });
    nextHand(h);
    expect(handStarts(h)[2]).toEqual({ button: 3, sb: 3, bb: 6, players: [3, 6] });
  });

  it('3-handed to heads-up when the SB busts', () => {
    const h = new Harness({ initialButtonSeat: 0 });
    h.seat('p0', 0);
    h.seat('p3', 3, 1_000);
    h.seat('p6', 6);
    h.rigNextHand({ 6: ['As', 'Ah'], 3: ['7c', '2d'] }, ['Kd', 'Qc', '9s', '5h', '3c']);
    h.start(); // button 0, SB 3, BB 6
    h.playAllInHand('p3', 'p6');
    h.fireNextHand();
    // BB = first after 6 = 0; 6 (last BB) is button and posts SB: 6 does not post BB twice.
    expect(handStarts(h)[1]).toEqual({ button: 6, sb: 6, bb: 0, players: [0, 6] });
  });

  it('3-handed to heads-up when the BB busts', () => {
    const h = new Harness({ initialButtonSeat: 0 });
    h.seat('p0', 0);
    h.seat('p3', 3);
    h.seat('p6', 6, 1_000);
    h.rigNextHand({ 0: ['As', 'Ah'], 6: ['7c', '2d'] }, ['Kd', 'Qc', '9s', '5h', '3c']);
    h.start(); // button 0, SB 3, BB 6
    h.playAllInHand('p6', 'p0');
    h.fireNextHand();
    // BB = first after 6 = 0; 3 is button/SB. Player 3 posted SB and 0 posted nothing last hand.
    expect(handStarts(h)[1]).toEqual({ button: 3, sb: 3, bb: 0, players: [0, 3] });
    nextHand(h);
    expect(handStarts(h)[2]).toEqual({ button: 0, sb: 0, bb: 3, players: [0, 3] });
  });

  it('heads-up to 3-handed: newcomer after the BB posts the BB next', () => {
    const h = table([1, 5], { button: 1 }); // HU: button/SB 1, BB 5
    h.seat('p7', 7);
    nextHand(h);
    // BB = first after 5 = 7; SB = 5; button = 1.
    expect(handStarts(h)[1]).toEqual({ button: 1, sb: 5, bb: 7, players: [1, 5, 7] });
  });

  it('heads-up to 3-handed: newcomer between button and BB (literal rule: button may coincide with the BB)', () => {
    const h = table([1, 5], { button: 1 }); // HU: button/SB 1, BB 5
    h.seat('p3', 3);
    nextHand(h);
    // BB = first after 5 = 1; SB position = 5; button = last SB position = 1.
    expect(handStarts(h)[1]).toEqual({ button: 1, sb: 5, bb: 1, players: [1, 3, 5] });
    const hand2Starts = h.payloads('HAND_STARTED');
    expect(hand2Starts).toHaveLength(2);
    nextHand(h);
    expect(handStarts(h)[2]).toEqual({ button: 5, sb: 1, bb: 3, players: [1, 3, 5] });
  });

  it('removal between hands of the player due the BB: BB skips to the next player, SB dead', () => {
    const h = table([0, 2, 4, 6], { button: 0 }); // BB 4
    h.foldAround();
    h.send({ type: 'REMOVE_PLAYER', playerId: 'p6', reason: 'MOVED', moveId: 'm1' }); // was due the BB
    h.fireNextHand();
    expect(handStarts(h)[1]).toEqual({ button: 2, sb: 4, bb: 0, players: [0, 2, 4] });
  });
});

describe('property: nobody posts the big blind twice in a row', () => {
  it('holds across random arrivals, removals and busts-by-removal', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 10 }),
        fc.array(fc.tuple(fc.constantFrom('add', 'remove', 'none'), fc.nat()), { minLength: 5, maxLength: 25 }),
        (maxSeats, ops) => {
          const h = new Harness({ maxSeats, freeze: false });
          h.seat('p0', 0);
          h.seat('p1', 1);
          h.start();
          let n = 2;
          for (const [op, x] of ops) {
            h.foldAround();
            const occupied = h.state.seats.flatMap((o, i) => (o === null ? [] : [i]));
            const free = h.state.seats.flatMap((o, i) => (o === null ? [i] : []));
            if (op === 'add' && free.length > 0) h.seat(`p${n++}`, free[x % free.length] as number);
            if (op === 'remove' && occupied.length > 2) {
              const seat = occupied[x % occupied.length] as number;
              h.send({
                type: 'REMOVE_PLAYER',
                playerId: h.state.seats[seat]?.playerId as string,
                reason: 'ADMIN',
                moveId: null,
              });
            }
            if (h.state.status === 'BETWEEN_HANDS') h.fireNextHand();
          }
          const starts = handStarts(h);
          const bbPlayers = h
            .payloads('HAND_STARTED')
            .map((e) => e.players.find((p) => p.seat === e.bigBlindSeat)?.playerId);
          for (let i = 1; i < starts.length; i += 1) {
            expect(bbPlayers[i]).not.toBe(bbPlayers[i - 1]);
            const s = starts[i];
            expect(s?.players).toContain(s?.bb);
            if (s?.sb !== null) expect(s?.players).toContain(s?.sb);
          }
        },
      ),
      { numRuns: 60 },
    );
  });
});
