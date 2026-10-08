import { fisherYatesShuffle, hexToBytes, HmacDrbgSource, sha256Hex } from '@jpb/randomness';
import type { HmacSha256Fn, RandomSource } from '@jpb/randomness';
import { CANONICAL_DECK, DECK_SIZE } from '@jpb/shared-types';
import type { CardCode } from '@jpb/shared-types';
import { deckLabel, deckLabelProblem, drawLabel } from './labels';
import type { DeckLabelParams, DrawLabelParams } from './labels';
import { assertNoProblem, serverSeedProblem } from './validate';

export interface DeriveDeckParams extends DeckLabelParams {
  /** 32-byte server seed, hex. */
  serverSeed: string;
}

export interface DrawSourceParams extends DrawLabelParams {
  serverSeed: string;
}

const CARD_SET: ReadonlySet<string> = new Set(CANONICAL_DECK);

/** True iff `value` is one of the 52 card codes. */
export function isCardCode(value: unknown): value is CardCode {
  return typeof value === 'string' && CARD_SET.has(value);
}

/** True iff `deck` holds each of the 52 cards exactly once. */
export function isFullDeck(deck: unknown): deck is CardCode[] {
  if (!Array.isArray(deck) || deck.length !== DECK_SIZE) return false;
  const seen = new Set<string>();
  for (const card of deck) {
    if (!isCardCode(card) || seen.has(card)) return false;
    seen.add(card);
  }
  return true;
}

/**
 * The deck of one hand (CONTRACTS §2): CANONICAL_DECK shuffled with
 * Fisher–Yates driven by HmacDrbgSource(key = serverSeedBytes, label = deckLabel(p)).
 * deck[0] is the top card. Pass `hmac` (e.g. node:crypto) for speed; the
 * result is identical.
 */
export function deriveDeck(p: DeriveDeckParams, hmac?: HmacSha256Fn): CardCode[] {
  assertNoProblem(serverSeedProblem(p.serverSeed));
  return fisherYatesShuffle(CANONICAL_DECK, new HmacDrbgSource(hexToBytes(p.serverSeed), deckLabel(p), hmac));
}

/** Everything a table's decks depend on except the hand number. */
export type DeckProviderParams = Omit<DeriveDeckParams, 'handNumber'>;

/**
 * `handNumber => deriveDeck(...)` for one table — the shape of the table
 * engine's `TableContext.deckFor`. Validates the fixed inputs once, up front.
 */
export function createDeckProvider(p: DeckProviderParams, hmac?: HmacSha256Fn): (handNumber: number) => CardCode[] {
  const fixed: DeckProviderParams = {
    serverSeed: p.serverSeed,
    tournamentId: p.tournamentId,
    tableId: p.tableId,
    publicEntropy: p.publicEntropy,
  };
  assertNoProblem(serverSeedProblem(fixed.serverSeed), deckLabelProblem({ ...fixed, handNumber: 0 }));
  return (handNumber) => deriveDeck({ ...fixed, handNumber }, hmac);
}

/**
 * Deterministic RandomSource for non-deck draws (seating, final-table seat
 * draw, button draws): HmacDrbgSource(serverSeedBytes, drawLabel(p)).
 */
export function drawSource(p: DrawSourceParams, hmac?: HmacSha256Fn): RandomSource {
  assertNoProblem(serverSeedProblem(p.serverSeed));
  return new HmacDrbgSource(hexToBytes(p.serverSeed), drawLabel(p), hmac);
}

/**
 * deckHash = lowercase hex( SHA-256( ASCII( deck.join("") ) ) ) — the
 * 104-character concatenation of the 52 card codes, top card first.
 * Only full decks are hashed (hashing a partial deck is always a bug).
 */
export function deckHash(deck: readonly CardCode[]): string {
  if (!isFullDeck(deck)) throw new RangeError('deckHash expects a full deck of 52 distinct cards');
  return sha256Hex(deck.join(''));
}
