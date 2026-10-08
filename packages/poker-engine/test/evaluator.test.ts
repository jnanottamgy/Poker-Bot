import type { CardCode } from '@jpb/shared-types';
import { describe, expect, it } from 'vitest';
import { categoryOfScore, compareHands, evaluateHand, handScore, scoreRanks } from '../src';

const ev = (s: string) => evaluateHand(s.split(' ') as CardCode[]);
const cmp = (a: string, b: string) => Math.sign(compareHands(ev(a), ev(b)));

describe('evaluateHand categories and descriptions', () => {
  const cases: Array<[string, string, string]> = [
    ['As Ks Qs Js Ts 2c 3d', 'ROYAL_FLUSH', 'Royal Flush'],
    ['9h 8h 7h 6h 5h Ac Ad', 'STRAIGHT_FLUSH', 'Straight Flush, Nine High'],
    ['Ad 2d 3d 4d 5d Kc Kh', 'STRAIGHT_FLUSH', 'Straight Flush, Five High'],
    ['7c 7d 7h 7s Kd 2c 3h', 'FOUR_OF_A_KIND', 'Four of a Kind, Sevens'],
    ['Kc Kd Kh 7s 7d 2c 3h', 'FULL_HOUSE', 'Full House, Kings full of Sevens'],
    ['6c 6d 6h 9s 9d', 'FULL_HOUSE', 'Full House, Sixes full of Nines'],
    ['Ah Jh 8h 4h 2h Kc Qd', 'FLUSH', 'Flush, Ace High'],
    ['9c 8d 7h 6s 5d 2c 2h', 'STRAIGHT', 'Straight, Nine High'],
    ['Ac 2d 3h 4s 5d Kc Kh', 'STRAIGHT', 'Straight, Five High'],
    ['Ac Kd Qh Js Td 2c 2h', 'STRAIGHT', 'Straight, Ace High'],
    ['7c 7d 7h Ks 2d 4c 9h', 'THREE_OF_A_KIND', 'Three of a Kind, Sevens'],
    ['Kc Kd 7h 7s 2d 4c 9h', 'TWO_PAIR', 'Two Pair, Kings and Sevens'],
    ['Kc Kd 7h 3s 2d 4c 9h', 'ONE_PAIR', 'One Pair, Kings'],
    ['Ac Jd 7h 3s 2d 4c 9h', 'HIGH_CARD', 'High Card, Ace'],
  ];
  for (const [cards, category, description] of cases) {
    it(`${cards} -> ${description}`, () => {
      const h = ev(cards);
      expect(h.category).toBe(category);
      expect(h.description).toBe(description);
      expect(h.bestFive).toHaveLength(5);
      expect(categoryOfScore(h.score)).toBe(category);
    });
  }

  it('orders bestFive by significance', () => {
    expect(ev('Kc Kd 7h 7s 2d 4c 9h').bestFive).toEqual(['Kd', 'Kc', '7s', '7h', '9h']);
    expect(ev('Ac 2d 3h 4s 5d Kc Kh').bestFive).toEqual(['5d', '4s', '3h', '2d', 'Ac']);
    expect(ev('Ad 2d 3d 4d 5d Kc Kh').bestFive).toEqual(['5d', '4d', '3d', '2d', 'Ad']);
    expect(ev('Kc Kd Kh 7s 7d 7c 3h').bestFive).toEqual(['Kh', 'Kd', 'Kc', '7s', '7d']);
    expect(ev('7c 7d 7h 7s Kd Ac 3h').bestFive).toEqual(['7s', '7h', '7d', '7c', 'Ac']);
  });

  it('bestFive is independent of input order', () => {
    const a = ev('Kc Kd 7h 7s 2d 4c 9h');
    const b = ev('9h 4c 2d 7s 7h Kd Kc');
    expect(a).toEqual(b);
  });

  it('accepts 5, 6 and 7 cards and rejects other sizes, invalid and duplicate cards', () => {
    expect(ev('As Ks Qs Js Ts').category).toBe('ROYAL_FLUSH');
    expect(ev('As Ks Qs Js Ts 9s').category).toBe('ROYAL_FLUSH');
    expect(() => ev('As Ks Qs Js')).toThrow(RangeError);
    expect(() => ev('As Ks Qs Js Ts 9s 8s 7s')).toThrow(RangeError);
    expect(() => ev('As Ks Qs Js Xx')).toThrow(RangeError);
    expect(() => ev('As As Qs Js Ts')).toThrow(RangeError);
    expect(() => handScore([null as unknown as CardCode, 'As', 'Ks', 'Qs', 'Js'])).toThrow(RangeError);
  });
});

