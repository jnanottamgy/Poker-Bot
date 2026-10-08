/**
 * DEALING ORDER (NORMATIVE — CONTRACTS §2; the poker engine deals exactly so).
 *
 * deck[0] is the top card. The N dealt-in seats are ordered clockwise
 * starting with the first seat after the button (the button seat may be
 * empty — dead button; if occupied, it is dealt last in each round):
 *
 *   hole card 1 of the k-th seat = deck[k]          k = 0..N-1
 *   hole card 2 of the k-th seat = deck[N + k]
 *   burn 1 = deck[2N],   flop  = deck[2N+1 .. 2N+3]
 *   burn 2 = deck[2N+4], turn  = deck[2N+5]
 *   burn 3 = deck[2N+6], river = deck[2N+7]
 *
 * Positions never shift: a hand that ends early leaves later positions undealt.
 */
import type { CardCode, DerivedDeal, SeatIndex } from '@jpb/shared-types';
import { COMMUNITY_DEAL_CARDS, HOLE_CARDS_PER_SEAT } from './constants';

/** Hole cards per seat (dealing order), the three burn positions and the five board positions. */
export type ExpectedDeal = DerivedDeal;

/** Cards a full deal uses: 2 per seat + 3 burns + 5 board cards. */
export function cardsNeeded(seatCount: number): number {
  return HOLE_CARDS_PER_SEAT * seatCount + COMMUNITY_DEAL_CARDS;
}

/** Clockwise steps from the seat after the button to `seat`: 0 for the first seat after the button, maxSeats-1 for the button. */
function stepsAfterButton(seat: SeatIndex, buttonSeat: SeatIndex, maxSeats: number): number {
  return (((seat - buttonSeat - 1) % maxSeats) + maxSeats) % maxSeats;
}

/**
 * Dealt-in seats in dealing order: clockwise (ascending index, wrapping at
 * maxSeats) starting with the first seat strictly after `buttonSeat`.
 * Throws on invalid input (seat out of range, duplicates, bad maxSeats).
 */
export function dealingOrder(seats: readonly SeatIndex[], buttonSeat: SeatIndex, maxSeats: number): SeatIndex[] {
  if (!Number.isSafeInteger(maxSeats) || maxSeats < 1) throw new RangeError('maxSeats must be a positive integer');
  const inRange = (s: number): boolean => Number.isSafeInteger(s) && s >= 0 && s < maxSeats;
  if (!inRange(buttonSeat)) throw new RangeError('buttonSeat must be a seat index in [0, maxSeats)');
  if (!seats.every(inRange)) throw new RangeError('every seat must be a seat index in [0, maxSeats)');
  if (new Set(seats).size !== seats.length) throw new RangeError('seats must be distinct');
  return seats
    .slice()
    .sort((a, b) => stepsAfterButton(a, buttonSeat, maxSeats) - stepsAfterButton(b, buttonSeat, maxSeats));
}

export interface DealPositions {
  /** Deck indices of [hole card 1, hole card 2] of the k-th seat in dealing order. */
  holeCards: Array<[number, number]>;
  burns: [number, number, number];
  board: [number, number, number, number, number];
}

/** Deck positions (0-based) of every card of a full deal for N dealt-in seats. */
export function dealPositions(seatCount: number): DealPositions {
  if (!Number.isSafeInteger(seatCount) || seatCount < 1) throw new RangeError('at least one dealt-in seat is required');
  const n = seatCount;
  // Community cards are taken one at a time from the top after both hole-card rounds.
  let next = HOLE_CARDS_PER_SEAT * n;
  const take = (): number => next++;
  const burn1 = take();
  const flop: [number, number, number] = [take(), take(), take()];
  const burn2 = take();
  const turn = take();
  const burn3 = take();
  const river = take();
  return {
    holeCards: Array.from({ length: n }, (_, k): [number, number] => [k, n + k]),
    burns: [burn1, burn2, burn3],
    board: [...flop, turn, river],
  };
}

/**
 * The cards each position of a full deal receives, given the deck and the
 * dealt-in seats ALREADY in dealing order (see `dealingOrder`).
 */
export function expectedDeal(deck: readonly CardCode[], seatsInDealingOrder: readonly SeatIndex[]): ExpectedDeal {
  const n = seatsInDealingOrder.length;
  if (new Set(seatsInDealingOrder).size !== n) throw new RangeError('seats must be distinct');
  if (deck.length < cardsNeeded(n)) throw new RangeError(`a deck of ${deck.length} cards cannot deal ${n} seats`);
  const pos = dealPositions(n);
  const at = (i: number): CardCode => deck[i] as CardCode;
  return {
    holeCards: seatsInDealingOrder.map((seat, k) => ({
      seat,
      cards: [at(pos.holeCards[k]![0]), at(pos.holeCards[k]![1])],
    })),
    burns: [at(pos.burns[0]), at(pos.burns[1]), at(pos.burns[2])],
    board: [at(pos.board[0]), at(pos.board[1]), at(pos.board[2]), at(pos.board[3]), at(pos.board[4])],
  };
}
