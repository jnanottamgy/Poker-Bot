import { currentPots, getLegalActions } from '@jpb/poker-engine';
import type { HandPlayerState, HandState } from '@jpb/poker-engine';
import type {
  AdminTableView,
  CardCode,
  EpochMs,
  PlayerId,
  PlayerTableView,
  PublicHandView,
  PublicSeatView,
  SeatIndex,
  SeatOccupant,
  SpectatorTableView,
  TableViewBase,
} from '@jpb/shared-types';
import { handInProgress, isAway, nextHandPositions } from './queries';
import type { TableState } from './types';

/**
 * Audience projections. The ONLY private data are hole cards:
 * - a player sees their own hole cards and cards revealed at showdown;
 * - spectators see only cards revealed at showdown;
 * - admins see every hole card only with `includeHoleCards` (VIEW_HOLE_CARDS).
 * The hand shown is the hand in progress, or the last completed hand until
 * the next deal (board and showdown stay visible between hands).
 * Every view is a fresh object: nothing returned aliases the state.
 */

const pair = (c: [CardCode, CardCode]): [CardCode, CardCode] => [c[0], c[1]];

/** The hand player of `occ` in `hand` (matched by seat AND player). */
function playerInHand(hand: HandState | null, seat: SeatIndex, occ: SeatOccupant): HandPlayerState | null {
  if (hand === null) return null;
  return hand.players.find((p) => p.seat === seat && p.playerId === occ.playerId) ?? null;
}

/** Cards revealed at the showdown of a completed hand. */
function shownCards(hand: HandState | null, seat: SeatIndex): [CardCode, CardCode] | null {
  const reveal = hand?.result?.reveals.find((r) => r.seat === seat);
  return reveal?.cards ? pair(reveal.cards) : null;
}

function seatView(s: TableState, seat: SeatIndex, occ: SeatOccupant): PublicSeatView {
  const hand = s.hand;
  const live = handInProgress(s);
  const hp = playerInHand(hand, seat, occ);
  return {
    seat,
    playerId: occ.playerId,
    displayName: occ.displayName,
    publicId: occ.publicId,
    stack: live && hp !== null ? hp.stack : occ.stack,
    connected: occ.connected,
    inHand: hp !== null,
    folded: hp?.folded ?? false,
    allIn: live && hp !== null ? hp.allIn : false,
    streetContribution: live && hp !== null ? hp.streetContribution : 0,
    lastAction: live && hp?.lastAction ? { ...hp.lastAction } : null,
    isButton: (hand?.buttonSeat ?? s.buttonSeat) === seat,
    isSmallBlind: hand !== null && hand.smallBlindSeat === seat,
    isBigBlind: hand !== null && hand.bigBlindSeat === seat,
    shownCards: hp !== null ? shownCards(hand, seat) : null,
    away: isAway(occ, s.timing),
  };
}

function handView(s: TableState): PublicHandView | null {
  const hand = s.hand;
  if (hand === null) return null;
  const live = handInProgress(s);
  const pots = live
    ? currentPots(hand).pots.map((p) => ({ amount: p.amount, eligibleSeats: [...p.eligibleSeats] }))
    : (hand.result?.pots ?? [])
        .slice()
        .sort((a, b) => a.potIndex - b.potIndex)
        .map((p) => ({ amount: p.amount, eligibleSeats: [...p.eligibleSeats] }));
  return {
    handId: hand.handId,
    handNumber: hand.handNumber,
    phase: hand.phase,
    board: [...hand.board],
    pots,
    totalPot: live ? hand.pot : (hand.result?.totalPot ?? 0),
    currentBet: live ? hand.currentBet : 0,
    actingSeat: s.turn?.seat ?? null,
    actionDeadline: s.turn?.deadline ?? null,
    turnVersion: s.turn?.turnVersion ?? null,
  };
}

