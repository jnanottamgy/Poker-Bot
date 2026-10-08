/**
 * Adversarial tests (betting lens): NLHE betting rules against CONTRACTS.md §3
 * rules 1-7 and TDA practice. Hand-crafted scenarios with exact numbers.
 */
import type { CardCode } from '@jpb/shared-types';
import { describe, expect, it } from 'vitest';
import { currentPots, getLegalActions, timeoutIntent } from '../src';
import { Table } from './helpers';

const legal = (t: Table) => {
  const l = getLegalActions(t.state);
  if (l === null) throw new Error('nobody to act');
  return l;
};

/** Five players, button 0, SB 1, BB 2; everyone limps preflop, flop order 1,2,3,4,0. */
function fiveToFlop(stacks: Record<number, number>): Table {
  const t = new Table({ stacks, buttonSeat: 0, smallBlindSeat: 1, bigBlindSeat: 2 });
  t.act(3, { type: 'CALL' });
  t.act(4, { type: 'CALL' });
  t.act(0, { type: 'CALL' });
  t.act(1, { type: 'CALL' });
  t.act(2, { type: 'CHECK' });
  expect(t.state.phase).toBe('FLOP');
  expect(t.acting).toBe(1);
  return t;
}

describe('adversarial-betting: minimum bets and raises (rule 5)', () => {
  it('postflop bet/raise chain: each full raise sets the next minimum exactly', () => {
    const t = fiveToFlop({ 0: 5000, 1: 5000, 2: 5000, 3: 5000, 4: 5000 });
    expect(legal(t)).toMatchObject({ canBet: true, canRaise: false, minTo: 100, maxTo: 4900 });
    t.act(1, { type: 'BET', amount: 250 });
    expect(t.state.minRaiseIncrement).toBe(250);
    expect(legal(t)).toMatchObject({
      seat: 2,
      canBet: false,
      canRaise: true,
      minTo: 500,
      maxTo: 4900,
      callAmount: 250,
    });
    expect(t.reject(2, { type: 'BET', amount: 600 })).toBe('BET_NOT_ALLOWED');
    expect(t.reject(2, { type: 'RAISE', amount: 499 })).toBe('AMOUNT_BELOW_MINIMUM');
    expect(t.reject(2, { type: 'RAISE', amount: 250 })).toBe('AMOUNT_BELOW_MINIMUM');
    t.act(2, { type: 'RAISE', amount: 700 }); // increment 450
    expect(t.state.minRaiseIncrement).toBe(450);
    expect(legal(t)).toMatchObject({ seat: 3, minTo: 1150, callAmount: 700 });
    expect(t.reject(3, { type: 'RAISE', amount: 1149 })).toBe('AMOUNT_BELOW_MINIMUM');
    t.act(3, { type: 'RAISE', amount: 1150 });
    expect(legal(t)).toMatchObject({ seat: 4, minTo: 1600 });
  });

  it('preflop open raise to 250 (increment 150): the minimum re-raise is to 400', () => {
    const t = new Table({
      stacks: { 0: 3000, 1: 3000, 2: 3000, 3: 3000 },
      buttonSeat: 0,
      smallBlindSeat: 1,
      bigBlindSeat: 2,
    });
    expect(legal(t)).toMatchObject({ seat: 3, minTo: 200, callAmount: 100, canCheck: false });
    t.act(3, { type: 'RAISE', amount: 250 });
    expect(legal(t)).toMatchObject({ seat: 0, minTo: 400, callAmount: 250 });
    expect(t.reject(0, { type: 'RAISE', amount: 399 })).toBe('AMOUNT_BELOW_MINIMUM');
  });

  it('an incomplete all-in raise does not change the minimum increment for later raisers', () => {
    const t = fiveToFlop({ 0: 5000, 1: 5000, 2: 600, 3: 5000, 4: 5000 });
    t.act(1, { type: 'BET', amount: 300 });
    t.act(2, { type: 'ALL_IN' }); // to 500: increment 200 < 300 -> incomplete
    expect(t.lastEvents[0]).toMatchObject({ kind: 'PLAYER_ACTED', action: 'RAISE', toAmount: 500, allIn: true });
    expect(t.state.minRaiseIncrement).toBe(300);
    expect(t.state.currentBet).toBe(500);
    expect(legal(t)).toMatchObject({ seat: 3, canRaise: true, minTo: 800, callAmount: 500 });
  });
});

