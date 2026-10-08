import { createHmac } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { bytesToHex, createHmacDrbg, hexToBytes, HmacDrbgSource, streamBlock, streamBlockMessage } from '../src';
import type { HmacSha256Fn } from '../src';
import { createNodeHmacDrbg, nodeHmacSha256 } from '../src/node';
import { GOLDEN_KEY, GOLDEN_LABEL } from './helpers';

/**
 * Known-answer vectors. Computed ONCE with node:crypto directly from the
 * normative formula (block(i) = HMAC-SHA256(key, label + "|" + i)), by a
 * script independent of this package, then hardcoded. Never regenerate them
 * from this package's own output.
 */
const V1_BLOCKS = [
  '30bfe8d7f155d9ab664dab9bc23042572c0eb184482b023c3fff4e847ac1c1cc',
  '5399f1ce1df979bfc26336f06867e1414578aac2259fd16020b61a966b2f366d',
  '5fbcace282a3db4aec7e12a584aba34abe0d3fac682e302ced48a70d6e3e1757',
];
const V1_UINT32 = [
  817883351, 4048935339, 1716366235, 3257942615, 739160452, 1210778172, 1073696388, 2059518412, 1402597838, 502888895,
];
const V2_KEY = hexToBytes('c0ffee');
const V2_LABEL = 'JPB/v1/ünïcödé ♠ 🂡';
const V2_BLOCKS: Record<number, string> = {
  0: '3df091c92656b61b19ced55c6ac4e8f297a25cdfd50bf35bea28e17fe79513ee',
  9: 'c1c0c5a053037de495d2fa6dad97d59ef777e669587664d154ea893860a2f174',
  10: 'b1f5fef66de5d2d0aa67ca648641a950b6556e10d41aa6dad0d40d7c755e7b5a',
  123: '1f761c53b91b3e3a8a4859d1c4ef3ba042acedffe8ab60ae4b4606a7f72e34d7',
};
const V3_EMPTY_LABEL_BLOCK0 = 'c3b828d37771dc351605ae48fdf2af1f5b38e179d42df368bb71419ae96bfb05';

const IMPLEMENTATIONS: Array<[string, HmacSha256Fn | undefined]> = [
  ['pure JS (default)', undefined],
  ['node:crypto', nodeHmacSha256],
];

describe.each(IMPLEMENTATIONS)('HMAC-SHA256 counter-mode stream — %s', (_name, hmac) => {
  it('V1: block(0..2) known answers', () => {
    V1_BLOCKS.forEach((hex, i) => expect(bytesToHex(streamBlock(GOLDEN_KEY, GOLDEN_LABEL, i, hmac))).toBe(hex));
    const src = new HmacDrbgSource(GOLDEN_KEY, GOLDEN_LABEL, hmac);
    expect(bytesToHex(src.nextBytes(96))).toBe(V1_BLOCKS.join(''));
  });

  it('V1: nextUint32 consumes 4 bytes big-endian', () => {
    const src = new HmacDrbgSource(GOLDEN_KEY, GOLDEN_LABEL, hmac);
    expect(Array.from({ length: 10 }, () => src.nextUint32())).toEqual(V1_UINT32);
  });

  it('V2: UTF-8 label and multi-digit counters', () => {
    for (const [i, hex] of Object.entries(V2_BLOCKS)) {
      expect(bytesToHex(streamBlock(V2_KEY, V2_LABEL, Number(i), hmac))).toBe(hex);
    }
    const src = new HmacDrbgSource(V2_KEY, V2_LABEL, hmac);
    const all = bytesToHex(src.nextBytes(32 * 124));
    expect(all.slice(0, 64)).toBe(V2_BLOCKS[0]);
    expect(all.slice(64 * 10, 64 * 11)).toBe(V2_BLOCKS[10]);
    expect(all.slice(64 * 123)).toBe(V2_BLOCKS[123]);
  });

  it('V3: empty label (message is "|0")', () => {
    expect(bytesToHex(streamBlock(Uint8Array.of(1), '', 0, hmac))).toBe(V3_EMPTY_LABEL_BLOCK0);
  });
});

