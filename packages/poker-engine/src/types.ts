import type {
  ActionType,
  AnteType,
  CardCode,
  Chips,
  EvaluatedHand,
  ForcedBetType,
  HandCategory,
  HandEvent,
  HandId,
  HandPhase,
  HandSeatInput,
  IllegalActionCode,
  PlayerId,
  PotWinner,
  SeatIndex,
  ShowdownReveal,
  Street,
} from '@jpb/shared-types';

/** Input to `createHand` (CONTRACTS section 3). */
export interface CreateHandInput {
  handId: HandId;
  handNumber: number;
  maxSeats: number;
  /** Dealt-in players only, stack > 0, any order. */
  seats: HandSeatInput[];
  /** May be an EMPTY seat (dead button). */
  buttonSeat: SeatIndex;
  /** null = dead small blind (none posted). Heads-up: equal to `buttonSeat`. */
  smallBlindSeat: SeatIndex | null;
  bigBlindSeat: SeatIndex;
  smallBlind: Chips;
  bigBlind: Chips;
  ante: Chips;
  anteType: AnteType;
  /** 52 unique cards; deck[0] is the top. */
  deck: CardCode[];
}

/** Per-player state inside a hand. Plain JSON. */
export interface HandPlayerState {
  seat: SeatIndex;
  playerId: PlayerId;
  /** Stack when the hand started (before antes/blinds). */
  startingStack: Chips;
  /** Chips currently behind (not in the pot). */
  stack: Chips;
  /** Null only before DEAL_HOLE_CARDS. */
  holeCards: [CardCode, CardCode] | null;
  folded: boolean;
  /** True when the player has no chips behind (set the moment the stack reaches 0). */
  allIn: boolean;
  /** Chips put in on the current street (blinds + bets; antes never count). */
  streetContribution: Chips;
  /** Chips put in during the whole hand (antes + blinds + bets), minus any uncalled bet returned. */
  totalContribution: Chips;
  /** The ante part of `totalContribution`. */
  anteContribution: Chips;
  /** The player made a voluntary action on the current street. Forced bets are not actions. */
  actedThisStreet: boolean;
  /** `currentBet` immediately after this player's last voluntary action on this street (rule 6). */
  betLevelAtLastAction: Chips | null;
  /** Last voluntary action on the current street (for views). Reset at each street. */
  lastAction: { action: ActionType; amount: Chips; toAmount: Chips } | null;
  /** Chips won from pots in this hand. */
  won: Chips;
  /** Uncalled chips returned to this player. */
  uncalledReturned: Chips;
}

/** A pot built from contribution layers (rule 10). */
export interface Pot {
  /** 0 = MAIN, 1.. = SIDE pots in ascending contribution level. */
  index: number;
  type: 'MAIN' | 'SIDE';
  amount: Chips;
  /** Non-folded contributors that can win this pot, ascending seat order. */
  eligibleSeats: SeatIndex[];
  /** Every seat that put chips into this pot (folded or not), ascending seat order. */
  contributorSeats: SeatIndex[];
}

/** One entry of the hand's action log (hand history / replay). */
export type HandLogEntry =
  | {
      kind: 'FORCED_BET';
      street: 'PREFLOP';
      seat: SeatIndex;
      playerId: PlayerId;
      betType: ForcedBetType;
      amount: Chips;
      allIn: boolean;
    }
  | {
      kind: 'ACTION';
      street: Street;
      seat: SeatIndex;
      playerId: PlayerId;
      /** The intent type the player sent. */
      intent: ActionType;
      /** The resolved action (an ALL_IN intent resolves to CALL, BET or RAISE). */
      action: Exclude<ActionType, 'ALL_IN'>;
      amount: Chips;
      toAmount: Chips;
      allIn: boolean;
      /** For BET/RAISE: whether it was a full bet/raise (re-opens betting, rule 6). */
      fullRaise: boolean | null;
      currentBetAfter: Chips;
      timeout: boolean;
    };

/** A pot as awarded at the end of the hand. */
export interface AwardedPot {
  potIndex: number;
  potType: 'MAIN' | 'SIDE';
  amount: Chips;
  eligibleSeats: SeatIndex[];
  winners: PotWinner[];
  winningHand: { category: HandCategory; description: string; bestFive: CardCode[] } | null;
}

export interface HandResult {
  /** FOLD: everyone else folded (no cards shown). SHOWDOWN: two or more players reached the showdown. */
  winType: 'FOLD' | 'SHOWDOWN';
  uncalled: { seat: SeatIndex; playerId: PlayerId; amount: Chips } | null;
  /** In award order: last side pot first, main pot last (rule 12). */
  pots: AwardedPot[];
  /** Showdown reveals in reveal order; empty for a fold win. */
  reveals: ShowdownReveal[];
  /** Every live player's evaluated hand at showdown (server-side only; includes mucked hands). */
  evaluated: Array<{ seat: SeatIndex; hand: EvaluatedHand }>;
  /** Sum of all awarded pots (uncalled chips excluded). */
  totalPot: Chips;
  finalStacks: HandSeatInput[];
  bustedSeats: SeatIndex[];
}

/**
 * Complete state of one hand. Plain JSON: contains everything needed to
 * continue the hand (including the undealt deck), so it can be snapshotted
 * and replayed exactly.
 */
export interface HandState {
  handId: HandId;
  handNumber: number;
  maxSeats: number;
  buttonSeat: SeatIndex;
  smallBlindSeat: SeatIndex | null;
  bigBlindSeat: SeatIndex;
  smallBlind: Chips;
  bigBlind: Chips;
  /** Effective ante (0 when anteType is NONE). */
  ante: Chips;
  anteType: AnteType;
  phase: HandPhase;
  /** Dealt-in players in ascending seat order. */
  players: HandPlayerState[];
  /** Undealt cards; deck[0] is the next card. */
  deck: CardCode[];
  board: CardCode[];
  burns: CardCode[];
  /** Chips currently in the pot (all streets, including the current street's bets). */
  pot: Chips;
  /** Highest street contribution to match (preflop: at least the nominal big blind). */
  currentBet: Chips;
  /** Size of the last full bet/raise on this street (starts at the big blind). */
  minRaiseIncrement: Chips;
  /** Last player to bet or raise on the current street. */
  lastAggressorSeat: SeatIndex | null;
  /** Last aggressor of each street (null = no bet on that street). */
  aggressorByStreet: Record<Street, SeatIndex | null>;
  actingSeat: SeatIndex | null;
  /** True while the current street has an open betting round. */
  bettingRoundOpen: boolean;
  /** Betting closed before the river action completed with two or more live players (all-in run-out). */
  allInRunOut: boolean;
  actionLog: HandLogEntry[];
  result: HandResult | null;
}

export type HandTransition = { ok: true; state: HandState; events: HandEvent[] };
export type HandRejection = { ok: false; code: IllegalActionCode; message: string };
