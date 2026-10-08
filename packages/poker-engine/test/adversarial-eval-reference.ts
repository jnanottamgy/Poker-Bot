/*
 * Independent reference implementations used by the adversarial-eval-* tests.
 *
 * Written from the rules, NOT from the engine source: a naive 5-card evaluator
 * (sort + group), best-of-all-subsets for 6/7 cards, an independent
 * description builder, canonical best-five selection, an independent side-pot
 * builder and an independent dealing-order calculator. Nothing here imports
 * engine code.
 */
import type { CardCode, SeatIndex } from '@jpb/shared-types';

export const RANK_STR = '23456789TJQKA';
export const SUIT_STR = 'cdhs';

export const CAT = {
  HIGH_CARD: 0,
  ONE_PAIR: 1,
  TWO_PAIR: 2,
  THREE_OF_A_KIND: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  FOUR_OF_A_KIND: 7,
  STRAIGHT_FLUSH: 8,
} as const;

export const CAT_NAMES = [
  'HIGH_CARD',
  'ONE_PAIR',
  'TWO_PAIR',
  'THREE_OF_A_KIND',
  'STRAIGHT',
  'FLUSH',
  'FULL_HOUSE',
  'FOUR_OF_A_KIND',
  'STRAIGHT_FLUSH',
] as const;

export function rv(card: string): number {
  const i = RANK_STR.indexOf(card[0] as string);
  if (i < 0 || card.length !== 2 || !SUIT_STR.includes(card[1] as string)) throw new Error(`bad card ${card}`);
  return i + 2;
}

export function sv(card: string): number {
  return SUIT_STR.indexOf(card[1] as string);
}

/** Reference value: [category, ...tie-break ranks in significance order]. */
export type RefValue = number[];

/** Naive 5-card evaluation. */
export function ref5(cards: readonly string[]): RefValue {
  if (cards.length !== 5) throw new Error('ref5 needs 5 cards');
  const values = cards.map(rv);
  const suits = cards.map((c) => c[1]);
  const isFlush = suits.every((s) => s === suits[0]);
  const desc = [...values].sort((a, b) => b - a);
  const uniq = [...new Set(desc)];
  let straightHigh = 0;
  if (uniq.length === 5) {
    if ((uniq[0] as number) - (uniq[4] as number) === 4) straightHigh = uniq[0] as number;
    // A-2-3-4-5: the ace plays low
    if (uniq[0] === 14 && uniq[1] === 5 && uniq[2] === 4 && uniq[3] === 3 && uniq[4] === 2) straightHigh = 5;
  }
  // groups sorted by size desc, then rank desc
  const count: Record<number, number> = {};
  for (const v of values) count[v] = (count[v] ?? 0) + 1;
  const groups = Object.keys(count)
    .map(Number)
    .sort((a, b) => (count[b] as number) - (count[a] as number) || b - a);
  const sizes = groups.map((g) => count[g]);
  const key = sizes.join('');
  if (isFlush && straightHigh) return [CAT.STRAIGHT_FLUSH, straightHigh];
  if (key === '41') return [CAT.FOUR_OF_A_KIND, ...groups];
  if (key === '32') return [CAT.FULL_HOUSE, ...groups];
  if (isFlush) return [CAT.FLUSH, ...desc];
  if (straightHigh) return [CAT.STRAIGHT, straightHigh];
  if (key === '311') return [CAT.THREE_OF_A_KIND, ...groups];
  if (key === '221') return [CAT.TWO_PAIR, ...groups];
  if (key === '2111') return [CAT.ONE_PAIR, ...groups];
  return [CAT.HIGH_CARD, ...desc];
}

export function cmpRef(a: RefValue, b: RefValue): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function subsets<T>(items: readonly T[], k: number): T[][] {
  const out: T[][] = [];
  const pick: T[] = [];
  const rec = (start: number): void => {
    if (pick.length === k) {
      out.push([...pick]);
      return;
    }
    for (let i = start; i <= items.length - (k - pick.length); i++) {
      pick.push(items[i] as T);
      rec(i + 1);
      pick.pop();
    }
  };
  rec(0);
  return out;
}

/** Best value over every 5-card subset (5, 6 or 7 cards). */
export function refBest(cards: readonly string[]): RefValue {
  let best: RefValue | null = null;
  for (const five of subsets(cards, 5)) {
    const v = ref5(five);
    if (best === null || cmpRef(v, best) > 0) best = v;
  }
  return best as RefValue;
}

