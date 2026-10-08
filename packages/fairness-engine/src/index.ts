/**
 * @jpb/fairness-engine — portable entry (browser + Node; no `node:` imports).
 * Commit–reveal, deterministic deck/draw derivation and independent
 * verification. `@jpb/fairness-engine/node` adds `createSeedCommitment`
 * (CSPRNG) and node:crypto-accelerated defaults.
 */
export type {
  BundleCheckId,
  BundleCheckResult,
  BundleVerificationResult,
  DerivedDeal,
  DerivedHandCards,
  FairnessCheckId,
  FairnessCheckResult,
  FairnessCheckStatus,
  FairnessExport,
  FairnessMethodDescription,
  FairnessMismatch,
  FairnessOverallStatus,
  FairnessScheme,
  HandFairnessRecord,
  HandFairnessSeat,
  HandVerificationResult,
  PublicEntropyInputs,
} from '@jpb/shared-types';
export { FAIRNESS_SCHEME } from '@jpb/shared-types';
export type { HmacSha256Fn, RandomSource } from '@jpb/randomness';

export {
  BOARD_CARDS,
  BURNS_FOR_BOARD_SIZE,
  BURNS_PER_HAND,
  CLIENT_SEED_PATTERN,
  CLIENT_SEED_SEPARATOR,
  DECK_PURPOSE,
  ENTROPY_PURPOSE,
  FIELD_SEPARATOR,
  HOLE_CARDS_PER_SEAT,
  LABEL_PREFIX,
  MAX_CLIENT_SEED_LENGTH,
  RESERVED_PURPOSES,
  SERVER_SEED_BYTES,
} from './constants';
export { commitmentFor, isValidServerSeed, seedMatchesCommitment } from './commitment';
export { clientSeedProblem, computePublicEntropy, publicEntropyPreimage } from './entropy';
export { deckLabel, deckLabelProblem, drawLabel } from './labels';
export type { DeckLabelParams, DrawLabelParams } from './labels';
export { createDeckProvider, deckHash, deriveDeck, drawSource, isCardCode, isFullDeck } from './deck';
export type { DeckProviderParams, DeriveDeckParams, DrawSourceParams } from './deck';
export { cardsNeeded, dealingOrder, dealPositions, expectedDeal } from './dealing';
export type { DealPositions, ExpectedDeal } from './dealing';
export { isHandFairnessRecord, recordShapeProblems, redactHandFairnessRecord } from './record';
export type { RedactionPolicy } from './record';
export { verifyHand } from './verify';
export type { VerifyOptions } from './verify';
export {
  buildVerificationBundle,
  bundleShapeProblems,
  FAIRNESS_EXPORT_FORMAT,
  FAIRNESS_EXPORT_VERSION,
  FAIRNESS_METHOD,
  MAX_LISTED_PROBLEMS,
  verifyBundle,
} from './bundle';
export type { BuildBundleInput, VerifyBundleOptions } from './bundle';
