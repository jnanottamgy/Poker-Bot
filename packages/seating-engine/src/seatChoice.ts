import type { PlayerId, SeatIndex, SeatPositionStats, TableSummary } from '@jpb/shared-types';
import { bigBlindOrderFor, isStrictlyBetween, planningBlindState, positionsForNextHand } from './blindOrder';
import type { BlindState } from './blindOrder';
import { assertWeights } from './config';
import type { SeatingWeights } from './config';
import { freeSeats, nextHandParticipants } from './tableView';

export interface IncomingPlayer {
  playerId: PlayerId;
  stats: SeatPositionStats;
}

export interface SeatChoice {
  seat: SeatIndex;
  score: number;
  /** Every raw term and weighted contribution (stored with the movement for audit). */
  breakdown: Record<string, number>;
}

/**
 * Hands the player "should" wait before their next big blind so that their
 * blind frequency stays one BB per orbit:
 *
 *   expectedHandsUntilBB = max(0, orbitLength - 1 - handsSinceBigBlind)
 *
 * where orbitLength = participants at the destination including the incoming
 * player. Steady-state identity at a table of n: handsSinceBB + handsUntilBB + 1 = n.
 */
export function expectedHandsUntilBigBlind(handsSinceBigBlind: number, orbitLength: number): number {
  return Math.max(0, orbitLength - 1 - handsSinceBigBlind);
}

/**
 * 1 when `seat` would be dealt in strictly between the next hand's button and
 * small-blind position (it would play before ever posting a blind: TDA "dealt
 * in anywhere except between the SB and the button"), else 0. Always 0 before
 * the table's first hand (positions are then computed from the players
 * present) and when the next hand would be heads-up.
 */
export function skipPenalty(state: BlindState, participantsWithSeat: readonly SeatIndex[], seat: SeatIndex): number {
  if (state.lastBigBlindSeat === null || participantsWithSeat.length < 3) return 0;
  const pos = positionsForNextHand(state, participantsWithSeat);
  if (pos === null || pos.buttonSeat === pos.smallBlindSeat) return 0;
  return isStrictlyBetween(seat, pos.buttonSeat, pos.smallBlindSeat, state.maxSeats) ? 1 : 0;
}

/**
 * Fraction of the seat's distinct neighbours (seat-1, seat+1 mod maxSeats)
 * that will be occupied at the next hand: 0 (both empty), 0.5, or 1 (both
 * occupied). Prefers seats with an empty neighbour so players stay spread.
 */
export function adjacencyPenalty(participantsWithoutSeat: readonly SeatIndex[], seat: SeatIndex, maxSeats: number): number {
  const neighbours = new Set<SeatIndex>([(seat - 1 + maxSeats) % maxSeats, (seat + 1) % maxSeats]);
  neighbours.delete(seat);
  if (neighbours.size === 0) return 0;
  let occupied = 0;
  for (const n of neighbours) if (participantsWithoutSeat.includes(n)) occupied += 1;
  return occupied / neighbours.size;
}

function insertSorted(seats: readonly SeatIndex[], seat: SeatIndex): SeatIndex[] {
  const out = seats.slice();
  let i = out.length;
  while (i > 0 && (out[i - 1] as SeatIndex) > seat) i -= 1;
  out.splice(i, 0, seat);
  return out;
}

/**
 * Score every free seat for an incoming player (lower is better), sorted best
 * first (score ascending, then seat ascending):
 *
 *   seatScore(seat) = W.blindFairness     * |handsUntilBB(table + seat) - expectedHandsUntilBB|
 *                   + W.position          * skipPenalty(seat)
 *                   + W.seatCompatibility * adjacencyPenalty(seat)
 */
export function scoreSeatsForIncoming(table: TableSummary, player: IncomingPlayer, weights: SeatingWeights): SeatChoice[] {
  assertWeights(weights);
  const state = planningBlindState(table);
  const participants = nextHandParticipants(table);
  const orbitLength = participants.length + 1;
  const expected = expectedHandsUntilBigBlind(player.stats.handsSinceBigBlind, orbitLength);
  const choices: SeatChoice[] = [];
  for (const seat of freeSeats(table)) {
    const withSeat = insertSorted(participants, seat);
    const handsUntil = bigBlindOrderFor(state, withSeat).indexOf(seat);
    const deviation = Math.abs(handsUntil - expected);
    const skip = skipPenalty(state, withSeat, seat);
    const adjacency = adjacencyPenalty(participants, seat, table.maxSeats);
    const blindFairnessTerm = weights.blindFairness * deviation;
    const positionTerm = weights.position * skip;
    const seatCompatibilityTerm = weights.seatCompatibility * adjacency;
    const score = blindFairnessTerm + positionTerm + seatCompatibilityTerm;
    choices.push({
      seat,
      score,
      breakdown: {
        seat,
        orbitLength,
        handsUntilBigBlind: handsUntil,
        expectedHandsUntilBigBlind: expected,
        blindFairnessDeviation: deviation,
        skipPenalty: skip,
        adjacencyPenalty: adjacency,
        blindFairnessTerm,
        positionTerm,
        seatCompatibilityTerm,
        score,
      },
    });
  }
  return choices.sort((a, b) => a.score - b.score || a.seat - b.seat);
}

/**
 * Best seat for a player joining `table` (see scoreSeatsForIncoming); ties go
 * to the lowest seat index. Throws when the table has no free seat — callers
 * must check capacity first (a full destination is a planner bug).
 */
export function chooseSeatForIncoming(table: TableSummary, player: IncomingPlayer, weights: SeatingWeights): SeatChoice {
  const best = scoreSeatsForIncoming(table, player, weights)[0];
  if (best === undefined) throw new Error(`table ${table.tableId} has no free seat for ${player.playerId}`);
  return best;
}
