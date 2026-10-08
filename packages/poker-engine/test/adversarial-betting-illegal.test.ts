/**
 * Adversarial tests (betting lens): hostile client input. Every rejection must
 * be a typed code, never a throw, never a state change, never a silent clamp
 * (CONTRACTS.md §3 rule 5 and the error convention).
 */
import type { PlayerActionIntent } from '@jpb/shared-types';
import { describe, expect, it } from 'vitest';
import { applyAction, getLegalActions } from '../src';
import type { HandState } from '../src';
import { Table } from './helpers';

const four = () =>
  new Table({ stacks: { 0: 1000, 1: 1000, 2: 1000, 3: 1000 }, buttonSeat: 0, smallBlindSeat: 1, bigBlindSeat: 2 });

/** Applies without the helper so that thrown errors surface as test failures with context. */
function code(state: HandState, seat: unknown, intent: unknown): string {
  const before = JSON.stringify(state);
  const r = applyAction(state, seat as number, intent as PlayerActionIntent);
  expect(JSON.stringify(state)).toBe(before);
  if (r.ok) return 'ACCEPTED';
  expect(typeof r.message).toBe('string');
  return r.code;
}

const BAD_AMOUNTS: Array<[string, unknown, string]> = [
  ['999999999', 999999999, 'AMOUNT_ABOVE_MAXIMUM'],
  ['MAX_SAFE_INTEGER', Number.MAX_SAFE_INTEGER, 'AMOUNT_ABOVE_MAXIMUM'],
  ['2^53', 2 ** 53, 'AMOUNT_NOT_INTEGER'],
  ['1e308', 1e308, 'AMOUNT_NOT_INTEGER'],
  ['NaN', Number.NaN, 'AMOUNT_NOT_INTEGER'],
  ['Infinity', Number.POSITIVE_INFINITY, 'AMOUNT_NOT_INTEGER'],
  ['-Infinity', Number.NEGATIVE_INFINITY, 'AMOUNT_NOT_INTEGER'],
  ['-1', -1, 'AMOUNT_BELOW_MINIMUM'],
  ['-0', -0, 'AMOUNT_BELOW_MINIMUM'],
  ['0', 0, 'AMOUNT_BELOW_MINIMUM'],
  ['1.5', 1.5, 'AMOUNT_NOT_INTEGER'],
  ['200.0000001', 200.0000001, 'AMOUNT_NOT_INTEGER'],
  ['string "300"', '300', 'AMOUNT_NOT_INTEGER'],
  ['bigint 300n', BigInt(300), 'AMOUNT_NOT_INTEGER'],
  ['boolean true', true, 'AMOUNT_NOT_INTEGER'],
  ['object', { valueOf: () => 300 }, 'AMOUNT_NOT_INTEGER'],
  ['array [300]', [300], 'AMOUNT_NOT_INTEGER'],
  ['undefined', undefined, 'AMOUNT_REQUIRED'],
  ['null', null, 'AMOUNT_REQUIRED'],
];

describe('adversarial-betting: illegal RAISE amounts preflop (min 200, max 1000)', () => {
  for (const [name, amount, expected] of BAD_AMOUNTS) {
    it(`RAISE ${name} -> ${expected}`, () => {
      const t = four();
      expect(code(t.state, 3, { type: 'RAISE', amount })).toBe(expected);
    });
  }

  it('boundaries are exact: 199 below, 200 and 1000 accepted, 1001 above, the call amount (100) is not a raise', () => {
    const t = four();
    expect(code(t.state, 3, { type: 'RAISE', amount: 199 })).toBe('AMOUNT_BELOW_MINIMUM');
    expect(code(t.state, 3, { type: 'RAISE', amount: 100 })).toBe('AMOUNT_BELOW_MINIMUM');
    expect(code(t.state, 3, { type: 'RAISE', amount: 1001 })).toBe('AMOUNT_ABOVE_MAXIMUM');
    expect(code(t.state, 3, { type: 'RAISE', amount: 200 })).toBe('ACCEPTED');
    expect(code(t.state, 3, { type: 'RAISE', amount: 1000 })).toBe('ACCEPTED');
  });

  it('accepted maximum raise is exactly an all-in (no clamping)', () => {
    const t = four();
    t.act(3, { type: 'RAISE', amount: 1000 });
    expect(t.player(3)).toMatchObject({ stack: 0, allIn: true, streetContribution: 1000 });
    expect(t.lastEvents[0]).toMatchObject({ action: 'RAISE', amount: 1000, toAmount: 1000, allIn: true });
  });
});

