import { describe, expect, it } from 'vitest';
import { getLegalActions, timeoutIntent } from '../src';
import { Table } from './helpers';

/** 4 players, button 0, SB 1, BB 2, UTG 3; blinds 50/100. */
const four = (stacks: Record<number, number> = { 0: 1000, 1: 1000, 2: 1000, 3: 1000 }) =>
  new Table({ stacks, buttonSeat: 0, smallBlindSeat: 1, bigBlindSeat: 2 });

/** Reaches the flop with everyone in for 100. Postflop order: 1, 2, 3, 0. */
const toFlop = (stacks?: Record<number, number>) => {
  const t = four(stacks);
  t.act(3, { type: 'CALL' });
  t.act(0, { type: 'CALL' });
  t.act(1, { type: 'CALL' });
  t.act(2, { type: 'CHECK' });
  expect(t.state.phase).toBe('FLOP');
  return t;
};

describe('legal actions (rule 5)', () => {
  it('BB option after limps: check or raise', () => {
    const t = four();
    t.act(3, { type: 'CALL' });
    t.act(0, { type: 'CALL' });
    t.act(1, { type: 'CALL' });
    expect(getLegalActions(t.state)).toMatchObject({
      seat: 2,
      canCheck: true,
      canCall: false,
      canBet: false,
      canRaise: true,
      minTo: 200,
      maxTo: 1000,
      canAllIn: true,
      allInTo: 1000,
    });
  });

  it('postflop: bet when unopened, min bet is the big blind', () => {
    const t = toFlop();
    expect(t.acting).toBe(1);
    expect(getLegalActions(t.state)).toMatchObject({
      canCheck: true,
      canBet: true,
      canRaise: false,
      minTo: 100,
      maxTo: 900,
    });
    expect(t.reject(1, { type: 'BET', amount: 99 })).toBe('AMOUNT_BELOW_MINIMUM');
    expect(t.reject(1, { type: 'BET', amount: 901 })).toBe('AMOUNT_ABOVE_MAXIMUM');
    expect(t.reject(1, { type: 'RAISE', amount: 200 })).toBe('RAISE_NOT_ALLOWED');
    expect(t.reject(1, { type: 'CALL' })).toBe('CALL_NOT_ALLOWED');
  });

  it('a bet smaller than the big blind is only possible as all-in', () => {
    const t = toFlop({ 0: 1000, 1: 140, 2: 1000, 3: 1000 });
    expect(getLegalActions(t.state)).toMatchObject({ seat: 1, canBet: true, minTo: 40, maxTo: 40 });
    t.act(1, { type: 'BET', amount: 40 });
    expect(t.player(1).allIn).toBe(true);
    expect(t.state.currentBet).toBe(40);
    expect(t.state.minRaiseIncrement).toBe(100);
    // Next player (has not acted) may raise; the minimum is 40 + full bet (100).
    expect(getLegalActions(t.state)).toMatchObject({ seat: 2, canRaise: true, minTo: 140, callAmount: 40 });
  });

  it('call is capped at the stack (all-in call); no raise without chips beyond the call', () => {
    const t = four({ 0: 600, 1: 1000, 2: 1000, 3: 1000 });
    t.act(3, { type: 'RAISE', amount: 1000 });
    expect(getLegalActions(t.state)).toMatchObject({
      seat: 0,
      callAmount: 600,
      canRaise: false,
      canAllIn: true,
      allInTo: 600,
    });
    t.act(0, { type: 'CALL' });
    expect(t.lastEvents[0]).toMatchObject({ action: 'CALL', amount: 600, allIn: true });
    expect(getLegalActions(t.state)).toMatchObject({ seat: 1, callAmount: 950, canRaise: false, canAllIn: true });
  });
});

