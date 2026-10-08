/*
 * ADVERSARIAL TESTER — evaluator lens.
 *
 * The engine evaluator is checked against an independent reference
 * (adversarial-eval-reference.ts) that was written from the rules alone:
 * exhaustive enumeration of every 5-card hand, exhaustive 7-card enumeration
 * over structured sub-decks that concentrate the tricky cases, seeded random
 * 6/7-card hands, fast-check, and hand-crafted cases with exact expectations.
 */
import { CANONICAL_DECK } from '@jpb/shared-types';
import type { CardCode, EvaluatedHand } from '@jpb/shared-types';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { categoryOfScore, compareHands, evaluateHand, handScore, rankValue, scoreRanks, suitOf } from '../src';
import {
  CAT,
  allCards,
  cmpRef,
  refBest,
  refBestFive,
  refBestFiveRanks,
  refCategory,
  refDescription,
  rng,
  rv,
  subsets,
} from './adversarial-eval-reference';
import type { RefValue } from './adversarial-eval-reference';

const C = (s: string): CardCode[] => s.trim().split(/\s+/) as CardCode[];

/** Full check of one evaluation against the reference. Returns the ref value. */
function checkAgainstRef(cards: readonly CardCode[]): RefValue {
  const ref = refBest(cards);
  const ev = evaluateHand(cards);
  const msg = cards.join(' ');
  expect(ev.category, msg).toBe(refCategory(ref));
  expect(ev.description, msg).toBe(refDescription(ref));
  expect(ev.score, msg).toBe(handScore(cards));
  // bestFive: 5 distinct input cards, evaluates to the same strength, significance order
  expect(ev.bestFive, msg).toHaveLength(5);
  expect(new Set(ev.bestFive).size, msg).toBe(5);
  for (const c of ev.bestFive) expect(cards, msg).toContain(c);
  expect(cmpRef(refBest(ev.bestFive), ref), msg).toBe(0);
  expect(
    ev.bestFive.map((c) => rv(c)),
    msg,
  ).toEqual(refBestFiveRanks(ref));
  expect(ev.bestFive, msg).toEqual(refBestFive(cards, ref));
  return ref;
}

/** Score order must agree with the reference order (strict both ways). */
function checkPairOrder(a: readonly CardCode[], b: readonly CardCode[]): void {
  const ra = refBest(a);
  const rb = refBest(b);
  const ea = evaluateHand(a);
  const eb = evaluateHand(b);
  expect(Math.sign(compareHands(ea, eb)), `${a.join(' ')} vs ${b.join(' ')}`).toBe(Math.sign(cmpRef(ra, rb)));
  expect(Math.sign(compareHands(eb, ea))).toBe(-Math.sign(cmpRef(ra, rb)));
}

// ---------------------------------------------------------------------------

