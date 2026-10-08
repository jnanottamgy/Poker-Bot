/**
 * ADVERSARIAL (dead button & blind positions). Independent checks of
 * CONTRACTS §4 "Dead-button blinds (TDA)" and "first hand" rules against the
 * HAND_STARTED / HAND_RESULT stream produced under heavy churn: eliminations,
 * arrivals during and between hands, pending and immediate removals, seat
 * re-use, heads-up transitions both ways.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { HandResultReport, PlayerActionIntent, SeatIndex } from '@jpb/shared-types';
import { getLegalActions } from '@jpb/poker-engine';
import { adminView } from '../src';
import { Harness } from './helpers';
import { prng, simulate } from './sim';

interface DealtHand {
  handNumber: number;
  button: SeatIndex;
  sbPosted: SeatIndex | null;
  sbPosition: SeatIndex;
  bb: SeatIndex;
  seats: SeatIndex[];
  playerAt: Map<SeatIndex, string>;
}

/** Strictly-clockwise first participant after `seat` (independent re-implementation). */
function after(seat: SeatIndex, participants: readonly SeatIndex[], maxSeats: number): SeatIndex {
  for (let k = 1; k <= maxSeats; k += 1) {
    const s = (seat + k) % maxSeats;
    if (participants.includes(s)) return s;
  }
  throw new Error('no participant');
}

/** Seats strictly between a and b going clockwise. */
function strictlyBetween(a: SeatIndex, b: SeatIndex, maxSeats: number): SeatIndex[] {
  const out: SeatIndex[] = [];
  for (let s = (a + 1) % maxSeats; s !== b; s = (s + 1) % maxSeats) out.push(s);
  return out;
}

function dealtHands(h: Harness): DealtHand[] {
  const results = new Map<number, HandResultReport>();
  for (const r of h.payloads('HAND_RESULT')) results.set(r.result.handNumber, r.result);
  return h.payloads('HAND_STARTED').map((e) => {
    const r = results.get(e.handNumber);
    return {
      handNumber: e.handNumber,
      button: e.buttonSeat,
      sbPosted: e.smallBlindSeat,
      // smallBlindPosition is only reported in HAND_RESULT (hands still running have none yet).
      sbPosition: r?.smallBlindPosition ?? (e.smallBlindSeat as SeatIndex),
      bb: e.bigBlindSeat,
      seats: e.players.map((p) => p.seat).sort((a, b) => a - b),
      playerAt: new Map(e.players.map((p) => [p.seat, p.playerId])),
    };
  });
}

/**
 * Checks every consecutive pair of dealt hands against the normative rules:
 * - BB = first dealt-in seat strictly clockwise after the last BB seat (nobody skips the BB);
 * - nobody posts the BB twice in a row (2+ players are always dealt in);
 * - 3+ players: SB position = last BB seat, posted iff that seat is dealt in; button = last SB position;
 * - heads-up: the non-BB player is the button and posts the small blind;
 * - the posted SB and the BB are dealt-in seats and differ.
 */
function checkPositionRules(hands: readonly DealtHand[], maxSeats: number): void {
  for (let i = 0; i < hands.length; i += 1) {
    const cur = hands[i] as DealtHand;
    const ctx = `hand #${cur.handNumber} ${JSON.stringify({ ...cur, playerAt: [...cur.playerAt] })}`;
    expect(cur.seats, ctx).toContain(cur.bb);
    if (cur.sbPosted !== null) {
      expect(cur.seats, ctx).toContain(cur.sbPosted);
      expect(cur.sbPosted, ctx).toBe(cur.sbPosition);
    }
    expect(cur.sbPosition, ctx).not.toBe(cur.bb);
    if (cur.seats.length === 2) {
      const other = cur.seats.find((s) => s !== cur.bb);
      expect(cur.button, ctx).toBe(other);
      expect(cur.sbPosted, ctx).toBe(other);
    }
    if (i === 0) continue;
    const prev = hands[i - 1] as DealtHand;
    expect(cur.bb, ctx).toBe(after(prev.bb, cur.seats, maxSeats));
    for (const s of strictlyBetween(prev.bb, cur.bb, maxSeats)) {
      expect(cur.seats.includes(s), `${ctx}: seat ${s} skipped the big blind`).toBe(false);
    }
    expect(cur.playerAt.get(cur.bb), `${ctx}: same player posts the BB twice in a row`).not.toBe(
      prev.playerAt.get(prev.bb),
    );
    if (cur.seats.length > 2) {
      expect(cur.sbPosition, ctx).toBe(prev.bb);
      expect(cur.sbPosted, ctx).toBe(cur.seats.includes(prev.bb) ? prev.bb : null);
      expect(cur.button, ctx).toBe(prev.sbPosition);
    }
  }
}

