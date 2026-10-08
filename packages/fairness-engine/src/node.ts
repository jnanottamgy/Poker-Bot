/**
 * @jpb/fairness-engine/node — server entry. Re-exports the portable API, adds
 * `createSeedCommitment` (CSPRNG) and overrides the derivation/verification
 * functions so that they default to the node:crypto HMAC. Results are
 * byte-identical to the portable versions (tested); only speed differs.
 *
 * Never import this from browser code.
 */
import { generateSeedHex, nodeHmacSha256 } from '@jpb/randomness/node';
import type { HmacSha256Fn, RandomSource } from '@jpb/randomness';
import type { BundleVerificationResult, CardCode, HandFairnessRecord, HandVerificationResult } from '@jpb/shared-types';
import { commitmentFor } from './commitment';
import { SERVER_SEED_BYTES } from './constants';
import {
  createDeckProvider as createDeckProviderPortable,
  deriveDeck as deriveDeckPortable,
  drawSource as drawSourcePortable,
} from './deck';
import type { DeckProviderParams, DeriveDeckParams, DrawSourceParams } from './deck';
import { verifyBundle as verifyBundlePortable } from './bundle';
import type { VerifyBundleOptions } from './bundle';
import { verifyHand as verifyHandPortable } from './verify';
import type { VerifyOptions } from './verify';

export * from './index';

/**
 * A fresh server seed (32 CSPRNG bytes, lowercase hex) and its commitment
 * SHA-256(seed bytes). Called once when a tournament is created; publish
 * `serverSeedHash`, keep `serverSeed` secret (encrypted at rest) until reveal.
 */
export function createSeedCommitment(): { serverSeed: string; serverSeedHash: string } {
  const serverSeed = generateSeedHex(SERVER_SEED_BYTES);
  return { serverSeed, serverSeedHash: commitmentFor(serverSeed) };
}

/** `deriveDeck` defaulting to the node:crypto HMAC. */
export function deriveDeck(p: DeriveDeckParams, hmac: HmacSha256Fn = nodeHmacSha256): CardCode[] {
  return deriveDeckPortable(p, hmac);
}

/** `createDeckProvider` defaulting to the node:crypto HMAC (use for `TableContext.deckFor`). */
export function createDeckProvider(
  p: DeckProviderParams,
  hmac: HmacSha256Fn = nodeHmacSha256,
): (handNumber: number) => CardCode[] {
  return createDeckProviderPortable(p, hmac);
}

/** `drawSource` defaulting to the node:crypto HMAC. */
export function drawSource(p: DrawSourceParams, hmac: HmacSha256Fn = nodeHmacSha256): RandomSource {
  return drawSourcePortable(p, hmac);
}

/** `verifyHand` defaulting to the node:crypto HMAC. */
export function verifyHand(
  record: HandFairnessRecord,
  revealedServerSeed: string | null,
  opts: VerifyOptions = {},
): HandVerificationResult {
  return verifyHandPortable(record, revealedServerSeed, { hmac: nodeHmacSha256, ...opts });
}

/** `verifyBundle` defaulting to the node:crypto HMAC. */
export function verifyBundle(bundle: unknown, opts: VerifyBundleOptions = {}): BundleVerificationResult {
  return verifyBundlePortable(bundle, { hmac: nodeHmacSha256, ...opts });
}
