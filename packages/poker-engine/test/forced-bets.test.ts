import { describe, expect, it } from 'vitest';
import { getLegalActions } from '../src';
import { Table } from './helpers';

const ring = (stacks: Record<number, number>, extra: Partial<ConstructorParameters<typeof Table>[0]> = {}) =>
  new Table({ stacks, buttonSeat: 0, smallBlindSeat: 1, bigBlindSeat: 2, ...extra } as ConstructorParameters<
    typeof Table
  >[0]);

describe('blinds and dealing (rules 2, 4)', () => {
  it('posts SB then BB, deals in order, first action after the BB', () => {
    const t = ring({ 0: 1000, 1: 1000, 2: 1000, 3: 1000 });
    expect(t.kinds()).toEqual([
      'HAND_STARTED',
      'FORCED_BET_POSTED',
      'FORCED_BET_POSTED',
      'HOLE_CARDS_DEALT',
      'HOLE_CARDS_DEALT',
      'HOLE_CARDS_DEALT',
      'HOLE_CARDS_DEALT',
      'TURN_TO_ACT',
    ]);
    expect(t.ofKind('FORCED_BET_POSTED').map((e) => [e.seat, e.betType, e.amount])).toEqual([
      [1, 'SMALL_BLIND', 50],
      [2, 'BIG_BLIND', 100],
    ]);
    expect(t.ofKind('HOLE_CARDS_DEALT').map((e) => e.seat)).toEqual([1, 2, 3, 0]);
    expect(t.acting).toBe(3);
    expect(t.state.currentBet).toBe(100);
    expect(t.state.minRaiseIncrement).toBe(100);
    expect(t.state.pot).toBe(150);
    expect(t.state.phase).toBe('PREFLOP');
    const legal = getLegalActions(t.state);
    expect(legal).toMatchObject({
      seat: 3,
      canCall: true,
      callAmount: 100,
      canRaise: true,
      minTo: 200,
      maxTo: 1000,
      canCheck: false,
    });
  });

  it('BB all-in for less than the BB: current bet stays the nominal BB', () => {
    const t = ring({ 0: 1000, 1: 1000, 2: 60, 3: 1000 });
    expect(t.player(2)).toMatchObject({ allIn: true, stack: 0, streetContribution: 60 });
    expect(t.state.currentBet).toBe(100);
    expect(getLegalActions(t.state)).toMatchObject({ callAmount: 100, minTo: 200 });
    // UTG raises to the minimum, everyone folds: BB short all-in never acts.
    t.act(3, { type: 'RAISE', amount: 200 });
    t.act(0, { type: 'FOLD' });
    t.act(1, { type: 'FOLD' });
    // Only seat 3 can act and it has matched: betting closed, run-out to showdown.
    expect(t.state.phase).toBe('HAND_COMPLETE');
    expect(t.ofKind('TURN_TO_ACT').map((e) => e.seat)).toEqual([3, 0, 1]);
    expect(t.ofKind('UNCALLED_BET_RETURNED')).toEqual([
      { kind: 'UNCALLED_BET_RETURNED', seat: 3, playerId: 'p3', amount: 140, stack: 940 },
    ]);
    expect(t.ofKind('STREET_STARTED').map((e) => e.street)).toEqual(['FLOP', 'TURN', 'RIVER']);
  });

  it('SB all-in for less than the SB', () => {
    const t = ring({ 0: 1000, 1: 30, 2: 1000 });
    expect(t.ofKind('FORCED_BET_POSTED').map((e) => [e.seat, e.amount, e.allIn])).toEqual([
      [1, 30, true],
      [2, 100, false],
    ]);
    expect(t.acting).toBe(0);
    t.act(0, { type: 'CALL' });
    // BB has the option.
    expect(t.acting).toBe(2);
    expect(getLegalActions(t.state)).toMatchObject({ canCheck: true, canRaise: true, minTo: 200 });
  });

  it('dead small blind (smallBlindSeat null): only the BB posts', () => {
    const t = new Table({
      stacks: { 0: 1000, 2: 1000, 4: 1000 },
      buttonSeat: 0,
      smallBlindSeat: null,
      bigBlindSeat: 2,
    });
    expect(t.ofKind('FORCED_BET_POSTED').map((e) => e.betType)).toEqual(['BIG_BLIND']);
    expect(t.state.pot).toBe(100);
    expect(t.acting).toBe(4);
  });

  it('dead button (empty button seat): deal and postflop action start after the empty seat', () => {
    const t = new Table({ stacks: { 1: 1000, 3: 1000, 5: 1000 }, buttonSeat: 0, smallBlindSeat: 1, bigBlindSeat: 3 });
    expect(t.ofKind('HOLE_CARDS_DEALT').map((e) => e.seat)).toEqual([1, 3, 5]);
    expect(t.acting).toBe(5);
    t.act(5, { type: 'CALL' });
    t.act(1, { type: 'CALL' });
    t.act(3, { type: 'CHECK' });
    expect(t.state.phase).toBe('FLOP');
    expect(t.acting).toBe(1);
  });

  it('heads-up: button posts SB and acts first preflop, last postflop', () => {
    const t = new Table({ stacks: { 3: 1000, 7: 1000 }, buttonSeat: 3, smallBlindSeat: 3, bigBlindSeat: 7 });
    expect(t.ofKind('FORCED_BET_POSTED').map((e) => [e.seat, e.betType])).toEqual([
      [3, 'SMALL_BLIND'],
      [7, 'BIG_BLIND'],
    ]);
    expect(t.ofKind('HOLE_CARDS_DEALT').map((e) => e.seat)).toEqual([7, 3]);
    expect(t.acting).toBe(3);
    t.act(3, { type: 'CALL' });
    expect(t.acting).toBe(7);
    t.act(7, { type: 'CHECK' });
    expect(t.state.phase).toBe('FLOP');
    expect(t.acting).toBe(7);
    t.act(7, { type: 'CHECK' });
    expect(t.acting).toBe(3);
  });

  it('heads-up: BB all-in for less from the blind, SB must still act', () => {
    const t = new Table({ stacks: { 0: 1000, 1: 70 }, buttonSeat: 0, smallBlindSeat: 0, bigBlindSeat: 1 });
    expect(t.player(1).allIn).toBe(true);
    expect(t.acting).toBe(0);
    expect(getLegalActions(t.state)).toMatchObject({ canCall: true, callAmount: 50, canCheck: false });
    t.act(0, { type: 'CALL' });
    expect(t.state.phase).toBe('HAND_COMPLETE');
    expect(t.ofKind('UNCALLED_BET_RETURNED')[0]).toMatchObject({ seat: 0, amount: 30 });
    expect(t.state.result?.totalPot).toBe(140);
  });

  it('heads-up: SB all-in from the blind, BB has matched: no option, immediate run-out', () => {
    const t = new Table({ stacks: { 0: 40, 1: 1000 }, buttonSeat: 0, smallBlindSeat: 0, bigBlindSeat: 1 });
    expect(t.state.phase).toBe('HAND_COMPLETE');
    expect(t.ofKind('TURN_TO_ACT')).toHaveLength(0);
    expect(t.ofKind('BETTING_ROUND_COMPLETE')).toHaveLength(0);
    expect(t.kinds()).toEqual([
      'HAND_STARTED',
      'FORCED_BET_POSTED',
      'FORCED_BET_POSTED',
      'HOLE_CARDS_DEALT',
      'HOLE_CARDS_DEALT',
      'STREET_STARTED',
      'STREET_STARTED',
      'STREET_STARTED',
      'UNCALLED_BET_RETURNED',
      'SHOWDOWN',
      'POT_AWARDED',
      'HAND_COMPLETED',
    ]);
    expect(t.ofKind('UNCALLED_BET_RETURNED')[0]).toMatchObject({ seat: 1, amount: 60 });
    expect(t.ofKind('SHOWDOWN')[0]?.reveals.every((r) => !r.mucked)).toBe(true);
  });

  it('everyone all-in from the blinds: hand completes inside createHand', () => {
    const t = ring({ 0: 1000, 1: 50, 2: 100 }, { smallBlindSeat: 1, bigBlindSeat: 2 });
    // Seat 0 must still act facing the BB.
    expect(t.acting).toBe(0);
    const t2 = new Table({ stacks: { 1: 50, 2: 100 }, buttonSeat: 1, smallBlindSeat: 1, bigBlindSeat: 2 });
    expect(t2.state.phase).toBe('HAND_COMPLETE');
  });
});

