import { FAIRNESS_SCHEME } from '@jpb/shared-types';

/** Every label and hashed preimage starts with this versioned prefix ("JPB/v1/"). */
export const LABEL_PREFIX = `${FAIRNESS_SCHEME}/`;

/** Separates fields inside labels and the entropy preimage. Forbidden inside any field. */
export const FIELD_SEPARATOR = '|';

/** Separates sorted client seeds inside the entropy preimage. Forbidden inside client seeds. */
export const CLIENT_SEED_SEPARATOR = ',';

/** Purpose of the per-hand deck stream ("JPB/v1/deck|..."). */
export const DECK_PURPOSE = 'deck';

/** Purpose of the public-entropy preimage ("JPB/v1/entropy|..."). */
export const ENTROPY_PURPOSE = 'entropy';

/** `drawSource` purposes that would alias another construction's prefix. */
export const RESERVED_PURPOSES: readonly string[] = [DECK_PURPOSE, ENTROPY_PURPOSE];

/** CONTRACTS §2: the server seed is 32 CSPRNG bytes. */
export const SERVER_SEED_BYTES = 32;

/** SHA-256 digest size in bytes (commitments, entropy and deck hashes). */
export const HASH_BYTES = 32;

/**
 * Client seeds are 1..MAX_CLIENT_SEED_LENGTH printable ASCII characters
 * (0x21..0x7E) other than "," and "|". ASCII makes "sorted" unambiguous in
 * every language (code-unit order = code-point order = byte order).
 */
export const MAX_CLIENT_SEED_LENGTH = 256;
export const CLIENT_SEED_PATTERN = /^[\x21-\x2b\x2d-\x7b\x7d\x7e]+$/;

/** Dealing constants (Texas Hold'em). */
export const HOLE_CARDS_PER_SEAT = 2;
export const BURNS_PER_HAND = 3;
export const BOARD_CARDS = 5;
/** Cards a full deal needs beyond the hole cards: 3 burns + 5 board cards. */
export const COMMUNITY_DEAL_CARDS = BURNS_PER_HAND + BOARD_CARDS;

/** Legal board sizes and the burns that precede them: none, flop, turn, river. */
export const BURNS_FOR_BOARD_SIZE: Readonly<Record<number, number>> = { 0: 0, 3: 1, 4: 2, 5: 3 };
