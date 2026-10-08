import type { CardCode } from '@jpb/shared-types';
import { describe, expect, it } from 'vitest';
import { Table } from './helpers';

type Hole = Record<number, [CardCode, CardCode]>;
const DRY_BOARD: CardCode[] = ['2c', '7d', '9h', 'Js', 'Kd'];

const three = (
  hole: Hole,
  board: CardCode[] = DRY_BOARD,
  stacks: Record<number, number> = { 0: 1000, 1: 1000, 2: 1000 },
) => new Table({ stacks, buttonSeat: 0, smallBlindSeat: 1, bigBlindSeat: 2, hole, board });

const limpAndCheckToRiver = (t: Table) => {
  t.act(0, { type: 'CALL' });
  t.act(1, { type: 'CALL' });
  t.act(2, { type: 'CHECK' });
  for (const street of ['FLOP', 'TURN']) {
    expect(t.state.phase).toBe(street);
    t.act(1, { type: 'CHECK' });
    t.act(2, { type: 'CHECK' });
    t.act(0, { type: 'CHECK' });
  }
  expect(t.state.phase).toBe('RIVER');
};

describe('showdown reveal order and mucking (rule 11)', () => {
  const hole: Hole = { 0: ['Qc', 'Qd'], 1: ['Jc', 'Jh'], 2: ['Ah', 'Kc'] };

  it('river aggressor shows first; then clockwise, losers muck, better hands show', () => {
    const t = three(hole);
    limpAndCheckToRiver(t);
    t.act(1, { type: 'CHECK' });
    t.act(2, { type: 'BET', amount: 100 });
    t.act(0, { type: 'CALL' });
    t.act(1, { type: 'CALL' });
    const sd = t.ofKind('SHOWDOWN')[0];
    expect(sd?.reveals.map((r) => [r.seat, r.mucked])).toEqual([
      [2, false],
      [0, true],
      [1, false],
    ]);
    const mucked = sd?.reveals.find((r) => r.seat === 0);
    expect(mucked).toMatchObject({ cards: null, hand: null, mucked: true });
    expect(sd?.reveals.find((r) => r.seat === 1)?.hand?.description).toBe('Three of a Kind, Jacks');
    const award = t.ofKind('POT_AWARDED')[0];
    expect(award).toMatchObject({ potType: 'MAIN', amount: 600, winners: [{ seat: 1, amount: 600, oddChips: 0 }] });
    expect(award?.winningHand?.description).toBe('Three of a Kind, Jacks');
    expect(t.state.result?.evaluated).toHaveLength(3);
  });

  it('no river bet: the first live seat after the button shows first', () => {
    const t = three(hole);
    limpAndCheckToRiver(t);
    t.act(1, { type: 'CHECK' });
    t.act(2, { type: 'CHECK' });
    t.act(0, { type: 'CHECK' });
    expect(t.ofKind('SHOWDOWN')[0]?.reveals.map((r) => [r.seat, r.mucked])).toEqual([
      [1, false],
      [2, true],
      [0, true],
    ]);
  });

  it('a player who ties a shown hand shows (split pot)', () => {
    const t = three({ 0: ['3c', '4d'], 1: ['3h', '4s'], 2: ['5c', '6h'] }, ['As', 'Ks', 'Qd', 'Jc', 'Th']);
    limpAndCheckToRiver(t);
    t.act(1, { type: 'CHECK' });
    t.act(2, { type: 'CHECK' });
    t.act(0, { type: 'CHECK' });
    expect(t.ofKind('SHOWDOWN')[0]?.reveals.every((r) => !r.mucked)).toBe(true);
    expect(t.ofKind('POT_AWARDED')[0]?.winners.map((w) => w.seat)).toEqual([1, 2, 0]);
  });

  it('all-in before the river: every live hand is revealed, clockwise from the button', () => {
    const t = three(hole, DRY_BOARD, { 0: 1000, 1: 1000, 2: 1000 });
    t.act(0, { type: 'ALL_IN' });
    t.act(1, { type: 'ALL_IN' });
    t.act(2, { type: 'ALL_IN' });
    expect(t.state.allInRunOut).toBe(true);
    expect(t.ofKind('SHOWDOWN')[0]?.reveals.map((r) => [r.seat, r.mucked])).toEqual([
      [1, false],
      [2, false],
      [0, false],
    ]);
  });

  it('side pots: short all-in wins main, side pot loser mucks, side pot winner shows', () => {
    const t = three({ 0: ['As', 'Ad'], 1: ['Kh', 'Kd'], 2: ['Qh', 'Qs'] }, ['2c', '7d', '9h', '3s', '4d'], {
      0: 300,
      1: 2000,
      2: 2000,
    });
    t.act(0, { type: 'ALL_IN' });
    t.act(1, { type: 'CALL' });
    t.act(2, { type: 'CALL' });
    // Two players can still bet: no run-out.
    expect(t.state.phase).toBe('FLOP');
    t.act(1, { type: 'CHECK' });
    t.act(2, { type: 'CHECK' });
    t.act(1, { type: 'CHECK' });
    t.act(2, { type: 'CHECK' });
    t.act(1, { type: 'BET', amount: 500 });
    t.act(2, { type: 'CALL' });
    expect(t.state.allInRunOut).toBe(false);
    expect(t.ofKind('SHOWDOWN')[0]?.reveals.map((r) => [r.seat, r.mucked])).toEqual([
      [1, false],
      [2, true],
      [0, false],
    ]);
    const awards = t.ofKind('POT_AWARDED');
    expect(awards.map((a) => [a.potIndex, a.potType, a.amount, a.eligibleSeats, a.winners.map((w) => w.seat)])).toEqual(
      [
        [1, 'SIDE', 1000, [1, 2], [1]],
        [0, 'MAIN', 900, [0, 1, 2], [0]],
      ],
    );
    expect(t.state.result?.finalStacks).toEqual([
      { seat: 0, playerId: 'p0', stack: 900 },
      { seat: 1, playerId: 'p1', stack: 2200 },
      { seat: 2, playerId: 'p2', stack: 1200 },
    ]);
  });

  it('a hand that loses the main pot but wins a side pot is shown', () => {
    const t = three({ 0: ['As', 'Ad'], 1: ['Qh', 'Qs'], 2: ['Kh', 'Kd'] }, ['2c', '7d', '9h', '3s', '4d'], {
      0: 300,
      1: 2000,
      2: 2000,
    });
    t.act(0, { type: 'ALL_IN' });
    t.act(1, { type: 'CALL' });
    t.act(2, { type: 'CALL' });
    for (let i = 0; i < 3; i++) {
      t.act(1, { type: 'CHECK' });
      t.act(2, { type: 'CHECK' });
    }
    // No river bet: seat 1 (first after button) shows QQ, seat 2 shows KK (wins side), seat 0 shows AA (wins main).
    expect(t.ofKind('SHOWDOWN')[0]?.reveals.map((r) => [r.seat, r.mucked])).toEqual([
      [1, false],
      [2, false],
      [0, false],
    ]);
  });

  it('tied side pot with an odd chip; main pot to the short stack', () => {
    const t = new Table({
      stacks: { 0: 300, 1: 2000, 2: 2000, 3: 2000 },
      buttonSeat: 0,
      smallBlindSeat: 1,
      bigBlindSeat: 2,
      hole: { 0: ['As', 'Ad'], 1: ['Kc', 'Qd'], 2: ['Kh', 'Qs'], 3: ['8c', '8d'] },
      board: ['2c', '7d', '9h', '3s', '4d'],
    });
    t.act(3, { type: 'RAISE', amount: 401 });
    t.act(0, { type: 'ALL_IN' });
    t.act(1, { type: 'CALL' });
    t.act(2, { type: 'CALL' });
    t.act(1, { type: 'BET', amount: 200 });
    t.act(2, { type: 'CALL' });
    t.act(3, { type: 'FOLD' });
    for (let i = 0; i < 2; i++) {
      t.act(1, { type: 'CHECK' });
      t.act(2, { type: 'CHECK' });
    }
    const awards = t.ofKind('POT_AWARDED');
    // Side: 101*3 + 200*2 = 703 split between 1 and 2; odd chip to seat 1 (first after the button).
    expect(awards[0]).toMatchObject({
      potType: 'SIDE',
      amount: 703,
      eligibleSeats: [1, 2],
      winners: [
        { seat: 1, amount: 352, oddChips: 1 },
        { seat: 2, amount: 351, oddChips: 0 },
      ],
    });
    expect(awards[1]).toMatchObject({
      potType: 'MAIN',
      amount: 1200,
      eligibleSeats: [0, 1, 2],
      winners: [{ seat: 0, amount: 1200 }],
    });
    expect(t.state.players.find((p) => p.seat === 3)?.won).toBe(0);
  });

  it('3-way split of an odd pot: odd chip clockwise from the first seat after the button', () => {
    const t = new Table({
      stacks: { 0: 1000, 1: 1000, 2: 1000, 3: 1000 },
      buttonSeat: 0,
      smallBlindSeat: 1,
      bigBlindSeat: 2,
      ante: 1,
      anteType: 'ALL_PLAYERS',
      hole: { 0: ['2c', '3d'], 1: ['2d', '3h'], 2: ['2h', '3s'], 3: ['4c', '5c'] },
      board: ['As', 'Ks', 'Qs', 'Js', 'Ts'],
    });
    t.act(3, { type: 'FOLD' });
    t.act(0, { type: 'CALL' });
    t.act(1, { type: 'CALL' });
    t.act(2, { type: 'CHECK' });
    for (let i = 0; i < 3; i++) {
      t.act(1, { type: 'CHECK' });
      t.act(2, { type: 'CHECK' });
      t.act(0, { type: 'CHECK' });
    }
    const award = t.ofKind('POT_AWARDED')[0];
    expect(award?.amount).toBe(304);
    expect(award?.winners).toEqual([
      { seat: 1, playerId: 'p1', amount: 102, oddChips: 1 },
      { seat: 2, playerId: 'p2', amount: 101, oddChips: 0 },
      { seat: 0, playerId: 'p0', amount: 101, oddChips: 0 },
    ]);
    expect(award?.winningHand?.category).toBe('ROYAL_FLUSH');
  });

  it('4-player all-in at four different levels: main + two side pots, uncalled top stack', () => {
    const t = new Table({
      stacks: { 0: 100, 1: 300, 2: 600, 3: 1000 },
      buttonSeat: 0,
      smallBlindSeat: 1,
      bigBlindSeat: 2,
      hole: { 0: ['As', 'Ad'], 1: ['Ks', 'Kd'], 2: ['Qs', 'Qd'], 3: ['Js', 'Jd'] },
      board: ['2c', '7d', '9h', '3s', '4d'],
    });
    t.act(3, { type: 'ALL_IN' });
    t.act(0, { type: 'ALL_IN' });
    t.act(1, { type: 'ALL_IN' });
    t.act(2, { type: 'ALL_IN' });
    expect(t.state.phase).toBe('HAND_COMPLETE');
    expect(t.ofKind('UNCALLED_BET_RETURNED')[0]).toMatchObject({ seat: 3, amount: 400 });
    expect(
      t.ofKind('POT_AWARDED').map((a) => [a.potType, a.amount, a.eligibleSeats, a.winners.map((w) => w.seat)]),
    ).toEqual([
      ['SIDE', 600, [2, 3], [2]],
      ['SIDE', 600, [1, 2, 3], [1]],
      ['MAIN', 400, [0, 1, 2, 3], [0]],
    ]);
    expect(t.state.result?.finalStacks.map((f) => f.stack)).toEqual([400, 600, 600, 400]);
    expect(t.state.result?.bustedSeats).toEqual([]);
  });

  it('fold win shows no cards', () => {
    const t = three(hole);
    t.act(0, { type: 'RAISE', amount: 300 });
    t.act(1, { type: 'FOLD' });
    t.act(2, { type: 'FOLD' });
    expect(t.ofKind('SHOWDOWN')).toHaveLength(0);
    expect(t.state.result).toMatchObject({ winType: 'FOLD', reveals: [], evaluated: [] });
    expect(t.ofKind('POT_AWARDED')[0]?.winningHand).toBeNull();
  });

  it('busted players are reported', () => {
    const t = three(hole, DRY_BOARD, { 0: 500, 1: 1000, 2: 1000 });
    t.act(0, { type: 'ALL_IN' });
    t.act(1, { type: 'ALL_IN' });
    t.act(2, { type: 'FOLD' });
    // Board 2 7 9 J K gives seat 1 trips (JJ) over seat 0's QQ; seat 1's extra 500 is uncalled.
    expect(t.ofKind('HAND_COMPLETED')[0]?.bustedSeats).toEqual([0]);
    expect(t.stack(1)).toBe(1000 + 500 + 100);
  });
});
