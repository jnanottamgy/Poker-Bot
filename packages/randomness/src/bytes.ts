/**
 * Byte/encoding helpers. Portable (no Node or DOM APIs) so that the public
 * verifier produces byte-identical inputs in every environment.
 */

const HEX_DIGITS = '0123456789abcdef';
const HEX_PATTERN = /^(?:[0-9a-fA-F]{2})*$/;

/** Lowercase hex encoding. */
export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i] as number;
    out += HEX_DIGITS[b >>> 4]! + HEX_DIGITS[b & 0x0f]!;
  }
  return out;
}

/**
 * Decodes hex (either case). Throws a TypeError for non-string input and a
 * RangeError for odd length or non-hex characters — hex never comes out of a
 * decode "approximately right".
 */
export function hexToBytes(hex: string): Uint8Array {
  if (typeof hex !== 'string') throw new TypeError('hexToBytes expects a string');
  if (!HEX_PATTERN.test(hex)) throw new RangeError('hexToBytes expects an even-length string of hexadecimal digits');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  }
  return out;
}

/** True iff `value` is hex (either case) of exactly `byteLength` bytes (any even length when omitted). */
export function isHex(value: unknown, byteLength?: number): value is string {
  if (typeof value !== 'string' || !HEX_PATTERN.test(value)) return false;
  return byteLength === undefined || value.length === 2 * byteLength;
}

/** True iff `value` is lowercase hex of exactly `byteLength` bytes — the canonical form this system emits. */
export function isLowerHex(value: unknown, byteLength: number): value is string {
  return typeof value === 'string' && value.length === 2 * byteLength && /^[0-9a-f]*$/.test(value);
}

/**
 * True iff the string is well-formed UTF-16 (no lone surrogates). Lone
 * surrogates have no UTF-8 encoding; silently replacing them (as TextEncoder
 * does) would let two different strings map to the same bytes, so labels and
 * hashed strings must be well-formed.
 */
export function isWellFormedString(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = i + 1 < value.length ? value.charCodeAt(i + 1) : 0;
      if (next < 0xdc00 || next > 0xdfff) return false;
      i += 1;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/**
 * Strict UTF-8 encoding (RFC 3629). Throws a RangeError on lone surrogates
 * instead of substituting U+FFFD. Identical to TextEncoder for well-formed
 * input (tested).
 */
export function utf8Encode(value: string): Uint8Array {
  if (typeof value !== 'string') throw new TypeError('utf8Encode expects a string');
  // Worst case is 3 bytes per UTF-16 code unit (a surrogate pair: 4 bytes for 2 units).
  const out = new Uint8Array(value.length * 3);
  let n = 0;
  for (let i = 0; i < value.length; i += 1) {
    let cp = value.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff) {
      const low = i + 1 < value.length ? value.charCodeAt(i + 1) : 0;
      if (low < 0xdc00 || low > 0xdfff) throw new RangeError('utf8Encode: lone high surrogate');
      cp = 0x10000 + ((cp - 0xd800) << 10) + (low - 0xdc00);
      i += 1;
    } else if (cp >= 0xdc00 && cp <= 0xdfff) {
      throw new RangeError('utf8Encode: lone low surrogate');
    }
    if (cp < 0x80) {
      out[n++] = cp;
    } else if (cp < 0x800) {
      out[n++] = 0xc0 | (cp >> 6);
      out[n++] = 0x80 | (cp & 0x3f);
    } else if (cp < 0x10000) {
      out[n++] = 0xe0 | (cp >> 12);
      out[n++] = 0x80 | ((cp >> 6) & 0x3f);
      out[n++] = 0x80 | (cp & 0x3f);
    } else {
      out[n++] = 0xf0 | (cp >> 18);
      out[n++] = 0x80 | ((cp >> 12) & 0x3f);
      out[n++] = 0x80 | ((cp >> 6) & 0x3f);
      out[n++] = 0x80 | (cp & 0x3f);
    }
  }
  return out.slice(0, n);
}

/** `string` → UTF-8 bytes; `Uint8Array` → itself. */
export function toBytes(data: string | Uint8Array): Uint8Array {
  if (typeof data === 'string') return utf8Encode(data);
  if (data instanceof Uint8Array) return data;
  throw new TypeError('expected a string or Uint8Array');
}

/** Concatenation into a new array. */
export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  let length = 0;
  for (const p of parts) length += p.length;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