describe('min-raise tracking', () => {
  it('raise increments compound: each full raise sets the new minimum increment', () => {
    const t = four({ 0: 5000, 1: 5000, 2: 5000, 3: 5000 });
    t.act(3, { type: 'RAISE', amount: 300 }); // +200
    expect(t.state.minRaiseIncrement).toBe(200);
    expect(getLegalActions(t.state)).toMatchObject({ minTo: 500 });
    t.act(0, { type: 'RAISE', amount: 700 }); // +400
    expect(t.state.minRaiseIncrement).toBe(400);
    expect(getLegalActions(t.state)).toMatchObject({ seat: 1, minTo: 1100 });
    expect(t.reject(1, { type: 'RAISE', amount: 1099 })).toBe('AMOUNT_BELOW_MINIMUM');
    t.act(1, { type: 'RAISE', amount: 1100 }); // +400 exactly (min raise)
    expect(t.state.minRaiseIncrement).toBe(400);
    expect(getLegalActions(t.state)).toMatchObject({ seat: 2, minTo: 1500 });
  });

  it('street change resets current bet and min increment to the big blind', () => {
    const t = four({ 0: 5000, 1: 5000, 2: 5000, 3: 5000 });
    t.act(3, { type: 'RAISE', amount: 400 });
    t.act(0, { type: 'CALL' });
    t.act(1, { type: 'FOLD' });
    t.act(2, { type: 'CALL' });
    expect(t.state.phase).toBe('FLOP');
    expect(t.state.currentBet).toBe(0);
    expect(t.state.minRaiseIncrement).toBe(100);
    expect(t.acting).toBe(2);
  });

  it('raise below the minimum is allowed only as all-in', () => {
    const t = four({ 0: 1000, 1: 1000, 2: 1000, 3: 150 });
    expect(getLegalActions(t.state)).toMatchObject({ seat: 3, canRaise: true, minTo: 150, maxTo: 150 });
    t.act(3, { type: 'RAISE', amount: 150 });
    expect(t.state.currentBet).toBe(150);
    expect(t.state.minRaiseIncrement).toBe(100);
  });
});

describe('incomplete raises (rule 6, TDA)', () => {
  it('an all-in for less than a full raise does not re-open betting for players who already acted', () => {
    const t = toFlop({ 0: 2000, 1: 2000, 2: 250, 3: 2000 });
    t.act(1, { type: 'BET', amount: 100 });
    t.act(2, { type: 'ALL_IN' }); // to 150: +50 < 100, incomplete
    expect(t.lastEvents[0]).toMatchObject({ kind: 'PLAYER_ACTED', action: 'RAISE', toAmount: 150, allIn: true });
    expect(t.state.currentBet).toBe(150);
    expect(t.state.minRaiseIncrement).toBe(100);
    // Seat 3 has not acted yet: may raise, min to 250.
    expect(getLegalActions(t.state)).toMatchObject({ seat: 3, canRaise: true, minTo: 250 });
    t.act(3, { type: 'CALL' });
    t.act(0, { type: 'CALL' });
    // Seat 1 already acted at 100 and faces only +50: call or fold only.
    expect(t.acting).toBe(1);
    expect(getLegalActions(t.state)).toMatchObject({ canCall: true, callAmount: 50, canRaise: false, canAllIn: false });
    expect(t.reject(1, { type: 'RAISE', amount: 400 })).toBe('RAISE_NOT_ALLOWED');
    expect(t.reject(1, { type: 'ALL_IN' })).toBe('RAISE_NOT_ALLOWED');
    t.act(1, { type: 'CALL' });
    expect(t.state.phase).toBe('TURN');
  });

  it('cumulative incomplete raises totalling a full raise DO re-open betting', () => {
    const t = toFlop({ 0: 2000, 1: 2000, 2: 250, 3: 310 });
    t.act(1, { type: 'BET', amount: 100 });
    t.act(2, { type: 'ALL_IN' }); // 150 (+50)
    t.act(3, { type: 'ALL_IN' }); // 210 (+60), cumulative +110 over seat 1's 100
    expect(t.state.currentBet).toBe(210);
    expect(t.state.minRaiseIncrement).toBe(100);
    t.act(0, { type: 'CALL' });
    expect(t.acting).toBe(1);
    expect(getLegalActions(t.state)).toMatchObject({ canRaise: true, minTo: 310, callAmount: 110 });
    t.act(1, { type: 'RAISE', amount: 310 });
    // Seat 0 called 210 and now faces a full raise: re-opened.
    expect(getLegalActions(t.state)).toMatchObject({ seat: 0, canRaise: true, minTo: 410 });
  });

  it('the original raiser facing an incomplete all-in re-raise may only call or fold', () => {
    const t = four({ 0: 2000, 1: 2000, 2: 350, 3: 2000 });
    t.act(3, { type: 'CALL' });
    t.act(0, { type: 'RAISE', amount: 300 }); // full raise +200
    t.act(1, { type: 'FOLD' });
    t.act(2, { type: 'ALL_IN' }); // 350: +50 < 200
    // Seat 3 limped at 100: cumulative 250 >= 200 -> may raise.
    expect(getLegalActions(t.state)).toMatchObject({ seat: 3, canRaise: true, minTo: 550 });
    t.act(3, { type: 'CALL' });
    // Seat 0 raised to 300, faces +50 only.
    expect(getLegalActions(t.state)).toMatchObject({ seat: 0, canRaise: false, callAmount: 50 });
  });

  it('a full raise after a player acted re-opens betting for them', () => {
    const t = toFlop({ 0: 2000, 1: 2000, 2: 2000, 3: 2000 });
    t.act(1, { type: 'BET', amount: 100 });
    t.act(2, { type: 'RAISE', amount: 300 });
    t.act(3, { type: 'FOLD' });
    t.act(0, { type: 'FOLD' });
    expect(getLegalActions(t.state)).toMatchObject({ seat: 1, canRaise: true, minTo: 500 });
  });

  it('an all-in bet smaller than the big blind does not re-open betting for a player who checked', () => {
    const t = toFlop({ 0: 2000, 1: 2000, 2: 140, 3: 2000 });
    t.act(1, { type: 'CHECK' });
    t.act(2, { type: 'ALL_IN' }); // bets 40 < BB: incomplete
    expect(t.lastEvents[0]).toMatchObject({ action: 'BET', toAmount: 40, allIn: true });
    expect(getLegalActions(t.state)).toMatchObject({ seat: 3, canRaise: true, minTo: 140 });
    t.act(3, { type: 'CALL' });
    t.act(0, { type: 'CALL' });
    expect(getLegalActions(t.state)).toMatchObject({ seat: 1, canRaise: false, callAmount: 40 });
  });

  it('preflop: short all-in raise does not re-open for limpers, but the BB (not yet acted) may raise', () => {
    const t5 = new Table({
      stacks: { 0: 2000, 1: 2000, 2: 2000, 3: 2000, 4: 150 },
      buttonSeat: 0,
      smallBlindSeat: 1,
      bigBlindSeat: 2,
    });
    t5.act(3, { type: 'CALL' }); // limp 100
    t5.act(4, { type: 'ALL_IN' }); // 150: incomplete
    t5.act(0, { type: 'CALL' });
    t5.act(1, { type: 'CALL' });
    expect(getLegalActions(t5.state)).toMatchObject({ seat: 2, canRaise: true, minTo: 250 });
    t5.act(2, { type: 'CALL' });
    expect(getLegalActions(t5.state)).toMatchObject({ seat: 3, canRaise: false, callAmount: 50 });
  });
});