describe('antes (rule 1)', () => {
  it('ALL_PLAYERS: every player posts the ante first (dealing order), dead money', () => {
    const t = ring({ 0: 1000, 1: 1000, 2: 1000 }, { ante: 10, anteType: 'ALL_PLAYERS' });
    expect(t.ofKind('FORCED_BET_POSTED').map((e) => [e.seat, e.betType, e.amount])).toEqual([
      [1, 'ANTE', 10],
      [2, 'ANTE', 10],
      [0, 'ANTE', 10],
      [1, 'SMALL_BLIND', 50],
      [2, 'BIG_BLIND', 100],
    ]);
    expect(t.state.pot).toBe(180);
    expect(t.state.currentBet).toBe(100);
    expect(t.player(2).streetContribution).toBe(100);
    expect(getLegalActions(t.state)).toMatchObject({ callAmount: 100 });
  });

  it('ALL_PLAYERS: a player who cannot cover the ante is all-in and never acts', () => {
    const t = ring({ 0: 6, 1: 1000, 2: 1000, 3: 1000 }, { ante: 10, anteType: 'ALL_PLAYERS' });
    expect(t.player(0)).toMatchObject({ allIn: true, stack: 0, totalContribution: 6 });
    expect(t.acting).toBe(3);
    t.act(3, { type: 'CALL' });
    expect(t.acting).toBe(1);
    t.act(1, { type: 'CALL' });
    t.act(2, { type: 'CHECK' });
    expect(t.state.phase).toBe('FLOP');
    expect(t.ofKind('TURN_TO_ACT').some((e) => e.seat === 0)).toBe(false);
  });

  it('ALL_PLAYERS: the BB covering only part of BB after the ante posts the rest all-in', () => {
    const t = ring({ 0: 1000, 1: 1000, 2: 50 }, { ante: 10, anteType: 'ALL_PLAYERS' });
    expect(
      t
        .ofKind('FORCED_BET_POSTED')
        .filter((e) => e.seat === 2)
        .map((e) => [e.betType, e.amount]),
    ).toEqual([
      ['ANTE', 10],
      ['BIG_BLIND', 40],
    ]);
    expect(t.state.currentBet).toBe(100);
  });

  it('BB_ANTE: the big blind posts the ante once, before the blinds', () => {
    const t = ring({ 0: 1000, 1: 1000, 2: 1000 }, { ante: 100, anteType: 'BB_ANTE' });
    expect(t.ofKind('FORCED_BET_POSTED').map((e) => [e.seat, e.betType, e.amount])).toEqual([
      [2, 'ANTE', 100],
      [1, 'SMALL_BLIND', 50],
      [2, 'BIG_BLIND', 100],
    ]);
    expect(t.state.pot).toBe(250);
  });

  it('BB_ANTE priority: a short big blind posts the blind first, ante from the rest', () => {
    const t = ring({ 0: 1000, 1: 1000, 2: 150 }, { ante: 100, anteType: 'BB_ANTE' });
    expect(t.ofKind('FORCED_BET_POSTED').map((e) => [e.seat, e.betType, e.amount, e.allIn])).toEqual([
      [2, 'ANTE', 50, false],
      [1, 'SMALL_BLIND', 50, false],
      [2, 'BIG_BLIND', 100, true],
    ]);
    // Everyone folds to the all-in BB: SB's half blind is matched, the ante is dead money in the main pot.
    t.act(0, { type: 'FOLD' });
    t.act(1, { type: 'FOLD' });
    expect(t.state.phase).toBe('HAND_COMPLETE');
    expect(t.ofKind('UNCALLED_BET_RETURNED')[0]).toMatchObject({ seat: 2, amount: 50 });
    expect(t.ofKind('POT_AWARDED')).toHaveLength(1);
    expect(t.ofKind('POT_AWARDED')[0]).toMatchObject({ amount: 150, winners: [{ seat: 2, amount: 150 }] });
    expect(t.stack(2)).toBe(200);
  });

  it('BB_ANTE: big blind shorter than the blind posts no ante at all', () => {
    const t = ring({ 0: 1000, 1: 1000, 2: 80 }, { ante: 100, anteType: 'BB_ANTE' });
    expect(t.ofKind('FORCED_BET_POSTED').map((e) => [e.seat, e.betType, e.amount])).toEqual([
      [1, 'SMALL_BLIND', 50],
      [2, 'BIG_BLIND', 80],
    ]);
  });

  it('BB_ANTE: the ante stays dead money in the main pot when the BB loses a side pot', () => {
    // BB posts 100 ante + 100 blind. Seat 0 all-in for 300; BB calls; seat 1 folds.
    const t = ring(
      { 0: 300, 1: 1000, 2: 2000 },
      {
        ante: 100,
        anteType: 'BB_ANTE',
        hole: { 0: ['As', 'Ah'], 1: ['2c', '7d'], 2: ['Kc', 'Kd'] },
        board: ['3s', '8h', '9d', 'Jc', '4s'],
      },
    );
    t.act(0, { type: 'ALL_IN' });
    t.act(1, { type: 'FOLD' });
    t.act(2, { type: 'CALL' });
    expect(t.state.phase).toBe('HAND_COMPLETE');
    const awards = t.ofKind('POT_AWARDED');
    expect(awards).toHaveLength(1);
    // 300 + 300 + SB 50 + ante 100 = 750, all to seat 0.
    expect(awards[0]).toMatchObject({ potType: 'MAIN', amount: 750, winners: [{ seat: 0, amount: 750 }] });
  });

  it('ALL_PLAYERS: unmatched part of an ante comes back with the uncalled bet when everyone else is all-in on partial antes', () => {
    const t = ring({ 0: 1000, 1: 5, 2: 8 }, { ante: 10, anteType: 'ALL_PLAYERS' });
    // Both blinds are all-in from their antes (nothing posted as blinds). The button
    // already covers every opponent and nobody can bet against them, so betting is
    // closed (rule 7) without prompting: no call-or-fold decision, no timeout forfeit.
    expect(t.ofKind('FORCED_BET_POSTED').map((e) => [e.seat, e.betType, e.amount])).toEqual([
      [1, 'ANTE', 5],
      [2, 'ANTE', 8],
      [0, 'ANTE', 10],
    ]);
    expect(t.ofKind('TURN_TO_ACT')).toHaveLength(0);
    expect(t.state.phase).toBe('HAND_COMPLETE');
    expect(t.state.allInRunOut).toBe(true);
    expect(t.ofKind('UNCALLED_BET_RETURNED')[0]).toMatchObject({ seat: 0, amount: 2 });
    expect(t.player(0)).toMatchObject({ totalContribution: 8, anteContribution: 8, streetContribution: 0 });
    const pots = t.ofKind('POT_AWARDED').map((p) => [p.potType, p.amount, p.eligibleSeats]);
    expect(pots).toEqual([
      ['SIDE', 6, [0, 2]],
      ['MAIN', 15, [0, 1, 2]],
    ]);
  });

  it('anteType NONE ignores a configured ante', () => {
    const t = ring({ 0: 1000, 1: 1000, 2: 1000 }, { ante: 25, anteType: 'NONE' });
    expect(t.state.ante).toBe(0);
    expect(t.state.pot).toBe(150);
  });
});
