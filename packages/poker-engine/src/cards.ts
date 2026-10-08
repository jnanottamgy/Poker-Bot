import { RANK_CHARS, SUIT_CHARS } from '@jpb/shared-types';
import type { CardCode, RankChar, SuitChar } from '@jpb/shared-types';

/** Lowest and highest numeric rank values (deuce = 2, ace = 14). */
export const MIN_RANK_VALUE = 2;
export const ACE_VALUE = 14;
/** In a wheel (A-2-3-4-5) the ace plays as 1; the straight's high card is the five. */
export const WHEEL_HIGH_VALUE = 5;

const RANK_INDEX_BY_CHAR: Readonly<Record<string, number>> = Object.freeze(
  Object.fromEntries(RANK_CHARS.map((r, i) => [r, i])),
);
const SUIT_INDEX_BY_CHAR: Readonly<Record<string, number>> = Object.freeze(
  Object.fromEntries(SUIT_CHARS.map((s, i) => [s, i])),
);

/** True when `x` is a two-character card code such as "As" or "Td". */
export function isCardCode(x: unknown): x is CardCode {
  return (
    typeof x === 'string' &&
    x.length === 2 &&
    RANK_INDEX_BY_CHAR[x[0] as string] !== undefined &&
    SUIT_INDEX_BY_CHAR[x[1] as string] !== undefined
  );
}

function assertCard(card: unknown): asserts card is CardCode {
  if (!isCardCode(card)) throw new RangeError(`Invalid card code: ${String(card)}`);
}

/** Rank index 0..12 (2..A). Throws on an invalid card. */
export function rankIndex(card: CardCode): number {
  assertCard(card);
  return RANK_INDEX_BY_CHAR[card[0] as RankChar] as number;
}

/** Numeric rank value 2..14 (ace high = 14). Throws on an invalid card. */
export function rankValue(card: CardCode): number {
  return rankIndex(card) + MIN_RANK_VALUE;
}

/** Suit index 0..3 in canonical order (c, d, h, s). Throws on an invalid card. */
export function suitIndex(card: CardCode): number {
  assertCard(card);
  return SUIT_INDEX_BY_CHAR[card[1] as SuitChar] as number;
}

export function suitOf(card: CardCode): SuitChar {
  assertCard(card);
  return card[1] as SuitChar;
}

/** Position of the card in CANONICAL_DECK (0..51). */
export function canonicalIndex(card: CardCode): number {
  return suitIndex(card) * RANK_CHARS.length + rankIndex(card);
}

/** Card code from a rank value (2..14) and suit. */
export function cardOf(value: number, suit: SuitChar): CardCode {
  const r = RANK_CHARS[value - MIN_RANK_VALUE];
  if (r === undefined || SUIT_INDEX_BY_CHAR[suit] === undefined) {
    throw new RangeError(`Invalid rank value/suit: ${value}${suit}`);
  }
  return `${r}${suit}`;
}

/** Returns the first duplicated card, or null. Throws on an invalid card code. */
export function findDuplicateCard(cards: readonly CardCode[]): CardCode | null {
  const seen = new Set<string>();
  for (const c of cards) {
    assertCard(c);
    if (seen.has(c)) return c;
    seen.add(c);
  }
  return null;
}

/** True when `deck` is exactly a permutation of the 52-card deck. */
export function isFullDeck(deck: readonly unknown[]): deck is CardCode[] {
  if (deck.length !== RANK_CHARS.length * SUIT_CHARS.length) return false;
  const seen = new Set<string>();
  for (const c of deck) {
    if (!isCardCode(c) || seen.has(c)) return false;
    seen.add(c);
  }
  return true;
}
