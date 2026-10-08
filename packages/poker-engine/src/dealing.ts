import type { CardCode, SeatIndex } from '@jpb/shared-types';
import { clockwiseFrom } from './seats';

/**
 * DEALING ORDER (normative; shared with the fairness verifier).
 *
 * deck[0] is the top card. With N dealt-in seats ordered clockwise starting
 * with the first seat after the button seat (the button seat itself may be
 * empty; if occupied it is dealt last in each round):
 *
 *   hole card 1 of the k-th seat  = deck[k]          (k = 0..N-1)
 *   hole card 2 of the k-th seat  = deck[N + k]
 *   burn 1 = deck[2N],   flop  = deck[2N+1 .. 2N+3]
 *   burn 2 = deck[2N+4], turn  = deck[2N+5]
 *   burn 3 = deck[2N+6], river = deck[2N+7]
 *
 * Cards are always consumed in this order; a hand that ends early simply
 * leaves the later positions undealt.
 */
export interface DealPlan {
  /** Seats in dealing order. */
  seatOrder: SeatIndex[];
  holeCards: Array<{ seat: SeatIndex; deckIndices: [number, number] }>;
  burns: [number, number, number];
  flop: [number, number, number];
  turn: number;
  river: number;
}

/** Cards a full deal uses (2 per seat + 3 burns + 5 board cards). */
export function cardsNeeded(seatCount: number): number {
  return 2 * seatCount + 8;
}

/** Dealt-in seats in dealing order: clockwise from the first seat after the button. */
export function dealingSeatOrder(seats: readonly SeatIndex[], buttonSeat: SeatIndex, maxSeats: number): SeatIndex[] {
  return clockwiseFrom(seats, buttonSeat, maxSeats);
}

/** Deck positions of every card of a hand (see DEALING ORDER). */
export function dealPlan(seats: readonly SeatIndex[], buttonSeat: SeatIndex, maxSeats: number): DealPlan {
  const seatOrder = dealingSeatOrder(seats, buttonSeat, maxSeats);
  const n = seatOrder.length;
  const b = 2 * n;
  return {
    seatOrder,
    holeCards: seatOrder.map((seat, k) => ({ seat, deckIndices: [k, n + k] })),
    burns: [b, b + 4, b + 6],
    flop: [b + 1, b + 2, b + 3],
    turn: b + 5,
    river: b + 7,
  };
}

/** Every card a full deal would produce from `deck` (pure; used by fairness verification). */
export function dealFromDeck(
  deck: readonly CardCode[],
  seats: readonly SeatIndex[],
  buttonSeat: SeatIndex,
  maxSeats: number,
): { holeCards: Array<{ seat: SeatIndex; cards: [CardCode, CardCode] }>; burns: CardCode[]; board: CardCode[] } {
  if (deck.length < cardsNeeded(seats.length)) {
    throw new RangeError(`Deck of ${deck.length} cards cannot deal ${seats.length} seats`);
  }
  const plan = dealPlan(seats, buttonSeat, maxSeats);
  const at = (i: number): CardCode => deck[i] as CardCode;
  return {
    holeCards: plan.holeCards.map(({ seat, deckIndices }) => ({
      seat,
      cards: [at(deckIndices[0]), at(deckIndices[1])],
    })),
    burns: plan.burns.map(at),
    board: [...plan.flop, plan.turn, plan.river].map(at),
  };
}