describe('adversarial-betting: illegal BET amounts postflop (min 100, max 900)', () => {
  const flop = () => {
    const t = four();
    t.act(3, { type: 'CALL' });
    t.act(0, { type: 'CALL' });
    t.act(1, { type: 'CALL' });
    t.act(2, { type: 'CHECK' });
    expect(t.acting).toBe(1);
    return t;
  };
  for (const [name, amount, expected] of BAD_AMOUNTS) {
    it(`BET ${name} -> ${expected}`, () => {
      expect(code(flop().state, 1, { type: 'BET', amount })).toBe(expected);
    });
  }

  it('a short stack may bet below the big blind only as exactly all-in', () => {
    const t = new Table({
      stacks: { 0: 1000, 1: 1000, 2: 160, 3: 1000 },
      buttonSeat: 0,
      smallBlindSeat: 1,
      bigBlindSeat: 2,
    });
    t.act(3, { type: 'CALL' });
    t.act(0, { type: 'CALL' });
    t.act(1, { type: 'CALL' });
    t.act(2, { type: 'CHECK' });
    t.act(1, { type: 'CHECK' });
    expect(getLegalActions(t.state)).toMatchObject({ seat: 2, minTo: 60, maxTo: 60 });
    expect(code(t.state, 2, { type: 'BET', amount: 59 })).toBe('AMOUNT_BELOW_MINIMUM');
    expect(code(t.state, 2, { type: 'BET', amount: 61 })).toBe('AMOUNT_ABOVE_MAXIMUM');
    expect(code(t.state, 2, { type: 'BET', amount: 100 })).toBe('AMOUNT_ABOVE_MAXIMUM');
    expect(code(t.state, 2, { type: 'BET', amount: 60 })).toBe('ACCEPTED');
  });

  it('a short stack may raise below the minimum only as exactly all-in', () => {
    const t = new Table({
      stacks: { 0: 1000, 1: 1000, 2: 1000, 3: 150 },
      buttonSeat: 0,
      smallBlindSeat: 1,
      bigBlindSeat: 2,
    });
    expect(getLegalActions(t.state)).toMatchObject({ seat: 3, canRaise: true, minTo: 150, maxTo: 150 });
    expect(code(t.state, 3, { type: 'RAISE', amount: 149 })).toBe('AMOUNT_BELOW_MINIMUM');
    expect(code(t.state, 3, { type: 'RAISE', amount: 200 })).toBe('AMOUNT_ABOVE_MAXIMUM');
    expect(code(t.state, 3, { type: 'RAISE', amount: 150 })).toBe('ACCEPTED');
  });
});

