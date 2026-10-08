import { CANONICAL_DECK } from '@jpb/shared-types';
import type { PlayerActionIntent } from '@jpb/shared-types';
import { describe, expect, it } from 'vitest';
import { applyAction, createHand } from '../src';
import { Table, handInput } from './helpers';

const fresh = () =>
  new Table({ stacks: { 0: 1000, 1: 1000, 2: 1000, 3: 1000 }, buttonSeat: 0, smallBlindSeat: 1, bigBlindSeat: 2 });

describe('applyAction rejects client-triggerable problems with codes (never throws)', () => {
  it('illegal raise amounts', () => {
    const t = fresh();
    expect(t.acting).toBe(3);
    const cases: Array<[unknown, string]> = [
      [{ type: 'RAISE', amount: Number.NaN }, 'AMOUNT_NOT_INTEGER'],
      [{ type: 'RAISE', amount: Number.POSITIVE_INFINITY }, 'AMOUNT_NOT_INTEGER'],
      [{ type: 'RAISE', amount: Number.NEGATIVE_INFINITY }, 'AMOUNT_NOT_INTEGER'],
      [{ type: 'RAISE', amount: 250.5 }, 'AMOUNT_NOT_INTEGER'],
      [{ type: 'RAISE', amount: '300' }, 'AMOUNT_NOT_INTEGER'],
      [{ type: 'RAISE', amount: 2 ** 60 }, 'AMOUNT_NOT_INTEGER'],
      [{ type: 'RAISE', amount: -500 }, 'AMOUNT_BELOW_MINIMUM'],
      [{ type: 'RAISE', amount: 0 }, 'AMOUNT_BELOW_MINIMUM'],
      [{ type: 'RAISE', amount: 199 }, 'AMOUNT_BELOW_MINIMUM'],
      [{ type: 'RAISE', amount: 999_999_999 }, 'AMOUNT_ABOVE_MAXIMUM'],
      [{ type: 'RAISE', amount: 1001 }, 'AMOUNT_ABOVE_MAXIMUM'],
      [{ type: 'RAISE' }, 'AMOUNT_REQUIRED'],
      [{ type: 'RAISE', amount: null }, 'AMOUNT_REQUIRED'],
      [{ type: 'BET', amount: 300 }, 'BET_NOT_ALLOWED'],
      [{ type: 'CHECK' }, 'CHECK_NOT_ALLOWED'],
      [{ type: 'SHOVE' }, 'UNKNOWN_ACTION'],
      [{ type: 42 }, 'UNKNOWN_ACTION'],
      [{}, 'UNKNOWN_ACTION'],
      [null, 'UNKNOWN_ACTION'],
      [undefined, 'UNKNOWN_ACTION'],
      ['FOLD', 'UNKNOWN_ACTION'],
    ];
    for (const [intent, code] of cases) expect([intent, t.reject(3, intent)]).toEqual([intent, code]);
    // The exact boundaries are accepted.
    expect(applyAction(t.state, 3, { type: 'RAISE', amount: 200 }).ok).toBe(true);
    expect(applyAction(t.state, 3, { type: 'RAISE', amount: 1000 }).ok).toBe(true);
  });

  it('illegal bet amounts postflop', () => {
    const t = fresh();
    t.act(3, { type: 'CALL' });
    t.act(0, { type: 'CALL' });
    t.act(1, { type: 'CALL' });
    t.act(2, { type: 'CHECK' });
    expect(t.reject(1, { type: 'BET', amount: Number.NaN })).toBe('AMOUNT_NOT_INTEGER');
    expect(t.reject(1, { type: 'BET', amount: -1 })).toBe('AMOUNT_BELOW_MINIMUM');
    expect(t.reject(1, { type: 'BET', amount: 0.5 })).toBe('AMOUNT_NOT_INTEGER');
    expect(t.reject(1, { type: 'BET', amount: 999_999_999 })).toBe('AMOUNT_ABOVE_MAXIMUM');
    expect(t.reject(1, { type: 'BET' })).toBe('AMOUNT_REQUIRED');
    expect(t.reject(1, { type: 'CALL' })).toBe('CALL_NOT_ALLOWED');
    expect(t.reject(1, { type: 'RAISE', amount: 200 })).toBe('RAISE_NOT_ALLOWED');
  });

  it('amounts are ignored for FOLD/CHECK/CALL/ALL_IN', () => {
    const t = fresh();
    t.act(3, { type: 'CALL', amount: 999_999_999 });
    expect(t.player(3).streetContribution).toBe(100);
    t.act(0, { type: 'ALL_IN', amount: -4 } as PlayerActionIntent);
    expect(t.player(0).streetContribution).toBe(1000);
  });

  it('acting out of turn, unknown seats, folded and all-in players', () => {
    const t = fresh();
    expect(t.reject(0, { type: 'CALL' })).toBe('NOT_YOUR_TURN');
    expect(t.reject(2, { type: 'CHECK' })).toBe('NOT_YOUR_TURN');
    expect(t.reject(5, { type: 'FOLD' })).toBe('PLAYER_NOT_IN_HAND');
    expect(t.reject(-1, { type: 'FOLD' })).toBe('PLAYER_NOT_IN_HAND');
    expect(t.reject(Number.NaN, { type: 'FOLD' })).toBe('PLAYER_NOT_IN_HAND');
    expect(t.reject('3' as unknown as number, { type: 'FOLD' })).toBe('PLAYER_NOT_IN_HAND');
    t.act(3, { type: 'FOLD' });
    expect(t.reject(3, { type: 'CALL' })).toBe('PLAYER_FOLDED');
    t.act(0, { type: 'ALL_IN' });
    expect(t.reject(0, { type: 'CHECK' })).toBe('PLAYER_ALL_IN');
  });

  it('acting after the hand is complete', () => {
    const t = fresh();
    t.act(3, { type: 'FOLD' });
    t.act(0, { type: 'FOLD' });
    t.act(1, { type: 'FOLD' });
    expect(t.state.phase).toBe('HAND_COMPLETE');
    expect(t.reject(2, { type: 'CHECK' })).toBe('HAND_NOT_IN_BETTING');
    expect(t.reject(3, { type: 'FOLD' })).toBe('HAND_NOT_IN_BETTING');
  });

  it('never mutates the input state, even on success', () => {
    const t = fresh();
    const snapshot = JSON.stringify(t.state);
    const frozen = structuredClone(t.state);
    deepFreeze(frozen);
    const r = applyAction(frozen, 3, { type: 'RAISE', amount: 300 });
    expect(r.ok).toBe(true);
    expect(JSON.stringify(t.state)).toBe(snapshot);
  });

  it('state is plain JSON and round-trips through serialization', () => {
    const t = fresh();
    t.act(3, { type: 'RAISE', amount: 300 });
    const copy = JSON.parse(JSON.stringify(t.state));
    expect(copy).toEqual(t.state);
    const a = applyAction(t.state, 0, { type: 'CALL' });
    const b = applyAction(copy, 0, { type: 'CALL' });
    expect(b).toEqual(a);
  });
});

