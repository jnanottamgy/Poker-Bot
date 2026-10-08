import { describe, expect, it } from 'vitest';
import type { BundleCheckId, FairnessCheckStatus, FairnessExport, HandFairnessRecord } from '@jpb/shared-types';
import {
  buildVerificationBundle,
  bundleShapeProblems,
  FAIRNESS_METHOD,
  MAX_LISTED_PROBLEMS,
  redactHandFairnessRecord,
  verifyBundle,
} from '../src';
import type { BuildBundleInput } from '../src';
import { GOLDEN, goldenRecord, honestRecord } from './fixtures';

const SPEC = {
  serverSeed: GOLDEN.serverSeed,
  serverSeedHash: GOLDEN.serverSeedHash,
  tournamentId: GOLDEN.tournamentId,
  publicEntropy: GOLDEN.publicEntropy,
};

/** Hands at two tables, deliberately supplied out of order. */
function hands(): HandFairnessRecord[] {
  const at = (
    tableId: string,
    handNumber: number,
    seats: number[],
    buttonSeat: number,
    boardSize: number,
  ): HandFairnessRecord => honestRecord({ ...SPEC, tableId, handNumber, maxSeats: 9, buttonSeat, seats, boardSize });
  return [
    at('trn_golden:T2', 2, [0, 4, 8], 4, 5),
    goldenRecord(),
    at('trn_golden:T1', 1, [0, 1, 2, 3, 4, 5, 6, 7, 8], 0, 0),
    at('trn_golden:T2', 1, [1, 2], 2, 3),
  ];
}

function input(overrides: Partial<BuildBundleInput> = {}): BuildBundleInput {
  return {
    tournamentId: GOLDEN.tournamentId,
    serverSeedHash: GOLDEN.serverSeedHash,
    serverSeed: GOLDEN.serverSeed,
    publicEntropy: GOLDEN.publicEntropy,
    entropyInputs: { clientSeeds: GOLDEN.clientSeeds.slice(), adminEntropy: GOLDEN.adminEntropy },
    hands: hands(),
    ...overrides,
  };
}

const roundTrip = (b: FairnessExport): unknown => JSON.parse(JSON.stringify(b));
const statusOf = (r: ReturnType<typeof verifyBundle>, id: BundleCheckId): FairnessCheckStatus =>
  r.checks.find((c) => c.check === id)!.status;

describe('buildVerificationBundle', () => {
  it('builds a sorted, self-describing export', () => {
    const b = buildVerificationBundle(input());
    expect(b.format).toBe('JPB-FAIRNESS-EXPORT');
    expect(b.formatVersion).toBe(1);
    expect(b.scheme).toBe('JPB/v1');
    expect(b.method).toEqual(FAIRNESS_METHOD);
    expect(b.hands.map((h) => [h.tableId, h.handNumber])).toEqual([
      ['trn_golden:T1', 1],
      ['trn_golden:T1', 7],
      ['trn_golden:T2', 1],
      ['trn_golden:T2', 2],
    ]);
  });

  it('deep-copies its inputs', () => {
    const inp = input();
    const b = buildVerificationBundle(inp);
    b.hands[1]!.board[0] = 'As';
    b.entropyInputs!.clientSeeds.push('zz');
    expect(inp.hands[1]!.board).toEqual(GOLDEN.board);
    expect(inp.entropyInputs!.clientSeeds).toHaveLength(3);
  });

  it('can be built before the reveal (serverSeed null) and without entropy inputs', () => {
    const b = buildVerificationBundle(input({ serverSeed: null, entropyInputs: null }));
    expect(b.serverSeed).toBeNull();
    expect(b.entropyInputs).toBeNull();
  });

  it('refuses inconsistent inputs (programmer errors)', () => {
    const wrongSeed = `${GOLDEN.serverSeed.slice(0, 63)}b`;
    const otherTournament = { ...goldenRecord(), tournamentId: 'trn_other' };
    const bad: Array<Partial<BuildBundleInput>> = [
      { serverSeed: wrongSeed },
      { serverSeed: 'abc' },
      { serverSeedHash: GOLDEN.serverSeedHash.toUpperCase() },
      { serverSeedHash: 'x' },
      { publicEntropy: GOLDEN.emptyEntropy, hands: [] },
      { entropyInputs: { clientSeeds: ['a1'.repeat(32)], adminEntropy: null } },
      { hands: [goldenRecord(), goldenRecord()] },
      { hands: [otherTournament] },
      { hands: [{ ...goldenRecord(), serverSeedHash: '00'.repeat(32) }] },
      { hands: [{ ...goldenRecord(), publicEntropy: GOLDEN.emptyEntropy }] },
      { hands: [{ ...goldenRecord(), board: 'x' } as unknown as HandFairnessRecord] },
    ];
    for (const patch of bad) expect(() => buildVerificationBundle(input(patch))).toThrow(RangeError);
  });
});

