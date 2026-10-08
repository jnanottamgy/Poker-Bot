import { createHash } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CANONICAL_DECK } from '@jpb/shared-types';
import type { CardCode } from '@jpb/shared-types';
import {
  createDeckProvider,
  deckHash,
  deckLabel,
  deckLabelProblem,
  deriveDeck,
  drawLabel,
  drawSource,
  isCardCode,
  isFullDeck,
} from '../src';
import type { DeriveDeckParams } from '../src';
import { nodeHmacSha256 } from '@jpb/randomness/node';
import { hex, id } from './arbitraries';
import { GOLDEN } from './fixtures';

const goldenParams: DeriveDeckParams = {
  serverSeed: GOLDEN.serverSeed,
  tournamentId: GOLDEN.tournamentId,
  tableId: GOLDEN.tableId,
  handNumber: GOLDEN.handNumber,
  publicEntropy: GOLDEN.publicEntropy,
};

describe('labels', () => {
  it('golden deck label', () => {
    expect(deckLabel(goldenParams)).toBe(GOLDEN.label);
  });

  it('draw label: "JPB/v1/{purpose}|{tournamentId}|{publicEntropy}"', () => {
    expect(drawLabel({ tournamentId: 't1', purpose: 'seating', publicEntropy: GOLDEN.publicEntropy })).toBe(
      `JPB/v1/seating|t1|${GOLDEN.publicEntropy}`,
    );
    expect(drawLabel({ tournamentId: 't1', purpose: 'button:t1:T3', publicEntropy: GOLDEN.publicEntropy })).toBe(
      `JPB/v1/button:t1:T3|t1|${GOLDEN.publicEntropy}`,
    );
  });

  it('rejects fields that would make labels ambiguous or non-canonical', () => {
    const bad: Array<Partial<DeriveDeckParams>> = [
      { tournamentId: '' },
      { tournamentId: 'a|b' },
      { tableId: 'x|y' },
      { tableId: '' },
      { tableId: 'lone\udc00' },
      { handNumber: -1 },
      { handNumber: 1.5 },
      { handNumber: Number.NaN },
      { publicEntropy: GOLDEN.publicEntropy.toUpperCase() },
      { publicEntropy: GOLDEN.publicEntropy.slice(1) },
      { publicEntropy: 'entropy' },
    ];
    for (const patch of bad) {
      const p = { ...goldenParams, ...patch };
      expect(deckLabelProblem(p)).not.toBeNull();
      expect(() => deckLabel(p)).toThrow(RangeError);
      expect(() => deriveDeck(p)).toThrow(RangeError);
    }
    for (const purpose of ['', 'deck', 'entropy', 'a|b']) {
      expect(() => drawLabel({ tournamentId: 't', purpose, publicEntropy: GOLDEN.publicEntropy })).toThrow(RangeError);
    }
    expect(() => drawLabel({ tournamentId: 't|u', purpose: 'seating', publicEntropy: GOLDEN.publicEntropy })).toThrow(
      RangeError,
    );
  });

  it('distinct (tournamentId, tableId, handNumber, entropy) give distinct labels', () => {
    const params = fc.record({
      tournamentId: id,
      tableId: id,
      handNumber: fc.nat(1000),
      publicEntropy: fc.constantFrom(GOLDEN.publicEntropy, GOLDEN.emptyEntropy),
    });
    fc.assert(
      fc.property(params, params, (a, b) => {
        const same =
          a.tournamentId === b.tournamentId &&
          a.tableId === b.tableId &&
          a.handNumber === b.handNumber &&
          a.publicEntropy === b.publicEntropy;
        expect(deckLabel(a) === deckLabel(b)).toBe(same);
      }),
      { numRuns: 1000 },
    );
  });
});

