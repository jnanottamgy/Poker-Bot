/**
 * Portable, dependency-free SHA-256 (FIPS 180-4) and HMAC-SHA256 (RFC 2104).
 *
 * Exists so the public fairness verifier runs synchronously in any browser
 * (WebCrypto's digest/HMAC are async-only, which does not fit the synchronous
 * `RandomSource` interface). Tested against the NIST and RFC 4231 vectors and
 * cross-checked byte-for-byte against node:crypto on random inputs.
 */
import { bytesToHex, toBytes } from './bytes';

/** Digest size in bytes. */
export const SHA256_BYTES = 32;
/** Internal block size in bytes (also the HMAC key-padding size). */
export const SHA256_BLOCK_BYTES = 64;

/** Round constants: first 32 bits of the fractional parts of the cube roots of the first 64 primes. */
const K = Uint32Array.of(
  0x428a2f98,
  0x71374491,
  0xb5c0fbcf,
  0xe9b5dba5,
  0x3956c25b,
  0x59f111f1,
  0x923f82a4,
  0xab1c5ed5,
  0xd807aa98,
  0x12835b01,
  0x243185be,
  0x550c7dc3,
  0x72be5d74,
  0x80deb1fe,
  0x9bdc06a7,
  0xc19bf174,
  0xe49b69c1,
  0xefbe4786,
  0x0fc19dc6,
  0x240ca1cc,
  0x2de92c6f,
  0x4a7484aa,
  0x5cb0a9dc,
  0x76f988da,
  0x983e5152,
  0xa831c66d,
  0xb00327c8,
  0xbf597fc7,
  0xc6e00bf3,
  0xd5a79147,
  0x06ca6351,
  0x14292967,
  0x27b70a85,
  0x2e1b2138,
  0x4d2c6dfc,
  0x53380d13,
  0x650a7354,
  0x766a0abb,
  0x81c2c92e,
  0x92722c85,
  0xa2bfe8a1,
  0xa81a664b,
  0xc24b8b70,
  0xc76c51a3,
  0xd192e819,
  0xd6990624,
  0xf40e3585,
  0x106aa070,
  0x19a4c116,
  0x1e376c08,
  0x2748774c,
  0x34b0bcb5,
  0x391c0cb3,
  0x4ed8aa4a,
  0x5b9cca4f,
  0x682e6ff3,
  0x748f82ee,
  0x78a5636f,
  0x84c87814,
  0x8cc70208,
  0x90befffa,
  0xa4506ceb,
  0xbef9a3f7,
  0xc67178f2,
);

/** Initial hash value: first 32 bits of the fractional parts of the square roots of the first 8 primes. */
const IV = Uint32Array.of(
  0x6a09e667,
  0xbb67ae85,
  0x3c6ef372,
  0xa54ff53a,
  0x510e527f,
  0x9b05688c,
  0x1f83d9ab,
  0x5be0cd19,
);

/** Bytes per 2^32 bits of message length (2^32 / 8). */
const BYTES_PER_LENGTH_HIGH_WORD = 0x20000000;
const LENGTH_FIELD_OFFSET = SHA256_BLOCK_BYTES - 8;

/** One compression of the 64-byte block at `data[offset..offset+64)` into `h`. `w` is scratch space. */
function compress(h: Uint32Array, w: Uint32Array, data: Uint8Array, offset: number): void {
  for (let t = 0; t < 16; t += 1) {
    const j = offset + 4 * t;
    w[t] = (data[j]! << 24) | (data[j + 1]! << 16) | (data[j + 2]! << 8) | data[j + 3]!;
  }
  for (let t = 16; t < 64; t += 1) {
    const x = w[t - 15]!;
    const y = w[t - 2]!;
    const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
    const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
    w[t] = (w[t - 16]! + s0 + w[t - 7]! + s1) | 0;
  }
  let a = h[0]!;
  let b = h[1]!;
  let c = h[2]!;
  let d = h[3]!;
  let e = h[4]!;
  let f = h[5]!;
  let g = h[6]!;
  let hh = h[7]!;
  for (let t = 0; t < 64; t += 1) {
    const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const ch = (e & f) ^ (~e & g);
    const t1 = (hh + S1 + ch + K[t]! + w[t]!) | 0;
    const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const maj = (a & b) ^ (a & c) ^ (b & c);
    const t2 = (S0 + maj) | 0;
    hh = g;
    g = f;
    f = e;
    e = (d + t1) | 0;
    d = c;
    c = b;
    b = a;
    a = (t1 + t2) | 0;
  }
  // Uint32Array stores reduce modulo 2^32.
  h[0] = h[0]! + a;
  h[1] = h[1]! + b;
  h[2] = h[2]! + c;
  h[3] = h[3]! + d;
  h[4] = h[4]! + e;
  h[5] = h[5]! + f;
  h[6] = h[6]! + g;
  h[7] = h[7]! + hh;
}

