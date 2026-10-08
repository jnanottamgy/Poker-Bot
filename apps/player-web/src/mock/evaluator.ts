/**
 * Small 5-to-7 card hand evaluator for the MOCK backend, so scripted hands
 * reach consistent showdowns with the same wording as @jpb/poker-engine
 * ("Flush, Ace High"). The real server evaluates hands itself.
 */
import type { CardCode, HandCategory } from '@jpb/shared-types';

const RANKS = '23456789TJQKA';
const CATEGORIES: readonly HandCategory[] = [
  'HIGH_CARD',
  'ONE_PAIR',
  'TWO_PAIR',
  'THREE_OF_A_KIND',
  'STRAIGHT',
  'FLUSH',
  'FULL_HOUSE',
  'FOUR_OF_A_KIND',
  'STRAIGHT_FLUSH',
  'ROYAL_FLUSH',
];
const NAMES = ['', '', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace'];

export interface MockEvaluated {
  category: HandCategory;
  score: number;
  bestFive: CardCode[];
  description: string;
}

export function rankValue(card: CardCode): number {
  return RANKS.indexOf(card[0] ?? '2') + 2;
}

const plural = (v: number): string => {
  const n = NAMES[v] ?? '';
  return n.endsWith('x') ? `${n}es` : `${n}s`;
};

function describe(cat: number, t: number[]): string {
  const [a = 0, b = 0] = t;
  switch (CATEGORIES[cat]) {
    case 'HIGH_CARD':
      return `High Card, ${NAMES[a]}`;
    case 'ONE_PAIR':
      return `One Pair, ${plural(a)}`;
    case 'TWO_PAIR':
      return `Two Pair, ${plural(a)} and ${plural(b)}`;
    case 'THREE_OF_A_KIND':
      return `Three of a Kind, ${plural(a)}`;
    case 'STRAIGHT':
      return `Straight, ${NAMES[a]} High`;
    case 'FLUSH':
      return `Flush, ${NAMES[a]} High`;
    case 'FULL_HOUSE':
      return `Full House, ${plural(a)} full of ${plural(b)}`;
    case 'FOUR_OF_A_KIND':
      return `Four of a Kind, ${plural(a)}`;
    case 'STRAIGHT_FLUSH':
      return `Straight Flush, ${NAMES[a]} High`;
    default:
      return 'Royal Flush';
  }
}

function evaluate5(cards: CardCode[]): MockEvaluated {
  const sorted = [...cards].sort((x, y) => rankValue(y) - rankValue(x));
  const vals = sorted.map(rankValue);
  const flush = sorted.every((c) => c[1] === sorted[0]?.[1]);
  const counts = new Map<number, number>();
  for (const v of vals) counts.set(v, (counts.get(v) ?? 0) + 1);
  const groups = [...counts.entries()].sort((x, y) => y[1] - x[1] || y[0] - x[0]);
  let straightHigh = 0;
  if (counts.size === 5) {
    if ((vals[0] ?? 0) - (vals[4] ?? 0) === 4) straightHigh = vals[0] ?? 0;
    else if (vals[0] === 14 && vals[1] === 5) straightHigh = 5;
  }
  const byGroups = groups.flatMap(([v]) => sorted.filter((c) => rankValue(c) === v));
  const straightOrder = straightHigh === 5 ? [...sorted.slice(1), sorted[0] as CardCode] : sorted;
  const g0 = groups[0]?.[1] ?? 0;
  const g1 = groups[1]?.[1] ?? 0;
  let cat: number;
  let tiebreak: number[];
  let ordered: CardCode[];
  if (straightHigh && flush) [cat, tiebreak, ordered] = [straightHigh === 14 ? 9 : 8, [straightHigh], straightOrder];
  else if (g0 === 4) [cat, tiebreak, ordered] = [7, groups.map((g) => g[0]), byGroups];
  else if (g0 === 3 && g1 === 2) [cat, tiebreak, ordered] = [6, groups.map((g) => g[0]), byGroups];
  else if (flush) [cat, tiebreak, ordered] = [5, vals, sorted];
  else if (straightHigh) [cat, tiebreak, ordered] = [4, [straightHigh], straightOrder];
  else if (g0 === 3) [cat, tiebreak, ordered] = [3, groups.map((g) => g[0]), byGroups];
  else if (g0 === 2 && g1 === 2) [cat, tiebreak, ordered] = [2, groups.map((g) => g[0]), byGroups];
  else if (g0 === 2) [cat, tiebreak, ordered] = [1, groups.map((g) => g[0]), byGroups];
  else [cat, tiebreak, ordered] = [0, vals, sorted];
  let score = cat;
  for (let i = 0; i < 5; i++) score = score * 15 + (tiebreak[i] ?? 0);
  return { category: CATEGORIES[cat] ?? 'HIGH_CARD', score, bestFive: ordered, description: describe(cat, tiebreak) };
}

/** Best five-card hand from 5..7 cards. */
export function evaluateBest(cards: readonly CardCode[]): MockEvaluated {
  if (cards.length < 5) throw new Error('need at least 5 cards');
  let best: MockEvaluated | null = null;
  const n = cards.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++) {
            const r = evaluate5([cards[a], cards[b], cards[c], cards[d], cards[e]] as CardCode[]);
            if (!best || r.score > best.score) best = r;
          }
  return best as MockEvaluated;
}

/** Rough 0..1 preflop strength for bot decisions (pairs and high suited cards rank high). */
export function preflopStrength(hole: readonly [CardCode, CardCode]): number {
  const [x, y] = [rankValue(hole[0]), rankValue(hole[1])];
  const hi = Math.max(x, y);
  const lo = Math.min(x, y);
  if (x === y) return Math.min(1, 0.5 + x / 28);
  let s = (hi + lo - 4) / 44;
  if (hole[0][1] === hole[1][1]) s += 0.05;
  if (hi - lo === 1) s += 0.03;
  if (hi === 14) s += 0.08;
  return Math.min(0.92, s);
}
