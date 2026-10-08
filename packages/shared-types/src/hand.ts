import type { CardCode, EvaluatedHand, HandCategory } from './cards';
import type { AnteType } from './config';
import type { Chips, HandId, PlayerId, SeatIndex } from './ids';

/**
 * HAND STATE MACHINE (normative). Legal transitions:
 *
 *   HAND_CREATED     -> DEAL_HOLE_CARDS
 *   DEAL_HOLE_CARDS  -> PREFLOP
 *   PREFLOP          -> FLOP | POT_DISTRIBUTION (everyone else folded)
 *   FLOP             -> TURN | POT_DISTRIBUTION
 *   TURN             -> RIVER | POT_DISTRIBUTION
 *   RIVER            -> SHOWDOWN | POT_DISTRIBUTION
 *   SHOWDOWN         -> POT_DISTRIBUTION
 *   POT_DISTRIBUTION -> HAND_COMPLETE
 *
 * When betting is closed early (all-in run-out), the hand still passes through
 * every street in order, dealing board cards without action, then SHOWDOWN.
 * No state may be skipped except the fold-win shortcut to POT_DISTRIBUTION.
 */
export type HandPhase =
  | 'HAND_CREATED'
  | 'DEAL_HOLE_CARDS'
  | 'PREFLOP'
  | 'FLOP'
  | 'TURN'
  | 'RIVER'
  | 'SHOWDOWN'
  | 'POT_DISTRIBUTION'
  | 'HAND_COMPLETE';

export const HAND_PHASE_TRANSITIONS: Readonly<Record<HandPhase, readonly HandPhase[]>> = {
  HAND_CREATED: ['DEAL_HOLE_CARDS'],
  DEAL_HOLE_CARDS: ['PREFLOP'],
  PREFLOP: ['FLOP', 'POT_DISTRIBUTION'],
  FLOP: ['TURN', 'POT_DISTRIBUTION'],
  TURN: ['RIVER', 'POT_DISTRIBUTION'],
  RIVER: ['SHOWDOWN', 'POT_DISTRIBUTION'],
  SHOWDOWN: ['POT_DISTRIBUTION'],
  POT_DISTRIBUTION: ['HAND_COMPLETE'],
  HAND_COMPLETE: [],
};

export type Street = 'PREFLOP' | 'FLOP' | 'TURN' | 'RIVER';

/** Actions a player may intend. Forced bets (blinds/antes) are posted by the engine, never by the client. */
export type ActionType = 'FOLD' | 'CHECK' | 'CALL' | 'BET' | 'RAISE' | 'ALL_IN';

/**
 * A player's intention. For BET and RAISE, `amount` is the TOTAL the player's
 * street contribution becomes ("bet to" / "raise to"), not the increment.
 * FOLD/CHECK/CALL/ALL_IN ignore `amount`.
 */
export interface PlayerActionIntent {
  type: ActionType;
  amount?: Chips;
}

/** Everything a client needs to render legal controls. Computed only by the server. */
export interface LegalActions {
  seat: SeatIndex;
  playerId: PlayerId;
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  /** Additional chips required to call (already capped at the player's stack). */
  callAmount: Chips;
  canBet: boolean;
  canRaise: boolean;
  /** Minimum legal "to" total for BET/RAISE (if betting/raising is legal). */
  minTo: Chips;
  /** Maximum legal "to" total for BET/RAISE (= all-in total in no-limit). */
  maxTo: Chips;
  canAllIn: boolean;
  /** Street contribution total if the player goes all-in. */
  allInTo: Chips;
  currentBet: Chips;
  contributedThisStreet: Chips;
  stack: Chips;
  pot: Chips;
}

export type ForcedBetType = 'SMALL_BLIND' | 'BIG_BLIND' | 'ANTE';

export interface HandSeatInput {
  seat: SeatIndex;
  playerId: PlayerId;
  stack: Chips;
}

/** Visibility of an event: everyone at the table, or only the player in `seat`. */
export type EventVisibility = 'PUBLIC' | 'PRIVATE';

