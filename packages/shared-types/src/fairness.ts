import type { CardCode } from './cards';
import type { HandId, PlayerId, SeatIndex, TableId, TournamentId } from './ids';

/**
 * FAIRNESS VOCABULARY (CONTRACTS §2). Constructions are implemented and
 * documented in @jpb/fairness-engine and docs/FAIRNESS.md.
 */

/** Version tag of every fairness construction (labels, entropy formula, dealing order). */
export type FairnessScheme = 'JPB/v1';
export const FAIRNESS_SCHEME: FairnessScheme = 'JPB/v1';

/** One dealt-in seat of a hand and the hole cards it received. */
export interface HandFairnessSeat {
  seat: SeatIndex;
  playerId: PlayerId;
  /** [first-round card, second-round card]; null when withheld by the publisher (private cards). */
  cards: [CardCode, CardCode] | null;
}

/**
 * Everything needed to verify one hand against the revealed server seed.
 * Produced from what the poker engine actually dealt (never re-derived from
 * the deck, or verification would be circular).
 */
export interface HandFairnessRecord {
  scheme: FairnessScheme;
  tournamentId: TournamentId;
  tableId: TableId;
  handId: HandId;
  /** Input of the deck label (decimal, no padding). */
  handNumber: number;
  /** Tournament public entropy (64 lowercase hex chars) frozen at START. */
  publicEntropy: string;
  /** Published commitment: SHA-256 of the server seed bytes (64 hex chars). */
  serverSeedHash: string;
  /** SHA-256 of the 104-char concatenation of the hand's 52-card deck (64 hex chars). */
  deckHash: string;
  /** Seats are 0..maxSeats-1; clockwise = ascending index wrapping at maxSeats. */
  maxSeats: number;
  /** Button seat of this hand (may be an empty seat: dead button). */
  buttonSeat: SeatIndex;
  /** Every dealt-in seat, listed in dealing order (first seat clockwise after the button first). */
  holeCards: HandFairnessSeat[];
  /** Community cards in the order dealt: flop (3), turn, river. 0, 3, 4 or 5 cards. */
  board: CardCode[];
  /** Cards burned before each dealt street (one per street: 0..3); null when withheld by the publisher. */
  burns: CardCode[] | null;
}

export type FairnessCheckId = 'SEED_COMMITMENT' | 'DECK_HASH' | 'HOLE_CARDS' | 'BOARD';
export type FairnessCheckStatus = 'VERIFIED' | 'FAILED' | 'NOT_AVAILABLE';
/** VERIFIED: every check VERIFIED. FAILED: at least one check FAILED. INCOMPLETE: none failed, some NOT_AVAILABLE. */
export type FairnessOverallStatus = 'VERIFIED' | 'FAILED' | 'INCOMPLETE';

/** A published value that differs from the value derived from the revealed seed. */
export interface FairnessMismatch {
  /** What was compared, e.g. "seat 3 hole card 1", "flop card 2", "burn 1", "deck hash". */
  item: string;
  published: string;
  derived: string;
}

export interface FairnessCheckResult {
  check: FairnessCheckId;
  status: FairnessCheckStatus;
  /** Deterministic human-readable explanation (fixed templates). */
  detail: string;
  mismatches: FairnessMismatch[];
}

/** What each position of a full deal receives from a given deck. */
export interface DerivedDeal {
  /** Every dealt-in seat in dealing order. */
  holeCards: Array<{ seat: SeatIndex; cards: [CardCode, CardCode] }>;
  /** Burn positions before the flop, turn and river. */
  burns: [CardCode, CardCode, CardCode];
  /** Full five-card board positions (flop, turn, river), whether or not they were dealt. */
  board: [CardCode, CardCode, CardCode, CardCode, CardCode];
}

/** Cards recomputed from the revealed seed (anyone can recompute these once the seed is public). */
export interface DerivedHandCards {
  /** HMAC stream label used for the shuffle. */
  label: string;
  /** deck[0] is the top card. */
  deck: CardCode[];
  deckHash: string;
  /** Null when the record's seat list is invalid, so no dealing order exists. */
  deal: DerivedDeal | null;
}

export interface HandVerificationResult {
  /** Copied from the record when well-formed, else null. */
  tournamentId: TournamentId | null;
  tableId: TableId | null;
  handId: HandId | null;
  handNumber: number | null;
  status: FairnessOverallStatus;
  /** Always the four checks, in the order SEED_COMMITMENT, DECK_HASH, HOLE_CARDS, BOARD. */
  checks: FairnessCheckResult[];
  /** Dealt-in seats whose hole cards were withheld (not verified). */
  withheldSeats: SeatIndex[];
  /** Null when nothing could be derived (seed missing/invalid/not matching the commitment, malformed record). */
  derived: DerivedHandCards | null;
}

/** The published inputs of the tournament public entropy. */
export interface PublicEntropyInputs {
  clientSeeds: string[];
  adminEntropy: string | null;
}

/** Fixed, human-readable statement of every construction, embedded in exports for auditors. */
export interface FairnessMethodDescription {
  commitment: string;
  publicEntropy: string;
  deckLabel: string;
  drawLabel: string;
  stream: string;
  uniformInt: string;
  shuffle: string;
  canonicalDeck: string;
  deckHash: string;
  dealing: string;
}

/** JSON export for independent verification of a tournament (or a range of its hands). */
export interface FairnessExport {
  format: 'JPB-FAIRNESS-EXPORT';
  formatVersion: 1;
  scheme: FairnessScheme;
  method: FairnessMethodDescription;
  tournamentId: TournamentId;
  serverSeedHash: string;
  /** Null until the seed is revealed (after COMPLETED / CANCELLED). */
  serverSeed: string | null;
  publicEntropy: string;
  /** Null when the inputs are not published with this export. */
  entropyInputs: PublicEntropyInputs | null;
  /** Sorted by tableId, then handNumber. */
  hands: HandFairnessRecord[];
}

export type BundleCheckId = 'FORMAT' | 'SEED_COMMITMENT' | 'PUBLIC_ENTROPY' | 'HAND_CONSISTENCY';

export interface BundleCheckResult {
  check: BundleCheckId;
  status: FairnessCheckStatus;
  detail: string;
  problems: string[];
}

export interface BundleVerificationResult {
  status: FairnessOverallStatus;
  tournamentId: TournamentId | null;
  /** Always the four bundle-level checks, in the order FORMAT, SEED_COMMITMENT, PUBLIC_ENTROPY, HAND_CONSISTENCY. */
  checks: BundleCheckResult[];
  hands: HandVerificationResult[];
  counts: { hands: number; verified: number; failed: number; incomplete: number };
}