describe('adversarial-eval: exhaustive 5-card enumeration (2,598,960 hands)', () => {
  it('category frequencies, 7,462 equivalence classes, and score order == reference order', () => {
    const deck = allCards();
    const counts = new Array(9).fill(0) as number[];
    let royals = 0;
    // score -> reference key of the first hand seen with that score
    const keyOf = new Map<number, string>();
    const refOf = new Map<number, RefValue>();
    const idx = [0, 1, 2, 3, 4];
    const n = deck.length;
    const hand: CardCode[] = new Array(5);
    // Reference memo by rank multiset + flush flag (the 5-card value depends only on these).
    const memo = new Map<string, RefValue>();
    for (;;) {
      for (let k = 0; k < 5; k++) hand[k] = deck[idx[k] as number] as CardCode;
      const score = handScore(hand);
      const ranks = hand
        .map((c) => rv(c))
        .sort((a, b) => a - b)
        .join(',');
      const flush = hand.every((c) => c[1] === hand[0]?.[1]);
      const mk = `${ranks}|${flush ? 1 : 0}`;
      let ref = memo.get(mk);
      if (ref === undefined) {
        // reference on 5 cards == ref5; refBest does the same for 5
        ref = refBest(hand);
        memo.set(mk, ref);
      }
      const key = ref.join(',');
      const prevKey = keyOf.get(score);
      if (prevKey === undefined) {
        keyOf.set(score, key);
        refOf.set(score, ref);
      } else if (prevKey !== key) {
        throw new Error(`score ${score} shared by ${prevKey} and ${key} (${hand.join(' ')})`);
      }
      counts[ref[0] as number] = (counts[ref[0] as number] as number) + 1;
      if (ref[0] === CAT.STRAIGHT_FLUSH && ref[1] === 14) royals++;
      // next combination
      let i = 4;
      while (i >= 0 && (idx[i] as number) === n - 5 + i) i--;
      if (i < 0) break;
      idx[i] = (idx[i] as number) + 1;
      for (let j = i + 1; j < 5; j++) idx[j] = (idx[j - 1] as number) + 1;
    }
    expect(counts).toEqual([1302540, 1098240, 123552, 54912, 10200, 5108, 3744, 624, 40]);
    expect(royals).toBe(4);
    // Distinct scores == distinct reference values == 7462 classes.
    expect(keyOf.size).toBe(7462);
    expect(new Set(keyOf.values()).size).toBe(7462);
    // Total order: ascending scores must have strictly ascending reference values.
    const sorted = [...refOf.entries()].sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < sorted.length; i++) {
      const lo = sorted[i - 1] as [number, RefValue];
      const hi = sorted[i] as [number, RefValue];
      if (cmpRef(hi[1], lo[1]) <= 0) {
        throw new Error(`order broken: score ${lo[0]} (${lo[1].join(',')}) < ${hi[0]} (${hi[1].join(',')})`);
      }
    }
    // Per-category distinct counts (the classic table).
    const perCat = new Array(9).fill(0) as number[];
    for (const r of refOf.values()) perCat[r[0] as number] = (perCat[r[0] as number] as number) + 1;
    expect(perCat).toEqual([1277, 2860, 858, 858, 10, 1277, 156, 156, 10]);
    // categoryOfScore/scoreRanks agree with the reference for every class
    for (const [score, ref] of refOf) {
      expect(categoryOfScore(score)).toBe(refCategory(ref));
      expect(scoreRanks(score)).toEqual(ref.slice(1));
    }
  }, 120_000);
});

// ---------------------------------------------------------------------------

/** All C(deck, 7) hands of a small structured sub-deck, each checked fully. */
function exhaustive7(sub: readonly CardCode[], label: string, sample = 1): { checked: number; cats: Set<string> } {
  const cats = new Set<string>();
  let checked = 0;
  let i = 0;
  for (const hand of subsets(sub, 7)) {
    // `sample` > 1: check every sample-th hand fully, all hands by score
    const ref = refBest(hand);
    const score = handScore(hand);
    expect(categoryOfScore(score), `${label}: ${hand.join(' ')}`).toBe(refCategory(ref));
    expect(scoreRanks(score), `${label}: ${hand.join(' ')}`).toEqual(ref.slice(1));
    if (i++ % sample === 0) checkAgainstRef(hand);
    cats.add(refCategory(ref));
    checked++;
  }
  return { checked, cats };
}