/** Incremental SHA-256. `update` any number of times, then `digest` once. */
export class Sha256 {
  private readonly state = IV.slice();
  private readonly buffer = new Uint8Array(SHA256_BLOCK_BYTES);
  private readonly scratch = new Uint32Array(64);
  private bufferLength = 0;
  private bytesHashed = 0;
  private finished = false;

  /** Absorbs `data` (strings are UTF-8 encoded). */
  update(data: string | Uint8Array): this {
    if (this.finished) throw new Error('Sha256: update() after digest()');
    const bytes = toBytes(data);
    if (!Number.isSafeInteger(this.bytesHashed + bytes.length)) throw new RangeError('Sha256: message too long');
    this.bytesHashed += bytes.length;
    let pos = 0;
    if (this.bufferLength > 0) {
      const take = Math.min(SHA256_BLOCK_BYTES - this.bufferLength, bytes.length);
      this.buffer.set(bytes.subarray(0, take), this.bufferLength);
      this.bufferLength += take;
      pos = take;
      if (this.bufferLength < SHA256_BLOCK_BYTES) return this;
      compress(this.state, this.scratch, this.buffer, 0);
      this.bufferLength = 0;
    }
    while (bytes.length - pos >= SHA256_BLOCK_BYTES) {
      compress(this.state, this.scratch, bytes, pos);
      pos += SHA256_BLOCK_BYTES;
    }
    if (pos < bytes.length) {
      this.buffer.set(bytes.subarray(pos), 0);
      this.bufferLength = bytes.length - pos;
    }
    return this;
  }

  /** Pads, finishes and returns the 32-byte digest. The instance cannot be reused afterwards. */
  digest(): Uint8Array {
    if (this.finished) throw new Error('Sha256: digest() called twice');
    this.finished = true;
    const lengthHigh = Math.floor(this.bytesHashed / BYTES_PER_LENGTH_HIGH_WORD);
    const lengthLow = (this.bytesHashed % BYTES_PER_LENGTH_HIGH_WORD) * 8;
    const buf = this.buffer;
    buf[this.bufferLength] = 0x80;
    buf.fill(0, this.bufferLength + 1);
    if (this.bufferLength + 1 > LENGTH_FIELD_OFFSET) {
      compress(this.state, this.scratch, buf, 0);
      buf.fill(0);
    }
    writeUint32BE(buf, LENGTH_FIELD_OFFSET, lengthHigh);
    writeUint32BE(buf, LENGTH_FIELD_OFFSET + 4, lengthLow);
    compress(this.state, this.scratch, buf, 0);
    const out = new Uint8Array(SHA256_BYTES);
    for (let i = 0; i < 8; i += 1) writeUint32BE(out, 4 * i, this.state[i]!);
    return out;
  }

  /** Independent copy of the current (unfinished) state. */
  clone(): Sha256 {
    if (this.finished) throw new Error('Sha256: clone() after digest()');
    const copy = new Sha256();
    copy.state.set(this.state);
    copy.buffer.set(this.buffer);
    copy.bufferLength = this.bufferLength;
    copy.bytesHashed = this.bytesHashed;
    return copy;
  }
}

function writeUint32BE(out: Uint8Array, offset: number, value: number): void {
  out[offset] = value >>> 24;
  out[offset + 1] = value >>> 16;
  out[offset + 2] = value >>> 8;
  out[offset + 3] = value;
}

/** SHA-256 digest (strings are UTF-8 encoded). */
export function sha256(data: string | Uint8Array): Uint8Array {
  return new Sha256().update(data).digest();
}

/** Lowercase hex SHA-256 digest (strings are UTF-8 encoded). */
export function sha256Hex(data: string | Uint8Array): string {
  return bytesToHex(sha256(data));
}

/**
 * Keyed HMAC-SHA256 (RFC 2104): the inner and outer pad blocks are absorbed
 * once, so each message costs only its own compressions. This is what makes
 * the pure-JS DRBG fast enough for bulk verification in a browser.
 */
export function createHmacSha256(key: Uint8Array): (message: string | Uint8Array) => Uint8Array {
  if (!(key instanceof Uint8Array)) throw new TypeError('HMAC key must be a Uint8Array');
  const padded = new Uint8Array(SHA256_BLOCK_BYTES);
  padded.set(key.length > SHA256_BLOCK_BYTES ? sha256(key) : key);
  const inner = new Sha256().update(padded.map((b) => b ^ 0x36));
  const outer = new Sha256().update(padded.map((b) => b ^ 0x5c));
  return (message) => outer.clone().update(inner.clone().update(message).digest()).digest();
}

/** HMAC-SHA256(key, message); strings are UTF-8 encoded. Returns 32 bytes. */
export function hmacSha256(key: Uint8Array, message: string | Uint8Array): Uint8Array {
  return createHmacSha256(key)(message);
}