describe('ALL_IN classification', () => {
  it('ALL_IN with stack <= amount to call is a call', () => {
    const t = four({ 0: 80, 1: 1000, 2: 1000, 3: 1000 });
    t.act(3, { type: 'CALL' });
    t.act(0, { type: 'ALL_IN' });
    expect(t.lastEvents[0]).toMatchObject({ action: 'CALL', amount: 80, toAmount: 80, allIn: true });
    expect(t.state.currentBet).toBe(100);
  });
  it('ALL_IN unopened postflop is a bet; facing a bet it is a raise (full when large enough)', () => {
    const t = toFlop({ 0: 2000, 1: 600, 2: 2000, 3: 2000 });
    t.act(1, { type: 'ALL_IN' });
    expect(t.lastEvents[0]).toMatchObject({ action: 'BET', toAmount: 500, allIn: true });
    expect(t.state.minRaiseIncrement).toBe(500);
    t.act(2, { type: 'ALL_IN' });
    expect(t.lastEvents[0]).toMatchObject({ action: 'RAISE', toAmount: 1900, allIn: true });
    expect(t.state.minRaiseIncrement).toBe(1400);
  });
});

describe('round completion and action order (rules 4, 7)', () => {
  it('postflop action starts with the first live seat after the button and skips folded/all-in seats', () => {
    const t = four({ 0: 1000, 1: 1000, 2: 1000, 3: 1000 });
    t.act(3, { type: 'CALL' });
    t.act(0, { type: 'CALL' });
    t.act(1, { type: 'FOLD' });
    t.act(2, { type: 'CHECK' });
    expect(t.acting).toBe(2);
    t.act(2, { type: 'CHECK' });
    t.act(3, { type: 'CHECK' });
    t.act(0, { type: 'CHECK' });
    expect(t.state.phase).toBe('TURN');
    expect(t.ofKind('BETTING_ROUND_COMPLETE').map((e) => e.street)).toEqual(['PREFLOP', 'FLOP']);
  });

  it('when everyone else is all-in the last player must still act facing a bet, then the board runs out', () => {
    const t = toFlop({ 0: 3000, 1: 500, 2: 800, 3: 3000 });
    t.act(1, { type: 'ALL_IN' }); // bet 400
    t.act(2, { type: 'ALL_IN' }); // raise 700
    t.act(3, { type: 'FOLD' });
    expect(t.acting).toBe(0);
    expect(getLegalActions(t.state)).toMatchObject({ canCall: true, callAmount: 700 });
    t.act(0, { type: 'CALL' });
    expect(t.state.phase).toBe('HAND_COMPLETE');
    const after = t.kinds(t.lastEvents);
    expect(after).toEqual([
      'PLAYER_ACTED',
      'BETTING_ROUND_COMPLETE',
      'STREET_STARTED',
      'STREET_STARTED',
      'SHOWDOWN',
      'POT_AWARDED',
      'POT_AWARDED',
      'HAND_COMPLETED',
    ]);
    expect(t.state.allInRunOut).toBe(true);
    expect(t.state.board).toHaveLength(5);
    expect(t.state.burns).toHaveLength(3);
  });

  it('a lone player with chips who has matched does not get to bet on later streets', () => {
    const t = four({ 0: 3000, 1: 3000, 2: 3000, 3: 300 });
    t.act(3, { type: 'ALL_IN' });
    t.act(0, { type: 'FOLD' });
    t.act(1, { type: 'FOLD' });
    t.act(2, { type: 'CALL' });
    expect(t.state.phase).toBe('HAND_COMPLETE');
    expect(t.ofKind('TURN_TO_ACT')).toHaveLength(4);
    expect(t.ofKind('STREET_STARTED').map((e) => [e.street, e.newCards.length])).toEqual([
      ['FLOP', 3],
      ['TURN', 1],
      ['RIVER', 1],
    ]);
  });

  it('fold win: no further cards, no showdown, uncalled bet returned', () => {
    const t = toFlop();
    t.act(1, { type: 'BET', amount: 300 });
    t.act(2, { type: 'FOLD' });
    t.act(3, { type: 'FOLD' });
    t.act(0, { type: 'FOLD' });
    expect(t.state.phase).toBe('HAND_COMPLETE');
    expect(t.state.board).toHaveLength(3);
    expect(t.kinds(t.lastEvents)).toEqual([
      'PLAYER_ACTED',
      'BETTING_ROUND_COMPLETE',
      'UNCALLED_BET_RETURNED',
      'POT_AWARDED',
      'HAND_COMPLETED',
    ]);
    expect(t.ofKind('UNCALLED_BET_RETURNED')[0]).toMatchObject({ seat: 1, amount: 300 });
    expect(t.ofKind('POT_AWARDED')[0]).toMatchObject({
      amount: 400,
      winningHand: null,
      winners: [{ seat: 1, amount: 400 }],
    });
    expect(t.state.result?.winType).toBe('FOLD');
    expect(t.state.result?.reveals).toEqual([]);
    expect(t.stack(1)).toBe(1300);
  });

  it('everyone folds to the big blind preflop', () => {
    const t = four();
    t.act(3, { type: 'FOLD' });
    t.act(0, { type: 'FOLD' });
    t.act(1, { type: 'FOLD' });
    expect(t.state.phase).toBe('HAND_COMPLETE');
    expect(t.ofKind('UNCALLED_BET_RETURNED')[0]).toMatchObject({ seat: 2, amount: 50 });
    expect(t.stack(2)).toBe(1050);
    expect(t.stack(1)).toBe(950);
  });

  it('phase sequence follows the transition table through a checked-down hand', () => {
    const t = toFlop();
    const phases: string[] = [t.state.phase];
    for (let i = 0; i < 12 && t.state.phase !== 'HAND_COMPLETE'; i++) {
      t.act(t.acting as number, { type: 'CHECK' });
      if (phases[phases.length - 1] !== t.state.phase) phases.push(t.state.phase);
    }
    expect(phases).toEqual(['FLOP', 'TURN', 'RIVER', 'HAND_COMPLETE']);
    expect(t.ofKind('BETTING_ROUND_COMPLETE').map((e) => e.street)).toEqual(['PREFLOP', 'FLOP', 'TURN', 'RIVER']);
  });
});

describe('timeouts', () => {
  it('timeoutIntent is CHECK when legal, otherwise FOLD; applied with the timeout flag', () => {
    const t = four();
    expect(timeoutIntent(t.state)).toEqual({ type: 'FOLD' });
    t.act(3, timeoutIntent(t.state), { timeout: true });
    expect(t.lastEvents[0]).toMatchObject({ kind: 'PLAYER_ACTED', action: 'FOLD', timeout: true });
    t.act(0, { type: 'CALL' });
    t.act(1, { type: 'CALL' });
    expect(timeoutIntent(t.state)).toEqual({ type: 'CHECK' });
    t.act(2, timeoutIntent(t.state), { timeout: true });
    expect(t.state.actionLog.at(-1)).toMatchObject({ kind: 'ACTION', action: 'CHECK', timeout: true });
  });
  it('timeoutIntent with no acting seat is FOLD', () => {
    const t = new Table({ stacks: { 0: 40, 1: 1000 }, buttonSeat: 0, smallBlindSeat: 0, bigBlindSeat: 1 });
    expect(timeoutIntent(t.state)).toEqual({ type: 'FOLD' });
  });
});
