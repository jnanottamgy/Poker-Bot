import type { SeatIndex } from '@jpb/shared-types';

/**
 * Evenly spaced seats for `playerCount` players at a table with `maxSeats`
 * seats: seat_i = floor(i * maxSeats / playerCount), i = 0..playerCount-1.
 * Strictly ascending (spacing >= 1 because playerCount <= maxSeats), exact
 * integer arithmetic, no randomness. Gaps between consecutive players differ
 * by at most one seat (including the wrap-around gap).
 */
export function spreadSeats(playerCount: number, maxSeats: number): SeatIndex[] {
  if (!Number.isSafeInteger(maxSeats) || maxSeats < 1) throw new RangeError(`maxSeats must be a positive integer, got ${maxSeats}`);
  if (!Number.isSafeInteger(playerCount) || playerCount < 0 || playerCount > maxSeats) {
    throw new RangeError(`playerCount must be an integer in [0, ${maxSeats}], got ${playerCount}`);
  }
  const seats = new Array<SeatIndex>(playerCount);
  for (let i = 0; i < playerCount; i += 1) seats[i] = Math.floor((i * maxSeats) / playerCount);
  return seats;
}