describe('createHand rejects invalid configuration (programmer errors throw)', () => {
  const base = () =>
    handInput({ stacks: { 0: 1000, 1: 1000, 2: 1000 }, buttonSeat: 0, smallBlindSeat: 1, bigBlindSeat: 2 });
  const bad: Array<[string, (i: ReturnType<typeof base>) => void]> = [
    ['one player', (i) => (i.seats = i.seats.slice(0, 1))],
    ['duplicate seat', (i) => (i.seats[1] = { ...i.seats[0]!, playerId: 'x' })],
    ['duplicate player', (i) => (i.seats[1] = { ...i.seats[1]!, playerId: i.seats[0]!.playerId })],
    ['zero stack', (i) => (i.seats[0] = { ...i.seats[0]!, stack: 0 })],
    ['fractional stack', (i) => (i.seats[0] = { ...i.seats[0]!, stack: 10.5 })],
    ['seat out of range', (i) => (i.seats[0] = { ...i.seats[0]!, seat: 9 })],
    ['BB not dealt in', (i) => (i.bigBlindSeat = 5)],
    ['SB not dealt in', (i) => (i.smallBlindSeat = 5)],
    ['SB equals BB', (i) => (i.smallBlindSeat = 2)],
    ['button out of range', (i) => (i.buttonSeat = 9)],
    ['zero big blind', (i) => (i.bigBlind = 0)],
    ['SB above BB', (i) => (i.smallBlind = 200)],
    ['negative ante', (i) => (i.ante = -1)],
    ['bad ante type', (i) => (i.anteType = 'SOMETIMES' as never)],
    ['short deck', (i) => (i.deck = i.deck.slice(1))],
    ['duplicate card in deck', (i) => (i.deck = [...i.deck.slice(0, 51), i.deck[0]!])],
  ];
  for (const [name, mutate] of bad) {
    it(name, () => {
      const input = base();
      mutate(input);
      expect(() => createHand(input)).toThrow(RangeError);
    });
  }
  it('accepts a valid input and does not mutate it', () => {
    const input = base();
    const snapshot = JSON.stringify(input);
    createHand(input);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(input.deck).toHaveLength(CANONICAL_DECK.length);
  });
  it('is deterministic: same input, same output', () => {
    expect(createHand(base())).toEqual(createHand(base()));
  });
});

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}
