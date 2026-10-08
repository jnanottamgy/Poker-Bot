import { describe, expect, it } from 'vitest';
import {
  createNodeHmacDrbg,
  DEFAULT_SEED_BYTES,
  fisherYatesShuffle,
  generateSeedHex,
  HmacDrbgSource,
  MAX_SECURE_INT_RANGE,
  nodeSha256Hex,
  secureRandomBytes,
  secureRandomInt,
  secureRandomSource,
  sha256Hex,
  uniformInt,
} from '../src/node';
import { chiSquareCritical } from './helpers';

describe('secureRandomSource (node:crypto CSPRNG)', () => {
  it('returns uint32 values across many pool refills', () => {
    const src = secureRandomSource();
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i += 1) {
      const v = src.nextUint32();
      expect(Number.isInteger(v) && v >= 0 && v < 2 ** 32).toBe(true);
      seen.add(v);
    }
    // 5000 draws from 2^32 values: a collision is astronomically unlikely; many duplicates mean a broken pool.
    expect(seen.size).toBeGreaterThan(4990);
  });

  it('independent sources produce different streams', () => {
    const a = secureRandomSource();
    const b = secureRandomSource();
    const xs = Array.from({ length: 8 }, () => a.nextUint32());
    const ys = Array.from({ length: 8 }, () => b.nextUint32());
    expect(xs).not.toEqual(ys);
  });

  it('works with uniformInt and the shuffle (live, non-reproducible use)', () => {
    const src = secureRandomSource();
    const deck = Array.from({ length: 52 }, (_, i) => i);
    const out = fisherYatesShuffle(deck, src);
    expect(out.slice().sort((x, y) => x - y)).toEqual(deck);
    for (let i = 0; i < 1000; i += 1) {
      const v = uniformInt(src, 10);
      expect(v >= 0 && v < 10).toBe(true);
    }
  });

  it('bit balance smoke test: every bit position is set ~half the time', () => {
    // Not deterministic (real CSPRNG), so the bound is very loose: z = 7 (p ≈ 1e-12 per bit).
    const src = secureRandomSource();
    const draws = 20_000;
    const ones = new Array<number>(32).fill(0);
    for (let i = 0; i < draws; i += 1) {
      const v = src.nextUint32();
      for (let b = 0; b < 32; b += 1) if ((v >>> b) & 1) ones[b]! += 1;
    }
    const sd = Math.sqrt(draws / 4);
    for (const c of ones) expect(Math.abs(c - draws / 2)).toBeLessThan(7 * sd);
  });
});

describe('secureRandomBytes / secureRandomInt / generateSeedHex', () => {
  it('secureRandomBytes returns fresh arrays of the requested size', () => {
    expect(secureRandomBytes(0)).toHaveLength(0);
    const a = secureRandomBytes(32);
    const b = secureRandomBytes(32);
    expect(a).toBeInstanceOf(Uint8Array);
    expect(a).toHaveLength(32);
    expect(a).not.toEqual(b);
    for (const bad of [-1, 1.5, Number.NaN, 2 ** 31]) expect(() => secureRandomBytes(bad)).toThrow(RangeError);
  });

  it('secureRandomInt stays in range and is roughly uniform', () => {
    expect(secureRandomInt(1)).toBe(0);
    const n = 6;
    const draws = 12_000;
    const counts = new Array<number>(n).fill(0);
    for (let i = 0; i < draws; i += 1) {
      const v = secureRandomInt(n);
      expect(Number.isInteger(v) && v >= 0 && v < n).toBe(true);
      counts[v]! += 1;
    }
    const expected = draws / n;
    const stat = counts.reduce((acc, c) => acc + (c - expected) ** 2 / expected, 0);
    expect(stat).toBeLessThan(chiSquareCritical(n - 1, 7));
    const big = secureRandomInt(MAX_SECURE_INT_RANGE);
    expect(big >= 0 && big < MAX_SECURE_INT_RANGE).toBe(true);
    for (const bad of [0, -3, 2.5, Number.NaN, MAX_SECURE_INT_RANGE + 1])
      expect(() => secureRandomInt(bad)).toThrow(RangeError);
  });

  it('generateSeedHex returns lowercase hex of the requested size (default 32 bytes)', () => {
    const seed = generateSeedHex();
    expect(DEFAULT_SEED_BYTES).toBe(32);
    expect(seed).toMatch(/^[0-9a-f]{64}$/);
    expect(generateSeedHex()).not.toBe(seed);
    expect(generateSeedHex(16)).toMatch(/^[0-9a-f]{32}$/);
    for (const bad of [0, -1, 1.5, 4096]) expect(() => generateSeedHex(bad)).toThrow(RangeError);
  });

  it('nodeSha256Hex equals the portable sha256Hex', () => {
    for (const s of ['', 'abc', 'é♠🂡', 'x'.repeat(1000)]) expect(nodeSha256Hex(s)).toBe(sha256Hex(s));
    expect(() => nodeSha256Hex('\udfff')).toThrow(RangeError);
  });
});

describe('performance sanity', () => {
  it('10,000 seeded 52-card shuffles with the node:crypto DRBG run quickly', () => {
    const key = Uint8Array.from({ length: 32 }, (_, i) => 255 - i);
    const deck = Array.from({ length: 52 }, (_, i) => i);
    const started = performance.now();
    let checksum = 0;
    for (let h = 0; h < 10_000; h += 1)
      checksum += fisherYatesShuffle(deck, createNodeHmacDrbg(key, `JPB/v1/perf|${h}`))[0]!;
    const elapsed = performance.now() - started;
    expect(checksum).toBeGreaterThan(0);
    // Typically ~0.2 s; the bound is generous for slow CI machines.
    expect(elapsed).toBeLessThan(10_000);
  });

  it('2,000 seeded 52-card shuffles with the pure-JS DRBG (browser path) run quickly', () => {
    const key = Uint8Array.from({ length: 32 }, (_, i) => i * 3);
    const deck = Array.from({ length: 52 }, (_, i) => i);
    const started = performance.now();
    for (let h = 0; h < 2_000; h += 1) fisherYatesShuffle(deck, new HmacDrbgSource(key, `JPB/v1/perf|${h}`));
    expect(performance.now() - started).toBeLessThan(10_000);
  });
});
