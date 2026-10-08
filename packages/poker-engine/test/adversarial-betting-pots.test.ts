/**
 * Adversarial tests (betting lens): side pots, folded contributors, ties, odd
 * chips, uncalled bets, fold wins, showdown reveal/muck order and exact event
 * order (CONTRACTS.md §3 rules 8-14).
 */
import type { CardCode } from '@jpb/shared-types';
import { describe, expect, it } from 'vitest';
import { buildPots, currentPots } from '../src';
import { Table } from './helpers';

type Hole = Record<number, [CardCode, CardCode]>;
const ROYAL_BOARD: CardCode[] = ['As', 'Ks', 'Qs', 'Js', 'Ts'];

const stacksOf = (t: Table) => t.state.players.map((p) => p.stack);

describe('adversarial-betting: multi-way all-ins with a folded contributor (rules 10, 12)', () => {
  // Button 4, SB 0 (300), BB 1, seats 2, 3 (600), 4.
  const hole: Hole = {
    0: ['Ac', 'Ad'],
    3: ['Kc', 'Kd'],
    2: ['Qc', 'Qd'],
    4: ['Qh', 'Qs'],
    1: ['5c', '6d'],
  };
  const setup = () =>
    new Table({
      stacks: { 0: 300, 1: 1000, 2: 1000, 3: 600, 4: 2000 },
      buttonSeat: 4,
      smallBlindSeat: 0,
      bigBlindSeat: 1,
      hole,
      board: ['2c', '7d', '9h', '4s', '3d'],
    });

  it('main + two side pots, tied top side pot, exact awards and award order', () => {
    const t = setup();
    expect(t.acting).toBe(2);
    t.act(2, { type: 'RAISE', amount: 400 });
    t.act(3, { type: 'ALL_IN' }); // 600, incomplete (+200 < 300)
    t.act(4, { type: 'CALL' });
    t.act(0, { type: 'ALL_IN' }); // all-in call for 300
    expect(t.lastEvents[0]).toMatchObject({ action: 'CALL', amount: 250, toAmount: 300, allIn: true });
    t.act(1, { type: 'FOLD' });
    expect(t.acting).toBe(2);
    expect(t.state.actingSeat).toBe(2);
    t.act(2, { type: 'CALL' });
    expect(t.state.phase).toBe('FLOP');
    expect(t.acting).toBe(2);
    t.act(2, { type: 'ALL_IN' });
    expect(t.lastEvents[0]).toMatchObject({ action: 'BET', amount: 400, allIn: true });
    t.act(4, { type: 'CALL' });

    expect(t.state.phase).toBe('HAND_COMPLETE');
    expect(t.kinds(t.lastEvents)).toEqual([
      'PLAYER_ACTED',
      'BETTING_ROUND_COMPLETE',
      'STREET_STARTED',
      'STREET_STARTED',
      'SHOWDOWN',
      'POT_AWARDED',
      'POT_AWARDED',
      'POT_AWARDED',
      'HAND_COMPLETED',
    ]);
    const awarded = t.ofKind('POT_AWARDED');
    expect(
      awarded.map((a) => ({
        i: a.potIndex,
        type: a.potType,
        amount: a.amount,
        eligible: a.eligibleSeats,
        winners: a.winners.map((w) => [w.seat, w.amount, w.oddChips]),
      })),
    ).toEqual([
      {
        i: 2,
        type: 'SIDE',
        amount: 800,
        eligible: [2, 4],
        winners: [
          [2, 400, 0],
          [4, 400, 0],
        ],
      },
      { i: 1, type: 'SIDE', amount: 900, eligible: [2, 3, 4], winners: [[3, 900, 0]] },
      { i: 0, type: 'MAIN', amount: 1300, eligible: [0, 2, 3, 4], winners: [[0, 1300, 0]] },
    ]);
    expect(t.ofKind('UNCALLED_BET_RETURNED')).toHaveLength(0);
    // All-in run-out: every live hand shown, clockwise from the first live seat after the button.
    const sd = t.ofKind('SHOWDOWN')[0];
    expect(sd?.reveals.map((r) => [r.seat, r.mucked])).toEqual([
      [0, false],
      [2, false],
      [3, false],
      [4, false],
    ]);
    expect(stacksOf(t)).toEqual([1300, 900, 400, 900, 1400]);
    expect(t.state.result?.totalPot).toBe(3000);
    expect(t.state.result?.bustedSeats).toEqual([]);
  });
});

