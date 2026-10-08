import { describe, expect, it } from 'vitest';
import { movementScore, rankPlayersToMove, selectPlayerToMove, selectTableToBreak } from '../src';
import { DEFAULT_BALANCING, makeTable, tableOf } from './fixtures';

const nine = (extra: Parameters<typeof tableOf>[2] = {}) => tableOf(1, 9, extra);

describe('selectPlayerToMove', () => {
  it('moves the player due the big blind next (TDA)', () => {
    // seats 0..8, last BB 0 -> next BB is seat 1
    const pick = selectPlayerToMove(nine(), DEFAULT_BALANCING);
    expect(pick).toMatchObject({ playerId: 'T1-s1', seat: 1, score: 0 });
    expect(pick.breakdown).toMatchObject({ handsUntilBigBlind: 0, positionTerm: 0, movesWithinWindow: 0, recencyTerm: 0, protected: 0 });
  });

  it('recent-move protection: a recently moved player is skipped while another candidate exists', () => {
    const t = makeTable({
      number: 1,
      seats: [0, { seat: 1, stats: { handsPlayedTotal: 50 }, recentMovesAtHand: [48] }, 2, 3, 4, 5, 6, 7, 8],
      lastBB: 0,
      lastSB: 8,
    });
    expect(selectPlayerToMove(t, DEFAULT_BALANCING).seat).toBe(2);
    const ranked = rankPlayersToMove(t, DEFAULT_BALANCING);
    expect(ranked[ranked.length - 1]?.seat).toBe(1);
    const protectedOne = ranked.find((r) => r.seat === 1);
    // window 10, 2 hands since the move: 1 move in window + (10 - 2) / 10 recency
    expect(protectedOne?.breakdown).toMatchObject({ movesWithinWindow: 1, handsSinceLastMove: 2, recencyFraction: 0.8, protected: 1 });
    expect(protectedOne?.score).toBe(0 + 10 * 1 + 10 * 0.8);
  });

  it('protection is absolute even when the recent-move weight is tiny', () => {
    const cfg = { ...DEFAULT_BALANCING, weights: { ...DEFAULT_BALANCING.weights, recentMove: 0 } };
    const t = makeTable({
      number: 1,
      seats: [0, { seat: 1, stats: { handsPlayedTotal: 50 }, recentMovesAtHand: [45] }, 2],
      lastBB: 0,
      lastSB: 2,
    });
    expect(selectPlayerToMove(t, cfg).seat).toBe(2);
  });

  it('moves outside the window give no protection', () => {
    const t = makeTable({
      number: 1,
      seats: [0, { seat: 1, stats: { handsPlayedTotal: 50 }, recentMovesAtHand: [30, 40] }, 2],
      lastBB: 0,
      lastSB: 2,
    });
    const pick = selectPlayerToMove(t, DEFAULT_BALANCING);
    expect(pick.seat).toBe(1);
    expect(pick.breakdown).toMatchObject({ movesWithinWindow: 0, handsSinceLastMove: 10, recencyFraction: 0 });
  });

  it('when everyone was moved recently, the lowest movement score moves', () => {
    const seats = [0, 1, 2].map((seat) => ({ seat, stats: { handsPlayedTotal: 20 }, recentMovesAtHand: [seat === 1 ? 19 : 15] }));
    const t = makeTable({ number: 1, seats, lastBB: 0, lastSB: 2 });
    // seat 1: hu 0 + 10 + 10*0.9 = 19 ; seat 2: hu 1 + 10 + 10*0.5 = 16 ; seat 0: hu 2 + 10 + 5 = 17
    expect(selectPlayerToMove(t, DEFAULT_BALANCING).seat).toBe(2);
  });

  it('ties go to the lowest seat, then playerId', () => {
    const cfg = { ...DEFAULT_BALANCING, weights: { ...DEFAULT_BALANCING.weights, position: 0 } };
    expect(selectPlayerToMove(nine(), cfg).seat).toBe(0);
  });

  it('in a hand, the player due the BB in the hand after the current one moves', () => {
    // current hand BB = seat 1, so seat 2 posts next
    expect(selectPlayerToMove(nine({ inHand: true }), DEFAULT_BALANCING).seat).toBe(2);
  });

  it('skips players already moving out and excluded players; throws when nobody can move', () => {
    const t = makeTable({ number: 1, seats: [0, { seat: 1, movingOut: true }, 2, 3], lastBB: 0, lastSB: 3 });
    expect(selectPlayerToMove(t, DEFAULT_BALANCING).seat).toBe(2);
    expect(selectPlayerToMove(t, DEFAULT_BALANCING, new Set(['T1-s2'])).seat).toBe(3);
    expect(() => selectPlayerToMove(makeTable({ number: 1, seats: [{ seat: 0, movingOut: true }] }), DEFAULT_BALANCING)).toThrow(/no movable/);
  });

  it('movementScore formula', () => {
    const player = { seat: 4, playerId: 'p', stack: 1, stats: { handsDealtAtTable: 0, handsSinceBigBlind: 0, handsSinceSmallBlind: 0, handsPlayedTotal: 100 }, recentMovesAtHand: [90, 97] };
    const cfg = { ...DEFAULT_BALANCING, recentMoveWindowHands: 12, weights: { position: 2, blindFairness: 0, recentMove: 3, seatCompatibility: 0 } };
    const m = movementScore(player, 5, cfg);
    // 2*5 + 3*2 + 3*(12-3)/12
    expect(m.score).toBe(10 + 6 + 3 * 0.75);
    expect(m.protectedTier).toBe(1);
    const zeroWindow = movementScore(player, 5, { ...cfg, recentMoveWindowHands: 0 });
    expect(zeroWindow.score).toBe(10);
    expect(zeroWindow.protectedTier).toBe(0);
  });
});

describe('selectTableToBreak', () => {
  it('fewest players, ties → highest table number', () => {
    expect(selectTableToBreak([tableOf(1, 6), tableOf(2, 5), tableOf(3, 7), tableOf(4, 5)])).toBe('T4');
  });

  it('counts effective players and skips tables with players in transit to them', () => {
    const tables = [
      tableOf(1, 6),
      makeTable({ number: 2, seats: [0, 1, 2], reserved: [5] }), // 4, but has an inbound reservation
      makeTable({ number: 3, seats: [0, 1, 2, 3, { seat: 4, movingOut: true }, { seat: 5, movingOut: true }] }), // 4 effective
      makeTable({ number: 4, seats: [0], status: 'BREAKING' }),
      makeTable({ number: 5, seats: [], status: 'CLOSED' }),
    ];
    expect(selectTableToBreak(tables)).toBe('T3');
  });

  it('returns null when no table qualifies', () => {
    expect(selectTableToBreak([])).toBeNull();
    expect(selectTableToBreak([makeTable({ number: 1, seats: [0], reserved: [1] })])).toBeNull();
  });
});