describe('category ordering', () => {
  const ladder = [
    'Ac Jd 7h 3s 2d 4c 9h', // high card
    'Kc Kd 7h 3s 2d 4c 9h', // pair
    'Kc Kd 7h 7s 2d 4c 9h', // two pair
    '7c 7d 7h Ks 2d 4c 9h', // trips
    'Ac 2d 3h 4s 5d Kc Kh', // wheel straight
    '2h 4h 6h 8h Th Ac Kd', // flush
    '2c 2d 2h 3s 3d 4c 9h', // full house
    '2c 2d 2h 2s 3d 4c 9h', // quads
    'Ad 2d 3d 4d 5d Kc Kh', // steel wheel
    'As Ks Qs Js Ts 2c 3d', // royal
  ];
  it('each category beats the previous one', () => {
    for (let i = 1; i < ladder.length; i++) {
      expect(cmp(ladder[i] as string, ladder[i - 1] as string)).toBe(1);
    }
  });
  it('royal flush compares as the best straight flush', () => {
    expect(cmp('As Ks Qs Js Ts', 'Ks Qs Js Ts 9s')).toBe(1);
    expect(ev('As Ks Qs Js Ts').score).toBe(ev('Ah Kh Qh Jh Th').score);
  });
  it('flush beats straight; full house beats flush', () => {
    expect(cmp('2h 4h 6h 8h Th', 'Ac Kd Qh Js Td')).toBe(1);
    expect(cmp('2c 2d 2h 3s 3d', 'Ah Kh Qh Jh 9h')).toBe(1);
  });
});

describe('straights', () => {
  it('wheel is the lowest straight; broadway the highest', () => {
    expect(cmp('Ac 2d 3h 4s 5d', '2c 3d 4h 5s 6d')).toBe(-1);
    expect(cmp('Ac Kd Qh Js Td', '9c Kd Qh Js Td')).toBe(1);
    expect(scoreRanks(ev('Ac 2d 3h 4s 5d').score)).toEqual([5]);
  });
  it('picks the highest straight in seven cards', () => {
    expect(ev('Ac 2d 3h 4s 5d 6c 7h').description).toBe('Straight, Seven High');
    expect(ev('Ac Kd Qh Js Td 9c 8h').description).toBe('Straight, Ace High');
  });
  it('no wraparound straights (Q-K-A-2-3)', () => {
    expect(ev('Qc Kd Ah 2s 3d').category).toBe('HIGH_CARD');
  });
  it('steel wheel is the lowest straight flush', () => {
    expect(cmp('Ad 2d 3d 4d 5d', '2h 3h 4h 5h 6h')).toBe(-1);
    expect(cmp('Ad 2d 3d 4d 5d', 'Ac Ad Ah As Kd')).toBe(1);
  });
  it('a straight flush is found even when a higher plain straight exists', () => {
    // 5-9 of hearts plus Td: plain straight to the ten, straight flush to the nine.
    expect(ev('5h 6h 7h 8h 9h Td 2c').description).toBe('Straight Flush, Nine High');
  });
  it('flush with straight cards of mixed suits is just a flush when no straight flush exists', () => {
    expect(ev('2h 3h 4h 5h 9h 6c Kd').category).toBe('FLUSH');
  });
});