const NAMES: Record<number, string> = {
  2: 'Two',
  3: 'Three',
  4: 'Four',
  5: 'Five',
  6: 'Six',
  7: 'Seven',
  8: 'Eight',
  9: 'Nine',
  10: 'Ten',
  11: 'Jack',
  12: 'Queen',
  13: 'King',
  14: 'Ace',
};
const PLURALS: Record<number, string> = {
  2: 'Twos',
  3: 'Threes',
  4: 'Fours',
  5: 'Fives',
  6: 'Sixes',
  7: 'Sevens',
  8: 'Eights',
  9: 'Nines',
  10: 'Tens',
  11: 'Jacks',
  12: 'Queens',
  13: 'Kings',
  14: 'Aces',
};

/** Category name as the engine should report it (royal flush separated). */
export function refCategory(v: RefValue): string {
  if (v[0] === CAT.STRAIGHT_FLUSH && v[1] === 14) return 'ROYAL_FLUSH';
  return CAT_NAMES[v[0] as number] as string;
}

/** Description from the README's fixed templates, computed independently. */
export function refDescription(v: RefValue): string {
  const [c, a, b] = v as [number, number, number];
  switch (c) {
    case CAT.HIGH_CARD:
      return `High Card, ${NAMES[a]}`;
    case CAT.ONE_PAIR:
      return `One Pair, ${PLURALS[a]}`;
    case CAT.TWO_PAIR:
      return `Two Pair, ${PLURALS[a]} and ${PLURALS[b]}`;
    case CAT.THREE_OF_A_KIND:
      return `Three of a Kind, ${PLURALS[a]}`;
    case CAT.STRAIGHT:
      return `Straight, ${NAMES[a]} High`;
    case CAT.FLUSH:
      return `Flush, ${NAMES[a]} High`;
    case CAT.FULL_HOUSE:
      return `Full House, ${PLURALS[a]} full of ${PLURALS[b]}`;
    case CAT.FOUR_OF_A_KIND:
      return `Four of a Kind, ${PLURALS[a]}`;
    default:
      return a === 14 ? 'Royal Flush' : `Straight Flush, ${NAMES[a]} High`;
  }
}

/**
 * The rank of each of the five best cards in significance order, derived
 * from the reference value: groups expanded by size; straights high to low
 * with the wheel as 5-4-3-2-A.
 */
export function refBestFiveRanks(v: RefValue): number[] {
  const [c, ...r] = v as [number, ...number[]];
  const straight = (h: number): number[] => (h === 5 ? [5, 4, 3, 2, 14] : [h, h - 1, h - 2, h - 3, h - 4]);
  switch (c) {
    case CAT.STRAIGHT:
    case CAT.STRAIGHT_FLUSH:
      return straight(r[0] as number);
    case CAT.FLUSH:
    case CAT.HIGH_CARD:
      return r;
    case CAT.FOUR_OF_A_KIND:
      return [r[0], r[0], r[0], r[0], r[1]] as number[];
    case CAT.FULL_HOUSE:
      return [r[0], r[0], r[0], r[1], r[1]] as number[];
    case CAT.THREE_OF_A_KIND:
      return [r[0], r[0], r[0], r[1], r[2]] as number[];
    case CAT.TWO_PAIR:
      return [r[0], r[0], r[1], r[1], r[2]] as number[];
    default:
      return [r[0], r[0], r[1], r[2], r[3]] as number[];
  }
}

/**
 * Canonical best five per the README: significance order; among cards of
 * equal rank higher suits (s > h > d > c) first; flushes/straight flushes use
 * the flush suit.
 */
export function refBestFive(cards: readonly string[], v: RefValue): string[] {
  const cat = v[0];
  let pool = [...cards].sort((a, b) => sv(b) - sv(a));
  if (cat === CAT.FLUSH || cat === CAT.STRAIGHT_FLUSH) {
    // the suit with >= 5 cards (at most one with 7 cards); for SF the straight must be in it
    const bySuit = [0, 1, 2, 3].map((s) => pool.filter((c) => sv(c) === s));
    const suitCards = bySuit.find((g) => g.length >= 5) as string[];
    pool = suitCards;
  }
  const used = new Set<string>();
  return refBestFiveRanks(v).map((r) => {
    const c = pool.find((x) => rv(x) === r && !used.has(x)) as string;
    used.add(c);
    return c;
  });
}

// ---------------------------------------------------------------------------
// dealing order & seats