function baseView(s: TableState, now: EpochMs): TableViewBase {
  return {
    tableId: s.tableId,
    tournamentId: s.tournamentId,
    tableNumber: s.tableNumber,
    version: s.version,
    lastEventSeq: s.nextEventSeq - 1,
    status: s.status,
    holds: [...s.holds],
    frozen: s.frozen !== null,
    maxSeats: s.maxSeats,
    seats: s.seats.map((occ, seat) => (occ === null ? null : seatView(s, seat, occ))),
    buttonSeat: s.hand?.buttonSeat ?? s.buttonSeat,
    blinds: { ...s.blinds },
    hand: handView(s),
    serverTime: now,
  };
}

/** What `playerId` may see: public view + their own hole cards and legal actions. Null if not seated here. */
export function playerView(state: TableState, playerId: PlayerId, now: EpochMs): PlayerTableView | null {
  const seat = state.seats.findIndex((o) => o !== null && o.playerId === playerId);
  if (seat < 0) return null;
  const occ = state.seats[seat] as SeatOccupant;
  const hp = playerInHand(state.hand, seat, occ);
  const myTurn = handInProgress(state) && state.frozen === null && state.turn !== null && state.turn.seat === seat;
  const legal = myTurn && state.hand !== null ? getLegalActions(state.hand) : null;
  return {
    ...baseView(state, now),
    audience: 'PLAYER',
    you: {
      playerId,
      seat,
      holeCards: hp?.holeCards ? pair(hp.holeCards) : null,
      legal,
    },
  };
}

/** Spectators: public data and showdown reveals only. */
export function spectatorView(state: TableState, now: EpochMs): SpectatorTableView {
  return { ...baseView(state, now), audience: 'SPECTATOR' };
}

/** Admin projection with full table internals; hole cards only with `includeHoleCards`. */
export function adminView(state: TableState, now: EpochMs, opts: { includeHoleCards: boolean }): AdminTableView {
  const hand = state.hand;
  let holeCards: Record<SeatIndex, [CardCode, CardCode]> | null = null;
  if (opts.includeHoleCards) {
    holeCards = {};
    for (const p of hand?.players ?? []) if (p.holeCards !== null) holeCards[p.seat] = pair(p.holeCards);
  }
  const base = baseView(state, now);
  const next = nextHandPositions(state);
  const turn = state.turn;
  return {
    ...base,
    audience: 'ADMIN',
    holeCards,
    seatDetails: state.seats.map((occ, seat) => {
      if (occ === null) return null;
      return {
        ...occ,
        stack: base.seats[seat]?.stack ?? occ.stack,
        stats: { ...occ.stats },
        pendingRemoval: occ.pendingRemoval === null ? null : { ...occ.pendingRemoval },
        seat,
      };
    }),
    timing: { ...state.timing },
    handForHand: state.handForHand,
    pendingBlinds: state.pendingBlinds === null ? null : { ...state.pendingBlinds },
    lastProgressAt: state.lastProgressAt,
    handsPlayed: state.counters.handsPlayed,
    started: state.started,
    nextHandAt: state.frozen === null ? (state.nextHand?.dueAt ?? null) : null,
    freeze: state.frozen === null ? null : { ...state.frozen },
    turn:
      turn === null
        ? null
        : {
            seat: turn.seat,
            playerId: turn.playerId,
            turnVersion: turn.turnVersion,
            requestedAt: turn.requestedAt,
            deadline: turn.deadline,
            hardDeadline: turn.deadline + turn.graceMs,
            timerMs: turn.timerMs,
            away: turn.away,
            addedMs: turn.addedMs,
          },
    positions: {
      lastButtonSeat: state.handNumber > 0 ? state.buttonSeat : null,
      lastSmallBlindSeat: state.lastSmallBlindSeat,
      lastBigBlindSeat: state.lastBigBlindSeat,
      next:
        next === null
          ? null
          : {
              buttonSeat: next.buttonSeat,
              smallBlindPosition: next.smallBlindPosition,
              smallBlindPosted: next.smallBlindPosted,
              bigBlindSeat: next.bigBlindSeat,
              headsUp: next.headsUp,
            },
    },
    counters: { ...state.counters },
    handActionLog: hand === null ? [] : structuredClone(hand.actionLog),
    handDeckHash: state.handMeta?.deckHash ?? null,
    recentHands: structuredClone(state.recentHands),
    clock: state.clock,
  };
}
