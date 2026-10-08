import { RANK_CHARS, SUIT_CHARS } from '@jpb/shared-types';
import type { CardCode, EvaluatedHand, HandCategory } from '@jpb/shared-types';
import { ACE_VALUE, MIN_RANK_VALUE, WHEEL_HIGH_VALUE } from './cards';
import { describeHand } from './describe';

/**
 * SCORE ENCODING (documented, stable):
 *
 *   score = categoryCode * 2^20 + r1 * 2^16 + r2 * 2^12 + r3 * 2^8 + r4 * 2^4 + r5
 *
 * where r1..r5 are rank VALUES (2..14; 5 for the high card of a wheel) of the
 * tie-break ranks in significance order, zero-filled when a category needs
 * fewer than five:
 *
 *   HIGH_CARD (0)        five ranks, high to low
 *   ONE_PAIR (1)         pair, kicker, kicker, kicker
 *   TWO_PAIR (2)         high pair, low pair, kicker
 *   THREE_OF_A_KIND (3)  trips, kicker, kicker
 *   STRAIGHT (4)         high card (wheel = 5)
 *   FLUSH (5)            five ranks, high to low
 *   FULL_HOUSE (6)       trips, pair
 *   FOUR_OF_A_KIND (7)   quads, kicker
 *   STRAIGHT_FLUSH (8)   high card (steel wheel = 5)
 *
 * ROYAL_FLUSH is the ace-high straight flush: it is reported as its own
 * category for display but encodes as STRAIGHT_FLUSH with r1 = 14, so it
 * compares as the best straight flush. Scores are < 2^24 and totally ordered;
 * equal scores are exact ties (suits never break ties).
 */
export const CATEGORY_CODES = {
  HIGH_CARD: 0,
  ONE_PAIR: 1,
  TWO_PAIR: 2,
  THREE_OF_A_KIND: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  FOUR_OF_A_KIND: 7,
  STRAIGHT_FLUSH: 8,
  ROYAL_FLUSH: 8,
} as const satisfies Record<HandCategory, number>;

const CODE_TO_CATEGORY: readonly HandCategory[] = [
  'HIGH_CARD',
  'ONE_PAIR',
  'TWO_PAIR',
  'THREE_OF_A_KIND',
  'STRAIGHT',
  'FLUSH',
  'FULL_HOUSE',
  'FOUR_OF_A_KIND',
  'STRAIGHT_FLUSH',
];

const CATEGORY_SHIFT = 20;
const NIBBLE = 4;
const NIBBLE_MASK = 0xf;
const HAND_SIZE = 5;
export const MIN_EVAL_CARDS = 5;
export const MAX_EVAL_CARDS = 7;
const ALL_RANKS_MASK = (1 << RANK_CHARS.length) - 1;
const ACE_BIT_INDEX = RANK_CHARS.length - 1;

// Char-code lookup tables (constant after module initialisation).
const RANK_BY_CHARCODE = new Int8Array(128).fill(-1);
const SUIT_BY_CHARCODE = new Int8Array(128).fill(-1);
RANK_CHARS.forEach((r, i) => (RANK_BY_CHARCODE[r.charCodeAt(0)] = i));
SUIT_CHARS.forEach((s, i) => (SUIT_BY_CHARCODE[s.charCodeAt(0)] = i));