describe('adversarial-eval: exhaustive 7-card enumeration over structured sub-decks', () => {
  it('low cards A-7 in three suits: wheels, steel wheels, 6/7-high straights & SFs, flush vs SF', () => {
    const sub = C('Ac 2c 3c 4c 5c 6c 7c Ad 2d 3d 4d 5d 6d 7d Ah 2h 3h 4h 5h 6h 7h');
    const { checked, cats } = exhaustive7(sub, 'low', 7);
    expect(checked).toBe(116_280);
    for (const c of ['STRAIGHT', 'STRAIGHT_FLUSH', 'FLUSH', 'FULL_HOUSE', 'TWO_PAIR', 'THREE_OF_A_KIND', 'ONE_PAIR']) {
      expect(cats.has(c), c).toBe(true);
    }
  }, 300_000);

  it('high cards 9-A in three suits: broadway, royal flush, KQJT9 SF, ace-high flushes', () => {
    const sub = C('9s Ts Js Qs Ks As 9h Th Jh Qh Kh Ah 9d Td Jd Qd Kd Ad');
    const { checked, cats } = exhaustive7(sub, 'high', 3);
    expect(checked).toBe(31_824);
    expect(cats.has('ROYAL_FLUSH')).toBe(true);
    expect(cats.has('STRAIGHT_FLUSH')).toBe(true);
  }, 300_000);

  it('quad-heavy deck: quads+trips, quads+FH on board, two trips, three pairs', () => {
    const sub = C('2c 2d 2h 2s 3c 3d 3h 3s Ac Ad Ah As Kc Kd 7h 9s Qd Jc');
    const { checked, cats } = exhaustive7(sub, 'quads', 3);
    expect(checked).toBe(31_824);
    expect(cats.has('FOUR_OF_A_KIND')).toBe(true);
    expect(cats.has('FULL_HOUSE')).toBe(true);
  }, 300_000);

  it('a whole suit plus off-suit connectors: 6/7-card flushes, flush+straight in the same hand', () => {
    const sub = C('2s 3s 4s 5s 6s 7s 8s 9s Ts Js Qs Ks As Ah 5h 9d Td 6c');
    const { checked, cats } = exhaustive7(sub, 'suit', 3);
    expect(checked).toBe(31_824);
    expect(cats.has('FLUSH')).toBe(true);
    expect(cats.has('STRAIGHT_FLUSH')).toBe(true);
    expect(cats.has('ROYAL_FLUSH')).toBe(true);
  }, 300_000);

  it('every 6-card hand of a 16-card sub-deck', () => {
    const sub = C('As Ks Qs Js Ts 5s 4s 3s 2s Ah Kh 5h 4d 3c 2d Tc');
    let n = 0;
    for (const hand of subsets(sub, 6)) {
      const ref = refBest(hand);
      expect(scoreRanks(handScore(hand))).toEqual(ref.slice(1));
      expect(categoryOfScore(handScore(hand))).toBe(refCategory(ref));
      if (n % 5 === 0) checkAgainstRef(hand);
      n++;
    }
    expect(n).toBe(8008);
  }, 120_000);
});

// ---------------------------------------------------------------------------

describe('adversarial-eval: random full-deck hands vs reference', () => {
  it('20,000 seeded random 7-card hands and 5,000 6-card hands', () => {
    const r = rng(0xc0ffee);
    const deck = allCards();
    for (let t = 0; t < 25_000; t++) {
      const d = [...deck];
      const k = t < 20_000 ? 7 : 6;
      const hand: CardCode[] = [];
      for (let i = 0; i < k; i++) hand.push(d.splice(Math.floor(r() * d.length), 1)[0] as CardCode);
      checkAgainstRef(hand);
    }
  }, 300_000);

  it('fast-check: any 5..7 distinct cards match the reference; pairwise order matches', () => {
    const cardArb = fc.uniqueArray(fc.integer({ min: 0, max: 51 }), { minLength: 14, maxLength: 14 });
    fc.assert(
      fc.property(cardArb, fc.integer({ min: 5, max: 7 }), fc.integer({ min: 5, max: 7 }), (ids, ka, kb) => {
        const cards = ids.map((i) => CANONICAL_DECK[i] as CardCode);
        const a = cards.slice(0, ka);
        const b = cards.slice(7, 7 + kb);
        checkAgainstRef(a);
        checkAgainstRef(b);
        checkPairOrder(a, b);
      }),
      { numRuns: 3_000, seed: 424242 },
    );
  }, 120_000);

  it('fast-check: evaluation is independent of input order (deep-equal result)', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 51 }), { minLength: 7, maxLength: 7 }),
        fc.integer({ min: 0, max: 5039 }),
        (ids, perm) => {
          const cards = ids.map((i) => CANONICAL_DECK[i] as CardCode);
          // a deterministic permutation from `perm`
          const pool = [...cards];
          const shuffled: CardCode[] = [];
          let p = perm;
          while (pool.length > 0) {
            shuffled.push(pool.splice(p % pool.length, 1)[0] as CardCode);
            p = Math.floor(p / (pool.length + 1));
          }
          expect(evaluateHand(shuffled)).toEqual(evaluateHand(cards));
          expect(evaluateHand([...cards].reverse())).toEqual(evaluateHand(cards));
        },
      ),
      { numRuns: 2_000, seed: 77 },
    );
  });

  it('fast-check: suits never break ties (relabelling suits keeps the score)', () => {
    const perms = ['cdhs', 'sdhc', 'hscd', 'dchs', 'shdc'];
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 51 }), { minLength: 7, maxLength: 7 }),
        fc.integer({ min: 0, max: perms.length - 1 }),
        (ids, pi) => {
          const cards = ids.map((i) => CANONICAL_DECK[i] as CardCode);
          const map = perms[pi] as string;
          const relabelled = cards.map((c) => `${c[0]}${map['cdhs'.indexOf(c[1] as string)]}` as CardCode);
          const a = evaluateHand(cards);
          const b = evaluateHand(relabelled);
          expect(b.score).toBe(a.score);
          expect(b.category).toBe(a.category);
          expect(b.description).toBe(a.description);
          expect(compareHands(a, b)).toBe(0);
        },
      ),
      { numRuns: 1_500, seed: 9 },
    );
  });
});