export type HandEvent =
  | {
      kind: 'HAND_STARTED';
      handId: HandId;
      handNumber: number;
      buttonSeat: SeatIndex;
      smallBlindSeat: SeatIndex | null;
      bigBlindSeat: SeatIndex;
      smallBlind: Chips;
      bigBlind: Chips;
      ante: Chips;
      anteType: AnteType;
      players: HandSeatInput[];
    }
  | { kind: 'FORCED_BET_POSTED'; seat: SeatIndex; betType: ForcedBetType; amount: Chips; allIn: boolean; stack: Chips; pot: Chips }
  | { kind: 'HOLE_CARDS_DEALT'; seat: SeatIndex; playerId: PlayerId; cards: [CardCode, CardCode] }
  | { kind: 'STREET_STARTED'; street: Street; board: CardCode[]; newCards: CardCode[]; pot: Chips }
  | { kind: 'TURN_TO_ACT'; seat: SeatIndex; playerId: PlayerId; legal: LegalActions }
  | {
      kind: 'PLAYER_ACTED';
      seat: SeatIndex;
      playerId: PlayerId;
      action: ActionType;
      /** Chips moved from stack to pot by this action. */
      amount: Chips;
      /** Player's street contribution after the action. */
      toAmount: Chips;
      allIn: boolean;
      stack: Chips;
      pot: Chips;
      /** True when the server applied the action because the timer expired. */
      timeout: boolean;
    }
  | { kind: 'BETTING_ROUND_COMPLETE'; street: Street; pot: Chips }
  | { kind: 'UNCALLED_BET_RETURNED'; seat: SeatIndex; playerId: PlayerId; amount: Chips; stack: Chips }
  | { kind: 'SHOWDOWN'; reveals: ShowdownReveal[] }
  | {
      kind: 'POT_AWARDED';
      potIndex: number;
      potType: 'MAIN' | 'SIDE';
      amount: Chips;
      eligibleSeats: SeatIndex[];
      winners: PotWinner[];
      /** Null when the pot was won uncontested (everyone else folded). */
      winningHand: { category: HandCategory; description: string; bestFive: CardCode[] } | null;
    }
  | {
      kind: 'HAND_COMPLETED';
      handId: HandId;
      handNumber: number;
      board: CardCode[];
      totalPot: Chips;
      finalStacks: HandSeatInput[];
      /** Players whose stack is 0 after distribution (candidates for elimination). */
      bustedSeats: SeatIndex[];
    };

export interface ShowdownReveal {
  seat: SeatIndex;
  playerId: PlayerId;
  /** Null when the player mucked (cards stay private). */
  cards: [CardCode, CardCode] | null;
  mucked: boolean;
  hand: EvaluatedHand | null;
}

export interface PotWinner {
  seat: SeatIndex;
  playerId: PlayerId;
  amount: Chips;
  /** Odd chips included in `amount` under the documented odd-chip rule. */
  oddChips: Chips;
}

/** Visibility helper: HOLE_CARDS_DEALT is private to its seat; all other hand events are public. */
export function handEventVisibility(event: HandEvent): EventVisibility {
  return event.kind === 'HOLE_CARDS_DEALT' ? 'PRIVATE' : 'PUBLIC';
}

/** Codes for rejected actions. Messages shown to players are mapped from these codes, never raw errors. */
export type IllegalActionCode =
  | 'HAND_NOT_IN_BETTING'
  | 'NOT_YOUR_TURN'
  | 'PLAYER_NOT_IN_HAND'
  | 'PLAYER_FOLDED'
  | 'PLAYER_ALL_IN'
  | 'CHECK_NOT_ALLOWED'
  | 'CALL_NOT_ALLOWED'
  | 'BET_NOT_ALLOWED'
  | 'RAISE_NOT_ALLOWED'
  | 'AMOUNT_REQUIRED'
  | 'AMOUNT_NOT_INTEGER'
  | 'AMOUNT_BELOW_MINIMUM'
  | 'AMOUNT_ABOVE_MAXIMUM'
  | 'UNKNOWN_ACTION';