describe('adversarial-betting: incomplete raises and re-opening (rule 6, TDA)', () => {
  // Flop: seat 1 bets 200; seat 2 all-in to 300; seat 3 all-in to 400 (or 399).
  const stacks = (s3: number) => ({ 0: 5000, 1: 5000, 2: 400, 3: s3, 4: 5000 });

  it('two incomplete all-ins adding up to EXACTLY a full raise re-open betting for the original bettor', () => {
    const t = fiveToFlop(stacks(500));
    t.act(1, { type: 'BET', amount: 200 });
    t.act(2, { type: 'ALL_IN' }); // to 300
    t.act(3, { type: 'ALL_IN' }); // to 400; cumulative over 200 = 200 = full raise
    expect(t.state.currentBet).toBe(400);
    expect(t.state.minRaiseIncrement).toBe(200);
    expect(legal(t)).toMatchObject({ seat: 4, canRaise: true, minTo: 600 });
    t.act(4, { type: 'CALL' });
    t.act(0, { type: 'CALL' });
    expect(legal(t)).toMatchObject({ seat: 1, canRaise: true, canAllIn: true, minTo: 600, callAmount: 200 });
    t.act(1, { type: 'RAISE', amount: 600 });
    expect(t.lastEvents[0]).toMatchObject({ action: 'RAISE', toAmount: 600 });
  });

  it('cumulative increase one chip short of a full raise: original bettor may only call or fold', () => {
    const t = fiveToFlop(stacks(499));
    t.act(1, { type: 'BET', amount: 200 });
    t.act(2, { type: 'ALL_IN' }); // 300
    t.act(3, { type: 'ALL_IN' }); // 399
    expect(legal(t)).toMatchObject({ seat: 4, canRaise: true, minTo: 599 });
    t.act(4, { type: 'CALL' });
    t.act(0, { type: 'CALL' });
    expect(legal(t)).toMatchObject({ seat: 1, canRaise: false, canAllIn: false, canCall: true, callAmount: 199 });
    expect(t.reject(1, { type: 'RAISE', amount: 599 })).toBe('RAISE_NOT_ALLOWED');
    expect(t.reject(1, { type: 'ALL_IN' })).toBe('RAISE_NOT_ALLOWED');
    t.act(1, { type: 'CALL' });
    // Everyone matched or all-in: round over, turn dealt.
    expect(t.state.phase).toBe('TURN');
  });

  it('a player who called the incomplete raise is closed by a further incomplete raise, the original bettor is re-opened', () => {
    // Seat 1 bets 200, seat 2 all-in 300, seat 3 CALLS 300, seat 4 all-in 450.
    const t = fiveToFlop({ 0: 5000, 1: 5000, 2: 400, 3: 5000, 4: 550 });
    t.act(1, { type: 'BET', amount: 200 });
    t.act(2, { type: 'ALL_IN' });
    t.act(3, { type: 'CALL' });
    t.act(4, { type: 'ALL_IN' }); // 450: +150 over 300, incomplete
    expect(legal(t)).toMatchObject({ seat: 0, canRaise: true, minTo: 650 });
    t.act(0, { type: 'CALL' });
    // Seat 1: 450 - 200 = 250 >= 200 -> open.
    expect(legal(t)).toMatchObject({ seat: 1, canRaise: true, minTo: 650, callAmount: 250 });
    t.act(1, { type: 'CALL' });
    // Seat 3: 450 - 300 = 150 < 200 -> closed.
    expect(legal(t)).toMatchObject({ seat: 3, canRaise: false, canAllIn: false, callAmount: 150 });
  });

  it('a full raise after an incomplete one re-opens betting for the player the incomplete raise had closed', () => {
    const t = fiveToFlop({ 0: 5000, 1: 5000, 2: 400, 3: 5000, 4: 5000 });
    t.act(1, { type: 'BET', amount: 200 });
    t.act(2, { type: 'ALL_IN' }); // 300 incomplete
    t.act(3, { type: 'CALL' }); // 300
    t.act(4, { type: 'RAISE', amount: 600 }); // +300 full
    expect(t.state.minRaiseIncrement).toBe(300);
    t.act(0, { type: 'FOLD' });
    expect(legal(t)).toMatchObject({ seat: 1, canRaise: true, minTo: 900 });
    t.act(1, { type: 'CALL' });
    expect(legal(t)).toMatchObject({ seat: 3, canRaise: true, minTo: 900, callAmount: 300 });
  });

  it('after a full raise, an incomplete all-in re-opens only for players who acted before the full raise', () => {
    // Seat 1 bets 100, seat 2 raises to 400 (full, +300), seat 3 all-in 600 (+200 < 300).
    const t = fiveToFlop({ 0: 5000, 1: 5000, 2: 5000, 3: 700, 4: 5000 });
    t.act(1, { type: 'BET', amount: 100 });
    t.act(2, { type: 'RAISE', amount: 400 });
    t.act(3, { type: 'ALL_IN' });
    expect(t.state.currentBet).toBe(600);
    expect(t.state.minRaiseIncrement).toBe(300);
    t.act(4, { type: 'CALL' });
    t.act(0, { type: 'CALL' });
    expect(legal(t)).toMatchObject({ seat: 1, canRaise: true, minTo: 900, callAmount: 500 });
    t.act(1, { type: 'CALL' });
    expect(legal(t)).toMatchObject({ seat: 2, canRaise: false, canAllIn: false, callAmount: 200 });
    expect(t.reject(2, { type: 'RAISE', amount: 900 })).toBe('RAISE_NOT_ALLOWED');
  });

  it('preflop: full raise then an incomplete all-in: the original raiser is closed, blinds (not yet acted) may raise', () => {
    // UTG(3) raises to 300 (+200), button(0) all-in 450 (+150 incomplete).
    const t = new Table({
      stacks: { 0: 450, 1: 5000, 2: 5000, 3: 5000 },
      buttonSeat: 0,
      smallBlindSeat: 1,
      bigBlindSeat: 2,
    });
    t.act(3, { type: 'RAISE', amount: 300 });
    t.act(0, { type: 'ALL_IN' });
    expect(t.state.currentBet).toBe(450);
    expect(legal(t)).toMatchObject({ seat: 1, canRaise: true, minTo: 650, callAmount: 400 });
    t.act(1, { type: 'CALL' });
    expect(legal(t)).toMatchObject({ seat: 2, canRaise: true, minTo: 650, callAmount: 350 });
    t.act(2, { type: 'CALL' });
    expect(legal(t)).toMatchObject({ seat: 3, canRaise: false, canAllIn: false, callAmount: 150 });
    t.act(3, { type: 'CALL' });
    expect(t.state.phase).toBe('FLOP');
    expect(t.state.pot).toBe(1800);
  });

  it('preflop: limpers facing two short all-ins that add up to a full raise are re-opened (min to 310)', () => {
    const t = new Table({
      stacks: { 0: 5000, 1: 5000, 2: 5000, 3: 5000, 4: 150, 5: 210 },
      buttonSeat: 0,
      smallBlindSeat: 1,
      bigBlindSeat: 2,
    });
    t.act(3, { type: 'CALL' }); // limp 100
    t.act(4, { type: 'ALL_IN' }); // 150 (+50)
    t.act(5, { type: 'ALL_IN' }); // 210 (+60) cumulative over 100 = 110
    t.act(0, { type: 'CALL' });
    t.act(1, { type: 'CALL' });
    t.act(2, { type: 'CALL' });
    expect(legal(t)).toMatchObject({ seat: 3, canRaise: true, minTo: 310, callAmount: 110 });
  });

  it('a check followed by an all-in bet below the big blind keeps the checker call-or-fold (README note 4)', () => {
    const t = fiveToFlop({ 0: 5000, 1: 5000, 2: 140, 3: 5000, 4: 5000 });
    t.act(1, { type: 'CHECK' });
    t.act(2, { type: 'ALL_IN' }); // bet 40 < BB
    expect(t.lastEvents[0]).toMatchObject({ action: 'BET', toAmount: 40, allIn: true });
    expect(legal(t)).toMatchObject({ seat: 3, canRaise: true, minTo: 140 });
    t.act(3, { type: 'CALL' });
    t.act(4, { type: 'CALL' });
    t.act(0, { type: 'CALL' });
    expect(legal(t)).toMatchObject({ seat: 1, canRaise: false, callAmount: 40 });
  });
});

