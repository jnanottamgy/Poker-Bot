import type { AwardedPot, HandLogEntry, HandResult, HandState } from '@jpb/poker-engine';
import type {
  ActionId,
  CardCode,
  Chips,
  CommandReply,
  CurrentBlinds,
  EpochMs,
  HandId,
  HoldReason,
  PlayerId,
  SeatIndex,
  SeatOccupant,
  ShowdownReveal,
  TableCounters,
  TableEvent,
  TableHandSummary,
  TableId,
  TableStatus,
  TableTimerRequest,
  TableTimingState,
  TournamentId,
} from '@jpb/shared-types';

/** The decision the table is waiting for. */
export interface TurnState {
  seat: SeatIndex;
  playerId: PlayerId;
  /** Table version of the command that requested this decision; clients echo it as `tableStateVersion`. */
  turnVersion: number;
  requestedAt: EpochMs;
  /** Visible deadline. Actions are accepted while `at <= deadline + actionGraceMs`. */
  deadline: EpochMs;
  /** Timer length chosen when the turn started (actionTimerMs or awayActionTimerMs). */
  timerMs: number;
  /** Token of the pending ACTION_TIMEOUT timer; any other token is stale. */
  timerToken: string;
  /** The away timer was used. */
  away: boolean;
  /** Extra time granted by ADMIN_ADD_TIME during this turn. */
  addedMs: number;
}

/** A pending NEXT_HAND timer. */
export interface NextHandTimer {
  dueAt: EpochMs;
  token: string;
}

/** Emergency freeze: timers are suspended and the remaining times preserved. */
export interface FrozenState {
  since: EpochMs;
  turnRemainingMs: number | null;
  nextHandRemainingMs: number | null;
}

/** Table-level facts about the current (or last) hand that the poker engine does not keep. */
export interface HandMeta {
  startedAt: EpochMs;
  /** SHA-256 of the 52-card deck the hand was dealt from (`sha256Hex(deck.join(''))`). */
  deckHash: string;
  blinds: CurrentBlinds;
  /** Small-blind POSITION (equals the button heads-up; may be an empty seat = dead small blind). */
  smallBlindPosition: SeatIndex;
  headsUp: boolean;
  /** Sum of the dealt-in players' starting stacks (chip conservation reference). */
  startingChips: Chips;
  /** Seat -> display data of each dealt-in player (for the hand history). */
  players: Array<{ seat: SeatIndex; playerId: PlayerId; displayName: string; publicId: string }>;
}

export interface RecentAction {
  actionId: ActionId;
  reply: CommandReply;
}

/**
 * Complete state of one table. Plain JSON (no Map/Set/Date/class), so it can be
 * snapshotted, persisted and replayed exactly.
 */
export interface TableState {
  schemaVersion: number;
  tableId: TableId;
  tournamentId: TournamentId;
  tableNumber: number;
  maxSeats: number;
  createdAt: EpochMs;

  status: TableStatus;
  /** START received. */
  started: boolean;
  /** Active holds, unique, in the order they were placed. */
  holds: HoldReason[];
  frozen: FrozenState | null;

  /** Index = seat. */
  seats: Array<SeatOccupant | null>;

  timing: TableTimingState;
  /** Blinds of the next hand to be dealt (and of the hand in progress when no change is pending). */
  blinds: CurrentBlinds;
  /** SET_BLINDS received during a hand; applied when the hand completes. */
  pendingBlinds: CurrentBlinds | null;
  handForHand: boolean;

  /** Number of the last hand dealt (0 = none yet). */
  handNumber: number;
  /**
   * The hand in progress, or the last completed hand (phase HAND_COMPLETE) until
   * the next one is dealt, so views can keep showing the board and showdown.
   */
  hand: HandState | null;
  handMeta: HandMeta | null;

  /** Button of the last dealt hand (before the first hand: the initial button, or null). */
  buttonSeat: SeatIndex | null;
  /** Small-blind POSITION of the last dealt hand (even if the small blind was dead). */
  lastSmallBlindSeat: SeatIndex | null;
  lastBigBlindSeat: SeatIndex | null;

  turn: TurnState | null;
  nextHand: NextHandTimer | null;
  /** Counter used to mint deterministic timer tokens. */
  timerSeq: number;

  /** Number of accepted commands. */
  version: number;
  /** Seq of the next emitted event (events are gap-free from 1). */
  nextEventSeq: number;
  /** Time of the last accepted command; envelope times are clamped to be non-decreasing. */
  clock: EpochMs;
  /** Last RECENT_ACTION_CAPACITY processed PLAYER_ACTION ids with their replies, oldest first. */
  recentActions: RecentAction[];
  /** Last time the game made progress (hand dealt, action applied, hand completed, status change). */
  lastProgressAt: EpochMs;
  counters: TableCounters;

  /** Full record of the last completed hand (persistence, replay, fairness). */
  lastHand: HandHistoryRecord | null;
  /** Summaries of recent completed hands, oldest first (bounded). */
  recentHands: TableHandSummary[];
}

export interface CreateTableInput {
  tableId: TableId;
  tournamentId: TournamentId;
  tableNumber: number;
  maxSeats: number;
  timing: TableTimingState;
  blinds: CurrentBlinds;
  initialButtonSeat: SeatIndex | null;
  createdAt: EpochMs;
}

/** Host-supplied dependencies. `deckFor` comes from the fairness engine (deriveDeck). */
export interface TableContext {
  deckFor(handNumber: number): CardCode[];
}

export interface TableTransition {
  state: TableState;
  events: TableEvent[];
  timers: TableTimerRequest[];
  /** Reply for every command except TIMER_FIRED (null). */
  reply: CommandReply | null;
}

/** One player of a completed hand, as recorded in the hand history. */
export interface HandHistoryPlayer {
  seat: SeatIndex;
  playerId: PlayerId;
  displayName: string;
  publicId: string;
  startingStack: Chips;
  finalStack: Chips;
  holeCards: [CardCode, CardCode];
  folded: boolean;
  /** Chips won from pots. */
  won: Chips;
  uncalledReturned: Chips;
  /** Cards shown at showdown (null: not shown / mucked / fold win). */
  shownCards: [CardCode, CardCode] | null;
  busted: boolean;
}

/**
 * Complete, self-contained record of one completed hand: enough to persist,
 * display, replay (re-apply the action log to `createHand`) and verify it.
 * Contains every hole card: never send it to players or spectators.
 */
export interface HandHistoryRecord {
  format: string;
  formatVersion: number;
  tournamentId: TournamentId;
  tableId: TableId;
  tableNumber: number;
  handId: HandId;
  handNumber: number;
  maxSeats: number;
  startedAt: EpochMs;
  completedAt: EpochMs;
  buttonSeat: SeatIndex;
  /** Seat that posted the small blind (null = dead small blind). */
  smallBlindSeat: SeatIndex | null;
  smallBlindPosition: SeatIndex;
  bigBlindSeat: SeatIndex;
  headsUp: boolean;
  blinds: CurrentBlinds;
  deckHash: string;
  /** Dealt-in seats in dealing order (first seat clockwise after the button first). */
  dealingOrder: SeatIndex[];
  /** Ascending seat order. */
  players: HandHistoryPlayer[];
  board: CardCode[];
  burns: CardCode[];
  actionLog: HandLogEntry[];
  winType: HandResult['winType'];
  uncalled: HandResult['uncalled'];
  /** In award order (last side pot first, main pot last). */
  pots: AwardedPot[];
  reveals: ShowdownReveal[];
  totalPot: Chips;
  busted: Array<{ seat: SeatIndex; playerId: PlayerId; startingStack: Chips }>;
}
