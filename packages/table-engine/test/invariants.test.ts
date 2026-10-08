import { describe, expect, it } from 'vitest';
import { checkTableInvariants } from '../src';
import type { TableState } from '../src';
import { deepFreeze, Harness } from './helpers';

function midHand(): Harness {
  const h = new Harness({ initialButtonSeat: 0 });
  h.seat('a', 0);
  h.seat('b', 1);
  h.seat('c', 2);
  h.start();
  return h;
}

const corrupt = (s: TableState, f: (c: TableState) => void): string[] => {
  const c = structuredClone(s);
  f(c);
  return checkTableInvariants(c);
};

describe('checkTableInvariants', () => {
  it('is empty for healthy states', () => {
    const h = midHand();
    expect(checkTableInvariants(h.state)).toEqual([]);
  });

  it('detects duplicate players, bad stacks and status inconsistencies', () => {
    const s = midHand().state;
    expect(corrupt(s, (c) => (c.seats[5] = structuredClone(c.seats[0] ?? null)))).toContain('player a seated twice');
    expect(corrupt(s, (c) => ((c.seats[0] as { stack: number }).stack = -1)).join()).toContain('stack -1');
    expect(corrupt(s, (c) => (c.status = 'WAITING')).join()).toContain('status WAITING but hand in progress = true');
    expect(corrupt(s, (c) => (c.holds = ['PAUSE', 'PAUSE'])).join()).toContain('duplicate holds');
  });

  it('detects chip leaks and turn problems during a hand', () => {
    const s = midHand().state;
    expect(corrupt(s, (c) => c.hand && (c.hand.pot += 1)).join()).toMatch(/chips in hand|chip conservation|pot/);
    expect(corrupt(s, (c) => (c.turn = null)).join()).toContain('vs acting seat');
    expect(corrupt(s, (c) => c.turn && (c.turn.seat = 2)).join()).toContain('turn seat 2 != acting seat 0');
    expect(corrupt(s, (c) => ((c.seats[1] as { stack: number }).stack += 5)).join()).toContain('seat stack');
  });

  it('detects bookkeeping problems', () => {
    const s = midHand().state;
    expect(
      corrupt(
        s,
        (c) =>
          (c.recentActions = [
            { playerId: 'p', actionId: 'x', reply: { ok: true, code: null, message: null, duplicate: false } },
            { playerId: 'p', actionId: 'x', reply: { ok: true, code: null, message: null, duplicate: false } },
          ]),
      ).join(),
    ).toContain('duplicate (playerId, actionId)');
    expect(corrupt(s, (c) => (c.nextEventSeq = 0)).join()).toContain('nextEventSeq');
    expect(corrupt(s, (c) => (c.seats = c.seats.slice(1))).join()).toContain('seats.length');
  });

  it('never throws, even on garbage', () => {
    expect(checkTableInvariants({} as TableState).length).toBeGreaterThan(0);
  });

  it('the harness deep-freeze really catches mutation (sanity check of the immutability tests)', () => {
    const frozen = deepFreeze({ a: { b: 1 } });
    expect(() => {
      (frozen.a as { b: number }).b = 2;
    }).toThrow(TypeError);
  });
});
