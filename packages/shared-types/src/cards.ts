/**
 * Card representation.
 *
 * A card is a two-character code: rank + suit, e.g. "As", "Td", "2c".
 * "T" denotes ten (displayed as "10" by UIs).
 */
export type RankChar = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K' | 'A';
export type SuitChar = 'c' | 'd' | 'h' | 's';
export type CardCode = `${RankChar}${SuitChar}`;

/** Ranks in ascending order. Numeric rank value = index + 2 (2..14, Ace high = 14). */
export const RANK_CHARS: readonly RankChar[] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

/** Suits in canonical order: clubs, diamonds, hearts, spades. */
export const SUIT_CHARS: readonly SuitChar[] = ['c', 'd', 'h', 's'];

export const SUIT_SYMBOLS: Readonly<Record<SuitChar, string>> = { c: '♣', d: '♦', h: '♥', s: '♠' };

/**
 * CANONICAL DECK ORDER (normative — the fairness verifier depends on it):
 * index i (0..51) => RANK_CHARS[i % 13] + SUIT_CHARS[Math.floor(i / 13)]
 * i.e. 2c,3c,...,Ac,2d,...,Ad,2h,...,Ah,2s,...,As.
 * Every shuffle starts from this exact order.
 */
export const CANONICAL_DECK: readonly CardCode[] = Object.freeze(
  SUIT_CHARS.flatMap((s) => RANK_CHARS.map((r) => `${r}${s}` as CardCode)),
);

export const DECK_SIZE = 52;

export type HandCategory =
  | 'HIGH_CARD'
  | 'ONE_PAIR'
  | 'TWO_PAIR'
  | 'THREE_OF_A_KIND'
  | 'STRAIGHT'
  | 'FLUSH'
  | 'FULL_HOUSE'
  | 'FOUR_OF_A_KIND'
  | 'STRAIGHT_FLUSH'
  | 'ROYAL_FLUSH';

/** Result of evaluating the best 5-card hand from 5..7 cards. */
export interface EvaluatedHand {
  category: HandCategory;
  /**
   * Totally ordered strength. Higher wins; equal score means an exact tie
   * (split pot). Suits never break ties.
   */
  score: number;
  /** The five cards forming the best hand, ordered by significance (e.g. pair cards first, then kickers). */
  bestFive: CardCode[];
  /** Deterministic human-readable description, e.g. "Full House, Kings full of Sevens". */
  description: string;
}
