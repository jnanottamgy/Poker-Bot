import { applyAction, createHand, getLegalActions, isFullDeck, timeoutIntent } from '@jpb/poker-engine';
import type { HandState, HandTransition } from '@jpb/poker-engine';
import { sha256Hex } from '@jpb/randomness';
import type {
  CardCode,
  HandEvent,
  HandResultReport,
  LegalActions,
  PlayerId,
  RemovalReason,
  SeatIndex,
  SeatOccupant,
  SeatPositionStats,
} from '@jpb/shared-types';
import { RECENT_HANDS_CAPACITY } from './constants';
import { addHold, announce, emit, emitHandEvent, mintToken, requestTimer, setStatus } from './draft';
import type { Draft } from './draft';
import { buildHandHistory, summarizeHand } from './history';
import { canDeal, eligibleSeats, handInProgress, isAway, nextHandPositions } from './queries';
import type { HandMeta } from './types';

/* ------------------------------------------------------------------------ */
/* Idle status & NEXT_HAND scheduling                                        */

/** Schedules NEXT_HAND `delayMs` from now (while frozen only the remaining delay is stored). */
function scheduleNextHand(d: Draft, delayMs: number): void {
  const token = mintToken(d, 'NEXT_HAND');
  d.s.nextHand = { dueAt: d.now + delayMs, token };
  if (d.s.frozen !== null) {
    d.s.frozen = { ...d.s.frozen, nextHandRemainingMs: delayMs };
  } else {
    requestTimer(d, 'NEXT_HAND', d.now + delayMs, token);
  }
}

function cancelNextHand(d: Draft): void {
  d.s.nextHand = null;
  if (d.s.frozen !== null && d.s.frozen.nextHandRemainingMs !== null) {
    d.s.frozen = { ...d.s.frozen, nextHandRemainingMs: null };
  }
}

/**
 * Recomputes the status of a table that is not playing a hand (normative order):
 * CLOSED stays CLOSED; any hold -> HELD; not started or fewer than two eligible
 * players -> WAITING; otherwise BETWEEN_HANDS with a NEXT_HAND timer `delayMs`
 * from now (an already pending timer is kept).
 */
export function settle(d: Draft, delayMs: number): void {
  if (d.s.status === 'CLOSED') return;
  if (handInProgress(d.s)) {
    setStatus(d, 'IN_HAND');
    return;
  }
  if (d.s.holds.length > 0) {
    cancelNextHand(d);
    setStatus(d, 'HELD');
  } else if (!d.s.started || eligibleSeats(d.s).length < 2) {
    cancelNextHand(d);
    setStatus(d, 'WAITING');
  } else {
    if (d.s.nextHand === null) scheduleNextHand(d, delayMs);
    setStatus(d, 'BETWEEN_HANDS');
  }
}

/** Unrecoverable host-side problem (e.g. the deck provider): report it and hold the table for an admin. */
export function integrityFailure(d: Draft, code: string, detail: string): void {
  emit(d, { kind: 'INTEGRITY_VIOLATION', code, detail });
  addHold(d, 'INTEGRITY');
  settle(d, d.s.timing.betweenHandsDelayMs);
}

/* ------------------------------------------------------------------------ */
/* Dealing                                                                   */

function fetchDeck(d: Draft, handNumber: number, deckFor: (n: number) => CardCode[]): CardCode[] | null {
  let deck: unknown;
  try {
    deck = deckFor(handNumber);
  } catch (e) {
    integrityFailure(
      d,
      'DECK_PROVIDER_FAILED',
      `deckFor(${handNumber}) threw: ${e instanceof Error ? e.message : String(e)}`,
    );
    return null;
  }
  if (!Array.isArray(deck) || !isFullDeck(deck as CardCode[])) {
    integrityFailure(d, 'INVALID_DECK', `deckFor(${handNumber}) did not return the 52 distinct cards`);
    return null;
  }
  return [...(deck as CardCode[])];
}

