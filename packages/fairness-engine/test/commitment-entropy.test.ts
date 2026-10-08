import { createHash } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  clientSeedProblem,
  commitmentFor,
  computePublicEntropy,
  isValidServerSeed,
  MAX_CLIENT_SEED_LENGTH,
  publicEntropyPreimage,
  seedMatchesCommitment,
} from '../src';
import { hex } from './arbitraries';
import { GOLDEN } from './fixtures';

describe('commitmentFor', () => {
  it('golden: SHA-256 over the 32 seed BYTES (not over the hex text)', () => {
    expect(commitmentFor(GOLDEN.serverSeed)).toBe(GOLDEN.serverSeedHash);
    expect(commitmentFor(GOLDEN.serverSeed)).not.toBe(
      createHash('sha256').update(GOLDEN.serverSeed, 'utf8').digest('hex'),
    );
  });

  it('matches node:crypto for random seeds; hex case does not change the seed', () => {
    fc.assert(
      fc.property(hex(32), (seed) => {
        const expected = createHash('sha256').update(Buffer.from(seed, 'hex')).digest('hex');
        expect(commitmentFor(seed)).toBe(expected);
        expect(commitmentFor(seed.toUpperCase())).toBe(expected);
        expect(seedMatchesCommitment(seed, expected)).toBe(true);
        expect(seedMatchesCommitment(seed, expected.toUpperCase())).toBe(true);
      }),
    );
  });

  it('rejects seeds that are not exactly 32 bytes of hex', () => {
    for (const bad of [
      '',
      'ab',
      GOLDEN.serverSeed.slice(2),
      `${GOLDEN.serverSeed}00`,
      `${GOLDEN.serverSeed.slice(1)}g`,
      ` ${GOLDEN.serverSeed.slice(1)}`,
    ]) {
      expect(isValidServerSeed(bad)).toBe(false);
      expect(() => commitmentFor(bad)).toThrow(RangeError);
      expect(seedMatchesCommitment(bad, GOLDEN.serverSeedHash)).toBe(false);
    }
    expect(isValidServerSeed(42)).toBe(false);
    expect(isValidServerSeed(GOLDEN.serverSeed)).toBe(true);
  });

  it('seedMatchesCommitment is false for a different seed or a malformed hash', () => {
    const other = `${GOLDEN.serverSeed.slice(0, 63)}${GOLDEN.serverSeed.endsWith('0') ? '1' : '0'}`;
    expect(seedMatchesCommitment(other, GOLDEN.serverSeedHash)).toBe(false);
    expect(seedMatchesCommitment(GOLDEN.serverSeed, 'not-a-hash')).toBe(false);
    expect(seedMatchesCommitment(GOLDEN.serverSeed, null)).toBe(false);
  });
});

