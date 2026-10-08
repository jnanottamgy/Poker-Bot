import { describe, expect, it } from 'vitest';
import { checkHandInvariants } from '../src';
import type { HandState } from '../src';
import { Table } from './helpers';

const midHand = (): HandState => {
  const t = new Table({ stacks: { 0: 1000, 1: 1000, 2: 1000 }, buttonSeat: 0, smallBlindSeat: 1, bigBlindSeat: 2 });
  t.act(0, { type: 'CALL' });
  t.act(1, { type: 'CALL' });
  t.act(2, { type: 'CHECK' });
  return structuredClone(t.state);
};

const corrupt = (mutate: (s: HandState) => void): string[] => {
  const s = midHand();
  mutate(s);
  return checkHandInvariants(s);
};

describe('checkHandInvariants', () => {
  it('a healthy state has no problems', () => {
    expect(checkHandInvariants(midHand())).toEqual([]);
  });

  const cases: Array<[string, (s: HandState) => void, RegExp]> = [
    ['duplicate card', (s) => (s.deck[0] = s.board[0]!), /duplicate card/],
    ['missing card', (s) => s.deck.pop(), /card count/],
    ['invalid card', (s) => (s.deck[0] = 'Zz' as never), /invalid card/],
    ['board size vs phase', (s) => s.board.pop(), /board has 2 cards/],
    ['burn count', (s) => s.burns.push(s.deck.shift()!), /burns/],
    ['negative stack', (s) => (s.players[0]!.stack = -5), /not a non-negative integer/],
    ['fractional stack', (s) => (s.players[0]!.stack += 0.5), /not a non-negative integer/],
    ['chips created', (s) => (s.players[0]!.stack += 10), /chips not conserved/],
    [
      'pot vs contributions',
      (s) => {
        s.pot += 10;
        s.players[0]!.stack -= 10;
      },
      /pot .* != total contributions/,
    ],
    [
      'two flags',
      (s) => {
        s.players[0]!.folded = true;
        s.players[0]!.allIn = true;
      },
      /both folded and all-in/,
    ],
    ['acting seat folded', (s) => (s.players.find((p) => p.seat === s.actingSeat)!.folded = true), /cannot act/],
    ['acting seat missing', (s) => (s.actingSeat = 7), /not in hand/],
    ['no acting seat in betting', (s) => (s.actingSeat = null), /no acting seat/],
    [
      'contribution above current bet',
      (s) => {
        s.players[0]!.streetContribution = 50;
        s.players[0]!.totalContribution += 50;
        s.players[0]!.stack -= 50;
        s.pot += 50;
      },
      /above the current bet/,
    ],
    ['all-in flag without empty stack', (s) => (s.players[1]!.allIn = true), /allIn flag/],
    ['duplicate seats', (s) => (s.players[1]!.seat = s.players[0]!.seat), /duplicate seat/],
    ['min raise below BB', (s) => (s.minRaiseIncrement = 1), /minRaiseIncrement/],
    ['everyone folded', (s) => s.players.forEach((p) => (p.folded = true)), /every player folded/],
  ];
  for (const [name, mutate, pattern] of cases) {
    it(`detects: ${name}`, () => {
      const errors = corrupt(mutate);
      expect(errors.some((e) => pattern.test(e))).toBe(true);
    });
  }

  it('completed hand: pot must be empty and awards must equal contributions', () => {
    const t = new Table({ stacks: { 0: 1000, 1: 1000 }, buttonSeat: 0, smallBlindSeat: 0, bigBlindSeat: 1 });
    t.act(0, { type: 'FOLD' });
    const s = structuredClone(t.state);
    expect(checkHandInvariants(s)).toEqual([]);
    s.players[1]!.won -= 1;
    s.players[1]!.stack -= 1;
    s.pot += 1;
    expect(checkHandInvariants(s).join('\n')).toMatch(/pot 1 not empty/);
    expect(checkHandInvariants(s).join('\n')).toMatch(/awarded/);
  });
});