describe('adversarial-betting: short blinds (rules 1-2, 7)', () => {
  it('BB all-in for 60 multiway: UTG must call the nominal 100; exact main/side pots afterwards', () => {
    const hole: Record<number, [CardCode, CardCode]> = { 2: ['Ah', 'Ad'], 3: ['Kh', 'Kd'], 1: ['7c', '2d'] };
    const t = new Table({
      stacks: { 0: 1000, 1: 1000, 2: 60, 3: 1000 },
      buttonSeat: 0,
      smallBlindSeat: 1,
      bigBlindSeat: 2,
      hole,
      board: ['3s', '8h', '9c', 'Js', '4d'],
    });
    expect(t.player(2)).toMatchObject({ allIn: true, stack: 0, streetContribution: 60 });
    expect(t.state.currentBet).toBe(100);
    expect(legal(t)).toMatchObject({ seat: 3, callAmount: 100, minTo: 200, canCheck: false });
    t.act(3, { type: 'CALL' });
    t.act(0, { type: 'FOLD' });
    expect(legal(t)).toMatchObject({ seat: 1, callAmount: 50 });
    t.act(1, { type: 'CALL' });
    expect(t.state.phase).toBe('FLOP');
    const pots = currentPots(t.state);
    expect(pots.pots.map((p) => [p.amount, p.eligibleSeats])).toEqual([
      [180, [1, 2, 3]],
      [80, [1, 3]],
    ]);
    expect(pots.uncalled).toBeNull();
    t.act(1, { type: 'CHECK' });
    t.act(3, { type: 'BET', amount: 100 });
    t.act(1, { type: 'FOLD' });
    expect(t.state.phase).toBe('HAND_COMPLETE');
    expect(t.state.allInRunOut).toBe(true);
    expect(t.ofKind('UNCALLED_BET_RETURNED')).toEqual([
      { kind: 'UNCALLED_BET_RETURNED', seat: 3, playerId: 'p3', amount: 100, stack: 900 },
    ]);
    const awarded = t.ofKind('POT_AWARDED');
    expect(awarded.map((a) => [a.potIndex, a.amount, a.winners.map((w) => [w.seat, w.amount])])).toEqual([
      [1, 80, [[3, 80]]],
      [0, 180, [[2, 180]]],
    ]);
    expect(t.state.players.map((p) => p.stack)).toEqual([1000, 900, 180, 980]);
  });

  it('SB all-in for less than the small blind: BB keeps the option only if someone can still bet against them', () => {
    const t = new Table({
      stacks: { 0: 1000, 1: 30, 2: 1000 },
      buttonSeat: 0,
      smallBlindSeat: 1,
      bigBlindSeat: 2,
    });
    expect(t.player(1)).toMatchObject({ allIn: true, streetContribution: 30 });
    expect(legal(t)).toMatchObject({ seat: 0, callAmount: 100, minTo: 200 });
    t.act(0, { type: 'CALL' });
    // BB has an option: button can still act.
    expect(legal(t)).toMatchObject({ seat: 2, canCheck: true, canRaise: true, minTo: 200 });
    t.act(2, { type: 'CHECK' });
    expect(t.state.phase).toBe('FLOP');
    expect(currentPots(t.state).pots.map((p) => [p.amount, p.eligibleSeats])).toEqual([
      [90, [0, 1, 2]],
      [140, [0, 2]],
    ]);
  });

  it('BUG heads-up BB all-in for LESS than the posted SB: SB faces no bet, betting must be closed (no fold/timeout forfeit)', () => {
    // SB/button posts 50, BB is all-in for 30. Nobody can bet against the SB and
    // the SB already covers the BB: there is no decision to make (TDA). The
    // engine instead asks the SB to call 50 more or fold, and the timeout
    // intent (CHECK_ELSE_FOLD) FOLDS, forfeiting 30 chips to a hand that is
    // already covered.
    const t = new Table({
      stacks: { 0: 1000, 1: 30 },
      buttonSeat: 0,
      smallBlindSeat: 0,
      bigBlindSeat: 1,
      hole: { 0: ['Ah', 'Ad'], 1: ['7c', '2d'] },
      board: ['3s', '8h', '9c', 'Js', '4d'],
    });
    const timeout = t.state.actingSeat === null ? null : timeoutIntent(t.state);
    expect(timeout).toBeNull();
    expect(t.state.phase).toBe('HAND_COMPLETE');
    expect(t.ofKind('TURN_TO_ACT')).toHaveLength(0);
    expect(t.ofKind('UNCALLED_BET_RETURNED')[0]).toMatchObject({ seat: 0, amount: 20 });
    expect(t.state.players.map((p) => p.stack)).toEqual([1030, 0]);
  });

  it('BUG 3-handed: button folds, BB all-in for LESS than the SB: SB must not be asked to call or fold', () => {
    const t = new Table({
      stacks: { 0: 1000, 1: 1000, 2: 30 },
      buttonSeat: 0,
      smallBlindSeat: 1,
      bigBlindSeat: 2,
      hole: { 1: ['Ah', 'Ad'], 2: ['7c', '2d'] },
      board: ['3s', '8h', '9c', 'Js', '4d'],
    });
    expect(legal(t)).toMatchObject({ seat: 0, callAmount: 100 });
    t.act(0, { type: 'FOLD' });
    expect(t.state.actingSeat).toBeNull();
    expect(t.state.phase).toBe('HAND_COMPLETE');
    // SB gets the unmatched 20 back and wins 60 with aces.
    expect(t.state.players.map((p) => p.stack)).toEqual([1000, 1030, 0]);
  });

  it('BUG ALL_PLAYERS ante leaves the BB all-in for less than the SB; a timeout then folds the covering SB', () => {
    // Ante 25: BB (60) posts ante 25 then is all-in for 35 < SB 50. Button folds.
    // The SB already covers the BB and nobody else can act, so betting is over
    // (rule 7 / TDA). The engine prompts the SB; CHECK_ELSE_FOLD folds and the
    // SB loses 60 chips without a showdown.
    const t = new Table({
      stacks: { 0: 1000, 1: 1000, 2: 60 },
      buttonSeat: 0,
      smallBlindSeat: 1,
      bigBlindSeat: 2,
      ante: 25,
      anteType: 'ALL_PLAYERS',
      hole: { 1: ['Ah', 'Ad'], 2: ['7c', '2d'] },
      board: ['3s', '8h', '9c', 'Js', '4d'],
    });
    expect(t.player(2)).toMatchObject({ allIn: true, streetContribution: 35 });
    t.act(0, { type: 'FOLD' });
    expect(t.state.actingSeat, 'SB must not be prompted').toBeNull();
    expect(t.state.phase).toBe('HAND_COMPLETE');
    // SB: 1000 - 75 + 15 returned + pot (25 + 60 + 60 = 145) = 1085.
    expect(t.state.players.map((p) => p.stack)).toEqual([975, 1085, 0]);
  });

  it('BB all-in for less, button (0 in) faces a real bet and must act; calling the nominal BB returns the excess', () => {
    const t = new Table({
      stacks: { 0: 1000, 1: 1000, 2: 30 },
      buttonSeat: 0,
      smallBlindSeat: null,
      bigBlindSeat: 2,
      hole: { 0: ['Ah', 'Ad'], 2: ['7c', '2d'] },
      board: ['3s', '8h', '9c', 'Js', '4d'],
    });
    // Dead SB: first to act after BB is seat 0, then seat 1.
    expect(legal(t)).toMatchObject({ seat: 0, callAmount: 100 });
    t.act(0, { type: 'CALL' });
    t.act(1, { type: 'FOLD' });
    expect(t.state.phase).toBe('HAND_COMPLETE');
    expect(t.ofKind('UNCALLED_BET_RETURNED')[0]).toMatchObject({ seat: 0, amount: 70 });
    expect(t.state.players.map((p) => p.stack)).toEqual([1030, 1000, 0]);
  });

  it('ALL_PLAYERS ante leaves the BB short: ante first, then BB all-in for the rest; current bet stays nominal', () => {
    const t = new Table({
      stacks: { 0: 1000, 1: 1000, 2: 120, 3: 1000 },
      buttonSeat: 0,
      smallBlindSeat: 1,
      bigBlindSeat: 2,
      ante: 30,
      anteType: 'ALL_PLAYERS',
    });
    const posts = t.ofKind('FORCED_BET_POSTED').map((e) => [e.seat, e.betType, e.amount, e.allIn]);
    expect(posts).toEqual([
      [1, 'ANTE', 30, false],
      [2, 'ANTE', 30, false],
      [3, 'ANTE', 30, false],
      [0, 'ANTE', 30, false],
      [1, 'SMALL_BLIND', 50, false],
      [2, 'BIG_BLIND', 90, true],
    ]);
    expect(t.state.currentBet).toBe(100);
    expect(t.state.pot).toBe(260);
    expect(legal(t)).toMatchObject({ seat: 3, callAmount: 100, minTo: 200 });
  });

  it('BB_ANTE priority: blind first, ante from the remainder; dead ante goes to the main pot; uncalled raise returned', () => {
    const t = new Table({
      stacks: { 0: 1000, 1: 1000, 2: 250, 3: 1000 },
      buttonSeat: 0,
      smallBlindSeat: 1,
      bigBlindSeat: 2,
      ante: 200,
      anteType: 'BB_ANTE',
      hole: { 2: ['Ah', 'Ad'], 3: ['Kh', 'Kd'] },
      board: ['3s', '8h', '9c', 'Js', '4d'],
    });
    expect(t.ofKind('FORCED_BET_POSTED').map((e) => [e.seat, e.betType, e.amount, e.allIn])).toEqual([
      [2, 'ANTE', 150, false],
      [1, 'SMALL_BLIND', 50, false],
      [2, 'BIG_BLIND', 100, true],
    ]);
    t.act(3, { type: 'RAISE', amount: 300 });
    t.act(0, { type: 'FOLD' });
    t.act(1, { type: 'FOLD' });
    expect(t.state.phase).toBe('HAND_COMPLETE');
    expect(t.ofKind('UNCALLED_BET_RETURNED')[0]).toMatchObject({ seat: 3, amount: 200 });
    const awarded = t.ofKind('POT_AWARDED');
    expect(awarded).toHaveLength(1);
    expect(awarded[0]).toMatchObject({ potType: 'MAIN', amount: 400, eligibleSeats: [2, 3] });
    expect(t.state.players.map((p) => p.stack)).toEqual([1000, 950, 400, 900]);
  });

  it('BB_ANTE with a BB holding exactly the big blind posts no ante event at all', () => {
    const t = new Table({
      stacks: { 0: 1000, 1: 1000, 2: 100 },
      buttonSeat: 0,
      smallBlindSeat: 1,
      bigBlindSeat: 2,
      ante: 100,
      anteType: 'BB_ANTE',
    });
    expect(t.ofKind('FORCED_BET_POSTED').map((e) => e.betType)).toEqual(['SMALL_BLIND', 'BIG_BLIND']);
    expect(t.state.pot).toBe(150);
  });
});

