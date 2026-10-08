import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import * as portable from '../src';
import * as node from '../src/node';
import { hex, honestSpec, id } from './arbitraries';
import { GOLDEN, goldenRecord, honestRecord } from './fixtures';

describe('@jpb/fairness-engine/node', () => {
  it('createSeedCommitment: 32 fresh CSPRNG bytes and their SHA-256 commitment', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      const { serverSeed, serverSeedHash } = node.createSeedCommitment();
      expect(serverSeed).toMatch(/^[0-9a-f]{64}$/);
      expect(serverSeedHash).toMatch(/^[0-9a-f]{64}$/);
      expect(serverSeedHash).toBe(portable.commitmentFor(serverSeed));
      expect(seen.has(serverSeed)).toBe(false);
      seen.add(serverSeed);
    }
  });

  it('re-exports the whole portable API', () => {
    for (const name of Object.keys(portable)) expect(name in node).toBe(true);
  });

  it('node-accelerated deriveDeck / drawSource equal the portable versions', () => {
    fc.assert(
      fc.property(
        hex(32),
        id,
        id,
        fc.nat(10_000),
        hex(32),
        (serverSeed, tournamentId, tableId, handNumber, publicEntropy) => {
          const p = { serverSeed, tournamentId, tableId, handNumber, publicEntropy };
          expect(node.deriveDeck(p)).toEqual(portable.deriveDeck(p));
          const a = node.drawSource({ serverSeed, tournamentId, purpose: 'seating', publicEntropy });
          const b = portable.drawSource({ serverSeed, tournamentId, purpose: 'seating', publicEntropy });
          for (let i = 0; i < 20; i += 1) expect(a.nextUint32()).toBe(b.nextUint32());
        },
      ),
      { numRuns: 100 },
    );
    expect(node.deriveDeck({ ...GOLDEN, serverSeed: GOLDEN.serverSeed })).toEqual(GOLDEN.deck);
    const deckFor = node.createDeckProvider({
      serverSeed: GOLDEN.serverSeed,
      tournamentId: GOLDEN.tournamentId,
      tableId: GOLDEN.tableId,
      publicEntropy: GOLDEN.publicEntropy,
    });
    expect(deckFor(GOLDEN.handNumber)).toEqual(GOLDEN.deck);
  });

  it('node verifyHand / verifyBundle give the same results as the portable ones', () => {
    fc.assert(
      fc.property(honestSpec, (spec) => {
        const rec = honestRecord(spec);
        expect(node.verifyHand(rec, spec.serverSeed)).toEqual(portable.verifyHand(rec, spec.serverSeed));
      }),
      { numRuns: 50 },
    );
    const bundle = portable.buildVerificationBundle({
      tournamentId: GOLDEN.tournamentId,
      serverSeedHash: GOLDEN.serverSeedHash,
      serverSeed: GOLDEN.serverSeed,
      publicEntropy: GOLDEN.publicEntropy,
      entropyInputs: null,
      hands: [goldenRecord()],
    });
    expect(node.verifyBundle(bundle)).toEqual(portable.verifyBundle(bundle));
  });

  it('bulk verification is fast enough for whole tournaments (2,000 hands)', () => {
    const records = Array.from({ length: 2_000 }, (_, i) =>
      honestRecord({
        ...GOLDEN,
        serverSeed: GOLDEN.serverSeed,
        tableId: `trn_golden:T${(i % 50) + 1}`,
        handNumber: i,
        seats: [0, 2, 4, 6, 8],
        buttonSeat: i % 9,
        maxSeats: 9,
        boardSize: 5,
      }),
    );
    const started = performance.now();
    for (const r of records) expect(node.verifyHand(r, GOLDEN.serverSeed).status).toBe('VERIFIED');
    // Typically well under a second; generous bound for slow CI.
    expect(performance.now() - started).toBeLessThan(15_000);
  });
});
