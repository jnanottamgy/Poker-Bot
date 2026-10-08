import type { HandCategory } from '@jpb/shared-types';

/** Singular rank names indexed by rank value (2..14). */
const RANK_NAMES: Readonly<Record<number, string>> = {
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

/** Singular name of a rank value, e.g. 13 -> "King". */
export function rankName(value: number): string {
  const name = RANK_NAMES[value];
  if (name === undefined) throw new RangeError(`Invalid rank value: ${value}`);
  return name;
}

/** Plural name of a rank value, e.g. 6 -> "Sixes", 13 -> "Kings". */
export function rankPlural(value: number): string {
  const name = rankName(value);
  return name.endsWith('x') ? `${name}es` : `${name}s`;
}

/**
 * Deterministic English description of a hand from its category and
 * tie-break ranks (the score's rank values in significance order):
 *
 *   HIGH_CARD        "High Card, Ace"
 *   ONE_PAIR         "One Pair, Kings"
 *   TWO_PAIR         "Two Pair, Kings and Sevens"
 *   THREE_OF_A_KIND  "Three of a Kind, Sevens"
 *   STRAIGHT         "Straight, Nine High" (wheel: "Straight, Five High")
 *   FLUSH            "Flush, Ace High"
 *   FULL_HOUSE       "Full House, Kings full of Sevens"
 *   FOUR_OF_A_KIND   "Four of a Kind, Aces"
 *   STRAIGHT_FLUSH   "Straight Flush, Nine High"
 *   ROYAL_FLUSH      "Royal Flush"
 */
export function describeHand(category: HandCategory, ranks: readonly number[]): string {
  const r = (i: number): number => {
    const v = ranks[i];
    if (v === undefined) throw new RangeError(`Missing rank ${i} for ${category}`);
    return v;
  };
  switch (category) {
    case 'HIGH_CARD':
      return `High Card, ${rankName(r(0))}`;
    case 'ONE_PAIR':
      return `One Pair, ${rankPlural(r(0))}`;
    case 'TWO_PAIR':
      return `Two Pair, ${rankPlural(r(0))} and ${rankPlural(r(1))}`;
    case 'THREE_OF_A_KIND':
      return `Three of a Kind, ${rankPlural(r(0))}`;
    case 'STRAIGHT':
      return `Straight, ${rankName(r(0))} High`;
    case 'FLUSH':
      return `Flush, ${rankName(r(0))} High`;
    case 'FULL_HOUSE':
      return `Full House, ${rankPlural(r(0))} full of ${rankPlural(r(1))}`;
    case 'FOUR_OF_A_KIND':
      return `Four of a Kind, ${rankPlural(r(0))}`;
    case 'STRAIGHT_FLUSH':
      return `Straight Flush, ${rankName(r(0))} High`;
    case 'ROYAL_FLUSH':
      return 'Royal Flush';
  }
}
