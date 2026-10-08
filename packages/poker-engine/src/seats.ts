import type { SeatIndex } from '@jpb/shared-types';

/**
 * Clockwise distance from `from` to `seat` (1..maxSeats; a seat is maxSeats
 * away from itself). Seat order is ascending index wrapping at maxSeats.
 */
export function clockwiseDistance(from: SeatIndex, seat: SeatIndex, maxSeats: number): number {
  const d = (((seat - from) % maxSeats) + maxSeats) % maxSeats;
  return d === 0 ? maxSeats : d;
}

/**
 * The given seats ordered clockwise starting with the first seat strictly
 * after `from` (`from` itself, if present, comes last). `from` may be empty.
 */
export function clockwiseFrom(seats: readonly SeatIndex[], from: SeatIndex, maxSeats: number): SeatIndex[] {
  return [...seats].sort((a, b) => clockwiseDistance(from, a, maxSeats) - clockwiseDistance(from, b, maxSeats));
}
