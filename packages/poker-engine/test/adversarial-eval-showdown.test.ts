/*
 * ADVERSARIAL TESTER — evaluator-at-the-table lens.
 *
 * Hand-crafted full hands (rigged decks built from the independently computed
 * dealing order) where the winner depends on evaluator subtleties: board
 * plays, kickers, wheel vs six-high, steel wheel, quads on board, two trips,
 * three pairs, folded best hands, side pots with different winners, odd
 * chips with a dead button. Every number is exact.
 */
import type { AnteType, CardCode, HandEvent, PlayerActionIntent, SeatIndex } from '@jpb/shared-types';
import { describe, expect, it } from 'vitest';
import { applyAction, checkHandInvariants, createHand } from '../src';
import type { CreateHandInput, HandState } from '../src';
import { allCards, refClockwise } from './adversarial-eval-reference';

type Ev<K extends HandEvent['kind']> = Extract<HandEvent, { kind: K }>;
const C = (s: string): CardCode[] => s.trim().split(/\s+/) as CardCode[];

/** Deck that deals `hole` per seat and `board` per the documented dealing order (independent of engine code). */
function rig(
  seats: number[],
  button: number,
  maxSeats: number,
  hole: Record<number, string>,
  board: string,
): CardCode[] {
  const order = refClockwise(seats, button, maxSeats);
  const n = order.length;
  const deck: Array<CardCode | null> = new Array(52).fill(null);
  order.forEach((seat, k) => {
    const h = hole[seat];
    if (h) {
      const [a, b] = C(h);
      deck[k] = a as CardCode;
      deck[n + k] = b as CardCode;
    }
  });
  const b = C(board);
  const pos = [2 * n + 1, 2 * n + 2, 2 * n + 3, 2 * n + 5, 2 * n + 7];
  b.forEach((c, i) => (deck[pos[i] as number] = c));
  const used = new Set(deck.filter((c) => c !== null));
  if (used.size !== deck.filter((c) => c !== null).length) throw new Error('rig: duplicate');
  const rest = allCards().filter((c) => !used.has(c));
  return deck.map((c) => c ?? (rest.shift() as CardCode));
}

interface Spec {
  maxSeats?: number;
  stacks: Record<number, number>;
  button: number;
  sb: number | null;
  bb: number;
  blinds?: [number, number];
  ante?: number;
  anteType?: AnteType;
  hole: Record<number, string>;
  board: string;
}

class Game {
  s: HandState;
  ev: HandEvent[];
  constructor(spec: Spec) {
    const maxSeats = spec.maxSeats ?? 9;
    const seats = Object.keys(spec.stacks).map(Number);
    const input: CreateHandInput = {
      handId: 'X:1',
      handNumber: 1,
      maxSeats,
      seats: seats.map((seat) => ({ seat, playerId: `p${seat}`, stack: spec.stacks[seat] as number })),
      buttonSeat: spec.button,
      smallBlindSeat: spec.sb,
      bigBlindSeat: spec.bb,
      smallBlind: spec.blinds?.[0] ?? 1,
      bigBlind: spec.blinds?.[1] ?? 2,
      ante: spec.ante ?? 0,
      anteType: spec.anteType ?? 'NONE',
      deck: rig(seats, spec.button, maxSeats, spec.hole, spec.board),
    };
    const t = createHand(input);
    this.s = t.state;
    this.ev = [...t.events];
    expect(checkHandInvariants(this.s)).toEqual([]);
  }
  act(seat: SeatIndex, type: PlayerActionIntent['type'], amount?: number): this {
    expect(this.s.actingSeat, `expected seat ${seat} to act`).toBe(seat);
    const r = applyAction(this.s, seat, amount === undefined ? { type } : { type, amount });
    if (!r.ok) throw new Error(`${seat} ${type} ${amount ?? ''} rejected: ${r.code}`);
    this.s = r.state;
    this.ev.push(...r.events);
    expect(checkHandInvariants(this.s)).toEqual([]);
    return this;
  }
  won(): Record<number, number> {
    return Object.fromEntries(this.s.players.map((p) => [p.seat, p.won]));
  }
  stacks(): Record<number, number> {
    return Object.fromEntries(this.s.players.map((p) => [p.seat, p.stack]));
  }
  awards(): Array<{ pot: number; amount: number; winners: Array<[number, number, number]>; desc: string | null }> {
    return this.ev
      .filter((e): e is Ev<'POT_AWARDED'> => e.kind === 'POT_AWARDED')
      .map((e) => ({
        pot: e.potIndex,
        amount: e.amount,
        winners: e.winners.map((w) => [w.seat, w.amount, w.oddChips] as [number, number, number]),
        desc: e.winningHand?.description ?? null,
      }));
  }
  reveals(): Array<[number, boolean]> {
    const sd = this.ev.find((e): e is Ev<'SHOWDOWN'> => e.kind === 'SHOWDOWN');
    return sd ? sd.reveals.map((r) => [r.seat, r.mucked]) : [];
  }
}