describe('adversarial-betting: malformed intents and wrong seats', () => {
  const MALFORMED: Array<[string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['string', 'FOLD'],
    ['number', 1],
    ['array', ['FOLD']],
    ['empty object', {}],
    ['lowercase type', { type: 'fold' }],
    ['unknown type', { type: 'POST_BLIND' }],
    ['type with whitespace', { type: 'CALL ' }],
    ['numeric type', { type: 0 }],
    ['prototype key', { type: 'constructor' }],
    ['toString key', { type: 'toString' }],
  ];
  for (const [name, intent] of MALFORMED) {
    it(`${name} -> UNKNOWN_ACTION (no throw)`, () => {
      expect(code(four().state, 3, intent)).toBe('UNKNOWN_ACTION');
    });
  }

  it('seat checks: unknown / non-integer / negative / string seats, out of turn', () => {
    const t = four();
    expect(code(t.state, 7, { type: 'FOLD' })).toBe('PLAYER_NOT_IN_HAND');
    expect(code(t.state, -1, { type: 'FOLD' })).toBe('PLAYER_NOT_IN_HAND');
    expect(code(t.state, 3.5, { type: 'FOLD' })).toBe('PLAYER_NOT_IN_HAND');
    expect(code(t.state, Number.NaN, { type: 'FOLD' })).toBe('PLAYER_NOT_IN_HAND');
    expect(code(t.state, '3', { type: 'FOLD' })).toBe('PLAYER_NOT_IN_HAND');
    expect(code(t.state, null, { type: 'FOLD' })).toBe('PLAYER_NOT_IN_HAND');
    // Out of turn: the BB and SB and button try to act before UTG.
    for (const seat of [0, 1, 2]) expect(code(t.state, seat, { type: 'FOLD' })).toBe('NOT_YOUR_TURN');
    // Out of turn takes precedence over a malformed intent.
    expect(code(t.state, 0, { type: 'NOPE' })).toBe('NOT_YOUR_TURN');
  });

  it('after fold / while all-in / after completion', () => {
    const t = four();
    t.act(3, { type: 'FOLD' });
    expect(code(t.state, 3, { type: 'CALL' })).toBe('PLAYER_FOLDED');
    expect(code(t.state, 3, { type: 'FOLD' })).toBe('PLAYER_FOLDED');
    t.act(0, { type: 'ALL_IN' });
    expect(code(t.state, 0, { type: 'FOLD' })).toBe('PLAYER_ALL_IN');
    expect(code(t.state, 0, { type: 'ALL_IN' })).toBe('PLAYER_ALL_IN');
    t.act(1, { type: 'FOLD' });
    t.act(2, { type: 'FOLD' });
    expect(t.state.phase).toBe('HAND_COMPLETE');
    for (const seat of [0, 1, 2, 3, 9]) {
      expect(code(t.state, seat, { type: 'CHECK' })).toBe('HAND_NOT_IN_BETTING');
    }
    expect(getLegalActions(t.state)).toBeNull();
  });

  it('action-specific codes: check facing a bet, call with nothing to call, bet facing a bet, raise with no bet', () => {
    const t = four();
    expect(code(t.state, 3, { type: 'CHECK' })).toBe('CHECK_NOT_ALLOWED');
    expect(code(t.state, 3, { type: 'BET', amount: 300 })).toBe('BET_NOT_ALLOWED');
    t.act(3, { type: 'CALL' });
    t.act(0, { type: 'CALL' });
    t.act(1, { type: 'CALL' });
    expect(code(t.state, 2, { type: 'CALL' })).toBe('CALL_NOT_ALLOWED');
    t.act(2, { type: 'CHECK' });
    expect(code(t.state, 1, { type: 'RAISE', amount: 300 })).toBe('RAISE_NOT_ALLOWED');
    expect(code(t.state, 1, { type: 'CALL' })).toBe('CALL_NOT_ALLOWED');
  });

  it('amounts on FOLD/CHECK/CALL/ALL_IN are ignored, even absurd ones', () => {
    const t = four();
    const r = applyAction(t.state, 3, { type: 'CALL', amount: 999999999 });
    expect(r.ok && r.events[0]).toMatchObject({ kind: 'PLAYER_ACTED', action: 'CALL', amount: 100, toAmount: 100 });
    const r2 = applyAction(t.state, 3, { type: 'ALL_IN', amount: -5 });
    expect(r2.ok && r2.events[0]).toMatchObject({ action: 'RAISE', amount: 1000, toAmount: 1000, allIn: true });
  });

  it('a rejected action leaves the state byte-identical and a stale state can be re-used (pure)', () => {
    const t = four();
    const snapshot = structuredClone(t.state);
    const a = applyAction(t.state, 3, { type: 'RAISE', amount: 300 });
    const b = applyAction(t.state, 3, { type: 'RAISE', amount: 300 });
    expect(a).toEqual(b);
    expect(t.state).toEqual(snapshot);
    // Applying on the old state again after progressing does not see the progressed state.
    const c = applyAction(snapshot, 3, { type: 'FOLD' });
    expect(c.ok).toBe(true);
  });

  it('the timeout flag is recorded only when exactly true', () => {
    const t = four();
    const r = applyAction(t.state, 3, { type: 'FOLD' }, { timeout: 'yes' as unknown as boolean });
    expect(r.ok && r.events[0]).toMatchObject({ timeout: false });
    const r2 = applyAction(t.state, 3, { type: 'FOLD' }, null as unknown as { timeout?: boolean });
    expect(r2.ok && r2.events[0]).toMatchObject({ timeout: false });
  });
});