function popcount(x: number): number {
  let v = x - ((x >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** Index of the highest set bit (rank index 0..12). */
function topBit(mask: number): number {
  return 31 - Math.clz32(mask);
}

/**
 * High card value of the best straight within a 13-bit rank mask, or 0.
 * The mask is shifted left by one and the ace copied into bit 0 so that bit k
 * of `ext` represents rank value k + 1 (ace-low = 1 ... ace-high = 14).
 */
function straightHigh(rankMask: number): number {
  const ext = (rankMask << 1) | ((rankMask >>> ACE_BIT_INDEX) & 1);
  const runs = ext & (ext >>> 1) & (ext >>> 2) & (ext >>> 3) & (ext >>> 4);
  return runs === 0 ? 0 : topBit(runs) + HAND_SIZE;
}

/** Packs up to five rank values (significance order) under a category code. */
function pack(category: number, r1: number, r2 = 0, r3 = 0, r4 = 0, r5 = 0): number {
  return (category << CATEGORY_SHIFT) | (r1 << 16) | (r2 << 12) | (r3 << 8) | (r4 << 4) | r5;
}

/** Appends the values of the top `n` ranks of `mask` to `out` (high to low). */
function topRanks(mask: number, n: number): number[] {
  const out: number[] = [];
  let m = mask;
  while (out.length < n && m !== 0) {
    const b = topBit(m);
    out.push(b + MIN_RANK_VALUE);
    m &= ~(1 << b);
  }
  return out;
}

function packRanks(category: number, ranks: readonly number[]): number {
  return pack(category, ranks[0] ?? 0, ranks[1] ?? 0, ranks[2] ?? 0, ranks[3] ?? 0, ranks[4] ?? 0);
}

/**
 * Fast score of the best 5-card hand among 5..7 cards (see SCORE ENCODING).
 *
 * Algorithm: one pass builds a per-suit rank bitmask and four "seen at least
 * k times" rank masks (k = 1..4). Categories are then tested from strongest
 * to weakest with bit operations only (no lookup tables).
 * Throws RangeError on invalid/duplicate cards or a wrong card count.
 */
export function handScore(cards: readonly CardCode[]): number {
  const n = cards.length;
  if (n < MIN_EVAL_CARDS || n > MAX_EVAL_CARDS) {
    throw new RangeError(`evaluate needs ${MIN_EVAL_CARDS}..${MAX_EVAL_CARDS} cards, got ${n}`);
  }
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let s3 = 0;
  let seen1 = 0;
  let seen2 = 0;
  let seen3 = 0;
  let seen4 = 0;
  for (let i = 0; i < n; i++) {
    const c: unknown = cards[i];
    const ok = typeof c === 'string' && c.length === 2;
    const r = ok ? (RANK_BY_CHARCODE[c.charCodeAt(0)] ?? -1) : -1;
    const s = ok ? (SUIT_BY_CHARCODE[c.charCodeAt(1)] ?? -1) : -1;
    if (r < 0 || s < 0) throw new RangeError(`Invalid card code: ${String(c)}`);
    const bit = 1 << r;
    let before: number;
    if (s === 0) {
      before = s0;
      s0 |= bit;
    } else if (s === 1) {
      before = s1;
      s1 |= bit;
    } else if (s === 2) {
      before = s2;
      s2 |= bit;
    } else {
      before = s3;
      s3 |= bit;
    }
    if (before & bit) throw new RangeError(`Duplicate card: ${String(c)}`);
    if (seen3 & bit) seen4 |= bit;
    else if (seen2 & bit) seen3 |= bit;
    else if (seen1 & bit) seen2 |= bit;
    else seen1 |= bit;
  }

  let flushMask = 0;
  if (popcount(s0) >= HAND_SIZE) flushMask = s0;
  else if (popcount(s1) >= HAND_SIZE) flushMask = s1;
  else if (popcount(s2) >= HAND_SIZE) flushMask = s2;
  else if (popcount(s3) >= HAND_SIZE) flushMask = s3;

  if (flushMask !== 0) {
    const sf = straightHigh(flushMask);
    if (sf !== 0) return pack(CATEGORY_CODES.STRAIGHT_FLUSH, sf);
  }
  if (seen4 !== 0) {
    const q = topBit(seen4);
    const kicker = topBit(seen1 & ~(1 << q) & ALL_RANKS_MASK);
    return pack(CATEGORY_CODES.FOUR_OF_A_KIND, q + MIN_RANK_VALUE, kicker + MIN_RANK_VALUE);
  }
  const tripsMask = seen3; // exactly three (no quads at this point)
  const pairsMask = seen2 & ~seen3; // exactly two
  if (tripsMask !== 0) {
    const t = topBit(tripsMask);
    const rest = (tripsMask & ~(1 << t)) | pairsMask;
    if (rest !== 0) return pack(CATEGORY_CODES.FULL_HOUSE, t + MIN_RANK_VALUE, topBit(rest) + MIN_RANK_VALUE);
  }
  if (flushMask !== 0) return packRanks(CATEGORY_CODES.FLUSH, topRanks(flushMask, HAND_SIZE));
  const st = straightHigh(seen1);
  if (st !== 0) return pack(CATEGORY_CODES.STRAIGHT, st);
  if (tripsMask !== 0) {
    const t = topBit(tripsMask);
    return packRanks(CATEGORY_CODES.THREE_OF_A_KIND, [t + MIN_RANK_VALUE, ...topRanks(seen1 & ~(1 << t), 2)]);
  }
  if (pairsMask !== 0) {
    const p1 = topBit(pairsMask);
    const others = pairsMask & ~(1 << p1);
    if (others !== 0) {
      const p2 = topBit(others);
      const kicker = topRanks(seen1 & ~(1 << p1) & ~(1 << p2), 1);
      return packRanks(CATEGORY_CODES.TWO_PAIR, [p1 + MIN_RANK_VALUE, p2 + MIN_RANK_VALUE, ...kicker]);
    }
    return packRanks(CATEGORY_CODES.ONE_PAIR, [p1 + MIN_RANK_VALUE, ...topRanks(seen1 & ~(1 << p1), 3)]);
  }
  return packRanks(CATEGORY_CODES.HIGH_CARD, topRanks(seen1, HAND_SIZE));
}

/** Category of a score (ROYAL_FLUSH for the ace-high straight flush). */
export function categoryOfScore(score: number): HandCategory {
  const code = score >>> CATEGORY_SHIFT;
  const cat = CODE_TO_CATEGORY[code];
  if (cat === undefined) throw new RangeError(`Invalid score: ${score}`);
  if (cat === 'STRAIGHT_FLUSH' && scoreRanks(score)[0] === ACE_VALUE) return 'ROYAL_FLUSH';
  return cat;
}

/** The tie-break rank values encoded in a score (non-zero nibbles, significance order). */
export function scoreRanks(score: number): number[] {
  const out: number[] = [];
  for (let i = HAND_SIZE - 1; i >= 0; i--) {
    const v = (score >>> (i * NIBBLE)) & NIBBLE_MASK;
    if (v !== 0) out.push(v);
  }
  return out;
}

/** How many cards of each tie-break rank the best five contain, per category. */
const GROUP_SIZES: Readonly<Record<HandCategory, readonly number[]>> = {
  HIGH_CARD: [1, 1, 1, 1, 1],
  ONE_PAIR: [2, 1, 1, 1],
  TWO_PAIR: [2, 2, 1],
  THREE_OF_A_KIND: [3, 1, 1],
  STRAIGHT: [],
  FLUSH: [],
  FULL_HOUSE: [3, 2],
  FOUR_OF_A_KIND: [4, 1],
  STRAIGHT_FLUSH: [],
  ROYAL_FLUSH: [],
};

function straightValues(high: number): number[] {
  const vals = [high, high - 1, high - 2, high - 3, high - 4];
  // Wheel: the "1" is the ace.
  return high === WHEEL_HIGH_VALUE ? [5, 4, 3, 2, ACE_VALUE] : vals;
}

interface ParsedCard {
  code: CardCode;
  value: number;
  suit: number;
}

function parseAll(cards: readonly CardCode[]): ParsedCard[] {
  return cards.map((code) => ({
    code,
    value: (RANK_BY_CHARCODE[code.charCodeAt(0)] ?? -1) + MIN_RANK_VALUE,
    suit: SUIT_BY_CHARCODE[code.charCodeAt(1)] ?? -1,
  }));
}

/**
 * Selects the five cards forming the hand, ordered by significance.
 * Deterministic: among cards of equal rank, higher suits (s > h > d > c) are
 * taken first, independent of input order.
 */
function selectBestFive(cards: readonly CardCode[], category: HandCategory, ranks: readonly number[]): CardCode[] {
  const parsed = parseAll(cards).sort((a, b) => b.value - a.value || b.suit - a.suit);
  if (category === 'FLUSH' || category === 'STRAIGHT_FLUSH' || category === 'ROYAL_FLUSH') {
    const counts = [0, 0, 0, 0];
    for (const p of parsed) counts[p.suit] = (counts[p.suit] ?? 0) + 1;
    const suit = counts.findIndex((c) => c >= HAND_SIZE);
    const values = category === 'FLUSH' ? ranks : straightValues(ranks[0] ?? 0);
    return values.map((v) => (parsed.find((p) => p.suit === suit && p.value === v) as ParsedCard).code);
  }
  if (category === 'STRAIGHT') {
    return straightValues(ranks[0] ?? 0).map((v) => (parsed.find((p) => p.value === v) as ParsedCard).code);
  }
  const out: CardCode[] = [];
  GROUP_SIZES[category].forEach((size, i) => {
    const v = ranks[i];
    out.push(
      ...parsed
        .filter((p) => p.value === v)
        .slice(0, size)
        .map((p) => p.code),
    );
  });
  return out;
}

/** Best 5-card hand among 5, 6 or 7 cards. Throws RangeError on invalid input (programmer error). */
export function evaluateHand(cards: readonly CardCode[]): EvaluatedHand {
  const score = handScore(cards);
  const category = categoryOfScore(score);
  const ranks = scoreRanks(score);
  return {
    category,
    score,
    bestFive: selectBestFive(cards, category, ranks),
    description: describeHand(category, ranks),
  };
}

/** > 0 when `a` wins, 0 for an exact tie, < 0 when `b` wins. */
export function compareHands(a: EvaluatedHand, b: EvaluatedHand): number {
  return a.score - b.score;
}