describe('adversarial-eval: showdowns with exact chip results', () => {
  it('board royal flush: 3-way all-in ties; 301 split 101/100/100, odd chip to first seat after the button', () => {
    // button 0, SB 1, BB 2, UTG 3; SB folds after posting 1 -> pot 301
    const g = new Game({
      stacks: { 0: 100, 1: 100, 2: 100, 3: 100 },
      button: 0,
      sb: 1,
      bb: 2,
      hole: { 0: 'Ah Ad', 1: 'Kc Kd', 2: '2c 3d', 3: '7h 8h' },
      board: 'Ts Js Qs Ks As',
    });
    g.act(3, 'ALL_IN').act(0, 'CALL').act(1, 'FOLD').act(2, 'CALL');
    expect(g.s.phase).toBe('HAND_COMPLETE');
    expect(g.awards()).toEqual([
      {
        pot: 0,
        amount: 301,
        winners: [
          [2, 101, 1],
          [3, 100, 0],
          [0, 100, 0],
        ],
        desc: 'Royal Flush',
      },
    ]);
    expect(g.stacks()).toEqual({ 0: 100, 1: 99, 2: 101, 3: 100 });
    // all-in run-out: everyone live revealed clockwise from the first live seat after the button
    expect(g.reveals()).toEqual([
      [2, false],
      [3, false],
      [0, false],
    ]);
  });

  it('a folded player holding the nuts never wins; the best LIVE hand does', () => {
    const g = new Game({
      stacks: { 0: 200, 1: 200, 2: 200 },
      button: 0,
      sb: 1,
      bb: 2,
      hole: { 0: 'As Ks', 1: '9c 9d', 2: '4h 5c' },
      board: 'Qs Js Ts 2d 3c',
    });
    // preflop: 0 raises to 6, 1 calls, 2 calls; flop: check, check, 0 bets 10... then 0 folds to a raise
    g.act(0, 'RAISE', 6).act(1, 'CALL').act(2, 'CALL');
    g.act(1, 'CHECK').act(2, 'CHECK').act(0, 'BET', 10).act(1, 'RAISE', 40).act(2, 'FOLD').act(0, 'FOLD');
    expect(g.s.phase).toBe('HAND_COMPLETE');
    // seat 1's 30 extra is uncalled; pot = 18 + 10 + 10 = 38
    expect(g.s.result?.uncalled).toEqual({ seat: 1, playerId: 'p1', amount: 30 });
    expect(g.won()).toEqual({ 0: 0, 1: 38, 2: 0 });
    expect(g.s.result?.winType).toBe('FOLD');
    expect(g.s.board).toHaveLength(3);
    expect(g.awards()[0]?.desc).toBeNull();
  });

  it('kickers split main and side pot between different winners (exact amounts)', () => {
    // seat 3 short all-in with AK; seats 1 and 2 play a side pot with AQ vs AJ on A-7-7-2-3
    const g = new Game({
      stacks: { 1: 500, 2: 500, 3: 50 },
      button: 3,
      sb: 1,
      bb: 2,
      blinds: [5, 10],
      hole: { 1: 'Ac Qd', 2: 'Ad Jh', 3: 'As Kc' },
      board: 'Ah 7c 7d 2s 3h',
    });
    g.act(3, 'ALL_IN').act(1, 'CALL').act(2, 'CALL');
    // flop: SB first
    g.act(1, 'BET', 100).act(2, 'CALL');
    g.act(1, 'CHECK').act(2, 'CHECK');
    g.act(1, 'CHECK').act(2, 'CHECK');
    expect(g.s.phase).toBe('HAND_COMPLETE');
    expect(g.awards()).toEqual([
      { pot: 1, amount: 200, winners: [[1, 200, 0]], desc: 'Two Pair, Aces and Sevens' },
      { pot: 0, amount: 150, winners: [[3, 150, 0]], desc: 'Two Pair, Aces and Sevens' },
    ]);
    expect(g.stacks()).toEqual({ 1: 550, 2: 350, 3: 150 });
    // seat 1 AQ bestFive uses the queen kicker
    const sd = g.ev.find((e): e is Ev<'SHOWDOWN'> => e.kind === 'SHOWDOWN');
    const r1 = sd?.reveals.find((r) => r.seat === 1);
    expect(r1?.hand?.bestFive).toEqual(C('Ah Ac 7d 7c Qd'));
  });

  it('wheel loses to six-high straight; steel wheel beats both', () => {
    const g = new Game({
      stacks: { 0: 100, 1: 100, 2: 100 },
      button: 0,
      sb: 1,
      bb: 2,
      hole: { 0: 'Ac 9d', 1: '6c 9h', 2: 'Ad Kd' },
      board: '2d 3d 4d 5s Jc',
    });
    // seat 2 has A-2-3-4-5 with diamonds 2d 3d 4d Ad Kd = flush, not steel wheel (5s): flush beats straights
    g.act(0, 'ALL_IN').act(1, 'CALL').act(2, 'CALL');
    expect(g.awards()).toEqual([{ pot: 0, amount: 300, winners: [[2, 300, 0]], desc: 'Flush, Ace High' }]);
    const sd = g.ev.find((e): e is Ev<'SHOWDOWN'> => e.kind === 'SHOWDOWN');
    expect(sd?.reveals.map((r) => r.hand?.description)).toEqual([
      'Straight, Six High',
      'Flush, Ace High',
      'Straight, Five High',
    ]);

    const g2 = new Game({
      stacks: { 0: 100, 1: 100, 2: 100 },
      button: 0,
      sb: 1,
      bb: 2,
      hole: { 0: 'Ac 9d', 1: '6c 9h', 2: 'Ad 5d' },
      board: '2d 3d 4d 5s Kd',
    });
    g2.act(0, 'ALL_IN').act(1, 'CALL').act(2, 'CALL');
    expect(g2.awards()).toEqual([{ pot: 0, amount: 300, winners: [[2, 300, 0]], desc: 'Straight Flush, Five High' }]);
    const sd2 = g2.ev.find((e): e is Ev<'SHOWDOWN'> => e.kind === 'SHOWDOWN');
    expect(sd2?.reveals.find((r) => r.seat === 2)?.hand?.bestFive).toEqual(C('5d 4d 3d 2d Ad'));
  });

  it('quads on board: kicker decides; equal kickers split with odd chip; dead button seat', () => {
    // button seat 4 is EMPTY (dead button); seats 0,1,2; SB 0, BB 1; odd pot via SB 1 / BB 2 and a fold
    const g = new Game({
      stacks: { 0: 60, 1: 60, 2: 60, 5: 60 },
      button: 4,
      sb: 5,
      bb: 0,
      hole: { 0: 'Kc 2d', 1: 'Kd 3c', 2: 'Qh Qd', 5: 'As 2s' },
      board: '9s 9d 9h 9c 4d',
    });
    // dealing order from seat 5: 5, 0, 1, 2. Preflop first to act: seat 1 (after BB 0)
    g.act(1, 'ALL_IN').act(2, 'CALL').act(5, 'FOLD').act(0, 'CALL');
    // pot = 60*3 + 1 = 181; seats 0 and 1 tie with K kicker, Q loses
    expect(g.awards()).toEqual([
      {
        pot: 0,
        amount: 181,
        winners: [
          [0, 91, 1],
          [1, 90, 0],
        ],
        desc: 'Four of a Kind, Nines',
      },
    ]);
    expect(g.stacks()).toEqual({ 0: 91, 1: 90, 2: 0, 5: 59 });
    expect(g.s.result?.bustedSeats).toEqual([2]);
  });

  it('two trips (board trips + hole trips) and three pairs resolve to the right boats and kickers', () => {
    const g = new Game({
      stacks: { 0: 100, 1: 100, 2: 100 },
      button: 0,
      sb: 1,
      bb: 2,
      hole: { 0: '5c 5d', 1: 'Jc Jd', 2: '8c 3h' },
      board: 'Js 5h 8d 8h 3s',
    });
    // 0: 5-5-5 + 8-8 = Fives full of Eights; 1: J-J-J + 8-8 = Jacks full of Eights; 2: 8-8-8? no: 8c + 8d 8h = trips 8 + 3-3 = Eights full of Threes
    g.act(0, 'ALL_IN').act(1, 'CALL').act(2, 'CALL');
    const sd = g.ev.find((e): e is Ev<'SHOWDOWN'> => e.kind === 'SHOWDOWN');
    expect(Object.fromEntries(sd?.reveals.map((r) => [r.seat, r.hand?.description]) ?? [])).toEqual({
      0: 'Full House, Fives full of Eights',
      1: 'Full House, Jacks full of Eights',
      2: 'Full House, Eights full of Threes',
    });
    expect(g.won()).toEqual({ 0: 0, 1: 300, 2: 0 });
  });

  it('three pairs on board + pocket pair: best two pair with the best remaining kicker', () => {
    const g = new Game({
      stacks: { 0: 100, 1: 100 },
      maxSeats: 2,
      button: 0,
      sb: 0,
      bb: 1,
      hole: { 0: 'Kc 2d', 1: 'Qc Qd' },
      board: '9s 9d 4h 4c Ks',
    });
    // heads-up: button/SB acts first preflop
    g.act(0, 'ALL_IN').act(1, 'CALL');
    const sd = g.ev.find((e): e is Ev<'SHOWDOWN'> => e.kind === 'SHOWDOWN');
    const by = Object.fromEntries(sd?.reveals.map((r) => [r.seat, r.hand]) ?? []);
    expect(by[0]?.description).toBe('Two Pair, Kings and Nines');
    expect(by[1]?.description).toBe('Two Pair, Queens and Nines');
    expect(by[1]?.bestFive).toEqual(C('Qd Qc 9s 9d Ks'));
    expect(g.won()).toEqual({ 0: 200, 1: 0 });
  });

  it('identical best hands with different suits split exactly; ALL_PLAYERS antes and side pot odd chips', () => {
    // 3 players, ante 1 each, blinds 1/2. Seat 2 short (21) all-in.
    const g = new Game({
      stacks: { 0: 300, 1: 300, 2: 21 },
      button: 2,
      sb: 0,
      bb: 1,
      ante: 1,
      anteType: 'ALL_PLAYERS',
      hole: { 0: 'Ah Kh', 1: 'As Ks', 2: 'Qc Qd' },
      board: 'Ad Kd 7c 4s 2h',
    });
    // preflop: seat 2 acts first (after BB 1): all-in 20 more chips (after ante, stack 20)
    g.act(2, 'ALL_IN').act(0, 'RAISE', 61).act(1, 'CALL');
    // flop..river: check down
    for (let i = 0; i < 3; i++) g.act(0, 'CHECK').act(1, 'CHECK');
    expect(g.s.phase).toBe('HAND_COMPLETE');
    // contributions: seat 2: 21; seats 0,1: 62 each. main = 21*3 = 63, side = 41*2 = 82
    // main: 63 split between 0 and 1 (AK vs AK, Q-Q loses): 32/31, odd chip to seat 0 (first after button 2)
    expect(g.awards()).toEqual([
      {
        pot: 1,
        amount: 82,
        winners: [
          [0, 41, 0],
          [1, 41, 0],
        ],
        desc: 'Two Pair, Aces and Kings',
      },
      {
        pot: 0,
        amount: 63,
        winners: [
          [0, 32, 1],
          [1, 31, 0],
        ],
        desc: 'Two Pair, Aces and Kings',
      },
    ]);
    expect(g.stacks()).toEqual({ 0: 311, 1: 310, 2: 0 });
  });
});
