import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CardCode, HandFairnessRecord } from '@jpb/shared-types';
import { computePublicEntropy, deckHash, deriveDeck, verifyHand } from '../src';
import { hex, honestSpec, id } from './arbitraries';
import { GOLDEN, goldenRecord, honestRecord, otherCard } from './fixtures';

/**
 * The examples/ verifiers are independent, dependency-free re-implementations
 * (node:crypto and WebCrypto). They are what docs/FAIRNESS.md tells third
 * parties to run, so they are tested against the engine here.
 */
interface NodeVerifier {
  publicEntropy(clientSeeds: string[], adminEntropy: string | null): string;
  deriveDeck(seed: string, tournamentId: string, tableId: string, handNumber: number, entropy: string): string[];
  verifyHand(
    record: HandFairnessRecord,
    seed: string,
  ): Record<'SEED_COMMITMENT' | 'DECK_HASH' | 'HOLE_CARDS' | 'BOARD', boolean>;
}
interface WebVerifier {
  commitment(seed: string): Promise<string>;
  deriveDeck(
    seed: string,
    tournamentId: string,
    tableId: string,
    handNumber: number,
    entropy: string,
  ): Promise<string[]>;
  deckHash(deck: string[]): Promise<string>;
}

const NODE_EXAMPLE = new URL('../examples/verify-hand.mjs', import.meta.url);
const WEB_EXAMPLE = new URL('../examples/verify-hand-webcrypto.mjs', import.meta.url);
const standalone = (await import(/* @vite-ignore */ NODE_EXAMPLE.href)) as NodeVerifier;
const web = (await import(/* @vite-ignore */ WEB_EXAMPLE.href)) as WebVerifier;

describe('standalone node:crypto verifier (examples/verify-hand.mjs)', () => {
  it('reproduces the golden vector', () => {
    expect(standalone.publicEntropy(GOLDEN.clientSeeds.slice(), GOLDEN.adminEntropy)).toBe(GOLDEN.publicEntropy);
    expect(
      standalone.deriveDeck(
        GOLDEN.serverSeed,
        GOLDEN.tournamentId,
        GOLDEN.tableId,
        GOLDEN.handNumber,
        GOLDEN.publicEntropy,
      ),
    ).toEqual(GOLDEN.deck);
    expect(standalone.verifyHand(goldenRecord(), GOLDEN.serverSeed)).toEqual({
      SEED_COMMITMENT: true,
      DECK_HASH: true,
      HOLE_CARDS: true,
      BOARD: true,
    });
  });

  it('agrees with the engine on random inputs', () => {
    fc.assert(
      fc.property(
        hex(32),
        id,
        id,
        fc.nat(100_000),
        fc.array(hex(32), { maxLength: 6 }),
        fc.option(fc.string({ unit: 'grapheme', maxLength: 20 }), { nil: null }),
        (seed, t, tbl, n, seeds, admin) => {
          const entropy = computePublicEntropy({ clientSeeds: seeds, adminEntropy: admin });
          expect(standalone.publicEntropy(seeds, admin)).toBe(entropy);
          expect(standalone.deriveDeck(seed, t, tbl, n, entropy)).toEqual(
            deriveDeck({ serverSeed: seed, tournamentId: t, tableId: tbl, handNumber: n, publicEntropy: entropy }),
          );
        },
      ),
      { numRuns: 150 },
    );
  });

  it('gives the same verdicts as the engine on honest and tampered hands', () => {
    fc.assert(
      fc.property(honestSpec, fc.constantFrom('none', 'hole', 'board', 'deckHash', 'button'), (spec, tamper) => {
        const rec = honestRecord(spec);
        if (tamper === 'hole') rec.holeCards[0]!.cards![1] = otherCard(rec.holeCards[0]!.cards![1]);
        if (tamper === 'board' && rec.board.length > 0) rec.board[0] = otherCard(rec.board[0] as CardCode);
        if (tamper === 'deckHash') rec.deckHash = '0'.repeat(64);
        if (tamper === 'button') rec.buttonSeat = (rec.buttonSeat + 1) % rec.maxSeats;
        const engine = verifyHand(rec, spec.serverSeed);
        const simple = standalone.verifyHand(rec, spec.serverSeed);
        for (const c of engine.checks) expect(simple[c.check]).toBe(c.status === 'VERIFIED');
      }),
      { numRuns: 200 },
    );
  });

  it('docs/FAIRNESS.md embeds this exact file', () => {
    const doc = readFileSync(new URL('../../../docs/FAIRNESS.md', import.meta.url), 'utf8');
    const source = readFileSync(NODE_EXAMPLE, 'utf8').trim();
    expect(doc.includes(source)).toBe(true);
  });
});

describe('standalone WebCrypto verifier (examples/verify-hand-webcrypto.mjs)', () => {
  it('reproduces the golden vector', async () => {
    expect(await web.commitment(GOLDEN.serverSeed)).toBe(GOLDEN.serverSeedHash);
    const deck = await web.deriveDeck(
      GOLDEN.serverSeed,
      GOLDEN.tournamentId,
      GOLDEN.tableId,
      GOLDEN.handNumber,
      GOLDEN.publicEntropy,
    );
    expect(deck).toEqual(GOLDEN.deck);
    expect(await web.deckHash(deck)).toBe(GOLDEN.deckHash);
  });

  it('agrees with the engine on random inputs', async () => {
    await fc.assert(
      fc.asyncProperty(hex(32), id, id, fc.nat(100_000), hex(32), async (seed, t, tbl, n, entropy) => {
        const expected = deriveDeck({
          serverSeed: seed,
          tournamentId: t,
          tableId: tbl,
          handNumber: n,
          publicEntropy: entropy,
        });
        const deck = await web.deriveDeck(seed, t, tbl, n, entropy);
        expect(deck).toEqual(expected);
        expect(await web.deckHash(deck)).toBe(deckHash(expected));
      }),
      { numRuns: 40 },
    );
  });
});