describe('adversarial-table: dead-button rules hold through the full random simulation', () => {
  it('property: every hand of random churn (busts, arrivals, removals, HU transitions) follows the dead-button rules', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 2_000_000 }), fc.integer({ min: 2, max: 10 }), (seed, maxSeats) => {
        const { h } = simulate({ seed, hands: 30, maxSeats });
        const hands = dealtHands(h);
        expect(hands.length).toBeGreaterThanOrEqual(30);
        checkPositionRules(hands, maxSeats);
      }),
      { numRuns: 25 },
    );
  });

  it('a long 9-max run (300 hands) never breaks the dead-button rules', () => {
    const { h } = simulate({ seed: 4242, hands: 300, maxSeats: 9 });
    const hands = dealtHands(h);
    // the run really exercised the dead-SB / dead-button / heads-up paths
    expect(hands.some((x) => x.sbPosted === null)).toBe(true);
    expect(hands.some((x) => !x.seats.includes(x.button))).toBe(true);
    checkPositionRules(hands, 9);
  });
});

/** Busy-table churn driver focusing on eliminations: everybody shoves often. */
function shoveFest(
  seed: number,
  maxSeats: number,
  handsWanted: number,
  onBeforeDeal: (h: Harness) => void = () => undefined,
): Harness {
  const rnd = prng(seed);
  const int = (n: number): number => Math.floor(rnd() * n);
  const h = new Harness({
    maxSeats,
    freeze: false,
    seed: `shove-${seed}`,
    initialButtonSeat: rnd() < 0.5 ? int(maxSeats) : null,
  });
  let id = 0;
  const seatNew = (): void => {
    const free = h.state.seats.flatMap((o, i) => (o === null ? [i] : []));
    if (free.length === 0) return;
    id += 1;
    h.seat(`q${id}`, free[int(free.length)] as number, 150 + int(1_500));
  };
  const initial = 2 + int(maxSeats - 1);
  for (let i = 0; i < initial; i += 1) seatNew();
  h.start();
  let guard = 0;
  while (h.state.counters.handsPlayed < handsWanted && guard++ < handsWanted * 80) {
    const s = h.state;
    if (s.turn !== null) {
      const hand = s.hand;
      const legal = hand === null ? null : getLegalActions(hand);
      if (legal === null) throw new Error('no legal');
      const r = rnd();
      // arrivals / pending removals during the hand
      if (r < 0.05) {
        seatNew();
        continue;
      }
      if (r < 0.08) {
        const dealt = hand?.players.map((p) => p.playerId) ?? [];
        const victim = dealt[int(dealt.length)];
        if (victim !== undefined)
          h.send({ type: 'REMOVE_PLAYER', playerId: victim, reason: 'MOVED', moveId: `m${guard}` });
        continue;
      }
      let intent: PlayerActionIntent;
      if (r < 0.45) intent = { type: 'ALL_IN' };
      else if (legal.canCheck) intent = { type: 'CHECK' };
      else intent = r < 0.75 ? { type: 'CALL' } : { type: 'FOLD' };
      h.act(intent);
      continue;
    }
    // between hands: arrivals and immediate removals
    const r = rnd();
    const seated = s.seats.flatMap((o) => (o === null ? [] : [o.playerId]));
    if (seated.length < 2 || r < 0.25) {
      seatNew();
      continue;
    }
    if (r < 0.32 && seated.length > 2) {
      h.send({ type: 'REMOVE_PLAYER', playerId: seated[int(seated.length)] as string, reason: 'ADMIN', moveId: null });
      continue;
    }
    if (s.status === 'BETWEEN_HANDS') {
      onBeforeDeal(h);
      if (h.state.status === 'BETWEEN_HANDS') h.fireNextHand();
    }
  }
  return h;
}