/** Deals the next hand. Precondition: canDeal(d.s). */
export function startHand(d: Draft, deckFor: (n: number) => CardCode[]): void {
  if (!canDeal(d.s)) throw new Error('startHand: table cannot deal');
  const participants = eligibleSeats(d.s);
  const pos = nextHandPositions(d.s);
  if (pos === null) throw new Error('startHand: fewer than two participants');
  const handNumber = d.s.handNumber + 1;
  const deck = fetchDeck(d, handNumber, deckFor);
  if (deck === null) return;

  const blinds = d.s.blinds;
  const seats = participants.map((seat) => {
    const occ = d.s.seats[seat] as SeatOccupant;
    return { seat, playerId: occ.playerId, stack: occ.stack };
  });
  const t = createHand({
    handId: `${d.s.tableId}:${handNumber}`,
    handNumber,
    maxSeats: d.s.maxSeats,
    seats,
    buttonSeat: pos.buttonSeat,
    smallBlindSeat: pos.smallBlindPosted ? pos.smallBlindPosition : null,
    bigBlindSeat: pos.bigBlindSeat,
    smallBlind: blinds.smallBlind,
    bigBlind: blinds.bigBlind,
    ante: blinds.ante,
    anteType: blinds.anteType,
    deck,
  });
  const meta: HandMeta = {
    startedAt: d.now,
    deckHash: sha256Hex(deck.join('')),
    blinds: { ...blinds },
    smallBlindPosition: pos.smallBlindPosition,
    headsUp: pos.headsUp,
    startingChips: seats.reduce((sum, p) => sum + p.stack, 0),
    players: participants.map((seat) => {
      const occ = d.s.seats[seat] as SeatOccupant;
      return { seat, playerId: occ.playerId, displayName: occ.displayName, publicId: occ.publicId };
    }),
  };
  d.s.handNumber = handNumber;
  d.s.hand = t.state;
  d.s.handMeta = meta;
  d.s.buttonSeat = pos.buttonSeat;
  d.s.lastSmallBlindSeat = pos.smallBlindPosition;
  d.s.lastBigBlindSeat = pos.bigBlindSeat;
  d.s.nextHand = null;
  d.s.lastProgressAt = d.now;
  setStatus(d, 'IN_HAND');
  announce(d);
  absorb(d, t.events);
}

/* ------------------------------------------------------------------------ */
/* Turns                                                                     */

/** ACTION_REQUESTED for a new decision: timer = away ? awayActionTimerMs : actionTimerMs. */
function requestAction(d: Draft, seat: SeatIndex, playerId: PlayerId, legal: LegalActions): void {
  const occ = d.s.seats[seat];
  if (occ === null || occ === undefined || occ.playerId !== playerId)
    throw new Error(`requestAction: seat ${seat} is not ${playerId}`);
  const away = isAway(occ, d.s.timing);
  const suspended = occ.suspended === true;
  // A suspended player's decision times out at once (the host fires the timer immediately).
  const timerMs = suspended ? 0 : away ? d.s.timing.awayActionTimerMs : d.s.timing.actionTimerMs;
  const graceMs = suspended ? 0 : d.s.timing.actionGraceMs;
  const deadline = d.now + timerMs;
  const token = mintToken(d, 'ACTION_TIMEOUT');
  d.s.turn = {
    seat,
    playerId,
    turnVersion: d.s.version,
    requestedAt: d.now,
    deadline,
    timerMs,
    graceMs,
    timerToken: token,
    away,
    addedMs: 0,
  };
  emit(d, { kind: 'ACTION_REQUESTED', seat, playerId, legal, deadline, timerMs, turnVersion: d.s.version });
  requestTimer(d, 'ACTION_TIMEOUT', deadline + graceMs, token);
}

/**
 * Re-arms the current turn with a new deadline (UNFREEZE, ADMIN_ADD_TIME): fresh
 * token (the old timer becomes stale), same turnVersion, ACTION_REQUESTED re-emitted.
 * The grace stays the one pinned for this turn (SET_TIMING never changes a
 * running turn's cutoff) unless UNFREEZE passes the grace that was left.
 */