/** Seats clockwise starting strictly after `from` (`from` last if present). */
export function refClockwise(seats: readonly number[], from: number, maxSeats: number): number[] {
  const out: number[] = [];
  for (let k = 1; k <= maxSeats; k++) {
    const s = (from + k) % maxSeats;
    if (seats.includes(s)) out.push(s);
  }
  return out;
}

export interface RefDeal {
  hole: Map<number, [string, string]>;
  holeOrder: number[];
  burns: string[];
  board: string[];
}

export function refDeal(deck: readonly string[], seats: readonly number[], button: number, maxSeats: number): RefDeal {
  const order = refClockwise(seats, button, maxSeats);
  const n = order.length;
  const hole = new Map<number, [string, string]>();
  order.forEach((s, k) => hole.set(s, [deck[k] as string, deck[n + k] as string]));
  let i = 2 * n;
  const burns: string[] = [];
  const board: string[] = [];
  burns.push(deck[i++] as string);
  board.push(deck[i++] as string, deck[i++] as string, deck[i++] as string);
  burns.push(deck[i++] as string);
  board.push(deck[i++] as string);
  burns.push(deck[i++] as string);
  board.push(deck[i] as string);
  return { hole, holeOrder: order, burns, board };
}

// ---------------------------------------------------------------------------
// side pots (independent)

export interface RefPot {
  amount: number;
  eligible: number[];
}

/**
 * Independent pot builder: remove the single top contributor's unmatched
 * excess, slice by levels, merge all-folded layers downward and merge
 * adjacent layers with identical eligible sets. `dead` goes to the main pot.
 */
export function refPots(
  contribs: ReadonlyArray<{ seat: number; amount: number; folded: boolean }>,
  dead: number,
): { pots: RefPot[]; uncalled: { seat: number; amount: number } | null } {
  const sorted = [...contribs].sort((a, b) => b.amount - a.amount);
  let uncalled: { seat: number; amount: number } | null = null;
  const work = contribs.map((c) => ({ ...c }));
  if (sorted.length > 0 && (sorted[0] as { amount: number }).amount > (sorted[1]?.amount ?? 0)) {
    const top = sorted[0] as { seat: number; amount: number };
    uncalled = { seat: top.seat, amount: top.amount - (sorted[1]?.amount ?? 0) };
    (work.find((w) => w.seat === top.seat) as { amount: number }).amount -= uncalled.amount;
  }
  const levels = [...new Set(work.map((w) => w.amount).filter((a) => a > 0))].sort((a, b) => a - b);
  const pots: RefPot[] = [];
  let carry = 0;
  let prev = 0;
  for (const L of levels) {
    let amt = 0;
    for (const w of work) amt += Math.max(0, Math.min(w.amount, L) - prev);
    const eligible = work
      .filter((w) => !w.folded && w.amount >= L)
      .map((w) => w.seat)
      .sort((a, b) => a - b);
    prev = L;
    const last = pots[pots.length - 1];
    if (eligible.length === 0) {
      if (last) last.amount += amt;
      else carry += amt;
      continue;
    }
    if (last && last.eligible.join(',') === eligible.join(',')) {
      last.amount += amt;
      continue;
    }
    pots.push({ amount: amt + carry, eligible });
    carry = 0;
  }
  if (carry > 0) throw new Error('refPots: unowned chips');
  if (dead > 0) {
    if (pots[0]) pots[0].amount += dead;
    else
      pots.push({
        amount: dead,
        eligible: contribs
          .filter((c) => !c.folded)
          .map((c) => c.seat)
          .sort((a, b) => a - b),
      });
  }
  return { pots, uncalled };
}

/** Odd-chip split: remainder one chip at a time clockwise from the first seat after the button. */
export function refSplit(amount: number, winners: number[], button: number, maxSeats: number): Map<number, number> {
  const order = refClockwise(winners, button, maxSeats);
  const base = Math.floor(amount / order.length);
  let rem = amount - base * order.length;
  const out = new Map<number, number>();
  for (const s of order) {
    out.set(s, base + (rem > 0 ? 1 : 0));
    rem--;
  }
  return out;
}

/** Deterministic test PRNG (xorshift32 variant, never Math.random). */
export function rng(seed: number): () => number {
  let x = seed | 0 || 0x9e3779b9;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

export function allCards(): CardCode[] {
  const out: CardCode[] = [];
  for (const s of SUIT_STR) for (const r of RANK_STR) out.push(`${r}${s}` as CardCode);
  return out;
}

export function deepFreeze<T>(o: T): T {
  if (o !== null && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}

export type { SeatIndex };