// ---------------------------------------------------------------------------

interface Case {
  cards: string;
  category: EvaluatedHand['category'];
  description: string;
  bestFive: string;
}

/** Hand-crafted cases with exact expected output (bestFive per README: significance order, s>h>d>c among equal ranks). */
const CASES: Case[] = [
  // high card / kickers beyond five don't matter
  { cards: 'As Kd 9h 7c 5s 3d 2c', category: 'HIGH_CARD', description: 'High Card, Ace', bestFive: 'As Kd 9h 7c 5s' },
  { cards: '7s 5d 4h 3c 2s', category: 'HIGH_CARD', description: 'High Card, Seven', bestFive: '7s 5d 4h 3c 2s' },
  // almost-wheel without the ace / Q-K-A-2-3 no wrap
  { cards: 'Qs Kd Ah 2c 3s 8d 9c', category: 'HIGH_CARD', description: 'High Card, Ace', bestFive: 'Ah Kd Qs 9c 8d' },
  // one pair
  { cards: '6s 6d Ah Kc 9s 4d 2c', category: 'ONE_PAIR', description: 'One Pair, Sixes', bestFive: '6s 6d Ah Kc 9s' },
  // two pair, three pairs: kicker is the best of (third pair rank, single)
  {
    cards: 'Ks Kd 7h 7c 4s 4d 2c',
    category: 'TWO_PAIR',
    description: 'Two Pair, Kings and Sevens',
    bestFive: 'Ks Kd 7h 7c 4s',
  },
  {
    cards: 'Ks Kd 7h 7c 4s 4d Qc',
    category: 'TWO_PAIR',
    description: 'Two Pair, Kings and Sevens',
    bestFive: 'Ks Kd 7h 7c Qc',
  },
  {
    cards: '3s 3d 2h 2c As Ad 5c',
    category: 'TWO_PAIR',
    description: 'Two Pair, Aces and Threes',
    bestFive: 'As Ad 3s 3d 5c',
  },
  {
    cards: '3s 3d 2h 2c As Ad 2s',
    category: 'FULL_HOUSE',
    description: 'Full House, Twos full of Aces',
    bestFive: '2s 2h 2c As Ad',
  },
  // trips
  {
    cards: '8s 8d 8h Ac Ks 4d 2c',
    category: 'THREE_OF_A_KIND',
    description: 'Three of a Kind, Eights',
    bestFive: '8s 8h 8d Ac Ks',
  },
  // straights
  {
    cards: 'As 2d 3h 4c 5s 9d Jc',
    category: 'STRAIGHT',
    description: 'Straight, Five High',
    bestFive: '5s 4c 3h 2d As',
  },
  {
    cards: 'As 2d 3h 4c 5s 6d Jc',
    category: 'STRAIGHT',
    description: 'Straight, Six High',
    bestFive: '6d 5s 4c 3h 2d',
  },
  {
    cards: 'As Kd Qh Jc Ts 9d 2c',
    category: 'STRAIGHT',
    description: 'Straight, Ace High',
    bestFive: 'As Kd Qh Jc Ts',
  },
  {
    cards: '9s 9d 8h 7c 6s 5d 5c',
    category: 'STRAIGHT',
    description: 'Straight, Nine High',
    bestFive: '9s 8h 7c 6s 5d',
  },
  // flushes: 6 and 7 suited cards keep the top five; flush beats a higher straight
  { cards: 'As Ks 2s 4s 6s 8s 3s', category: 'FLUSH', description: 'Flush, Ace High', bestFive: 'As Ks 8s 6s 4s' },
  { cards: 'Th 8h 6h 4h 2h 9c 7d', category: 'FLUSH', description: 'Flush, Ten High', bestFive: 'Th 8h 6h 4h 2h' },
  // flush vs straight flush in the same hand: SF wins even though a higher flush card exists
  {
    cards: 'As 9s 8s 7s 6s 5s Td',
    category: 'STRAIGHT_FLUSH',
    description: 'Straight Flush, Nine High',
    bestFive: '9s 8s 7s 6s 5s',
  },
  {
    cards: '2h 3h 4h 5h Ah Kh 6c',
    category: 'STRAIGHT_FLUSH',
    description: 'Straight Flush, Five High',
    bestFive: '5h 4h 3h 2h Ah',
  },
  // steel wheel + 6 off-suit: 6-high straight < steel wheel
  {
    cards: '2d 3d 4d 5d Ad 6s 7s',
    category: 'STRAIGHT_FLUSH',
    description: 'Straight Flush, Five High',
    bestFive: '5d 4d 3d 2d Ad',
  },
  // 6-high SF beats the wheel inside it
  {
    cards: '2c 3c 4c 5c 6c Ac Kd',
    category: 'STRAIGHT_FLUSH',
    description: 'Straight Flush, Six High',
    bestFive: '6c 5c 4c 3c 2c',
  },
  { cards: 'Ts Js Qs Ks As 9s 8s', category: 'ROYAL_FLUSH', description: 'Royal Flush', bestFive: 'As Ks Qs Js Ts' },
  // full houses: two trips -> higher trips full of lower trips
  {
    cards: 'Ks Kd Kh 7c 7s 7d 2c',
    category: 'FULL_HOUSE',
    description: 'Full House, Kings full of Sevens',
    bestFive: 'Ks Kh Kd 7s 7d',
  },
  {
    cards: '7s 7d 7h Kc Ks 2d 2c',
    category: 'FULL_HOUSE',
    description: 'Full House, Sevens full of Kings',
    bestFive: '7s 7h 7d Ks Kc',
  },
  // trips + pair: full house (a flush cannot coexist with a boat in 7 cards)
  {
    cards: 'Qh Qd Qs 4h 4c 9h 2h',
    category: 'FULL_HOUSE',
    description: 'Full House, Queens full of Fours',
    bestFive: 'Qs Qh Qd 4h 4c',
  },
  // quads: kicker is the best other card even if it's part of trips/pair
  {
    cards: 'Ks Kd Kh Kc Qs Qd Qh',
    category: 'FOUR_OF_A_KIND',
    description: 'Four of a Kind, Kings',
    bestFive: 'Ks Kh Kd Kc Qs',
  },
  {
    cards: '2s 2d 2h 2c 3s 3d As',
    category: 'FOUR_OF_A_KIND',
    description: 'Four of a Kind, Twos',
    bestFive: '2s 2h 2d 2c As',
  },
  {
    cards: 'As Ad Ah Ac 3s 3d 3c',
    category: 'FOUR_OF_A_KIND',
    description: 'Four of a Kind, Aces',
    bestFive: 'As Ah Ad Ac 3s',
  },
  // quads beat a straight flush draw/flush present
  {
    cards: '9s 9d 9h 9c 8s 7s 6s',
    category: 'FOUR_OF_A_KIND',
    description: 'Four of a Kind, Nines',
    bestFive: '9s 9h 9d 9c 8s',
  },
  // 5-card and 6-card inputs
  { cards: 'Ts Jd Qh Kc As', category: 'STRAIGHT', description: 'Straight, Ace High', bestFive: 'As Kc Qh Jd Ts' },
  {
    cards: '6s 6d 6h 6c 2s 3s',
    category: 'FOUR_OF_A_KIND',
    description: 'Four of a Kind, Sixes',
    bestFive: '6s 6h 6d 6c 3s',
  },
];