export function rearmTurn(d: Draft, deadline: number, graceMs: number = d.s.turn?.graceMs ?? 0): void {
  const turn = d.s.turn;
  const hand = d.s.hand;
  if (turn === null || hand === null) throw new Error('rearmTurn: no turn');
  const legal = getLegalActions(hand);
  if (legal === null || legal.seat !== turn.seat) throw new Error('rearmTurn: turn and hand disagree');
  const token = mintToken(d, 'ACTION_TIMEOUT');
  d.s.turn = { ...turn, deadline, graceMs, timerToken: token };
  emit(d, {
    kind: 'ACTION_REQUESTED',
    seat: turn.seat,
    playerId: turn.playerId,
    legal,
    deadline,
    timerMs: Math.max(0, deadline - d.now),
    turnVersion: turn.turnVersion,
  });
  requestTimer(d, 'ACTION_TIMEOUT', deadline + graceMs, token);
}

/** Emits a hand transition's events (TURN_TO_ACT becomes ACTION_REQUESTED) and completes the hand if done. */
function absorb(d: Draft, events: HandEvent[]): void {
  d.s.turn = null;
  for (const ev of events) {
    if (ev.kind === 'TURN_TO_ACT') requestAction(d, ev.seat, ev.playerId, ev.legal);
    else emitHandEvent(d, ev);
  }
  if (d.s.hand !== null && d.s.hand.phase === 'HAND_COMPLETE') completeHand(d);
}

/** Applies an accepted poker-engine transition to the table. */
export function applyHandTransition(d: Draft, t: HandTransition): void {
  d.s.hand = t.state;
  d.s.lastProgressAt = d.now;
  absorb(d, t.events);
}

/** Timeout of the acting player: CHECK if legal else FOLD, flagged timeout; consecutiveTimeouts + 1. */
export function applyTimeout(d: Draft): void {
  const turn = d.s.turn;
  const hand = d.s.hand;
  if (turn === null || hand === null) throw new Error('applyTimeout: nobody is acting');
  const r = applyAction(hand, turn.seat, timeoutIntent(hand), { timeout: true });
  if (!r.ok) throw new Error(`applyTimeout: poker engine rejected the timeout intent (${r.code})`);
  const occ = d.s.seats[turn.seat] as SeatOccupant;
  occ.consecutiveTimeouts += 1;
  d.s.counters.timeouts += 1;
  applyHandTransition(d, r);
}

/* ------------------------------------------------------------------------ */
/* Removal                                                                   */

/** Removes the occupant of `seat`, emitting PLAYER_REMOVED with the exact stack and position stats. */
export function removeOccupant(d: Draft, seat: SeatIndex, reason: RemovalReason, moveId: string | null): void {
  const occ = d.s.seats[seat];
  if (occ === null || occ === undefined) throw new Error(`removeOccupant: seat ${seat} is empty`);
  d.s.seats[seat] = null;
  d.s.counters.playersRemoved += 1;
  if (reason === 'ELIMINATED') d.s.counters.eliminations += 1;
  emit(d, {
    kind: 'PLAYER_REMOVED',
    seat,
    playerId: occ.playerId,
    reason,
    stack: occ.stack,
    moveId,
    stats: { ...occ.stats },
  });
}

/* ------------------------------------------------------------------------ */
/* End of hand                                                               */

/** Position stats after a dealt hand (CONTRACTS §4). */
function advanceStats(stats: SeatPositionStats, seat: SeatIndex, hand: HandState): SeatPositionStats {
  return {
    handsDealtAtTable: stats.handsDealtAtTable + 1,
    handsSinceBigBlind: seat === hand.bigBlindSeat ? 0 : stats.handsSinceBigBlind + 1,
    handsSinceSmallBlind: seat === hand.smallBlindSeat ? 0 : stats.handsSinceSmallBlind + 1,
    handsPlayedTotal: stats.handsPlayedTotal + 1,
  };
}