describe('verifyBundle', () => {
  it('a complete export after the reveal verifies end to end (through JSON)', () => {
    const res = verifyBundle(roundTrip(buildVerificationBundle(input())));
    expect(res.status).toBe('VERIFIED');
    expect(res.tournamentId).toBe(GOLDEN.tournamentId);
    expect(res.checks.map((c) => [c.check, c.status])).toEqual([
      ['FORMAT', 'VERIFIED'],
      ['SEED_COMMITMENT', 'VERIFIED'],
      ['PUBLIC_ENTROPY', 'VERIFIED'],
      ['HAND_CONSISTENCY', 'VERIFIED'],
    ]);
    expect(res.counts).toEqual({ hands: 4, verified: 4, failed: 0, incomplete: 0 });
  });

  it('before the reveal everything is INCOMPLETE; a seed supplied by the user is used instead', () => {
    const b = roundTrip(buildVerificationBundle(input({ serverSeed: null })));
    const before = verifyBundle(b);
    expect(before.status).toBe('INCOMPLETE');
    expect(statusOf(before, 'SEED_COMMITMENT')).toBe('NOT_AVAILABLE');
    expect(before.counts).toEqual({ hands: 4, verified: 0, failed: 0, incomplete: 4 });
    expect(verifyBundle(b, { serverSeed: GOLDEN.serverSeed }).status).toBe('VERIFIED');
    const wrong = verifyBundle(b, { serverSeed: '11'.repeat(32) });
    expect(wrong.status).toBe('FAILED');
    expect(statusOf(wrong, 'SEED_COMMITMENT')).toBe('FAILED');
    expect(wrong.counts.failed).toBe(4);
  });

  it('missing entropy inputs make the result INCOMPLETE (never VERIFIED)', () => {
    const res = verifyBundle(roundTrip(buildVerificationBundle(input({ entropyInputs: null }))));
    expect(res.status).toBe('INCOMPLETE');
    expect(statusOf(res, 'PUBLIC_ENTROPY')).toBe('NOT_AVAILABLE');
    expect(res.counts.verified).toBe(4);
  });

  it('redacted hole cards make hands INCOMPLETE, not FAILED', () => {
    const redacted = hands().map((h) => redactHandFairnessRecord(h, { revealSeats: 'NONE', includeBurns: false }));
    const res = verifyBundle(roundTrip(buildVerificationBundle(input({ hands: redacted }))));
    expect(res.status).toBe('INCOMPLETE');
    expect(res.counts).toEqual({ hands: 4, verified: 0, failed: 0, incomplete: 4 });
  });

  it('detects tampering at bundle level and per hand', () => {
    const good = roundTrip(buildVerificationBundle(input())) as FairnessExport;

    const entropy = structuredClone(good);
    entropy.entropyInputs!.clientSeeds[0] = 'ff'.repeat(32);
    expect(statusOf(verifyBundle(entropy), 'PUBLIC_ENTROPY')).toBe('FAILED');

    const badSeedInput = structuredClone(good);
    badSeedInput.entropyInputs!.clientSeeds[0] = 'has,comma';
    const r1 = verifyBundle(badSeedInput);
    expect(statusOf(r1, 'PUBLIC_ENTROPY')).toBe('FAILED');
    expect(r1.checks[2]!.problems[0]).toMatch(/client seed/);

    const commitment = structuredClone(good);
    commitment.serverSeedHash = '00'.repeat(32);
    const r2 = verifyBundle(commitment);
    expect(statusOf(r2, 'SEED_COMMITMENT')).toBe('FAILED');
    expect(statusOf(r2, 'HAND_CONSISTENCY')).toBe('FAILED');

    const card = structuredClone(good);
    card.hands[2]!.board[0] = card.hands[2]!.board[0] === 'As' ? 'Ks' : 'As';
    const r3 = verifyBundle(card);
    expect(r3.status).toBe('FAILED');
    expect(r3.counts).toEqual({ hands: 4, verified: 3, failed: 1, incomplete: 0 });
    expect(r3.hands[2]!.checks.find((c) => c.check === 'BOARD')!.status).toBe('FAILED');

    const dup = structuredClone(good);
    dup.hands.push(structuredClone(dup.hands[0]!));
    const r4 = verifyBundle(dup);
    expect(statusOf(r4, 'HAND_CONSISTENCY')).toBe('FAILED');
    expect(r4.checks[3]!.problems.some((p) => p.includes('duplicate'))).toBe(true);

    const foreign = structuredClone(good);
    foreign.hands[0]!.tournamentId = 'trn_other';
    expect(statusOf(verifyBundle(foreign), 'HAND_CONSISTENCY')).toBe('FAILED');
  });

  it('an empty export cannot be VERIFIED', () => {
    const res = verifyBundle(roundTrip(buildVerificationBundle(input({ hands: [] }))));
    expect(res.status).toBe('INCOMPLETE');
    expect(statusOf(res, 'HAND_CONSISTENCY')).toBe('NOT_AVAILABLE');
  });

  it('malformed input never throws and stops after FORMAT', () => {
    const good = roundTrip(buildVerificationBundle(input())) as Record<string, unknown>;
    const bad: unknown[] = [
      null,
      'json',
      42,
      [],
      { ...good, format: 'OTHER' },
      { ...good, formatVersion: 2 },
      { ...good, scheme: 'JPB/v2' },
      { ...good, hands: 'none' },
      { ...good, hands: [{}] },
      { ...good, serverSeed: 5 },
      { ...good, entropyInputs: { clientSeeds: 'x', adminEntropy: null } },
      { ...good, tournamentId: undefined },
    ];
    for (const value of bad) {
      const res = verifyBundle(value);
      expect(res.status).toBe('FAILED');
      expect(res.checks[0]!.status).toBe('FAILED');
      expect(res.checks.slice(1).every((c) => c.status === 'NOT_AVAILABLE')).toBe(true);
      expect(res.hands).toEqual([]);
      expect(bundleShapeProblems(value).length).toBeGreaterThan(0);
    }
  });

  it('caps the number of listed problems', () => {
    const good = roundTrip(buildVerificationBundle(input())) as FairnessExport;
    const many = { ...good, hands: Array.from({ length: MAX_LISTED_PROBLEMS + 10 }, () => ({})) };
    const res = verifyBundle(many);
    expect(res.checks[0]!.problems).toHaveLength(MAX_LISTED_PROBLEMS + 1);
    expect(res.checks[0]!.problems.at(-1)).toMatch(/^\.\.\. and \d+ more$/);
  });
});
