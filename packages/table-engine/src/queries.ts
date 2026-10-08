import type { HandPlayerState, HandState } from '@jpb/poker-engine';
import type { PlayerId, SeatIndex, SeatOccupant, TableTimingState } from '@jpb/shared-types';
import { MIN_PLAYERS_TO_DEAL } from './constants';
import { computePositions } from './positions';
import type { HandPositions } from './positions';
import type { TableState } from './types';

/** Read-only helpers over a TableState. */

export function handInProgress(s: Pick<TableState, 'hand'>): boolean {
  return s.hand !== null && s.hand.phase !== 'HAND_COMPLETE';
}

/** The hand player record of `playerId` in the given hand, if dealt in. */
export function handPlayer(hand: HandState | null, playerId: PlayerId): HandPlayerState | null {
  if (hand === null) return null;
  return hand.players.find((p) => p.playerId === playerId) ?? null;
}

/** True when `playerId` is dealt into the hand in progress. */
export function isDealtIn(s: TableState, playerId: PlayerId): boolean {
  return handInProgress(s) && handPlayer(s.hand, playerId) !== null;
}

/** Seats (ascending) whose players would be dealt into a hand starting now. */
export function eligibleSeats(s: TableState): SeatIndex[] {
  const out: SeatIndex[] = [];
  s.seats.forEach((occ, seat) => {
    if (occ !== null && occ.stack > 0 && occ.pendingRemoval === null) out.push(seat);
  });
  return out;
}

/** A player is away when disconnected or after `awayAfterTimeouts` consecutive timeouts (CONTRACTS §4). */
export function isAway(occ: SeatOccupant, timing: TableTimingState): boolean {
  return !occ.connected || occ.consecutiveTimeouts >= timing.awayAfterTimeouts;
}

/** Positions the next hand would use with the currently eligible players (null: fewer than two). */
export function nextHandPositions(s: TableState): HandPositions | null {
  return computePositions(
    {
      maxSeats: s.maxSeats,
      buttonSeat: s.buttonSeat,
      lastSmallBlindSeat: s.lastSmallBlindSeat,
      lastBigBlindSeat: s.lastBigBlindSeat,
    },
    eligibleSeats(s),
  );
}

/** Whether a new hand may be dealt right now. */
export function canDeal(s: TableState): boolean {
  return (
    s.status !== 'CLOSED' &&
    s.started &&
    s.frozen === null &&
    s.holds.length === 0 &&
    !handInProgress(s) &&
    eligibleSeats(s).length >= MIN_PLAYERS_TO_DEAL
  );
}

/** Sum of every seated player's stack (live stacks during a hand). */
export function chipsAtTable(s: TableState): number {
  let total = 0;
  const live = handInProgress(s) ? s.hand : null;
  s.seats.forEach((occ, seat) => {
    if (occ === null) return;
    const hp = live?.players.find((p) => p.seat === seat && p.playerId === occ.playerId);
    total += hp === undefined ? occ.stack : hp.stack;
  });
  return total + (live?.pot ?? 0);
}