/**
 * After HAND_COMPLETED (normative order): sync stacks and position stats,
 * record history, emit HAND_RESULT, remove busted players (ELIMINATED) and
 * pending removals (seat order), apply scheduled blinds, clear
 * waitingForNextHand, add the hand-for-hand hold, then settle the status
 * (NEXT_HAND after betweenHandsDelayMs, + showdownDelayMs after a showdown).
 */
function completeHand(d: Draft): void {
  const hand = d.s.hand;
  const meta = d.s.handMeta;
  if (hand === null || meta === null || hand.result === null) throw new Error('completeHand: no completed hand');
  const result = hand.result;
  const finalTotal = result.finalStacks.reduce((sum, p) => sum + p.stack, 0);
  if (finalTotal !== meta.startingChips) {
    throw new Error(`completeHand: chip conservation broken (${finalTotal} != ${meta.startingChips})`);
  }

  for (const p of hand.players) {
    const occ = d.s.seats[p.seat];
    if (occ === null || occ === undefined || occ.playerId !== p.playerId) {
      throw new Error(`completeHand: seat ${p.seat} no longer holds ${p.playerId}`);
    }
    occ.stack = p.stack;
    occ.stats = advanceStats(occ.stats, p.seat, hand);
  }

  const history = buildHandHistory(d.s, hand, meta, d.now);
  d.s.lastHand = history;
  d.s.recentHands = [...d.s.recentHands, summarizeHand(history)].slice(-RECENT_HANDS_CAPACITY);
  const showdown = result.winType === 'SHOWDOWN';
  const c = d.s.counters;
  c.handsPlayed += 1;
  c.largestPot = Math.max(c.largestPot, result.totalPot);
  c.totalPotChips += result.totalPot;
  if (showdown) c.showdowns += 1;
  c.totalHandDurationMs += d.now - meta.startedAt;

  emit(d, { kind: 'HAND_RESULT', result: handResultReport(d, hand, meta, showdown) });

  for (let seat = 0; seat < d.s.seats.length; seat += 1) {
    const occ = d.s.seats[seat];
    if (occ === null || occ === undefined) continue;
    if (occ.stack === 0) removeOccupant(d, seat, 'ELIMINATED', null);
    else if (occ.pendingRemoval !== null) removeOccupant(d, seat, occ.pendingRemoval.reason, occ.pendingRemoval.moveId);
    else occ.waitingForNextHand = false;
  }

  if (d.s.pendingBlinds !== null) {
    d.s.blinds = d.s.pendingBlinds;
    d.s.pendingBlinds = null;
  }
  if (d.s.handForHand) addHold(d, 'HAND_FOR_HAND');
  d.s.turn = null;
  d.s.lastProgressAt = d.now;
  settle(d, d.s.timing.betweenHandsDelayMs + (showdown ? d.s.timing.showdownDelayMs : 0));
}

function handResultReport(d: Draft, hand: HandState, meta: HandMeta, showdown: boolean): HandResultReport {
  let totalChipsAtTable = 0;
  for (const occ of d.s.seats) if (occ !== null) totalChipsAtTable += occ.stack;
  return {
    tableId: d.s.tableId,
    handId: hand.handId,
    handNumber: hand.handNumber,
    completedAt: d.now,
    buttonSeat: hand.buttonSeat,
    smallBlindSeat: hand.smallBlindSeat,
    bigBlindSeat: hand.bigBlindSeat,
    smallBlindPosition: meta.smallBlindPosition,
    startedAt: meta.startedAt,
    showdown,
    players: hand.players.map((p) => ({
      playerId: p.playerId,
      seat: p.seat,
      startingStack: p.startingStack,
      finalStack: p.stack,
      stats: { ...(d.s.seats[p.seat] as SeatOccupant).stats },
    })),
    busted: hand.players
      .filter((p) => p.stack === 0)
      .map((p) => ({ playerId: p.playerId, seat: p.seat, startingStack: p.startingStack })),
    largestPot: hand.result?.totalPot ?? 0,
    totalChipsAtTable,
  };
}
