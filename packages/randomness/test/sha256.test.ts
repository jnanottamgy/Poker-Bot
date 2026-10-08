import { createHash } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { bytesToHex, Sha256, sha256, sha256Hex } from '../src';

const nodeHex = (data: Uint8Array | string): string => createHash('sha256').update(data).digest('hex');

describe('SHA-256 NIST vectors (FIPS 180-2 / NIST CSRC examples)', () => {
  it('empty string', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex(new Uint8Array(0))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('"abc" (one block)', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('448-bit message (padding spills into a second block)', () => {
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('896-bit message', () => {
    expect(
      sha256Hex(
        'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu',
      ),
    ).toBe('cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1');
  });

  it('one million "a" (one shot and in uneven chunks)', () => {
    const expected = 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0';
    const million = new Uint8Array(1_000_000).fill(0x61);
    expect(sha256Hex(million)).toBe(expected);
    const h = new Sha256();
    let pos = 0;
    let step = 1;
    while (pos < million.length) {
      const end = Math.min(million.length, pos + step);
      h.update(million.subarray(pos, end));
      pos = end;
      step = (step * 7 + 3) % 1000;
    }
    expect(bytesToHex(h.digest())).toBe(expected);
  });
});

describe('SHA-256 against node:crypto', () => {
  it('every message length 0..300 (all padding boundaries)', () => {
    for (let len = 0; len <= 300; len += 1) {
      const data = Uint8Array.from({ length: len }, (_, i) => (i * 31 + len) & 0xff);
      expect(sha256Hex(data)).toBe(nodeHex(data));
    }
  });

  it('random byte strings', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 2048 }), (data) => {
        expect(sha256Hex(data)).toBe(nodeHex(data));
      }),
      { numRuns: 500 },
    );
  });

  it('random Unicode strings are UTF-8 encoded', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 200 }), (s) => {
        expect(sha256Hex(s)).toBe(nodeHex(Buffer.from(s, 'utf8')));
      }),
      { numRuns: 300 },
    );
  });

  it('incremental updates at arbitrary split points equal the one-shot digest', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 600 }), fc.array(fc.nat(600), { maxLength: 8 }), (data, cuts) => {
        const points = [...new Set(cuts.map((c) => c % (data.length + 1)))].sort((a, b) => a - b);
        const h = new Sha256();
        let prev = 0;
        for (const p of points) {
          h.update(data.subarray(prev, p));
          prev = p;
        }
        h.update(data.subarray(prev));
        expect(bytesToHex(h.digest())).toBe(nodeHex(data));
      }),
      { numRuns: 300 },
    );
  });
});

describe('Sha256 object lifecycle', () => {
  it('digest() twice and update() after digest() throw', () => {
    const h = new Sha256().update('abc');
    h.digest();
    expect(() => h.digest()).toThrow();
    expect(() => h.update('x')).toThrow();
    expect(() => h.clone()).toThrow();
  });

  it('clone() is independent of the original', () => {
    const h = new Sha256().update('ab');
    const c = h.clone();
    h.update('c');
    c.update('x');
    expect(bytesToHex(h.digest())).toBe(sha256Hex('abc'));
    expect(bytesToHex(c.digest())).toBe(sha256Hex('abx'));
  });

  it('sha256() returns 32 bytes and rejects non-byte input', () => {
    expect(sha256('abc')).toHaveLength(32);
    expect(() => sha256(42 as unknown as string)).toThrow(TypeError);
  });

  it('rejects strings with lone surrogates instead of guessing an encoding', () => {
    expect(() => sha256Hex('\ud800')).toThrow(RangeError);
  });
});
