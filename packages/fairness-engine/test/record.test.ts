import { describe, expect, it } from 'vitest';
import { isHandFairnessRecord, recordShapeProblems, redactHandFairnessRecord, verifyHand } from '../src';
import { GOLDEN, goldenRecord } from './fixtures';

describe('recordShapeProblems', () => {
  it('accepts a well-formed record', () => {
    expect(recordShapeProblems(goldenRecord())).toEqual([]);
    expect(isHandFairnessRecord(goldenRecord())).toBe(true);
    expect(isHandFairnessRecord({ ...goldenRecord(), burns: null })).toBe(true);
  });

  it('lists every structural problem', () => {
    expect(recordShapeProblems(null)).toEqual(['record must be an object']);
    expect(recordShapeProblems([])).toEqual(['record must be an object']);
    const problems = recordShapeProblems({
      ...goldenRecord(),
      tableId: 3,
      maxSeats: '6',
      board: 'AsKs',
      holeCards: [{ seat: 1 }],
    });
    expect(problems).toEqual([
      'tableId must be a string',
      'maxSeats must be a number',
      'holeCards[0].playerId must be a string',
      'board must be an array of card codes',
    ]);
  });
});

describe('redactHandFairnessRecord', () => {
  it('withholds every hole card and the burns, keeping the seat list', () => {
    const rec = goldenRecord();
    const out = redactHandFairnessRecord(rec, { revealSeats: 'NONE', includeBurns: false });
    expect(out.holeCards.map((h) => [h.seat, h.playerId, h.cards])).toEqual([
      [5, 'ply_5', null],
      [0, 'ply_0', null],
      [2, 'ply_2', null],
      [3, 'ply_3', null],
    ]);
    expect(out.burns).toBeNull();
    expect(out.board).toEqual(GOLDEN.board);
    expect(rec).toEqual(goldenRecord());
    const res = verifyHand(out, GOLDEN.serverSeed);
    expect(res.status).toBe('INCOMPLETE');
  });

  it('keeps only the listed seats (e.g. the viewer and showdown reveals)', () => {
    const out = redactHandFairnessRecord(goldenRecord(), { revealSeats: [2, 3], includeBurns: true });
    expect(out.holeCards.filter((h) => h.cards !== null).map((h) => h.seat)).toEqual([2, 3]);
    expect(out.burns).toEqual(GOLDEN.burns);
    expect(verifyHand(out, GOLDEN.serverSeed).status).toBe('VERIFIED');
  });

  it('ALL keeps everything, as an independent deep copy', () => {
    const rec = goldenRecord();
    const out = redactHandFairnessRecord(rec, { revealSeats: 'ALL', includeBurns: true });
    expect(out).toEqual(rec);
    out.holeCards[0]!.cards![0] = 'As';
    out.board[0] = 'As';
    out.burns![0] = 'As';
    expect(rec).toEqual(goldenRecord());
  });
});