describe('adversarial-eval: hand-crafted exact cases', () => {
  for (const c of CASES) {
    it(`${c.cards} -> ${c.description}`, () => {
      const cards = C(c.cards);
      const ev = evaluateHand(cards);
      expect(ev.category).toBe(c.category);
      expect(ev.description).toBe(c.description);
      expect(ev.bestFive).toEqual(C(c.bestFive));
      checkAgainstRef(cards);
    });
  }

  it('plural of Six is Sixes everywhere (pair, two pair, trips, full house, quads)', () => {
    expect(evaluateHand(C('6s 6d As Kc 9h 4d 2c')).description).toBe('One Pair, Sixes');
    expect(evaluateHand(C('6s 6d 2s 2c 9h 4d Ac')).description).toBe('Two Pair, Sixes and Twos');
    expect(evaluateHand(C('6s 6d 6h Kc 9h 4d 2c')).description).toBe('Three of a Kind, Sixes');
    expect(evaluateHand(C('6s 6d 6h 6c 9h 4d 2c')).description).toBe('Four of a Kind, Sixes');
    expect(evaluateHand(C('Ks Kd Kh 6c 6h 4d 2c')).description).toBe('Full House, Kings full of Sixes');
  });
});

// ---------------------------------------------------------------------------

describe('adversarial-eval: comparisons with exact outcomes', () => {
  const board = (b: string, h: string): CardCode[] => [...C(h), ...C(b)];

  it('board plays: both players use the board -> exact tie, regardless of hole cards', () => {
    const b = 'Ts Jd Qh Kc As';
    const a = evaluateHand(board(b, '2c 3d'));
    const z = evaluateHand(board(b, '4h 2s'));
    expect(compareHands(a, z)).toBe(0);
    expect(a.bestFive).toEqual(C('As Kc Qh Jd Ts'));
  });

  it('board quads: the higher fifth card (kicker) decides; equal kickers tie', () => {
    const b = '9s 9d 9h 9c 2d';
    expect(compareHands(evaluateHand(board(b, 'Ah 3c')), evaluateHand(board(b, 'Kh Qc')))).toBeGreaterThan(0);
    expect(compareHands(evaluateHand(board(b, 'Ah 3c')), evaluateHand(board(b, 'As 3d')))).toBe(0);
    expect(compareHands(evaluateHand(board(b, '3h 4c')), evaluateHand(board(b, '3s 2c')))).toBeGreaterThan(0);
  });

  it('quads with a full house on board: hole card makes quads; other player plays the board boat', () => {
    const b = 'Ks Kd Kh Qs Qd';
    const quads = evaluateHand(board(b, 'Kc 2c'));
    const boat = evaluateHand(board(b, 'Ac Ah'));
    expect(quads.category).toBe('FOUR_OF_A_KIND');
    expect(quads.description).toBe('Four of a Kind, Kings');
    expect(quads.bestFive).toEqual(C('Ks Kh Kd Kc Qs'));
    expect(boat.category).toBe('FULL_HOUSE');
    expect(boat.description).toBe('Full House, Kings full of Aces');
    expect(compareHands(quads, boat)).toBeGreaterThan(0);
    // a player with Q in hand: Kings full of Queens (same as board) -> tie with nothing
    expect(compareHands(evaluateHand(board(b, 'Qc 2h')), evaluateHand(board(b, '3c 2d')))).toBe(0);
  });

  it('kickers at every category decide exactly as far as the 5th card, never the 6th', () => {
    // pair: 3rd kicker decides
    expect(
      compareHands(evaluateHand(C('As Ad Kc Qh 9s 3d 2c')), evaluateHand(C('Ah Ac Kd Qs 8s 3h 2d'))),
    ).toBeGreaterThan(0);
    // pair: 6th/7th cards ignored
    expect(compareHands(evaluateHand(C('As Ad Kc Qh 9s 4d 2c')), evaluateHand(C('Ah Ac Kd Qs 9h 3h 2d')))).toBe(0);
    // two pair kicker
    expect(
      compareHands(evaluateHand(C('Ks Kd 7h 7c As 4d 2c')), evaluateHand(C('Kh Kc 7s 7d Qs 4c 2d'))),
    ).toBeGreaterThan(0);
    // trips second kicker
    expect(
      compareHands(evaluateHand(C('8s 8d 8h Ac Ks 4d 2c')), evaluateHand(C('8c 8d 8h Ad Qs 4c 2d'))),
    ).toBeGreaterThan(0);
    // flush 5th card
    expect(
      compareHands(evaluateHand(C('As Ks 9s 7s 5s 2d 3c')), evaluateHand(C('Ah Kh 9h 7h 4h 2c 3d'))),
    ).toBeGreaterThan(0);
    // flush: 6th suited card ignored
    expect(compareHands(evaluateHand(C('As Ks 9s 7s 5s 2s 3c')), evaluateHand(C('Ah Kh 9h 7h 5h 4h 3d')))).toBe(0);
    // high card 5th
    expect(compareHands(evaluateHand(C('As Kd 9h 7c 4s 3d 2c')), evaluateHand(C('Ah Kc 9s 7d 5c 3s 2h')))).toBeLessThan(
      0,
    );
  });

  it('straight ranking: wheel < 6-high < ... < broadway; steel wheel < 6-high SF < royal', () => {
    const wheel = evaluateHand(C('As 2d 3h 4c 5s Kd Qc'));
    const six = evaluateHand(C('6s 2d 3h 4c 5s Kd Qc'));
    const broadway = evaluateHand(C('As Kd Qh Jc Ts 2d 3c'));
    expect(compareHands(six, wheel)).toBeGreaterThan(0);
    expect(compareHands(broadway, six)).toBeGreaterThan(0);
    const steel = evaluateHand(C('As 2s 3s 4s 5s Kd Qc'));
    const sixSf = evaluateHand(C('6h 2h 3h 4h 5h Kd Qc'));
    const royal = evaluateHand(C('Ac Kc Qc Jc Tc 2d 3h'));
    const quadsAces = evaluateHand(C('As Ad Ah Ac Ks 2d 3h'));
    expect(compareHands(sixSf, steel)).toBeGreaterThan(0);
    expect(compareHands(royal, sixSf)).toBeGreaterThan(0);
    expect(compareHands(steel, quadsAces)).toBeGreaterThan(0);
    // lowest flush beats the best straight; lowest full house beats the best flush
    const lowFlush = evaluateHand(C('7d 5d 4d 3d 2d Kc Qh'));
    expect(compareHands(lowFlush, broadway)).toBeGreaterThan(0);
    expect(
      compareHands(evaluateHand(C('2s 2d 2h 3c 3s Kd Qh')), evaluateHand(C('As Ks Qs Js 9s 2d 3h'))),
    ).toBeGreaterThan(0);
  });

  it('category boundaries: the weakest hand of each category beats the strongest of the one below', () => {
    const weakest: string[] = [
      '7s 5d 4h 3c 2s', // HC
      '2s 2d 3h 4c 5s', // pair (lowest is 2-2-5-4-3)
      '3s 3d 2h 2c 4s',
      '2s 2d 2h 3c 4s',
      'As 2d 3h 4c 5s',
      '7d 5d 4d 3d 2d',
      '2s 2d 2h 3c 3s',
      '2s 2d 2h 2c 3s',
      'As 2s 3s 4s 5s',
    ];
    const strongest: string[] = [
      'As Kd Qh Jc 9s',
      'As Ad Kh Qc Js',
      'As Ad Kh Kc Qs',
      'As Ad Ah Kc Qs',
      'As Kd Qh Jc Ts',
      'As Ks Qs Js 9s',
      'As Ad Ah Kc Ks',
      'As Ad Ah Ac Ks',
      'As Ks Qs Js Ts',
    ];
    // pair lowest is actually 2-2-5-4-3 (the above is 2-2 with 5-4-3 kickers): fine
    for (let c = 1; c < 9; c++) {
      const lo = evaluateHand(C(weakest[c] as string));
      const hi = evaluateHand(C(strongest[c - 1] as string));
      expect(lo.category === 'ROYAL_FLUSH' ? 'STRAIGHT_FLUSH' : lo.category).not.toBe(hi.category);
      expect(compareHands(lo, hi), `${weakest[c]} > ${strongest[c - 1]}`).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------

describe('adversarial-eval: input validation and purity', () => {
  it('rejects wrong card counts, duplicates and malformed codes with RangeError', () => {
    expect(() => evaluateHand(C('As Kd Qh Jc'))).toThrow(RangeError);
    expect(() => evaluateHand(C('As Kd Qh Jc Ts 9s 8s 7s'))).toThrow(RangeError);
    expect(() => evaluateHand([] as CardCode[])).toThrow(RangeError);
    expect(() => evaluateHand(C('As As Qh Jc Ts'))).toThrow(RangeError);
    expect(() => evaluateHand(C('As Kd Qh Jc Ts 9s As'))).toThrow(RangeError);
    for (const bad of ['1s', 'AS', 'ax', 'Ax', '10s', 'A', 'Ass', '', 'Tz']) {
      expect(() => evaluateHand(['Kd', 'Qh', 'Jc', 'Ts', bad] as CardCode[]), bad).toThrow(RangeError);
      expect(() => handScore(['Kd', 'Qh', 'Jc', 'Ts', bad] as CardCode[]), bad).toThrow(RangeError);
    }
    expect(() => evaluateHand(['Kd', 'Qh', 'Jc', 'Ts', null] as unknown as CardCode[])).toThrow(RangeError);
    expect(() => evaluateHand(['Kd', 'Qh', 'Jc', 'Ts', 7] as unknown as CardCode[])).toThrow(RangeError);
  });

  it('does not mutate (works on a frozen input) and is deterministic across calls', () => {
    const cards = Object.freeze(C('Ks Kd Kh 7c 7s 7d 2c')) as readonly CardCode[];
    const a = evaluateHand(cards);
    const b = evaluateHand(cards);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(cards).toEqual(C('Ks Kd Kh 7c 7s 7d 2c'));
    // mutating a returned bestFive does not affect later results
    a.bestFive.push('2h');
    expect(evaluateHand(cards).bestFive).toHaveLength(5);
    expect(JSON.parse(JSON.stringify(b))).toEqual(b);
  });

  it('rankValue/suitOf agree with the canonical deck', () => {
    CANONICAL_DECK.forEach((c, i) => {
      expect(rankValue(c)).toBe((i % 13) + 2);
      expect(suitOf(c)).toBe('cdhs'[Math.floor(i / 13)]);
    });
  });

  it('scores are safe non-negative integers below 2^24', () => {
    const r = rng(5);
    for (let i = 0; i < 2_000; i++) {
      const d = allCards();
      const h: CardCode[] = [];
      for (let k = 0; k < 7; k++) h.push(d.splice(Math.floor(r() * d.length), 1)[0] as CardCode);
      const s = handScore(h);
      expect(Number.isSafeInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(2 ** 24);
    }
  });
});