describe('computePublicEntropy', () => {
  it('golden: sorted client seeds, comma-joined, then admin entropy', () => {
    const input = { clientSeeds: GOLDEN.clientSeeds.slice(), adminEntropy: GOLDEN.adminEntropy };
    expect(publicEntropyPreimage(input)).toBe(
      `JPB/v1/entropy|${'0f'.repeat(32)},${'a1'.repeat(32)},${'c3'.repeat(32)}|Johnny night #1`,
    );
    expect(computePublicEntropy(input)).toBe(GOLDEN.publicEntropy);
    expect(computePublicEntropy({ clientSeeds: [], adminEntropy: null })).toBe(GOLDEN.emptyEntropy);
    expect(createHash('sha256').update('JPB/v1/entropy||').digest('hex')).toBe(GOLDEN.emptyEntropy);
  });

  it('does not depend on the order seeds are supplied in and never mutates the input', () => {
    fc.assert(
      fc.property(
        fc.array(hex(32), { maxLength: 30 }),
        fc.option(fc.string({ unit: 'grapheme', maxLength: 40 }), { nil: null }),
        (seeds, admin) => {
          const original = seeds.slice();
          const a = computePublicEntropy({ clientSeeds: seeds, adminEntropy: admin });
          expect(seeds).toEqual(original);
          expect(computePublicEntropy({ clientSeeds: seeds.slice().reverse(), adminEntropy: admin })).toBe(a);
          expect(a).toMatch(/^[0-9a-f]{64}$/);
          const preimage = `JPB/v1/entropy|${seeds.slice().sort().join(',')}|${admin ?? ''}`;
          expect(a).toBe(createHash('sha256').update(Buffer.from(preimage, 'utf8')).digest('hex'));
        },
      ),
      { numRuns: 300 },
    );
  });

  it('changes when any contribution changes; keeps duplicates; null admin entropy equals ""', () => {
    const base = { clientSeeds: ['aa', 'bb'], adminEntropy: null };
    const e = computePublicEntropy(base);
    expect(computePublicEntropy({ clientSeeds: ['aa', 'bb'], adminEntropy: '' })).toBe(e);
    expect(computePublicEntropy({ clientSeeds: ['aa', 'bc'], adminEntropy: null })).not.toBe(e);
    expect(computePublicEntropy({ clientSeeds: ['aa', 'bb', 'bb'], adminEntropy: null })).not.toBe(e);
    expect(computePublicEntropy({ clientSeeds: ['aa', 'bb'], adminEntropy: 'x' })).not.toBe(e);
    expect(computePublicEntropy({ clientSeeds: ['aa'], adminEntropy: null })).not.toBe(e);
  });

  it('admin entropy may be any well-formed Unicode text (UTF-8 encoded), including "|" and ","', () => {
    const admin = 'Diwali night ♠ | round 2, table ✓';
    const expected = createHash('sha256')
      .update(Buffer.from(`JPB/v1/entropy|aa|${admin}`, 'utf8'))
      .digest('hex');
    expect(computePublicEntropy({ clientSeeds: ['aa'], adminEntropy: admin })).toBe(expected);
    expect(() => computePublicEntropy({ clientSeeds: ['aa'], adminEntropy: 'bad\ud800' })).toThrow(RangeError);
    expect(() => computePublicEntropy({ clientSeeds: ['aa'], adminEntropy: 5 as unknown as string })).toThrow(
      RangeError,
    );
  });

  it('client seeds must be 1..256 printable ASCII characters without "," or "|" (keeps the encoding unambiguous)', () => {
    for (const bad of [
      '',
      'a,b',
      'a|b',
      'with space',
      'tab\t',
      'é',
      'x'.repeat(MAX_CLIENT_SEED_LENGTH + 1),
      7 as unknown as string,
    ]) {
      expect(clientSeedProblem(bad)).not.toBeNull();
      expect(() => computePublicEntropy({ clientSeeds: ['ok', bad], adminEntropy: null })).toThrow(RangeError);
    }
    for (const good of ['a', 'A-Z_0.9~!', 'x'.repeat(MAX_CLIENT_SEED_LENGTH), 'deadbeef', 'base64+/='])
      expect(clientSeedProblem(good)).toBeNull();
    expect(() => computePublicEntropy({ clientSeeds: 'aa' as unknown as string[], adminEntropy: null })).toThrow(
      RangeError,
    );
  });

  it('distinct seed multisets give distinct preimages (no separator ambiguity)', () => {
    const seed = fc.stringMatching(/^[!-+\--{}~]{1,6}$/);
    fc.assert(
      fc.property(fc.array(seed, { maxLength: 5 }), fc.array(seed, { maxLength: 5 }), (a, b) => {
        const same = a.slice().sort().join('\u0000') === b.slice().sort().join('\u0000');
        const pa = publicEntropyPreimage({ clientSeeds: a, adminEntropy: null });
        const pb = publicEntropyPreimage({ clientSeeds: b, adminEntropy: null });
        expect(pa === pb).toBe(same);
      }),
      { numRuns: 500 },
    );
  });
});