describe('adversarial-betting: odd chips (rule 13)', () => {
  it('3-way split of 953 with a folded SB: odd chips go clockwise after the button, button seat last', () => {
    const t = new Table({
      stacks: { 0: 1000, 1: 1000, 2: 1000, 3: 1000 },
      buttonSeat: 3,
      smallBlindSeat: 0,
      bigBlindSeat: 1,
      hole: { 0: ['8c', '9c'], 1: ['2c', '3c'], 2: ['4d', '5d'], 3: ['6h', '7h'] },
      board: ROYAL_BOARD,
    });
    t.act(2, { type: 'RAISE', amount: 301 });
    t.act(3, { type: 'CALL' });
    t.act(0, { type: 'FOLD' });
    t.act(1, { type: 'CALL' });
    for (let i = 0; i < 9; i++) t.act(t.acting as number, { type: 'CHECK' });
    expect(t.state.phase).toBe('HAND_COMPLETE');
    const pot = t.ofKind('POT_AWARDED');
    expect(pot).toHaveLength(1);
    expect(pot[0]?.amount).toBe(953);
    expect(pot[0]?.winners.map((w) => [w.seat, w.amount, w.oddChips])).toEqual([
      [1, 318, 1],
      [2, 318, 1],
      [3, 317, 0],
    ]);
    expect(stacksOf(t)).toEqual([950, 1017, 1017, 1016]);
    // No river bet: first live seat after the button shows first; ties show.
    expect(t.ofKind('SHOWDOWN')[0]?.reveals.map((r) => [r.seat, r.mucked])).toEqual([
      [1, false],
      [2, false],
      [3, false],
    ]);
  });

  it('dead button (empty seat 3): the odd chip goes to the first winner clockwise after the empty seat', () => {
    const t = new Table({
      stacks: { 1: 1000, 2: 1000, 4: 1000 },
      maxSeats: 6,
      buttonSeat: 3,
      smallBlindSeat: 4,
      bigBlindSeat: 1,
      smallBlind: 25,
      bigBlind: 100,
      hole: { 1: ['2c', '3c'], 2: ['4d', '5d'], 4: ['6h', '7h'] },
      board: ROYAL_BOARD,
    });
    expect(t.acting).toBe(2);
    t.act(2, { type: 'RAISE', amount: 300 });
    t.act(4, { type: 'FOLD' });
    t.act(1, { type: 'CALL' });
    for (let i = 0; i < 6; i++) t.act(t.acting as number, { type: 'CHECK' });
    const pot = t.ofKind('POT_AWARDED')[0];
    expect(pot?.amount).toBe(625);
    expect(pot?.winners.map((w) => [w.seat, w.amount, w.oddChips])).toEqual([
      [1, 313, 1],
      [2, 312, 0],
    ]);
    expect(t.state.players.map((p) => [p.seat, p.stack])).toEqual([
      [1, 1013],
      [2, 1012],
      [4, 975],
    ]);
  });
});

