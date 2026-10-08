import { describe, expect, it } from 'vitest';
import {
  constantTimeEqual,
  decryptSecret,
  encryptSecret,
  hashPassword,
  parseEncryptionKey,
  randomToken,
  verifyPassword,
} from '../src/security/crypto';
import { newId, newJoinCode, newPublicPlayerId, publicPlayerIdLength } from '../src/security/ids';
import { RateLimiter } from '../src/security/rate-limit';

describe('passwords', () => {
  it('hashes with scrypt and verifies', async () => {
    const h = await hashPassword('correct horse battery staple');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse battery staple', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
  });
  it('salts every hash', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });
});

describe('secret box', () => {
  const key = parseEncryptionKey('11'.repeat(32));
  it('round-trips and authenticates', () => {
    const box = encryptSecret('server-seed-hex', key, 'trn_1');
    expect(decryptSecret(box, key, 'trn_1')).toBe('server-seed-hex');
    expect(() => decryptSecret(box, key, 'trn_2')).toThrow();
    const tampered = box.slice(0, -2) + (box.endsWith('A') ? 'B' : 'A') + box.slice(-1);
    expect(() => decryptSecret(tampered, key, 'trn_1')).toThrow();
  });
  it('rejects bad keys', () => {
    expect(() => parseEncryptionKey('abc')).toThrow();
  });
});

describe('tokens and ids', () => {
  it('generates unique url-safe tokens', () => {
    const set = new Set(Array.from({ length: 1000 }, () => randomToken()));
    expect(set.size).toBe(1000);
    for (const t of set) expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
  it('constant-time compare', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
  });
  it('public ids scale with field size', () => {
    expect(publicPlayerIdLength(100)).toBe(4);
    expect(publicPlayerIdLength(1_000_000)).toBeGreaterThanOrEqual(6);
    expect(newPublicPlayerId(1000)).toMatch(/^JPN-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(newJoinCode()).toMatch(/^[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(newId('ply')).toMatch(/^ply_[0-9a-f]{32}$/);
  });
});

describe('rate limiter', () => {
  it('allows a burst then refills over time', () => {
    const rl = new RateLimiter({ capacity: 3, refillPerSecond: 1 });
    expect([rl.take('a', 0), rl.take('a', 0), rl.take('a', 0), rl.take('a', 0)]).toEqual([true, true, true, false]);
    expect(rl.retryAfterSeconds('a', 0)).toBe(1);
    expect(rl.take('a', 1000)).toBe(true);
    expect(rl.take('a', 1000)).toBe(false);
    expect(rl.take('b', 0)).toBe(true);
  });
  it('blocks RAISE spam (spec §74)', () => {
    const rl = new RateLimiter({ capacity: 4, refillPerSecond: 2 });
    let allowed = 0;
    for (let i = 0; i < 100; i++) if (rl.take('player', i * 10)) allowed++;
    expect(allowed).toBeLessThanOrEqual(6);
  });
  it('bounds memory by evicting least recently used keys', () => {
    const rl = new RateLimiter({ capacity: 1, refillPerSecond: 1 }, 10);
    for (let i = 0; i < 50; i++) rl.take(`k${i}`, 0);
    expect(rl.size).toBe(10);
  });
});