describe('deriveDeck', () => {
  it('golden deck (computed independently with node:crypto)', () => {
    expect(deriveDeck(goldenParams)).toEqual(GOLDEN.deck);
    expect(deriveDeck(goldenParams, nodeHmacSha256)).toEqual(GOLDEN.deck);
    expect(deriveDeck({ ...goldenParams, serverSeed: GOLDEN.serverSeed.toUpperCase() })).toEqual(GOLDEN.deck);
  });

  it('always a permutation of the 52 cards; deterministic; pure JS equals node:crypto', () => {
    fc.assert(
      fc.property(
        hex(32),
        id,
        id,
        fc.nat(100_000),
        hex(32),
        (serverSeed, tournamentId, tableId, handNumber, publicEntropy) => {
          const p = { serverSeed, tournamentId, tableId, handNumber, publicEntropy };
          const deck = deriveDeck(p);
          expect(isFullDeck(deck)).toBe(true);
          expect(deriveDeck(p)).toEqual(deck);
          expect(deriveDeck(p, nodeHmacSha256)).toEqual(deck);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('every label input and the seed change the deck', () => {
    const base = deriveDeck(goldenParams);
    expect(deriveDeck({ ...goldenParams, handNumber: GOLDEN.handNumber + 1 })).not.toEqual(base);
    expect(deriveDeck({ ...goldenParams, tableId: 'trn_golden:T2' })).not.toEqual(base);
    expect(deriveDeck({ ...goldenParams, tournamentId: 'trn_other' })).not.toEqual(base);
    expect(deriveDeck({ ...goldenParams, publicEntropy: GOLDEN.emptyEntropy })).not.toEqual(base);
    expect(deriveDeck({ ...goldenParams, serverSeed: `${GOLDEN.serverSeed.slice(0, 63)}b` })).not.toEqual(base);
  });

  it('rejects invalid seeds', () => {
    for (const serverSeed of ['', GOLDEN.serverSeed.slice(2), `${GOLDEN.serverSeed}00`, 'zz'.repeat(32)]) {
      expect(() => deriveDeck({ ...goldenParams, serverSeed })).toThrow(RangeError);
    }
  });
});

describe('createDeckProvider (TableContext.deckFor)', () => {
  it('returns deriveDeck for each hand number of one table', () => {
    const deckFor = createDeckProvider({
      serverSeed: GOLDEN.serverSeed,
      tournamentId: GOLDEN.tournamentId,
      tableId: GOLDEN.tableId,
      publicEntropy: GOLDEN.publicEntropy,
    });
    expect(deckFor(GOLDEN.handNumber)).toEqual(GOLDEN.deck);
    expect(deckFor(1)).toEqual(deriveDeck({ ...goldenParams, handNumber: 1 }));
    expect(() => deckFor(-1)).toThrow(RangeError);
  });

  it('validates the fixed inputs up front', () => {
    const fixed = {
      serverSeed: GOLDEN.serverSeed,
      tournamentId: GOLDEN.tournamentId,
      tableId: GOLDEN.tableId,
      publicEntropy: GOLDEN.publicEntropy,
    };
    expect(() => createDeckProvider({ ...fixed, serverSeed: 'ab' })).toThrow(RangeError);
    expect(() => createDeckProvider({ ...fixed, tableId: 'a|b' })).toThrow(RangeError);
    expect(() => createDeckProvider({ ...fixed, publicEntropy: 'x' })).toThrow(RangeError);
  });
});

describe('deckHash', () => {
  it('golden: SHA-256 of the 104-character concatenation', () => {
    expect(deckHash(GOLDEN.deck)).toBe(GOLDEN.deckHash);
    expect(createHash('sha256').update(GOLDEN.deck.join(''), 'ascii').digest('hex')).toBe(GOLDEN.deckHash);
    expect(deckHash(CANONICAL_DECK)).toBe(createHash('sha256').update(CANONICAL_DECK.join('')).digest('hex'));
  });

  it('only hashes full decks of 52 distinct cards', () => {
    expect(() => deckHash(GOLDEN.deck.slice(1))).toThrow(RangeError);
    expect(() => deckHash([...GOLDEN.deck.slice(1), GOLDEN.deck[1] as CardCode])).toThrow(RangeError);
    expect(() => deckHash([...GOLDEN.deck.slice(1), 'Xx' as CardCode])).toThrow(RangeError);
  });

  it('isCardCode / isFullDeck', () => {
    for (const c of CANONICAL_DECK) expect(isCardCode(c)).toBe(true);
    for (const c of ['10s', 'as', 'AS', 'A', '', 'Ah ', 1]) expect(isCardCode(c)).toBe(false);
    expect(isFullDeck(CANONICAL_DECK)).toBe(true);
    expect(isFullDeck('deck')).toBe(false);
    expect(isFullDeck([...CANONICAL_DECK, 'As'])).toBe(false);
  });
});

describe('drawSource', () => {
  it('golden seating stream (computed independently with node:crypto)', () => {
    const src = drawSource({
      serverSeed: GOLDEN.serverSeed,
      tournamentId: GOLDEN.tournamentId,
      purpose: 'seating',
      publicEntropy: GOLDEN.publicEntropy,
    });
    expect([src.nextUint32(), src.nextUint32(), src.nextUint32()]).toEqual(GOLDEN.seatingUint32);
    const fast = drawSource(
      {
        serverSeed: GOLDEN.serverSeed,
        tournamentId: GOLDEN.tournamentId,
        purpose: 'seating',
        publicEntropy: GOLDEN.publicEntropy,
      },
      nodeHmacSha256,
    );
    expect([fast.nextUint32(), fast.nextUint32(), fast.nextUint32()]).toEqual(GOLDEN.seatingUint32);
  });

  it('purposes are independent streams', () => {
    const first = (purpose: string): number[] => {
      const s = drawSource({
        serverSeed: GOLDEN.serverSeed,
        tournamentId: GOLDEN.tournamentId,
        purpose,
        publicEntropy: GOLDEN.publicEntropy,
      });
      return Array.from({ length: 4 }, () => s.nextUint32());
    };
    const seating = first('seating');
    expect(first('seating')).toEqual(seating);
    expect(first('final-table')).not.toEqual(seating);
    expect(first('button:trn_golden:T1')).not.toEqual(first('button:trn_golden:T2'));
  });

  it('rejects invalid seeds and reserved purposes', () => {
    expect(() =>
      drawSource({ serverSeed: 'ab', tournamentId: 't', purpose: 'seating', publicEntropy: GOLDEN.publicEntropy }),
    ).toThrow(RangeError);
    expect(() =>
      drawSource({
        serverSeed: GOLDEN.serverSeed,
        tournamentId: 't',
        purpose: 'deck',
        publicEntropy: GOLDEN.publicEntropy,
      }),
    ).toThrow(RangeError);
  });
});
