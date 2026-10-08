import type { SeatIndex, SeatPositionStats, TableSummary } from '@jpb/shared-types';
import { nextHandParticipants, seatedSeats } from './tableView';

/**
 * Dead-button blind positions, mirroring the table engine (CONTRACTS §4).
 *
 * Clockwise = ascending seat index wrapping at maxSeats. "After s" always means
 * strictly after s, wrapping around (so s itself is reached last).
 *
 * Next hand, when a previous hand exists (lastBigBlindSeat !== null):
 *   BB     = first participant after lastBigBlindSeat
 *   SB     = position lastBigBlindSeat (posted only if a participant sits there; else dead SB)
 *   button = position lastSmallBlindSeat (may be empty = dead button)
 *   heads-up (exactly 2 participants): BB as above; the other participant is button and posts SB.
 *
 * First hand (lastBigBlindSeat === null):
 *   button = buttonSeat ?? lowest participant seat
 *   SB = first participant after button, BB = first participant after SB
 *   heads-up: SB = button = the button seat if a participant sits there, otherwise the
 *   first participant after it; BB = the other participant.
 */

/** The TableSummary fields that drive blind positions. */
export type BlindState = Pick<TableSummary, 'maxSeats' | 'buttonSeat' | 'lastSmallBlindSeat' | 'lastBigBlindSeat'>;

export interface HandPositions {
  buttonSeat: SeatIndex;
  /** Small-blind POSITION (may be an empty seat: dead small blind). */
  smallBlindSeat: SeatIndex;
  smallBlindPosted: boolean;
  bigBlindSeat: SeatIndex;
  headsUp: boolean;
  firstHand: boolean;
}

/** (to - from) mod maxSeats, in [0, maxSeats). */
export function clockwiseDistance(from: SeatIndex, to: SeatIndex, maxSeats: number): number {
  return (((to - from) % maxSeats) + maxSeats) % maxSeats;
}

/** True when `seat` lies strictly inside the clockwise arc from `from` to `to` (both exclusive). */
export function isStrictlyBetween(seat: SeatIndex, from: SeatIndex, to: SeatIndex, maxSeats: number): boolean {
  const d = clockwiseDistance(from, seat, maxSeats);
  return d > 0 && d < clockwiseDistance(from, to, maxSeats);
}

/** First participant strictly clockwise after `seat` (wrapping; `seat` itself if it is the only participant). */
export function participantAfter(seat: SeatIndex, participants: readonly SeatIndex[]): SeatIndex {
  if (participants.length === 0) throw new RangeError('no participants');
  for (const p of participants) if (p > seat) return p;
  return participants[0] as SeatIndex;
}

/** Last participant strictly counter-clockwise before `seat`. */
export function participantBefore(seat: SeatIndex, participants: readonly SeatIndex[]): SeatIndex {
  if (participants.length === 0) throw new RangeError('no participants');
  for (let i = participants.length - 1; i >= 0; i -= 1) {
    const p = participants[i] as SeatIndex;
    if (p < seat) return p;
  }
  return participants[participants.length - 1] as SeatIndex;
}

/**
 * Button / SB / BB for the next hand dealt to `participants` (sorted ascending,
 * unique). Null when fewer than two participants (no hand can be dealt).
 */
export function positionsForNextHand(state: BlindState, participants: readonly SeatIndex[]): HandPositions | null {
  if (participants.length < 2) return null;
  const headsUp = participants.length === 2;
  const lastBB = state.lastBigBlindSeat;
  if (lastBB === null) {
    const button = state.buttonSeat ?? (participants[0] as SeatIndex);
    if (headsUp) {
      const sb = participants.includes(button) ? button : participantAfter(button, participants);
      return { buttonSeat: sb, smallBlindSeat: sb, smallBlindPosted: true, bigBlindSeat: participantAfter(sb, participants), headsUp, firstHand: true };
    }
    const sb = participantAfter(button, participants);
    return { buttonSeat: button, smallBlindSeat: sb, smallBlindPosted: true, bigBlindSeat: participantAfter(sb, participants), headsUp, firstHand: true };
  }
  const bb = participantAfter(lastBB, participants);
  if (headsUp) {
    const other = participants[0] === bb ? (participants[1] as SeatIndex) : (participants[0] as SeatIndex);
    return { buttonSeat: other, smallBlindSeat: other, smallBlindPosted: true, bigBlindSeat: bb, headsUp, firstHand: false };
  }
  // Fallback when the last SB position is unknown: the last button, else the participant before the SB position.
  const button = state.lastSmallBlindSeat ?? state.buttonSeat ?? participantBefore(lastBB, participants);
  return {
    buttonSeat: button,
    smallBlindSeat: lastBB,
    smallBlindPosted: participants.includes(lastBB),
    bigBlindSeat: bb,
    headsUp,
    firstHand: false,
  };
}