describe('adversarial-betting: uncalled bets and fold wins (rules 8, 9)', () => {
  it('re-raise folded to: only the unmatched part (over the folded raiser) is returned; no showdown, no cards', () => {
    const t = new Table({
      stacks: { 0: 2000, 1: 2000, 2: 2000, 3: 2000 },
      buttonSeat: 0,
      smallBlindSeat: 1,
      bigBlindSeat: 2,
    });
    t.act(3, { type: 'RAISE', amount: 300 });
    t.act(0, { type: 'RAISE', amount: 1000 });
    t.act(1, { type: 'FOLD' });
    t.act(2, { type: 'FOLD' });
    t.act(3, { type: 'FOLD' });
    expect(t.state.phase).toBe('HAND_COMPLETE');
    expect(t.lastEvents).toEqual([
      expect.objectContaining({ kind: 'PLAYER_ACTED', seat: 3, action: 'FOLD', amount: 0 }),
      { kind: 'BETTING_ROUND_COMPLETE', street: 'PREFLOP', pot: 1450 },
      { kind: 'UNCALLED_BET_RETURNED', seat: 0, playerId: 'p0', amount: 700, stack: 1700 },
      {
        kind: 'POT_AWARDED',
        potIndex: 0,
        potType: 'MAIN',
        amount: 750,
        eligibleSeats: [0],
        winners: [{ seat: 0, playerId: 'p0', amount: 750, oddChips: 0 }],
        winningHand: null,
      },
      expect.objectContaining({ kind: 'HAND_COMPLETED', board: [], totalPot: 750, bustedSeats: [] }),
    ]);
    expect(stacksOf(t)).toEqual([2450, 1950, 1900, 1700]);
    expect(t.state.result?.reveals).toEqual([]);
    expect(t.state.board).toEqual([]);
  });

  it('all-in player stays live after everyone else folds to a re-raise: run-out, uncontested side pot, uncalled excess', () => {
    const t = new Table({
      stacks: { 0: 2000, 1: 2000, 2: 2000, 3: 200 },
      buttonSeat: 0,
      smallBlindSeat: 1,
      bigBlindSeat: 2,
      hole: { 3: ['Ah', 'Ad'], 2: ['7c', '2d'] },
      board: ['3s', '8h', '9c', 'Js', '4d'],
    });
    t.act(3, { type: 'ALL_IN' }); // 200
    t.act(0, { type: 'RAISE', amount: 600 });
    t.act(1, { type: 'FOLD' });
    t.act(2, { type: 'RAISE', amount: 1500 });
    t.act(0, { type: 'FOLD' });
    expect(t.state.phase).toBe('HAND_COMPLETE');
    expect(t.state.result?.winType).toBe('SHOWDOWN');
    expect(t.ofKind('UNCALLED_BET_RETURNED')[0]).toMatchObject({ seat: 2, amount: 900 });
    const awarded = t.ofKind('POT_AWARDED');
    expect(awarded.map((a) => [a.potIndex, a.amount, a.eligibleSeats, a.winners.map((w) => w.seat)])).toEqual([
      [1, 800, [2], [2]],
      [0, 650, [2, 3], [3]],
    ]);
    expect(awarded[0]?.winningHand).toBeNull();
    expect(awarded[1]?.winningHand?.category).toBe('ONE_PAIR');
    expect(stacksOf(t)).toEqual([1400, 1950, 2200, 650]);
  });

  it('short all-in call on the flop: the bettor gets the excess back after the run-out, before the showdown', () => {
    const t = new Table({
      stacks: { 0: 2000, 1: 400, 2: 2000 },
      buttonSeat: 0,
      smallBlindSeat: 1,
      bigBlindSeat: 2,
      hole: { 1: ['Ah', 'Ad'], 2: ['Kc', 'Kd'] },
      board: ['3s', '8h', '9c', 'Js', '4d'],
    });
    t.act(0, { type: 'FOLD' });
    t.act(1, { type: 'CALL' });
    t.act(2, { type: 'CHECK' });
    t.act(1, { type: 'CHECK' });
    t.act(2, { type: 'BET', amount: 800 });
    t.act(1, { type: 'CALL' }); // all-in for 300
    expect(t.lastEvents[0]).toMatchObject({ action: 'CALL', amount: 300, allIn: true });
    expect(t.kinds(t.lastEvents)).toEqual([
      'PLAYER_ACTED',
      'BETTING_ROUND_COMPLETE',
      'STREET_STARTED',
      'STREET_STARTED',
      'UNCALLED_BET_RETURNED',
      'SHOWDOWN',
      'POT_AWARDED',
      'HAND_COMPLETED',
    ]);
    expect(t.ofKind('UNCALLED_BET_RETURNED')[0]).toMatchObject({ seat: 2, amount: 500 });
    expect(t.ofKind('POT_AWARDED')[0]).toMatchObject({ amount: 800, winners: [{ seat: 1, amount: 800 }] });
    expect(stacksOf(t)).toEqual([2000, 800, 1600]);
  });
});

