import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type {
  CardCode,
  FairnessCheckId,
  FairnessCheckStatus,
  HandFairnessRecord,
  HandVerificationResult,
} from '@jpb/shared-types';
import { verifyHand } from '../src';
import { honestSpec } from './arbitraries';
import { GOLDEN, goldenRecord, honestRecord, otherCard } from './fixtures';

type Statuses = Record<FairnessCheckId, FairnessCheckStatus>;
const statuses = (r: HandVerificationResult): Statuses =>
  Object.fromEntries(r.checks.map((c) => [c.check, c.status])) as Statuses;
const ALL_VERIFIED: Statuses = {
  SEED_COMMITMENT: 'VERIFIED',
  DECK_HASH: 'VERIFIED',
  HOLE_CARDS: 'VERIFIED',
  BOARD: 'VERIFIED',
};
const check = (r: HandVerificationResult, id: FairnessCheckId) => r.checks.find((c) => c.check === id)!;

/** Changes the last hex digit (always a real change). */
const flipLastHex = (h: string): string => `${h.slice(0, -1)}${h.endsWith('0') ? '1' : '0'}`;

function tampered(mutate: (r: HandFairnessRecord) => void): HandFairnessRecord {
  const r = goldenRecord();
  mutate(r);
  return r;
}

describe('verifyHand — honest records', () => {
  it('golden hand: every check VERIFIED, derived cards exposed', () => {
    const r = verifyHand(goldenRecord(), GOLDEN.serverSeed);
    expect(r.status).toBe('VERIFIED');
    expect(r.checks.map((c) => c.check)).toEqual(['SEED_COMMITMENT', 'DECK_HASH', 'HOLE_CARDS', 'BOARD']);
    expect(statuses(r)).toEqual(ALL_VERIFIED);
    expect(r.checks.every((c) => c.mismatches.length === 0)).toBe(true);
    expect(r).toMatchObject({
      tournamentId: GOLDEN.tournamentId,
      tableId: GOLDEN.tableId,
      handId: 'trn_golden:T1:7',
      handNumber: 7,
      withheldSeats: [],
    });
    expect(r.derived?.label).toBe(GOLDEN.label);
    expect(r.derived?.deck).toEqual(GOLDEN.deck);
    expect(r.derived?.deckHash).toBe(GOLDEN.deckHash);
    expect(r.derived?.deal?.board).toEqual(GOLDEN.board);
    expect(r.derived?.deal?.holeCards.map((h) => h.seat)).toEqual([5, 0, 2, 3]);
  });

  it('accepts uppercase hex for the seed and the published digests (same values)', () => {
    const rec = tampered((r) => {
      r.serverSeedHash = r.serverSeedHash.toUpperCase();
      r.deckHash = r.deckHash.toUpperCase();
    });
    expect(verifyHand(rec, GOLDEN.serverSeed.toUpperCase()).status).toBe('VERIFIED');
  });

  it('the listing order of seats does not matter (cards are matched by seat)', () => {
    const rec = tampered((r) => r.holeCards.reverse());
    expect(verifyHand(rec, GOLDEN.serverSeed).status).toBe('VERIFIED');
  });

  it('never mutates the record', () => {
    const rec = goldenRecord();
    const snapshot = JSON.parse(JSON.stringify(rec));
    verifyHand(rec, GOLDEN.serverSeed);
    expect(rec).toEqual(snapshot);
  });

  it('hands ending before the flop, on the flop and on the turn', () => {
    for (const [size, burns] of [
      [0, 0],
      [3, 1],
      [4, 2],
    ] as const) {
      const rec = tampered((r) => {
        r.board = r.board.slice(0, size);
        r.burns = r.burns!.slice(0, burns);
      });
      const res = verifyHand(rec, GOLDEN.serverSeed);
      expect(res.status).toBe('VERIFIED');
      expect(check(res, 'BOARD').detail).toMatch(
        size === 0 ? /No community cards were dealt/ : new RegExp(`All ${size} community`),
      );
    }
  });

  it('random honest hands (any table size, dead buttons, any street) always verify', () => {
    fc.assert(
      fc.property(honestSpec, (spec) => {
        const res = verifyHand(honestRecord(spec), spec.serverSeed);
        expect(statuses(res)).toEqual(ALL_VERIFIED);
      }),
      { numRuns: 200 },
    );
  });
});