describe('adversarial-table: dead-button rules under heavy elimination churn', () => {
  it('property: shove-fest tables (many busts, seat re-use, HU <-> multiway) follow the rules', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 2_000_000 }), fc.integer({ min: 3, max: 10 }), (seed, maxSeats) => {
        const h = shoveFest(seed, maxSeats, 40);
        const hands = dealtHands(h);
        expect(h.payloads('PLAYER_REMOVED').some((e) => e.reason === 'ELIMINATED')).toBe(true);
        checkPositionRules(hands, maxSeats);
      }),
      { numRuns: 30 },
    );
  });
});

describe('adversarial-table: the admin view predicts the next hand exactly', () => {
  it('property: adminView.positions.next and nextHandAt match the hand the NEXT_HAND timer then deals', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 2_000_000 }), fc.integer({ min: 3, max: 10 }), (seed, maxSeats) => {
        let checked = 0;
        shoveFest(seed, maxSeats, 25, (h) => {
          const view = adminView(h.state, h.now, { includeHoleCards: false });
          const predicted = view.positions?.next;
          expect(view.nextHandAt).toBe(h.state.nextHand?.dueAt);
          const t = h.fireNextHand();
          const started = t.events.find((e) => e.event.kind === 'HAND_STARTED')?.event;
          if (started?.kind !== 'HAND_STARTED') throw new Error('no deal');
          expect(predicted).toEqual({
            buttonSeat: started.buttonSeat,
            smallBlindPosition: expect.any(Number),
            smallBlindPosted: started.smallBlindSeat !== null,
            bigBlindSeat: started.bigBlindSeat,
            headsUp: started.players.length === 2,
          });
          if (started.smallBlindSeat !== null) expect(predicted?.smallBlindPosition).toBe(started.smallBlindSeat);
          // the admin turn view reports the exact hard deadline the timer was requested for
          const turn = adminView(h.state, h.now, { includeHoleCards: false }).turn;
          const timer = t.timers.find((x) => x.kind === 'ACTION_TIMEOUT');
          if (turn !== null && turn !== undefined) expect(timer?.at).toBe(turn.hardDeadline);
          checked += 1;
        });
        expect(checked).toBeGreaterThan(0);
      }),
      { numRuns: 15 },
    );
  });
});

