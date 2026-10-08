import type { CardCode, EvaluatedHand, SeatIndex, ShowdownReveal } from '@jpb/shared-types';
import { evaluateHand } from './evaluator';
import { clockwiseFrom } from './seats';
import type { HandPlayerState, Pot } from './types';

export interface ShowdownInput {
  /** Non-folded players (all have hole cards). */
  live: readonly HandPlayerState[];
  board: readonly CardCode[];
  pots: readonly Pot[];
  buttonSeat: SeatIndex;
  maxSeats: number;
  /** Last aggressor of the final betting round (river), or null if nobody bet. */
  finalAggressorSeat: SeatIndex | null;
  /** Betting closed before the river action completed (all-in): every live hand is revealed. */
  revealAll: boolean;
}

export interface ShowdownOutcome {
  /** Reveals in reveal order. */
  reveals: ShowdownReveal[];
  /** Every live player's hand (server-side; includes mucked hands). */
  evaluated: Array<{ seat: SeatIndex; hand: EvaluatedHand }>;
}

/**
 * Reveal order (rule 11):
 * - all-in showdown (`revealAll`): every live hand is shown, clockwise from
 *   the first live seat after the button;
 * - otherwise the last aggressor of the final betting round shows first (or,
 *   with no river bet, the first live seat after the button); then clockwise
 *   each player shows if they win at least one pot (contested or not: "players
 *   who win a pot are always revealed"), or if their hand wins or ties at least
 *   one CONTESTED pot (two or more eligible players) they are eligible for,
 *   compared with the hands already shown among that pot's eligible players;
 *   otherwise they muck (cards stay private).
 */
export function revealOrder(input: ShowdownInput): SeatIndex[] {
  const seats = input.live.map((p) => p.seat);
  const clockwise = clockwiseFrom(seats, input.buttonSeat, input.maxSeats);
  const first =
    !input.revealAll && input.finalAggressorSeat !== null && seats.includes(input.finalAggressorSeat)
      ? input.finalAggressorSeat
      : (clockwise[0] as SeatIndex);
  const start = clockwise.indexOf(first);
  return [...clockwise.slice(start), ...clockwise.slice(0, start)];
}

/**
 * Seats that win (or tie for) at least one pot: the best score among each
 * pot's eligible players. A pot with a single eligible player is won by that
 * player uncontested.
 */
function potWinnerSeats(pots: readonly Pot[], hands: ReadonlyMap<SeatIndex, EvaluatedHand>): Set<SeatIndex> {
  const winners = new Set<SeatIndex>();
  for (const pot of pots) {
    const score = (s: SeatIndex): number => {
      const hand = hands.get(s);
      if (hand === undefined) throw new Error(`Seat ${s} is eligible for a pot but has no live hand`);
      return hand.score;
    };
    const best = Math.max(...pot.eligibleSeats.map(score));
    for (const s of pot.eligibleSeats) if (score(s) === best) winners.add(s);
  }
  return winners;
}

export function resolveShowdown(input: ShowdownInput): ShowdownOutcome {
  const bySeat = new Map(input.live.map((p) => [p.seat, p]));
  const hands = new Map<SeatIndex, EvaluatedHand>();
  for (const p of input.live) {
    if (p.holeCards === null) throw new Error(`Seat ${p.seat} reached showdown without hole cards`);
    hands.set(p.seat, evaluateHand([...p.holeCards, ...input.board]));
  }
  const contested = input.pots.filter((pot) => pot.eligibleSeats.length >= 2);
  const winners = potWinnerSeats(input.pots, hands);
  const shown = new Set<SeatIndex>();
  const reveals: ShowdownReveal[] = [];

  for (const seat of revealOrder(input)) {
    const player = bySeat.get(seat) as HandPlayerState;
    const hand = hands.get(seat) as EvaluatedHand;
    const mustShow =
      input.revealAll ||
      shown.size === 0 ||
      winners.has(seat) ||
      contested.some((pot) => {
        if (!pot.eligibleSeats.includes(seat)) return false;
        const rivals = pot.eligibleSeats.filter((s) => shown.has(s));
        return rivals.every((s) => (hands.get(s) as EvaluatedHand).score <= hand.score);
      });
    if (mustShow) {
      shown.add(seat);
      reveals.push({ seat, playerId: player.playerId, cards: player.holeCards, mucked: false, hand });
    } else {
      reveals.push({ seat, playerId: player.playerId, cards: null, mucked: true, hand: null });
    }
  }

  // Programmer-bug guard: a pot winner must never be mucked.
  for (const s of winners) {
    if (!shown.has(s)) throw new Error(`Invariant: pot winner at seat ${s} was mucked`);
  }

  return {
    reveals,
    evaluated: [...hands.entries()].map(([seat, hand]) => ({ seat, hand })).sort((a, b) => a.seat - b.seat),
  };
}