describe('verifyHand — tampered records fail the right check', () => {
  const cases: Array<[string, (r: HandFairnessRecord) => void, Partial<Statuses>]> = [
    [
      'published commitment changed',
      (r) => (r.serverSeedHash = flipLastHex(r.serverSeedHash)),
      { SEED_COMMITMENT: 'FAILED', DECK_HASH: 'NOT_AVAILABLE', HOLE_CARDS: 'NOT_AVAILABLE', BOARD: 'NOT_AVAILABLE' },
    ],
    [
      'deck hash changed',
      (r) => (r.deckHash = flipLastHex(r.deckHash)),
      { SEED_COMMITMENT: 'VERIFIED', DECK_HASH: 'FAILED', HOLE_CARDS: 'VERIFIED', BOARD: 'VERIFIED' },
    ],
    [
      'one hole card replaced',
      (r) => (r.holeCards[1]!.cards![0] = otherCard(r.holeCards[1]!.cards![0])),
      { DECK_HASH: 'VERIFIED', HOLE_CARDS: 'FAILED', BOARD: 'VERIFIED' },
    ],
    [
      'hole cards swapped between seats',
      (r) => ([r.holeCards[0]!.cards, r.holeCards[1]!.cards] = [r.holeCards[1]!.cards, r.holeCards[0]!.cards]),
      { HOLE_CARDS: 'FAILED', BOARD: 'VERIFIED' },
    ],
    [
      "a seat's two hole cards in reversed order",
      (r) => r.holeCards[2]!.cards!.reverse(),
      { HOLE_CARDS: 'FAILED', BOARD: 'VERIFIED' },
    ],
    [
      'river replaced',
      (r) => (r.board[4] = otherCard(r.board[4]!)),
      { DECK_HASH: 'VERIFIED', HOLE_CARDS: 'VERIFIED', BOARD: 'FAILED' },
    ],
    [
      'flop reordered',
      (r) => (r.board = [r.board[1]!, r.board[0]!, ...r.board.slice(2)]),
      { HOLE_CARDS: 'VERIFIED', BOARD: 'FAILED' },
    ],
    ['burn card replaced', (r) => (r.burns![1] = otherCard(r.burns![1]!)), { HOLE_CARDS: 'VERIFIED', BOARD: 'FAILED' }],
    ['board of 2 cards', (r) => (r.board = r.board.slice(0, 2)), { BOARD: 'FAILED' }],
    ['burns inconsistent with the board', (r) => (r.burns = r.burns!.slice(0, 2)), { BOARD: 'FAILED' }],
    [
      'button moved (dealing order changes)',
      (r) => (r.buttonSeat = 0),
      { DECK_HASH: 'VERIFIED', HOLE_CARDS: 'FAILED', BOARD: 'VERIFIED' },
    ],
    [
      'a dealt-in seat dropped (positions shift)',
      (r) => r.holeCards.pop(),
      { DECK_HASH: 'VERIFIED', HOLE_CARDS: 'FAILED', BOARD: 'FAILED' },
    ],
    [
      'public entropy changed',
      (r) => (r.publicEntropy = GOLDEN.emptyEntropy),
      { SEED_COMMITMENT: 'VERIFIED', DECK_HASH: 'FAILED', HOLE_CARDS: 'FAILED', BOARD: 'FAILED' },
    ],
    ['hand number changed', (r) => (r.handNumber = 8), { DECK_HASH: 'FAILED', HOLE_CARDS: 'FAILED', BOARD: 'FAILED' }],
    [
      'table id changed',
      (r) => (r.tableId = 'trn_golden:T2'),
      { DECK_HASH: 'FAILED', HOLE_CARDS: 'FAILED', BOARD: 'FAILED' },
    ],
  ];

  for (const [name, mutate, expected] of cases) {
    it(name, () => {
      const res = verifyHand(tampered(mutate), GOLDEN.serverSeed);
      expect(res.status).toBe('FAILED');
      expect(statuses(res)).toMatchObject(expected);
    });
  }

  it('reports exactly what differs', () => {
    const res = verifyHand(
      tampered((r) => (r.holeCards[1]!.cards![1] = 'As')),
      GOLDEN.serverSeed,
    );
    expect(check(res, 'HOLE_CARDS').mismatches).toEqual([
      { item: 'seat 0 hole card 2', published: 'As', derived: 'Js' },
    ]);
    const board = verifyHand(
      tampered((r) => (r.board[3] = 'As')),
      GOLDEN.serverSeed,
    );
    expect(check(board, 'BOARD').mismatches).toEqual([{ item: 'turn', published: 'As', derived: '8s' }]);
    const hash = verifyHand(
      tampered((r) => (r.deckHash = '00'.repeat(32))),
      GOLDEN.serverSeed,
    );
    expect(check(hash, 'DECK_HASH').mismatches).toEqual([
      { item: 'deck hash', published: '00'.repeat(32), derived: GOLDEN.deckHash },
    ]);
  });

  it('any single published card changed in a random honest hand is caught by HOLE_CARDS or BOARD', () => {
    fc.assert(
      fc.property(honestSpec, fc.nat(), (spec, pick) => {
        const rec = honestRecord(spec);
        const slots: Array<{ check: FairnessCheckId; get: () => CardCode; set: (c: CardCode) => void }> = [];
        rec.holeCards.forEach((h) =>
          [0, 1].forEach((i) =>
            slots.push({ check: 'HOLE_CARDS', get: () => h.cards![i]!, set: (c) => (h.cards![i] = c) }),
          ),
        );
        rec.board.forEach((_, i) =>
          slots.push({ check: 'BOARD', get: () => rec.board[i]!, set: (c) => (rec.board[i] = c) }),
        );
        rec.burns!.forEach((_, i) =>
          slots.push({ check: 'BOARD', get: () => rec.burns![i]!, set: (c) => (rec.burns![i] = c) }),
        );
        const slot = slots[pick % slots.length]!;
        slot.set(otherCard(slot.get()));
        const res = verifyHand(rec, spec.serverSeed);
        expect(res.status).toBe('FAILED');
        expect(check(res, slot.check).status).toBe('FAILED');
        expect(check(res, 'DECK_HASH').status).toBe('VERIFIED');
        expect(res.checks.filter((c) => c.status === 'FAILED')).toHaveLength(1);
      }),
      { numRuns: 300 },
    );
  });
});