describe('adversarial-table: concrete dead-button scenarios with exact numbers', () => {
  it('the BB busts and a newcomer takes that very seat between hands: the newcomer posts the SB at once', () => {
    const h = new Harness({ initialButtonSeat: 0 });
    h.seat('p0', 0);
    h.seat('p2', 2);
    h.seat('p4', 4, 1_000);
    h.seat('p6', 6);
    h.rigNextHand({ 6: ['As', 'Ah'], 4: ['7c', '2d'] }, ['Kd', 'Qc', '9s', '5h', '3c']);
    h.start(); // button 0, SB 2, BB 4
    h.playAllInHand('p4', 'p6');
    expect(h.occupant('p4')).toBeNull();
    h.seat('new4', 4, 5_000);
    h.fireNextHand();
    const hs = h.payloads('HAND_STARTED')[1];
    // BB = first dealt-in after 4 = 6; SB POSITION = 4 (now occupied -> posted); button = 2.
    expect(hs).toMatchObject({ buttonSeat: 2, smallBlindSeat: 4, bigBlindSeat: 6 });
    const forced = h.payloads('FORCED_BET_POSTED').slice(-2);
    expect(forced).toEqual([
      expect.objectContaining({ seat: 4, betType: 'SMALL_BLIND', amount: 50 }),
      expect.objectContaining({ seat: 6, betType: 'BIG_BLIND', amount: 100 }),
    ]);
  });

  it('dead small blind: only the BB is posted, the pot starts at 100 and nobody’s SB counter resets', () => {
    const h = new Harness({ initialButtonSeat: 0 });
    h.seat('p0', 0);
    h.seat('p2', 2);
    h.seat('p4', 4, 1_000);
    h.seat('p6', 6);
    h.rigNextHand({ 6: ['As', 'Ah'], 4: ['7c', '2d'] }, ['Kd', 'Qc', '9s', '5h', '3c']);
    h.start();
    h.playAllInHand('p4', 'p6');
    const before = new Map(h.state.seats.flatMap((o) => (o === null ? [] : [[o.playerId, o.stats] as const])));
    h.fireNextHand();
    const forced = h.last?.events.flatMap((e) => (e.event.kind === 'FORCED_BET_POSTED' ? [e.event] : [])) ?? [];
    expect(forced).toEqual([expect.objectContaining({ seat: 6, betType: 'BIG_BLIND', amount: 100, pot: 100 })]);
    expect(h.payloads('HAND_STARTED')[1]).toMatchObject({ buttonSeat: 2, smallBlindSeat: null, bigBlindSeat: 6 });
    h.foldAround();
    for (const id of ['p0', 'p2', 'p6']) {
      const was = before.get(id);
      const now = h.occupant(id)?.stats;
      if (was === undefined || now === undefined) throw new Error('missing');
      expect(now.handsSinceSmallBlind, id).toBe(was.handsSinceSmallBlind + 1);
      expect(now.handsSinceBigBlind, id).toBe(id === 'p6' ? 0 : was.handsSinceBigBlind + 1);
    }
  });

  it('heads-up stays strictly alternating for many hands (button = SB, BB alternates)', () => {
    const h = new Harness({ initialButtonSeat: 7 });
    h.seat('a', 2);
    h.seat('b', 7);
    h.start();
    for (let i = 0; i < 7; i += 1) {
      h.foldAround();
      h.fireNextHand();
    }
    const hs = h.payloads('HAND_STARTED').map((e) => [e.buttonSeat, e.smallBlindSeat, e.bigBlindSeat]);
    expect(hs).toEqual([
      [7, 7, 2],
      [2, 2, 7],
      [7, 7, 2],
      [2, 2, 7],
      [7, 7, 2],
      [2, 2, 7],
      [7, 7, 2],
      [2, 2, 7],
    ]);
  });

  it('first hand with the initial button on an EMPTY seat (multiway): dead button, SB/BB are the next two players', () => {
    const h = new Harness({ initialButtonSeat: 5 });
    h.seat('a', 1);
    h.seat('b', 3);
    h.seat('c', 8);
    h.start();
    expect(h.payloads('HAND_STARTED')[0]).toMatchObject({ buttonSeat: 5, smallBlindSeat: 8, bigBlindSeat: 1 });
    // first to act preflop is the first player after the BB: seat 3
    expect(h.state.turn?.seat).toBe(3);
  });

  it('first hand heads-up with the initial button occupied: that player is button AND small blind', () => {
    const h = new Harness({ initialButtonSeat: 6 });
    h.seat('a', 1);
    h.seat('b', 6);
    h.start();
    expect(h.payloads('HAND_STARTED')[0]).toMatchObject({ buttonSeat: 6, smallBlindSeat: 6, bigBlindSeat: 1 });
    expect(h.state.turn?.seat).toBe(6); // heads-up: button acts first preflop
  });

  it('the BB player is removed between hands and another player sits in that seat: nobody posts the BB twice', () => {
    const h = new Harness({ initialButtonSeat: 0 });
    for (const s of [0, 3, 6]) h.seat(`p${s}`, s);
    h.start(); // button 0, SB 3, BB 6
    h.foldAround();
    h.send({ type: 'REMOVE_PLAYER', playerId: 'p6', reason: 'MOVED', moveId: 'mv' });
    h.seat('x6', 6);
    h.fireNextHand();
    // BB = first after 6 = 0; SB position 6 occupied by the newcomer (posts SB); button = 3.
    expect(h.payloads('HAND_STARTED')[1]).toMatchObject({ buttonSeat: 3, smallBlindSeat: 6, bigBlindSeat: 0 });
  });

  it('pending removal of the next BB during the hand: the BB passes to the following player, SB stays with last BB', () => {
    const h = new Harness({ initialButtonSeat: 0 });
    for (const s of [0, 2, 4, 6, 8]) h.seat(`p${s}`, s);
    h.start(); // button 0, SB 2, BB 4; next BB would be 6
    h.send({ type: 'REMOVE_PLAYER', playerId: 'p6', reason: 'MOVED', moveId: 'mv6' });
    expect(h.occupant('p6')?.pendingRemoval).toEqual({ reason: 'MOVED', moveId: 'mv6' });
    h.foldAround();
    expect(h.occupant('p6')).toBeNull();
    h.fireNextHand();
    expect(h.payloads('HAND_STARTED')[1]).toMatchObject({ buttonSeat: 2, smallBlindSeat: 4, bigBlindSeat: 8 });
  });
});