describe('adversarial-betting: action order, heads-up, dead SB / dead button (rules 3-4)', () => {
  it('heads-up: button/SB acts first preflop and last on every later street', () => {
    const t = new Table({
      stacks: { 3: 1000, 7: 1000 },
      maxSeats: 9,
      buttonSeat: 7,
      smallBlindSeat: 7,
      bigBlindSeat: 3,
    });
    expect(t.ofKind('FORCED_BET_POSTED').map((e) => [e.seat, e.betType])).toEqual([
      [7, 'SMALL_BLIND'],
      [3, 'BIG_BLIND'],
    ]);
    expect(t.ofKind('HOLE_CARDS_DEALT').map((e) => e.seat)).toEqual([3, 7]);
    expect(legal(t)).toMatchObject({ seat: 7, callAmount: 50, minTo: 200 });
    t.act(7, { type: 'CALL' });
    expect(legal(t)).toMatchObject({ seat: 3, canCheck: true, canRaise: true, minTo: 200 });
    t.act(3, { type: 'CHECK' });
    for (const street of ['FLOP', 'TURN', 'RIVER']) {
      expect(t.state.phase).toBe(street);
      expect(t.acting).toBe(3);
      t.act(3, { type: 'CHECK' });
      expect(t.acting).toBe(7);
      t.act(7, { type: 'CHECK' });
    }
    expect(t.state.phase).toBe('HAND_COMPLETE');
  });

  it('dead button (empty seat 3): preflop order after BB, postflop order from the first seat after the empty button', () => {
    const t = new Table({
      stacks: { 1: 1000, 2: 1000, 4: 1000, 5: 1000 },
      maxSeats: 6,
      buttonSeat: 3,
      smallBlindSeat: 4,
      bigBlindSeat: 5,
    });
    const order: number[] = [];
    const step = (type: 'CALL' | 'CHECK') => {
      order.push(t.acting as number);
      t.act(t.acting as number, { type });
    };
    step('CALL');
    step('CALL');
    step('CALL');
    step('CHECK');
    expect(order).toEqual([1, 2, 4, 5]);
    order.length = 0;
    for (let i = 0; i < 4; i++) step('CHECK');
    expect(order).toEqual([4, 5, 1, 2]);
  });

  it('dead small blind, everyone folds to the BB: blind returned, no pot awarded, stacks unchanged', () => {
    const t = new Table({
      stacks: { 0: 1000, 1: 1000, 2: 1000, 3: 1000 },
      buttonSeat: 0,
      smallBlindSeat: null,
      bigBlindSeat: 2,
    });
    expect(legal(t).seat).toBe(3);
    t.act(3, { type: 'FOLD' });
    t.act(0, { type: 'FOLD' });
    t.act(1, { type: 'FOLD' });
    expect(t.state.phase).toBe('HAND_COMPLETE');
    expect(t.kinds(t.lastEvents)).toEqual([
      'PLAYER_ACTED',
      'BETTING_ROUND_COMPLETE',
      'UNCALLED_BET_RETURNED',
      'HAND_COMPLETED',
    ]);
    expect(t.state.players.map((p) => p.stack)).toEqual([1000, 1000, 1000, 1000]);
    expect(t.state.result?.totalPot).toBe(0);
  });

  it('wrap-around: BB on the highest seat, first preflop actor wraps to seat 0', () => {
    const t = new Table({
      stacks: { 0: 1000, 6: 1000, 7: 1000, 8: 1000 },
      maxSeats: 9,
      buttonSeat: 6,
      smallBlindSeat: 7,
      bigBlindSeat: 8,
    });
    expect(t.acting).toBe(0);
  });
});
