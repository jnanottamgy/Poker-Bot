import type { SeatIndex } from '@jpb/shared-types';

/**
 * DEAD-BUTTON BLIND POSITIONS (CONTRACTS §4, TDA). Mirrored literally by
 * @jpb/seating-engine `positionsForNextHand`, which predicts this engine's
 * big-blind order for balancing; the two must never disagree.
 *
 * Clockwise = ascending seat index wrapping at maxSeats. "After s" means
 * strictly after s, wrapping (so s itself is reached last).
 * Participants = seats whose players will be dealt in (sorted ascending).
 *
 * Previous hand known (lastBigBlindSeat !== null):
 *   BB          = first participant after lastBigBlindSeat
 *   SB position = lastBigBlindSeat (posted iff a participant sits there; else dead SB)
 *   button      = lastSmallBlindSeat (may be empty: dead button);
 *                 fallback buttonSeat, else the participant before the SB position
 *   heads-up (exactly 2 participants): BB as above; the other participant is
 *   the button and posts the small blind.
 *
 * First hand (lastBigBlindSeat === null):
 *   button = buttonSeat (initial button) ?? lowest participant
 *   SB = first participant after the button, BB = first participant after SB
 *   heads-up: SB = button = the button seat if a participant sits there,
 *   otherwise the first participant after it; BB = the other participant.
 *
 * Consequence: the BB moves to a different player every hand (the previous BB
 * seat is reached last), so nobody posts the big blind twice in a row while
 * two or more players are dealt in.
 */
export interface BlindState {
  maxSeats: number;
  buttonSeat: SeatIndex | null;
  lastSmallBlindSeat: SeatIndex | null;
  lastBigBlindSeat: SeatIndex | null;
}

export interface HandPositions {
  buttonSeat: SeatIndex;
  /** Small-blind POSITION (may be an empty seat: dead small blind). Heads-up: the button. */
  smallBlindPosition: SeatIndex;
  smallBlindPosted: boolean;
  bigBlindSeat: SeatIndex;
  headsUp: boolean;
  firstHand: boolean;
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
 * unique). Null when fewer than two participants.
 */
export function computePositions(state: BlindState, participants: readonly SeatIndex[]): HandPositions | null {
  if (participants.length < 2) return null;
  const headsUp = participants.length === 2;
  const lastBB = state.lastBigBlindSeat;
  if (lastBB === null) {
    const button = state.buttonSeat ?? (participants[0] as SeatIndex);
    if (headsUp) {
      const sb = participants.includes(button) ? button : participantAfter(button, participants);
      return {
        buttonSeat: sb,
        smallBlindPosition: sb,
        smallBlindPosted: true,
        bigBlindSeat: participantAfter(sb, participants),
        headsUp,
        firstHand: true,
      };
    }
    const sb = participantAfter(button, participants);
    return {
      buttonSeat: button,
      smallBlindPosition: sb,
      smallBlindPosted: true,
      bigBlindSeat: participantAfter(sb, participants),
      headsUp,
      firstHand: true,
    };
  }
  const bb = participantAfter(lastBB, participants);
  if (headsUp) {
    const other = participants[0] === bb ? (participants[1] as SeatIndex) : (participants[0] as SeatIndex);
    return { buttonSeat: other, smallBlindPosition: other, smallBlindPosted: true, bigBlindSeat: bb, headsUp, firstHand: false };
  }
  const button = state.lastSmallBlindSeat ?? state.buttonSeat ?? participantBefore(lastBB, participants);
  return {
    buttonSeat: button,
    smallBlindPosition: lastBB,
    smallBlindPosted: participants.includes(lastBB),
    bigBlindSeat: bb,
    headsUp,
    firstHand: false,
  };
}
