import type { RandomSource } from '@jpb/randomness';
import { compareIds, drawButtonSeat, shuffled, spreadSeats } from '@jpb/seating-engine';
import type { Chips, PlayerId, SeatIndex } from '@jpb/shared-types';

export interface PlanFinalTableInput {
  players: ReadonlyArray<{ playerId: PlayerId; stack: Chips }>;
  maxSeats: number;
  /** Seat-draw stream, e.g. fairness drawSource('final-table'). */
  rng: RandomSource;
}

export interface FinalTablePlan {
  /** Ascending by seat. */
  seats: Array<{ playerId: PlayerId; seat: SeatIndex }>;
  buttonSeat: SeatIndex;
}

/**
 * Final-table seat draw (stacks never influence it):
 *  1. ids sorted by UTF-16 code units; order = Fisher–Yates(ids, rng)   (n-1 draws)
 *  2. the i-th player of `order` takes spreadSeats(n, maxSeats)[i]
 *  3. buttonSeat = drawButtonSeat(occupied seats, rng)                    (1 draw)
 */
export function planFinalTable(input: PlanFinalTableInput): FinalTablePlan {
  const { players, maxSeats, rng } = input;
  if (players.length === 0) throw new RangeError('planFinalTable requires at least one player');
  if (!Number.isSafeInteger(maxSeats) || maxSeats < players.length) {
    throw new RangeError(`cannot seat ${players.length} players at a table of ${maxSeats} seats`);
  }
  for (const p of players) {
    if (!Number.isSafeInteger(p.stack) || p.stack < 1) throw new RangeError(`player ${p.playerId} has invalid stack ${p.stack}`);
  }
  const ids = players.map((p) => p.playerId).sort(compareIds);
  for (let i = 1; i < ids.length; i += 1) {
    if (ids[i] === ids[i - 1]) throw new RangeError(`duplicate playerId ${String(ids[i])}`);
  }
  const order = shuffled(ids, rng);
  const seatList = spreadSeats(order.length, maxSeats);
  const seats = order.map((playerId, i) => ({ playerId, seat: seatList[i] as SeatIndex }));
  return { seats, buttonSeat: drawButtonSeat(seatList, rng) };
}