describe('adversarial-betting: showdown reveal and muck order (rule 11)', () => {
  // Board Kc Td 7h 4s 2c. Seat 2 (river bettor) Q-high; seats 3 and 0 pair of kings with
  // identical kickers (tie); seat 1 king-high without a pair (loses).
  const hole: Hole = { 2: ['Qh', 'Jh'], 3: ['Kh', '3d'], 0: ['Kd', '3c'], 1: ['9c', '8c'] };
  const board: CardCode[] = ['Kc', 'Td', '7h', '4s', '2c'];
  const toRiver = () => {
    const t = new Table({
      stacks: { 0: 1000, 1: 1000, 2: 1000, 3: 1000 },
      buttonSeat: 0,
      smallBlindSeat: 1,
      bigBlindSeat: 2,
      hole,
      board,
    });
    t.act(3, { type: 'CALL' });
    t.act(0, { type: 'CALL' });
    t.act(1, { type: 'CALL' });
    t.act(2, { type: 'CHECK' });
    return t;
  };

  it('river bettor shows first even when losing; a tying hand shows; a beaten hand mucks; split pot', () => {
    const t = toRiver();
    for (let i = 0; i < 8; i++) t.act(t.acting as number, { type: 'CHECK' });
    expect(t.state.phase).toBe('RIVER');
    t.act(1, { type: 'CHECK' });
    t.act(2, { type: 'BET', amount: 100 });
    t.act(3, { type: 'CALL' });
    t.act(0, { type: 'CALL' });
    t.act(1, { type: 'CALL' });
    const sd = t.ofKind('SHOWDOWN')[0];
    expect(sd?.reveals.map((r) => [r.seat, r.mucked, r.cards])).toEqual([
      [2, false, ['Qh', 'Jh']],
      [3, false, ['Kh', '3d']],
      [0, false, ['Kd', '3c']],
      [1, true, null],
    ]);
    const pot = t.ofKind('POT_AWARDED')[0];
    expect(pot?.amount).toBe(800);
    expect(pot?.winners.map((w) => [w.seat, w.amount])).toEqual([
      [3, 400],
      [0, 400],
    ]);
    expect(stacksOf(t)).toEqual([1200, 800, 800, 1200]);
  });

  it('a turn bet does not make its bettor show first when the river is checked through', () => {
    const t = toRiver();
    for (let i = 0; i < 4; i++) t.act(t.acting as number, { type: 'CHECK' }); // flop
    expect(t.state.phase).toBe('TURN');
    t.act(1, { type: 'CHECK' });
    t.act(2, { type: 'CHECK' });
    t.act(3, { type: 'BET', amount: 100 });
    t.act(0, { type: 'CALL' });
    t.act(1, { type: 'CALL' });
    t.act(2, { type: 'CALL' });
    expect(t.state.phase).toBe('RIVER');
    for (let i = 0; i < 4; i++) t.act(t.acting as number, { type: 'CHECK' });
    const sd = t.ofKind('SHOWDOWN')[0];
    // First live seat after the button (seat 1) shows first (K-T-9-8-7), not the turn
    // bettor (seat 3); seat 2 (K-Q-J-T-7) beats it and shows; seat 3 pair shows; seat 0 ties.
    expect(sd?.reveals.map((r) => [r.seat, r.mucked])).toEqual([
      [1, false],
      [2, false],
      [3, false],
      [0, false],
    ]);
  });
});

describe('adversarial-betting: winners are always revealed (rule 11, last sentence)', () => {
  it('BUG uncontested side-pot winner is mucked: "Players who win a pot are always revealed"', () => {
    // Seat 3 all-in preflop for 100 (AA). Seats 0, 1, 2 build a 300 side pot on the
    // flop; on the river seats 1 and 2 fold although they could check. Seat 0 (KK)
    // loses the main pot to seat 3, but is the only player eligible for the side
    // pot and WINS it. The engine lets seat 0 muck (cards: null), contradicting
    // CONTRACTS.md §3 rule 11 "Players who win a pot are always revealed".
    const t = new Table({
      stacks: { 0: 1000, 1: 1000, 2: 1000, 3: 100 },
      buttonSeat: 0,
      smallBlindSeat: 1,
      bigBlindSeat: 2,
      hole: { 3: ['Ah', 'Ad'], 0: ['Kh', 'Kd'], 1: ['5c', '6c'], 2: ['8s', '3d'] },
      board: ['2c', '7d', '9h', '4s', 'Jc'],
    });
    t.act(3, { type: 'ALL_IN' });
    t.act(0, { type: 'CALL' });
    t.act(1, { type: 'CALL' });
    t.act(2, { type: 'CHECK' });
    expect(t.state.phase).toBe('FLOP');
    t.act(1, { type: 'BET', amount: 100 });
    t.act(2, { type: 'CALL' });
    t.act(0, { type: 'CALL' });
    for (let i = 0; i < 3; i++) t.act(t.acting as number, { type: 'CHECK' }); // turn
    expect(t.state.phase).toBe('RIVER');
    t.act(1, { type: 'FOLD' });
    t.act(2, { type: 'FOLD' });
    expect(t.state.phase).toBe('HAND_COMPLETE');
    expect(t.state.allInRunOut).toBe(false);
    const awarded = t.ofKind('POT_AWARDED');
    expect(awarded.map((a) => [a.potIndex, a.amount, a.eligibleSeats, a.winners.map((w) => w.seat)])).toEqual([
      [1, 300, [0], [0]],
      [0, 400, [0, 3], [3]],
    ]);
    const reveals = t.ofKind('SHOWDOWN')[0]?.reveals ?? [];
    expect(reveals.map((r) => r.seat)).toEqual([3, 0]);
    const seat0 = reveals.find((r) => r.seat === 0);
    expect(seat0?.mucked).toBe(false);
    expect(seat0?.cards).toEqual(['Kh', 'Kd']);
  });
});

