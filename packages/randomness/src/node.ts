/**
 * @jpb/randomness/node — Node-only entry. Re-exports the portable API and adds
 * the platform CSPRNG (node:crypto) plus a native, byte-identical HMAC-SHA256.
 *
 * Never import this from browser code.
 */
import { Buffer } from 'node:buffer';
import { createHash, createHmac, randomBytes, randomInt } from 'node:crypto';
import { bytesToHex, toBytes } from './bytes';
import { HmacDrbgSource } from './drbg';
import type { RandomSource } from './types';

export * from './index';

/** Bytes fetched from the CSPRNG per refill of a `secureRandomSource` pool. */
export const SECURE_POOL_BYTES = 4096;
/** Default server-seed size (CONTRACTS §2: 32 bytes). */
export const DEFAULT_SEED_BYTES = 32;
/** Upper bound accepted by `generateSeedHex`. */
export const MAX_SEED_BYTES = 1024;
/** node:crypto `randomInt` requires (max - min) < 2^48. */
export const MAX_SECURE_INT_RANGE = 2 ** 48 - 1;
/** node:crypto `randomBytes` upper bound (2^31 - 1). */
const MAX_RANDOM_BYTES = 2 ** 31 - 1;

/**
 * CSPRNG-backed RandomSource. Each instance keeps its own pool of
 * `SECURE_POOL_BYTES` bytes from `crypto.randomBytes` (pooling only amortises
 * the syscall; every value still comes from the CSPRNG). Never Math.random.
 */
export function secureRandomSource(): RandomSource {
  let pool = Buffer.alloc(0);
  let offset = 0;
  return {
    nextUint32(): number {
      if (offset + 4 > pool.length) {
        pool = randomBytes(SECURE_POOL_BYTES);
        offset = 0;
      }
      const value = pool.readUInt32BE(offset);
      // Consumed bytes are wiped so a later memory dump cannot reveal past draws.
      pool.fill(0, offset, offset + 4);
      offset += 4;
      return value;
    },
  };
}

/** `n` bytes from the CSPRNG (a fresh, unshared array). */
export function secureRandomBytes(n: number): Uint8Array {
  if (!Number.isSafeInteger(n) || n < 0 || n > MAX_RANDOM_BYTES) {
    throw new RangeError(`secureRandomBytes: n must be an integer in [0, 2^31 - 1], got ${n}`);
  }
  return new Uint8Array(randomBytes(n));
}

/** Uniform integer in [0, maxExclusive) from crypto.randomInt (unbiased). */
export function secureRandomInt(maxExclusive: number): number {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > MAX_SECURE_INT_RANGE) {
    throw new RangeError(`secureRandomInt: maxExclusive must be an integer in [1, 2^48 - 1], got ${maxExclusive}`);
  }
  return randomInt(maxExclusive);
}

/** `bytes` CSPRNG bytes as lowercase hex (default 32 bytes = 64 hex chars). */
export function generateSeedHex(bytes: number = DEFAULT_SEED_BYTES): string {
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_SEED_BYTES) {
    throw new RangeError(`generateSeedHex: bytes must be an integer in [1, ${MAX_SEED_BYTES}], got ${bytes}`);
  }
  return randomBytes(bytes).toString('hex');
}

/** node:crypto HMAC-SHA256 — byte-identical to the portable `hmacSha256`, much faster. */
export function nodeHmacSha256(key: Uint8Array, message: string | Uint8Array): Uint8Array {
  if (!(key instanceof Uint8Array)) throw new TypeError('HMAC key must be a Uint8Array');
  return new Uint8Array(createHmac('sha256', key).update(toBytes(message)).digest());
}

/** node:crypto SHA-256 digest (strings UTF-8 encoded with the same strict encoder as the portable version). */
export function nodeSha256(data: string | Uint8Array): Uint8Array {
  return new Uint8Array(createHash('sha256').update(toBytes(data)).digest());
}

/** Lowercase hex node:crypto SHA-256. */
export function nodeSha256Hex(data: string | Uint8Array): string {
  return bytesToHex(nodeSha256(data));
}

/** HmacDrbgSource backed by node:crypto HMAC (same stream as the portable source, faster). */
export function createNodeHmacDrbg(key: Uint8Array, label: string): HmacDrbgSource {
  return new HmacDrbgSource(key, label, nodeHmacSha256);
}
