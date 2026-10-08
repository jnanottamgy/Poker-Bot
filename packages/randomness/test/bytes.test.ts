import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  bytesToHex,
  concatBytes,
  hexToBytes,
  isHex,
  isLowerHex,
  isWellFormedString,
  toBytes,
  utf8Encode,
} from '../src';

describe('hex', () => {
  it('round-trips arbitrary bytes and always emits lowercase', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 256 }), (bytes) => {
        const hex = bytesToHex(bytes);
        expect(hex).toMatch(/^[0-9a-f]*$/);
        expect(hex).toBe(Buffer.from(bytes).toString('hex'));
        expect(hexToBytes(hex)).toEqual(bytes);
        expect(hexToBytes(hex.toUpperCase())).toEqual(bytes);
      }),
    );
  });

  it('rejects odd length, non-hex characters and non-strings', () => {
    expect(() => hexToBytes('abc')).toThrow(RangeError);
    expect(() => hexToBytes('zz')).toThrow(RangeError);
    expect(() => hexToBytes('0x00')).toThrow(RangeError);
    expect(() => hexToBytes(' 00')).toThrow(RangeError);
    expect(() => hexToBytes(null as unknown as string)).toThrow(TypeError);
    expect(hexToBytes('')).toEqual(new Uint8Array(0));
  });

  it('isHex / isLowerHex', () => {
    expect(isHex('00ff')).toBe(true);
    expect(isHex('00FF', 2)).toBe(true);
    expect(isHex('00FF', 3)).toBe(false);
    expect(isHex('0')).toBe(false);
    expect(isHex(12)).toBe(false);
    expect(isLowerHex('00ff', 2)).toBe(true);
    expect(isLowerHex('00FF', 2)).toBe(false);
    expect(isLowerHex('00ff', 3)).toBe(false);
    expect(isLowerHex(undefined, 0)).toBe(false);
  });
});

describe('utf8Encode', () => {
  it('equals TextEncoder for every well-formed string', () => {
    const encoder = new TextEncoder();
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 300 }), (s) => {
        expect(isWellFormedString(s)).toBe(true);
        expect(utf8Encode(s)).toEqual(encoder.encode(s));
      }),
      { numRuns: 500 },
    );
  });

  it('covers 1-, 2-, 3- and 4-byte sequences', () => {
    expect(bytesToHex(utf8Encode('A'))).toBe('41');
    expect(bytesToHex(utf8Encode('é'))).toBe('c3a9');
    expect(bytesToHex(utf8Encode('♠'))).toBe('e299a0');
    expect(bytesToHex(utf8Encode('🂡'))).toBe('f09f82a1');
  });

  it('rejects lone surrogates (TextEncoder would silently substitute U+FFFD)', () => {
    for (const bad of ['\ud800', '\udc00', 'a\ud83cb', '\ude00\ud83c', 'x\ud83c']) {
      expect(isWellFormedString(bad)).toBe(false);
      expect(() => utf8Encode(bad)).toThrow(RangeError);
    }
    expect(isWellFormedString('🂡')).toBe(true);
  });

  it('toBytes passes bytes through and encodes strings', () => {
    const b = Uint8Array.of(1, 2, 3);
    expect(toBytes(b)).toBe(b);
    expect(toBytes('abc')).toEqual(Uint8Array.of(0x61, 0x62, 0x63));
    expect(() => toBytes(5 as unknown as string)).toThrow(TypeError);
    expect(() => utf8Encode(5 as unknown as string)).toThrow(TypeError);
  });

  it('concatBytes', () => {
    expect(concatBytes()).toEqual(new Uint8Array(0));
    expect(concatBytes(Uint8Array.of(1), new Uint8Array(0), Uint8Array.of(2, 3))).toEqual(Uint8Array.of(1, 2, 3));
  });
});