/** Participants rotated so that `first` comes first (clockwise order). */
function rotateFrom(first: SeatIndex, participants: readonly SeatIndex[]): SeatIndex[] {
  const i = participants.indexOf(first);
  if (i < 0) throw new Error(`seat ${first} is not a participant`);
  return [...participants.slice(i), ...participants.slice(0, i)];
}

/**
 * Order in which `participants` will post the big blind, starting with the
 * next hand, assuming nobody joins or leaves: the BB advances to the next
 * participant clockwise every hand.
 */
export function bigBlindOrderFor(state: BlindState, participants: readonly SeatIndex[]): SeatIndex[] {
  if (participants.length === 0) return [];
  if (participants.length === 1) return [participants[0] as SeatIndex];
  const pos = positionsForNextHand(state, participants) as HandPositions;
  return rotateFrom(pos.bigBlindSeat, participants);
}

/**
 * Positions of the hand currently being played (null when the table is not in
 * a hand). The director's summary reflects the last COMPLETED hand, so the
 * in-progress hand is derived from it using everyone currently seated
 * (including players flagged movingOut, who finish the hand; reservations are
 * not dealt in).
 */
export function currentHandPositions(table: TableSummary): HandPositions | null {
  if (!table.inHand) return null;
  return positionsForNextHand(table, seatedSeats(table));
}

/**
 * Blind state that the NEXT hand to start will be derived from. Between hands
 * this is the summary itself; during a hand it is the in-progress hand's
 * positions (a newly seated player waits for the next hand, and a removal is
 * applied after the current hand, so all predictions skip the current hand).
 */
export function planningBlindState(table: TableSummary): BlindState {
  const current = currentHandPositions(table);
  if (current === null) return table;
  return {
    maxSeats: table.maxSeats,
    buttonSeat: current.buttonSeat,
    lastSmallBlindSeat: current.smallBlindSeat,
    lastBigBlindSeat: current.bigBlindSeat,
  };
}

/**
 * Seats in the order they will post the big blind, starting with the next hand
 * to be dealt (participants = staying players ∪ reserved seats).
 */
export function predictBigBlindOrder(table: TableSummary): SeatIndex[] {
  return bigBlindOrderFor(planningBlindState(table), nextHandParticipants(table));
}

function insertSorted(seats: readonly SeatIndex[], seat: SeatIndex): SeatIndex[] {
  if (seats.includes(seat)) return seats.slice();
  const out = seats.slice();
  let i = out.length;
  while (i > 0 && (out[i - 1] as SeatIndex) > seat) i -= 1;
  out.splice(i, 0, seat);
  return out;
}

/** Participants with `seat` added (no-op when it is already a participant). */
export function participantsWith(table: TableSummary, seat: SeatIndex): SeatIndex[] {
  return insertSorted(nextHandParticipants(table), seat);
}

export function assertSeat(table: TableSummary, seat: SeatIndex): void {
  if (!Number.isSafeInteger(seat) || seat < 0 || seat >= table.maxSeats) {
    throw new RangeError(`seat ${seat} out of range for table ${table.tableId} with ${table.maxSeats} seats`);
  }
}

/**
 * Hands that will be dealt before the player in `seat` posts the big blind
 * (0 = posts it in the next hand). Works for a participant seat and for a
 * hypothetical empty seat being filled (the seat is added to the participants
 * before predicting).
 */
export function handsUntilBigBlind(table: TableSummary, seat: SeatIndex): number {
  assertSeat(table, seat);
  const order = bigBlindOrderFor(planningBlindState(table), participantsWith(table, seat));
  return order.indexOf(seat);
}

/**
 * A player's position stats as they will be when they leave `table`. Between
 * hands they are unchanged. During a hand the player is assumed to complete it
 * (removals are applied after the hand): every counter advances by one, and
 * handsSinceBigBlind / handsSinceSmallBlind reset to 0 when the player is that
 * hand's big blind / posting small blind.
 */
export function statsAtDeparture(table: TableSummary, seat: SeatIndex, stats: SeatPositionStats): SeatPositionStats {
  const current = currentHandPositions(table);
  if (current === null) return stats;
  const postsSmallBlind = current.smallBlindPosted && current.smallBlindSeat === seat;
  return {
    ...stats,
    handsDealtAtTable: stats.handsDealtAtTable + 1,
    handsSinceBigBlind: current.bigBlindSeat === seat ? 0 : stats.handsSinceBigBlind + 1,
    handsSinceSmallBlind: postsSmallBlind ? 0 : stats.handsSinceSmallBlind + 1,
    handsPlayedTotal: stats.handsPlayedTotal + 1,
  };
}