describe('verifyHand — seeds', () => {
  it('seed not revealed yet: everything NOT_AVAILABLE, overall INCOMPLETE', () => {
    const res = verifyHand(goldenRecord(), null);
    expect(res.status).toBe('INCOMPLETE');
    expect(res.checks.every((c) => c.status === 'NOT_AVAILABLE')).toBe(true);
    expect(res.derived).toBeNull();
  });

  it('wrong seed: commitment FAILED, nothing derived from it is reported', () => {
    const wrong = `${GOLDEN.serverSeed.slice(0, 63)}b`;
    const res = verifyHand(goldenRecord(), wrong);
    expect(statuses(res)).toEqual({
      SEED_COMMITMENT: 'FAILED',
      DECK_HASH: 'NOT_AVAILABLE',
      HOLE_CARDS: 'NOT_AVAILABLE',
      BOARD: 'NOT_AVAILABLE',
    });
    expect(res.derived).toBeNull();
    expect(check(res, 'SEED_COMMITMENT').mismatches[0]?.item).toBe('seed commitment');
  });

  it('malformed seeds are FAILED, never thrown', () => {
    for (const bad of ['', 'xyz', GOLDEN.serverSeed.slice(2), `${GOLDEN.serverSeed} `, 42 as unknown as string]) {
      const res = verifyHand(goldenRecord(), bad);
      expect(res.status).toBe('FAILED');
      expect(check(res, 'SEED_COMMITMENT').status).toBe('FAILED');
    }
  });
});

describe('verifyHand — withheld data', () => {
  it('a player verifying only their own hole cards', () => {
    const rec = tampered((r) => r.holeCards.forEach((h) => h.seat !== 2 && (h.cards = null)));
    const res = verifyHand(rec, GOLDEN.serverSeed);
    expect(res.status).toBe('VERIFIED');
    expect(res.withheldSeats).toEqual([5, 0, 3]);
    expect(check(res, 'HOLE_CARDS').detail).toMatch(/Hole cards of 1 seat\(s\) match.*3 seat\(s\) withheld/);
  });

  it('all hole cards withheld: HOLE_CARDS NOT_AVAILABLE, overall INCOMPLETE (never VERIFIED)', () => {
    const rec = tampered((r) => r.holeCards.forEach((h) => (h.cards = null)));
    const res = verifyHand(rec, GOLDEN.serverSeed);
    expect(res.status).toBe('INCOMPLETE');
    expect(statuses(res)).toEqual({ ...ALL_VERIFIED, HOLE_CARDS: 'NOT_AVAILABLE' });
  });

  it('burns withheld: board still verified, the detail says burns were not checked', () => {
    const res = verifyHand(
      tampered((r) => (r.burns = null)),
      GOLDEN.serverSeed,
    );
    expect(res.status).toBe('VERIFIED');
    expect(check(res, 'BOARD').detail).toMatch(/burn cards withheld and not checked/);
  });
});

