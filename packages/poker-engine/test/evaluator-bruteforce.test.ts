import { CANONICAL_DECK } from '@jpb/shared-types';
import type { CardCode } from '@jpb/shared-types';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CATEGORY_CODES, evaluateHand, handScore, scoreRanks } from '../src';
import { prng, randInt } from './helpers';

/*
 * Independent reference evaluator, written only for tests: evaluates exactly
 * five cards by sorting and grouping, and picks the best of all 5-card
 * subsets. Returns a tuple [categoryCode, ...tieBreakRanks].
 */
const RANKS = '23456789TJQKA';
function ref5(cards: readonly string[]): number[] {
  const vals = cards.map((c) => RANKS.indexOf(c[0] as string) + 2).sort((a, b) => b - a);
  const flush = cards.every((c) => c[1] === cards[0]?.[1]);
  const distinct = [...new Set(vals)];
  let straight = 0;
  if (distinct.length === 5) {
    if ((vals[0] as number) - (vals[4] as number) === 4) straight = vals[0] as number;
    else if (vals.join(',') === '14,5,4,3,2') straight = 5;
  }
  const counts = new Map<number, number>();
  for (const v of vals) counts.set(v, (counts.get(v) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const g = groups.map(([v]) => v);
  const shape = groups.map(([, c]) => c).join('');
  if (straight && flush) return [8, straight];
  if (shape === '41') return [7, ...g];
  if (shape === '32') return [6, ...g];
  if (flush) return [5, ...vals];
  if (straight) return [4, straight];
  if (shape === '311') return [3, ...g];
  if (shape === '221') return [2, ...g];
  if (shape === '2111') return [1, ...g];
  return [0, ...vals];
}

function cmpTuple(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function combos<T>(items: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (items.length < k) return [];
  const [head, ...rest] = items;
  return [...combos(rest, k - 1).map((c) => [head as T, ...c]), ...combos(rest, k)];
}

const SUBSETS: Record<number, number[][]> = {
  5: combos([0, 1, 2, 3, 4], 5),
  6: combos([0, 1, 2, 3, 4, 5], 5),
  7: combos([0, 1, 2, 3, 4, 5, 6], 5),
};

function refBest(cards: readonly string[]): number[] {
  let best: number[] | null = null;
  for (const idx of SUBSETS[cards.length] ?? combos([...cards.keys()], 5)) {
    const t = ref5(idx.map((i) => cards[i] as string));
    if (best === null || cmpTuple(t, best) > 0) best = t;
  }
  return best as number[];
}

function checkAgainstReference(cards: CardCode[]): void {
  const ref = refBest(cards);
  const h = evaluateHand(cards);
  const code = CATEGORY_CODES[h.category];
  expect([code, ...scoreRanks(h.score)]).toEqual(ref);
  expect(handScore(cards)).toBe(h.score);
  // The reported best five really is a hand of that exact strength.
  expect(ref5(h.bestFive)).toEqual(ref);
  expect(new Set(h.bestFive).size).toBe(5);
  for (const c of h.bestFive) expect(cards).toContain(c);
}

function randomHand(rnd: () => number, n: number): CardCode[] {
  const deck = [...CANONICAL_DECK];
  const out: CardCode[] = [];
  for (let i = 0; i < n; i++) out.push(deck.splice(randInt(rnd, deck.length), 1)[0] as CardCode);
  return out;
}

describe('evaluator vs brute-force reference', () => {
  it('agrees on 60,000 seeded random 7-card hands (category, ranks, best five, ordering)', () => {
    const rnd = prng(20261008);
    let prev: { cards: CardCode[]; ref: number[]; score: number } | null = null;
    const categories = new Set<string>();
    const mismatches: string[] = [];
    for (let i = 0; i < 60_000; i++) {
      const cards = randomHand(rnd, 7);
      const ref = refBest(cards);
      const score = handScore(cards);
      const mine = [score >>> 20, ...scoreRanks(score)];
      if (mine.join(',') !== ref.join(',')) mismatches.push(`${cards.join(' ')}: ${mine} vs ${ref}`);
      categories.add(evaluateHand(cards).category);
      if (prev !== null && Math.sign(score - prev.score) !== Math.sign(cmpTuple(ref, prev.ref))) {
        mismatches.push(`order ${cards.join(' ')} vs ${prev.cards.join(' ')}`);
      }
      prev = { cards, ref, score };
    }
    expect(mismatches).toEqual([]);
    // Every category except royal/straight flush is virtually certain in 60k hands.
    for (const c of [
      'HIGH_CARD',
      'ONE_PAIR',
      'TWO_PAIR',
      'THREE_OF_A_KIND',
      'STRAIGHT',
      'FLUSH',
      'FULL_HOUSE',
      'FOUR_OF_A_KIND',
    ]) {
      expect(categories).toContain(c);
    }
  }, 120_000);

  it('agrees on 5- and 6-card hands', () => {
    const rnd = prng(7);
    for (let i = 0; i < 5_000; i++) {
      checkAgainstReference(randomHand(rnd, 5));
      checkAgainstReference(randomHand(rnd, 6));
    }
  }, 60_000);

  it('fast-check: any 7 distinct cards match the reference, and order does not matter', () => {
    fc.assert(
      fc.property(fc.shuffledSubarray([...CANONICAL_DECK], { minLength: 7, maxLength: 7 }), (cards) => {
        checkAgainstReference(cards);
        expect(handScore([...cards].reverse())).toBe(handScore(cards));
      }),
      { numRuns: 3_000, seed: 42 },
    );
  }, 60_000);

  it('fast-check: pairwise comparison matches the reference', () => {
    fc.assert(
      fc.property(fc.shuffledSubarray([...CANONICAL_DECK], { minLength: 9, maxLength: 9 }), (cards) => {
        // Two players sharing a 5-card board (realistic showdown shape).
        const board = cards.slice(0, 5);
        const a = [...board, ...cards.slice(5, 7)];
        const b = [...board, ...cards.slice(7, 9)];
        expect(Math.sign(handScore(a) - handScore(b))).toBe(Math.sign(cmpTuple(refBest(a), refBest(b))));
      }),
      { numRuns: 3_000, seed: 43 },
    );
  }, 60_000);

  it('straight flushes (rare) agree with the reference', () => {
    const suits = ['c', 'd', 'h', 's'];
    for (const s of suits) {
      for (let high = 5; high <= 14; high++) {
        const vals = high === 5 ? [14, 2, 3, 4, 5] : [high, high - 1, high - 2, high - 3, high - 4];
        const cards = vals.map((v) => `${RANKS[v - 2]}${s}`) as CardCode[];
        const extra = ['2', '9'].map((r) => `${r}${s === 'c' ? 'd' : 'c'}`) as CardCode[];
        checkAgainstReference([...cards, ...extra]);
      }
    }
  });
});

describe('evaluator throughput', () => {
  it('evaluates hundreds of thousands of 7-card hands per second', () => {
    const rnd = prng(99);
    const hands = Array.from({ length: 20_000 }, () => randomHand(rnd, 7));
    const reps = 10;
    const t0 = performance.now();
    let acc = 0;
    for (let r = 0; r < reps; r++) for (const h of hands) acc += handScore(h);
    const seconds = (performance.now() - t0) / 1000;
    const perSecond = (hands.length * reps) / seconds;
    expect(acc).toBeGreaterThan(0);
    // Generous floor so slow CI machines don't flake; typical is several million/s.
    expect(perSecond).toBeGreaterThan(200_000);
  }, 60_000);
});