describe('adversarial-betting: buildPots edge cases (rules 9, 10)', () => {
  it('a folded contributor between two all-in levels does not create its own pot', () => {
    const r = buildPots([
      { seat: 0, amount: 200, folded: false },
      { seat: 1, amount: 350, folded: true },
      { seat: 2, amount: 500, folded: false },
      { seat: 3, amount: 500, folded: false },
    ]);
    expect(r.uncalled).toBeNull();
    expect(r.pots.map((p) => [p.type, p.amount, p.eligibleSeats, p.contributorSeats])).toEqual([
      ['MAIN', 800, [0, 2, 3], [0, 1, 2, 3]],
      ['SIDE', 750, [2, 3], [1, 2, 3]],
    ]);
  });

  it('top layers contributed only by folded players merge down to the live player', () => {
    const r = buildPots([
      { seat: 0, amount: 100, folded: false },
      { seat: 1, amount: 400, folded: true },
      { seat: 2, amount: 400, folded: true },
    ]);
    expect(r.uncalled).toBeNull();
    expect(r.pots.map((p) => [p.amount, p.eligibleSeats])).toEqual([[900, [0]]]);
  });

  it('a unique top contribution by a folded player is returned as uncalled', () => {
    const r = buildPots([
      { seat: 0, amount: 100, folded: false },
      { seat: 1, amount: 400, folded: true },
      { seat: 2, amount: 250, folded: true },
    ]);
    expect(r.uncalled).toEqual({ seat: 1, amount: 150 });
    expect(r.pots.map((p) => [p.amount, p.eligibleSeats])).toEqual([[600, [0]]]);
  });

  it('dead money joins the main pot; malformed input throws', () => {
    const r = buildPots(
      [
        { seat: 0, amount: 100, folded: false },
        { seat: 1, amount: 300, folded: false },
      ],
      { deadMoney: 75 },
    );
    expect(r.uncalled).toEqual({ seat: 1, amount: 200 });
    expect(r.pots.map((p) => [p.amount, p.eligibleSeats])).toEqual([[275, [0, 1]]]);
    expect(() => buildPots([{ seat: 0, amount: -1, folded: false }])).toThrow(RangeError);
    expect(() => buildPots([{ seat: 0, amount: 1.5, folded: false }])).toThrow(RangeError);
    expect(() => buildPots([{ seat: 0, amount: Number.NaN, folded: false }])).toThrow(RangeError);
    expect(() =>
      buildPots([
        { seat: 0, amount: 1, folded: false },
        { seat: 0, amount: 1, folded: false },
      ]),
    ).toThrow(RangeError);
  });

  it('currentPots mid-hand reflects live side pots', () => {
    const t = new Table({
      stacks: { 0: 1000, 1: 1000, 2: 1000, 3: 250 },
      buttonSeat: 0,
      smallBlindSeat: 1,
      bigBlindSeat: 2,
    });
    t.act(3, { type: 'ALL_IN' });
    t.act(0, { type: 'CALL' });
    const p = currentPots(t.state);
    // Contributions so far: 3: 250, 0: 250, 1: 50 (SB), 2: 100 (BB); nobody folded.
    expect(p.uncalled).toBeNull();
    expect(p.pots.map((x) => [x.amount, x.eligibleSeats])).toEqual([
      [200, [0, 1, 2, 3]],
      [150, [0, 2, 3]],
      [300, [0, 3]],
    ]);
    expect(p.pots.reduce((s, x) => s + x.amount, 0)).toBe(t.state.pot);
  });
});