describe('kickers at every category', () => {
  it('high card: compares all five cards', () => {
    expect(cmp('Ac Jd 7h 3s 2d', 'Ac Jd 7h 3s 2h')).toBe(0);
    expect(cmp('Ac Jd 7h 4s 2d', 'Ac Jd 7h 3s 2h')).toBe(1);
    expect(cmp('Ac Jd 7h 4s 3d', 'Ac Jd 7h 4s 2h')).toBe(1);
  });
  it('one pair: pair then three kickers', () => {
    expect(cmp('Kc Kd Ah 3s 2d', 'Kh Ks Qh Js 9d')).toBe(1);
    expect(cmp('Kc Kd Ah Qs 3d', 'Kh Ks Ac Qd 2d')).toBe(1);
    expect(cmp('Ac Ad 2h 3s 4d', 'Kh Ks Ah Qd Jd')).toBe(1);
  });
  it('two pair: high pair, low pair, kicker; third pair can be the kicker', () => {
    expect(cmp('Kc Kd 7h 7s Ad', 'Kh Ks 7c 7d Qd')).toBe(1);
    expect(cmp('Kc Kd 8h 8s 2d', 'Kh Ks 7c 7d Ad')).toBe(1);
    expect(ev('Kc Kd 7h 7s 5d 5c 2h').bestFive).toEqual(['Kd', 'Kc', '7s', '7h', '5d']);
    expect(scoreRanks(ev('Kc Kd 7h 7s 5d 5c 2h').score)).toEqual([13, 7, 5]);
  });
  it('trips: trips then two kickers', () => {
    expect(cmp('7c 7d 7h As 2d', '7c 7d 7h Ks Qd')).toBe(1);
    expect(cmp('7c 7d 7h As 3d', '7c 7d 7h As 2c')).toBe(1);
  });
  it('flush: all five cards matter', () => {
    expect(cmp('Ah Jh 8h 4h 3h', 'Ah Jh 8h 4h 2h')).toBe(1);
    expect(cmp('As Js 8s 4s 2s 3s', 'Ah Jh 8h 4h 3h')).toBe(0);
  });
  it('full house: trips first, then pair; two trips uses the higher as trips', () => {
    expect(cmp('2c 2d 2h As Ad', '3c 3d 3h Ks Kd')).toBe(-1);
    expect(cmp('Ac Ad Ah 3s 3d', 'Ac Ad Ah 2s 2d')).toBe(1);
    expect(ev('Kc Kd Kh 7s 7d 7c 3h').description).toBe('Full House, Kings full of Sevens');
    expect(ev('Kc Kd Kh 7s 7d Ac Ah').description).toBe('Full House, Kings full of Aces');
  });
  it('quads: kicker decides', () => {
    expect(cmp('7c 7d 7h 7s Ad', '7c 7d 7h 7s Kd')).toBe(1);
    expect(ev('7c 7d 7h 7s Kd Kc Kh').description).toBe('Four of a Kind, Sevens');
    expect(scoreRanks(ev('7c 7d 7h 7s Kd Kc Kh').score)).toEqual([7, 13]);
  });
  it('straights of equal height tie regardless of suits', () => {
    expect(cmp('9c 8d 7h 6s 5d', '9h 8h 7c 6d 5s')).toBe(0);
  });
});

describe('board plays and exact ties', () => {
  const board = 'As Ks Qd Jc Th';
  it('two players playing the board tie exactly', () => {
    expect(cmp(`${board} 2c 3d`, `${board} 4h 5h`)).toBe(0);
  });
  it('a pair on board with different kickers in hand', () => {
    expect(cmp('Kh Kd 9c 5s 2h Ac 3d', 'Kh Kd 9c 5s 2h Qc 3s')).toBe(1);
  });
  it('kicker that does not play gives a tie', () => {
    // Board two pair + A kicker: hole cards lower than the ace do not play.
    expect(cmp('Kh Kd 9c 9s Ah 2c 3d', 'Kh Kd 9c 9s Ah 4c 5d')).toBe(0);
  });
  it('counterfeited two pair', () => {
    expect(cmp('Qh Qd Tc Ts 2h 3c 3d', 'Qh Qd Tc Ts 2h Ac 4d')).toBe(-1);
  });
});