describe('stream construction', () => {
  it('block message is UTF-8(label) || "|" || decimal(i)', () => {
    expect(Buffer.from(streamBlockMessage('JPB/v1/x', 0)).toString('utf8')).toBe('JPB/v1/x|0');
    expect(Buffer.from(streamBlockMessage('é', 1234)).toString('hex')).toBe(
      Buffer.from('é|1234', 'utf8').toString('hex'),
    );
    expect(() => streamBlockMessage('x', -1)).toThrow(RangeError);
    expect(() => streamBlockMessage('x', 1.5)).toThrow(RangeError);
    expect(() => streamBlockMessage(3 as unknown as string, 0)).toThrow(TypeError);
  });

  it('matches the formula for random keys, labels and lengths (pure JS vs node:crypto formula)', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 1, maxLength: 80 }),
        fc.string({ unit: 'binary', maxLength: 60 }),
        fc.integer({ min: 0, max: 200 }),
        (key, label, nBytes) => {
          const expected: Buffer[] = [];
          for (let i = 0; i * 32 < nBytes; i += 1)
            expected.push(
              createHmac('sha256', key)
                .update(Buffer.from(`${label}|${i}`, 'utf8'))
                .digest(),
            );
          const want = Buffer.concat(expected).subarray(0, nBytes).toString('hex');
          expect(bytesToHex(new HmacDrbgSource(key, label).nextBytes(nBytes))).toBe(want);
          expect(bytesToHex(createNodeHmacDrbg(key, label).nextBytes(nBytes))).toBe(want);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('mixing nextBytes and nextUint32 reads the same contiguous stream (words may straddle blocks)', () => {
    fc.assert(
      fc.property(fc.array(fc.oneof(fc.constant(-1), fc.integer({ min: 0, max: 37 })), { maxLength: 40 }), (ops) => {
        const reference = new HmacDrbgSource(GOLDEN_KEY, GOLDEN_LABEL).nextBytes(4 * 40 + 37 * 40);
        const src = new HmacDrbgSource(GOLDEN_KEY, GOLDEN_LABEL);
        let pos = 0;
        for (const op of ops) {
          if (op === -1) {
            const expected =
              ((reference[pos]! << 24) |
                (reference[pos + 1]! << 16) |
                (reference[pos + 2]! << 8) |
                reference[pos + 3]!) >>>
              0;
            expect(src.nextUint32()).toBe(expected);
            pos += 4;
          } else {
            expect(src.nextBytes(op)).toEqual(reference.subarray(pos, pos + op));
            pos += op;
          }
          expect(src.bytesConsumed).toBe(pos);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('identical (key, label) give identical streams; any change gives a different stream', () => {
    const a = new HmacDrbgSource(GOLDEN_KEY, GOLDEN_LABEL).nextBytes(64);
    expect(new HmacDrbgSource(GOLDEN_KEY, GOLDEN_LABEL).nextBytes(64)).toEqual(a);
    expect(new HmacDrbgSource(GOLDEN_KEY, `${GOLDEN_LABEL}x`).nextBytes(64)).not.toEqual(a);
    const otherKey = GOLDEN_KEY.slice();
    otherKey[31] = otherKey[31]! ^ 1;
    expect(new HmacDrbgSource(otherKey, GOLDEN_LABEL).nextBytes(64)).not.toEqual(a);
  });

  it('copies the key: mutating the caller array afterwards has no effect', () => {
    const key = GOLDEN_KEY.slice();
    const src = new HmacDrbgSource(key, GOLDEN_LABEL);
    key.fill(0);
    expect(Array.from({ length: 10 }, () => src.nextUint32())).toEqual(V1_UINT32);
  });

  it('counts blocks and bytes', () => {
    const src = createHmacDrbg(GOLDEN_KEY, GOLDEN_LABEL);
    expect(src.label).toBe(GOLDEN_LABEL);
    expect(src.blocksGenerated).toBe(0);
    expect(src.bytesConsumed).toBe(0);
    src.nextUint32();
    expect(src.blocksGenerated).toBe(1);
    expect(src.bytesConsumed).toBe(4);
    for (let i = 0; i < 8; i += 1) src.nextUint32();
    expect(src.blocksGenerated).toBe(2);
    expect(src.bytesConsumed).toBe(36);
  });

  it('rejects invalid keys, labels, lengths and broken HMAC implementations', () => {
    expect(() => new HmacDrbgSource(new Uint8Array(0), 'x')).toThrow(RangeError);
    expect(() => new HmacDrbgSource('00' as unknown as Uint8Array, 'x')).toThrow(TypeError);
    expect(() => new HmacDrbgSource(GOLDEN_KEY, 7 as unknown as string)).toThrow(TypeError);
    expect(() => new HmacDrbgSource(GOLDEN_KEY, 'bad\ud800')).toThrow(RangeError);
    expect(() => new HmacDrbgSource(GOLDEN_KEY, 'x').nextBytes(-1)).toThrow(RangeError);
    const shortMac: HmacSha256Fn = () => new Uint8Array(16);
    expect(() => new HmacDrbgSource(GOLDEN_KEY, 'x', shortMac).nextUint32()).toThrow(/32-byte/);
  });

  it('copies each block, so an implementation that reuses its output buffer cannot corrupt the stream', () => {
    const shared = new Uint8Array(32);
    const reusing: HmacSha256Fn = (key, msg) => {
      shared.set(nodeHmacSha256(key, msg));
      return shared;
    };
    const src = new HmacDrbgSource(GOLDEN_KEY, GOLDEN_LABEL, reusing);
    const first = src.nextUint32();
    shared.fill(0xff);
    expect([first, ...Array.from({ length: 9 }, () => src.nextUint32())]).toEqual(V1_UINT32);
  });
});