describe('verifyHand — malformed or unsupported records never throw', () => {
  const malformed: unknown[] = [
    null,
    'record',
    [],
    {},
    { ...goldenRecord(), holeCards: 'none' },
    { ...goldenRecord(), holeCards: [{ seat: '1', playerId: 'p', cards: null }] },
    { ...goldenRecord(), holeCards: [{ seat: 1, playerId: 'p', cards: ['As'] }] },
    { ...goldenRecord(), board: [1, 2, 3] },
    { ...goldenRecord(), burns: 'x' },
    { ...goldenRecord(), handNumber: '7' },
  ];
  for (const value of malformed) {
    it(`structurally malformed: ${JSON.stringify(value)?.slice(0, 60)}`, () => {
      const res = verifyHand(value as HandFairnessRecord, GOLDEN.serverSeed);
      expect(res.status).toBe('FAILED');
      expect(res.checks.every((c) => c.status === 'FAILED' && c.detail.startsWith('The record is malformed'))).toBe(
        true,
      );
      expect(res.derived).toBeNull();
    });
  }

  it('unsupported scheme: NOT_AVAILABLE rather than a false verdict', () => {
    const res = verifyHand({ ...goldenRecord(), scheme: 'JPB/v2' as 'JPB/v1' }, GOLDEN.serverSeed);
    expect(res.status).toBe('INCOMPLETE');
    expect(res.checks.every((c) => c.status === 'NOT_AVAILABLE')).toBe(true);
  });

  it('label fields unusable: DECK_HASH FAILED, the rest NOT_AVAILABLE', () => {
    for (const patch of [
      { tableId: 'a|b' },
      { publicEntropy: GOLDEN.publicEntropy.toUpperCase() },
      { handNumber: -1 },
      { tournamentId: '' },
    ]) {
      const res = verifyHand({ ...goldenRecord(), ...patch }, GOLDEN.serverSeed);
      expect(statuses(res)).toEqual({
        SEED_COMMITMENT: 'VERIFIED',
        DECK_HASH: 'FAILED',
        HOLE_CARDS: 'NOT_AVAILABLE',
        BOARD: 'NOT_AVAILABLE',
      });
    }
  });

  it('invalid seat lists: HOLE_CARDS and BOARD FAILED with the reason', () => {
    const patches: Array<(r: HandFairnessRecord) => void> = [
      (r) => (r.holeCards[1]!.seat = r.holeCards[0]!.seat),
      (r) => (r.holeCards[1]!.seat = 6),
      (r) => (r.holeCards[1]!.seat = 1.5),
      (r) => (r.holeCards[1]!.playerId = r.holeCards[0]!.playerId),
      (r) => (r.holeCards[1]!.playerId = ''),
      (r) => (r.holeCards = r.holeCards.slice(0, 1)),
      (r) => (r.maxSeats = 11),
      (r) => (r.maxSeats = 3),
      (r) => (r.buttonSeat = 6),
      (r) => (r.buttonSeat = -1),
    ];
    for (const patch of patches) {
      const res = verifyHand(tampered(patch), GOLDEN.serverSeed);
      expect(statuses(res)).toMatchObject({
        SEED_COMMITMENT: 'VERIFIED',
        DECK_HASH: 'VERIFIED',
        HOLE_CARDS: 'FAILED',
        BOARD: 'FAILED',
      });
      expect(check(res, 'HOLE_CARDS').detail).toMatch(/seat list is invalid/);
      expect(res.derived?.deal).toBeNull();
      expect(res.derived?.deck).toEqual(GOLDEN.deck);
    }
  });

  it('invalid card codes are reported as mismatches', () => {
    const res = verifyHand(
      tampered((r) => (r.board[0] = 'Zz' as CardCode)),
      GOLDEN.serverSeed,
    );
    expect(check(res, 'BOARD').mismatches).toEqual([{ item: 'flop card 1', published: 'Zz', derived: '3s' }]);
  });

  it('malformed published digests are FAILED', () => {
    expect(
      check(
        verifyHand(
          tampered((r) => (r.serverSeedHash = 'nope')),
          GOLDEN.serverSeed,
        ),
        'SEED_COMMITMENT',
      ).status,
    ).toBe('FAILED');
    expect(
      check(
        verifyHand(
          tampered((r) => (r.deckHash = 'nope')),
          GOLDEN.serverSeed,
        ),
        'DECK_HASH',
      ).status,
    ).toBe('FAILED');
  });
});
