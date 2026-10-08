/**
 * HMAC-SHA256 counter-mode stream (NORMATIVE — CONTRACTS §1).
 *
 *   block(i) = HMAC-SHA256(key, UTF-8(label) || "|" || ASCII(decimal(i)))   i = 0, 1, 2, ...
 *   stream   = block(0) || block(1) || block(2) || ...
 *   nextUint32() consumes the next 4 stream bytes, big-endian.
 *
 * `decimal(i)` is the base-10 representation without sign, padding or
 * leading zeros. Independent verifiers in any language must reproduce this
 * byte-for-byte; the README and docs/FAIRNESS.md carry known-answer vectors.
 */
import { concatBytes, utf8Encode } from './bytes';
import { createHmacSha256, SHA256_BYTES } from './sha256';
import type { HmacSha256Fn, RandomSource } from './types';

/** Separator between the label and the block counter. */
export const STREAM_COUNTER_SEPARATOR = '|';

const UINT8_SHIFT_24 = 0x1000000;

function counterBytes(index: number): Uint8Array {
  if (!Number.isSafeInteger(index) || index < 0)
    throw new RangeError(`stream block index must be a non-negative safe integer, got ${index}`);
  return utf8Encode(index.toString(10));
}

/** The exact HMAC message of block `index`: UTF-8(label) || "|" || decimal(index). */
export function streamBlockMessage(label: string, index: number): Uint8Array {
  if (typeof label !== 'string') throw new TypeError('stream label must be a string');
  return concatBytes(utf8Encode(label + STREAM_COUNTER_SEPARATOR), counterBytes(index));
}

/** block(index) of the stream for (key, label). */
export function streamBlock(key: Uint8Array, label: string, index: number, hmac?: HmacSha256Fn): Uint8Array {
  const message = streamBlockMessage(label, index);
  return hmac ? hmac(key, message) : createHmacSha256(key)(message);
}

/**
 * Deterministic RandomSource over the normative HMAC-SHA256 counter-mode
 * stream. Same (key, label) ⇒ same values, in every environment. The key is
 * copied, so later mutation of the caller's array has no effect.
 */
export class HmacDrbgSource implements RandomSource {
  readonly label: string;
  private readonly mac: (message: Uint8Array) => Uint8Array;
  private readonly prefix: Uint8Array;
  private block: Uint8Array = new Uint8Array(0);
  private offset = 0;
  private nextIndex = 0;

  /**
   * @param key   raw key bytes (non-empty), e.g. the 32-byte server seed
   * @param label UTF-8 domain-separation label (must be well-formed UTF-16)
   * @param hmac  optional faster HMAC-SHA256 implementation (e.g. node:crypto); must be byte-identical
   */
  constructor(key: Uint8Array, label: string, hmac?: HmacSha256Fn) {
    if (!(key instanceof Uint8Array)) throw new TypeError('HmacDrbgSource key must be a Uint8Array');
    if (key.length === 0) throw new RangeError('HmacDrbgSource key must not be empty');
    if (typeof label !== 'string') throw new TypeError('HmacDrbgSource label must be a string');
    const keyCopy = key.slice();
    this.label = label;
    this.prefix = utf8Encode(label + STREAM_COUNTER_SEPARATOR);
    this.mac = hmac ? (message) => hmac(keyCopy, message) : createHmacSha256(keyCopy);
  }

  nextUint32(): number {
    const o = this.offset;
    const b = this.block;
    if (o + 4 <= b.length) {
      this.offset = o + 4;
      return ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
    }
    // Only reachable at a block boundary or after nextBytes() left a partial word.
    return this.nextByte() * UINT8_SHIFT_24 + ((this.nextByte() << 16) | (this.nextByte() << 8) | this.nextByte());
  }

  /** The next `n` raw stream bytes. */
  nextBytes(n: number): Uint8Array {
    if (!Number.isSafeInteger(n) || n < 0)
      throw new RangeError(`nextBytes expects a non-negative safe integer, got ${n}`);
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) out[i] = this.nextByte();
    return out;
  }

  /** Number of HMAC blocks computed so far. */
  get blocksGenerated(): number {
    return this.nextIndex;
  }

  /** Number of stream bytes consumed so far. */
  get bytesConsumed(): number {
    return this.nextIndex === 0 ? 0 : (this.nextIndex - 1) * SHA256_BYTES + this.offset;
  }

  private nextByte(): number {
    if (this.offset >= this.block.length) this.refill();
    const value = this.block[this.offset]!;
    this.offset += 1;
    return value;
  }

  private refill(): void {
    const out = this.mac(concatBytes(this.prefix, counterBytes(this.nextIndex)));
    if (!(out instanceof Uint8Array) || out.length !== SHA256_BYTES) {
      throw new Error('HMAC-SHA256 implementation must return a 32-byte Uint8Array');
    }
    // Copy: a native implementation may hand out memory it later reuses.
    this.block = new Uint8Array(out);
    this.offset = 0;
    this.nextIndex += 1;
  }
}

/** Factory form of `new HmacDrbgSource(key, label, hmac)`. */
export function createHmacDrbg(key: Uint8Array, label: string, hmac?: HmacSha256Fn): HmacDrbgSource {
  return new HmacDrbgSource(key, label, hmac);
}
