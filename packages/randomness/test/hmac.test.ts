import { createHmac } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { bytesToHex, createHmacSha256, hexToBytes, hmacSha256 } from '../src';
import { nodeHmacSha256 } from '../src/node';

const fill = (byte: number, n: number): Uint8Array => new Uint8Array(n).fill(byte);
const ascii = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));

/** RFC 4231 §4.2–4.8, HMAC-SHA-256 outputs. */
const RFC4231: Array<{ name: string; key: Uint8Array; data: Uint8Array; mac: string; truncateBytes?: number }> = [
  {
    name: 'test case 1',
    key: fill(0x0b, 20),
    data: ascii('Hi There'),
    mac: 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
  },
  {
    name: 'test case 2 (key shorter than output)',
    key: ascii('Jefe'),
    data: ascii('what do ya want for nothing?'),
    mac: '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
  },
  {
    name: 'test case 3',
    key: fill(0xaa, 20),
    data: fill(0xdd, 50),
    mac: '773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe',
  },
  {
    name: 'test case 4',
    key: hexToBytes('0102030405060708090a0b0c0d0e0f10111213141516171819'),
    data: fill(0xcd, 50),
    mac: '82558a389a443c0ea4cc819899f2083a85f0faa3e578f8077a2e3ff46729665b',
  },
  {
    name: 'test case 5 (truncated to 128 bits)',
    key: fill(0x0c, 20),
    data: ascii('Test With Truncation'),
    mac: 'a3b6167473100ee06e0c796c2955552b',
    truncateBytes: 16,
  },
  {
    name: 'test case 6 (key larger than block size)',
    key: fill(0xaa, 131),
    data: ascii('Test Using Larger Than Block-Size Key - Hash Key First'),
    mac: '60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54',
  },
  {
    name: 'test case 7 (key and data larger than block size)',
    key: fill(0xaa, 131),
    data: ascii(
      'This is a test using a larger than block-size key and a larger than block-size data. The key needs to be hashed before being used by the HMAC algorithm.',
    ),
    mac: '9b09ffa71b942fcb27635fbcd5b0e944bfdc63644f0713938a7f51535c3a35e2',
  },
];

describe('HMAC-SHA256 RFC 4231 vectors', () => {
  for (const tc of RFC4231) {
    it(tc.name, () => {
      const n = tc.truncateBytes ?? 32;
      expect(bytesToHex(hmacSha256(tc.key, tc.data).subarray(0, n))).toBe(tc.mac);
      expect(bytesToHex(createHmacSha256(tc.key)(tc.data).subarray(0, n))).toBe(tc.mac);
      expect(bytesToHex(nodeHmacSha256(tc.key, tc.data).subarray(0, n))).toBe(tc.mac);
    });
  }
});

describe('HMAC-SHA256: pure JS vs node:crypto', () => {
  it('random keys (including > block size) and messages', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 200 }), fc.uint8Array({ maxLength: 400 }), (key, msg) => {
        const expected = createHmac('sha256', key).update(msg).digest('hex');
        expect(bytesToHex(hmacSha256(key, msg))).toBe(expected);
        expect(bytesToHex(nodeHmacSha256(key, msg))).toBe(expected);
      }),
      { numRuns: 500 },
    );
  });

  it('string messages are UTF-8 encoded', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 1, maxLength: 64 }),
        fc.string({ unit: 'binary', maxLength: 100 }),
        (key, msg) => {
          const expected = createHmac('sha256', key).update(Buffer.from(msg, 'utf8')).digest('hex');
          expect(bytesToHex(hmacSha256(key, msg))).toBe(expected);
          expect(bytesToHex(nodeHmacSha256(key, msg))).toBe(expected);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('a keyed HMAC can be reused for many messages', () => {
    const key = fill(0x42, 32);
    const mac = createHmacSha256(key);
    for (let i = 0; i < 50; i += 1) {
      const msg = ascii(`message ${i}`);
      expect(bytesToHex(mac(msg))).toBe(createHmac('sha256', key).update(msg).digest('hex'));
    }
  });

  it('rejects non-Uint8Array keys', () => {
    expect(() => hmacSha256('key' as unknown as Uint8Array, 'x')).toThrow(TypeError);
    expect(() => nodeHmacSha256('key' as unknown as Uint8Array, 'x')).toThrow(TypeError);
  });
});
