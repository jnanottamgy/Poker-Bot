import type { Chips, SeatIndex } from '@jpb/shared-types';
import { clockwiseFrom } from './seats';
import type { Pot } from './types';

export interface PotShare {
  seat: SeatIndex;
  amount: Chips;
  /** Odd chips included in `amount` (0 or 1). */
  oddChips: Chips;
}

export interface PotDistribution {
  potIndex: number;
  potType: 'MAIN' | 'SIDE';
  amount: Chips;
  eligibleSeats: SeatIndex[];
  /** Seats holding the best hand among the eligible players (one seat if uncontested). */
  winnerSeats: SeatIndex[];
  /** Shares in odd-chip order (clockwise from the first seat after the button). */
  shares: PotShare[];
}

export interface DistributePotsInput {
  pots: readonly Pot[];
  /** Hand strength (higher wins) of every player who may contest a pot with two or more eligible seats. */
  scores: ReadonlyArray<{ seat: SeatIndex; score: number }>;
  buttonSeat: SeatIndex;
  maxSeats: number;
}

/**
 * Splits `amount` equally among `winners` (rule 13). The remainder
 * (amount mod winners) is handed out one chip at a time to the winners in
 * clockwise order starting with the first seat after the button. The result
 * lists winners in that order. Deterministic; never random.
 */
export function splitPot(
  amount: Chips,
  winners: readonly SeatIndex[],
  buttonSeat: SeatIndex,
  maxSeats: number,
): PotShare[] {
  if (winners.length === 0) throw new RangeError('A pot needs at least one winner');
  const ordered = clockwiseFrom(winners, buttonSeat, maxSeats);
  const base = Math.floor(amount / ordered.length);
  const odd = amount - base * ordered.length;
  return ordered.map((seat, i) => {
    const oddChips = i < odd ? 1 : 0;
    return { seat, amount: base + oddChips, oddChips };
  });
}

/**
 * Awards every pot (rule 12): from the last side pot down to the main pot,
 * each pot goes to the best hand(s) among its eligible players; ties split
 * with `splitPot`. A pot with a single eligible player is won uncontested
 * without needing a score.
 */
export function distributePots(input: DistributePotsInput): PotDistribution[] {
  const scoreBySeat = new Map(input.scores.map((s) => [s.seat, s.score]));
  const out: PotDistribution[] = [];
  for (let i = input.pots.length - 1; i >= 0; i--) {
    const pot = input.pots[i] as Pot;
    let winnerSeats: SeatIndex[];
    if (pot.eligibleSeats.length === 1) {
      winnerSeats = [...pot.eligibleSeats];
    } else {
      let best = -Infinity;
      winnerSeats = [];
      for (const seat of pot.eligibleSeats) {
        const score = scoreBySeat.get(seat);
        if (score === undefined) throw new RangeError(`No score for eligible seat ${seat}`);
        if (score > best) {
          best = score;
          winnerSeats = [seat];
        } else if (score === best) {
          winnerSeats.push(seat);
        }
      }
    }
    out.push({
      potIndex: pot.index,
      potType: pot.type,
      amount: pot.amount,
      eligibleSeats: [...pot.eligibleSeats],
      winnerSeats: [...winnerSeats].sort((a, b) => a - b),
      shares: splitPot(pot.amount, winnerSeats, input.buttonSeat, input.maxSeats),
    });
  }
  return out;
}
