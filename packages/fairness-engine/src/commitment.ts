import { hexToBytes, sha256Hex } from '@jpb/randomness';
import { assertNoProblem, digestProblem, serverSeedProblem } from './validate';

/** True iff `value` is a 32-byte hex server seed (either case). */
export function isValidServerSeed(value: unknown): value is string {
  return serverSeedProblem(value) === null;
}

/**
 * Published commitment of a server seed (CONTRACTS §2):
 *   serverSeedHash = lowercase hex( SHA-256( serverSeedBytes ) )
 * Note: the hash is over the 32 raw bytes, not over the hex text.
 */
export function commitmentFor(serverSeedHex: string): string {
  assertNoProblem(serverSeedProblem(serverSeedHex));
  return sha256Hex(hexToBytes(serverSeedHex));
}

/** True iff the seed is valid and hashes to `serverSeedHash` (hex compared case-insensitively). */
export function seedMatchesCommitment(serverSeedHex: unknown, serverSeedHash: unknown): boolean {
  if (serverSeedProblem(serverSeedHex) !== null || digestProblem('serverSeedHash', serverSeedHash) !== null)
    return false;
  return commitmentFor(serverSeedHex as string) === (serverSeedHash as string).toLowerCase();
}
