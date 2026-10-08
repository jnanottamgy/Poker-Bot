import type { CardCode, CurrentBlinds, HoldReason, TableCommand, TableTimingState } from '@jpb/shared-types';
import { HOLD_REASONS, MAX_ADD_TIME_MS } from '../constants';
import { addHold, emit, removeHold, requestTimer, mintToken } from '../draft';
import type { Draft } from '../draft';
import { applyTimeout, rearmTurn, settle, startHand } from '../lifecycle';
import { accept, reject } from '../outcome';
import type { Outcome } from '../outcome';
import { canDeal, handInProgress } from '../queries';
import { blindsProblem, copyBlinds, copyTiming, isInt, timingProblem } from '../validate';

type Cmd<T extends TableCommand['type']> = Extract<TableCommand, { type: T }>;

const isHoldReason = (v: unknown): v is HoldReason => typeof v === 'string' && HOLD_REASONS.includes(v as HoldReason);

/**
 * SET_BLINDS: never applied mid-hand. During a hand the blinds become pending
 * and apply when it completes; otherwise they replace the blinds of the next
 * hand at once. BLINDS_SCHEDULED is emitted either way.
 */
export function setBlinds(d: Draft, c: Cmd<'SET_BLINDS'>): Outcome {
  const bad = blindsProblem(c.blinds);
  if (bad !== null) return reject('INVALID_COMMAND', bad);
  const blinds = copyBlinds(c.blinds as CurrentBlinds);
  if (handInProgress(d.s)) d.s.pendingBlinds = blinds;
  else {
    d.s.blinds = blinds;
    d.s.pendingBlinds = null;
  }
  emit(d, { kind: 'BLINDS_SCHEDULED', blinds: { ...blinds } });
  return accept(handInProgress(d.s) ? 'applies from the next hand' : null);
}

/** SET_TIMING: applies to turns and NEXT_HAND timers created afterwards (a running turn keeps its deadline and grace). */
export function setTiming(d: Draft, c: Cmd<'SET_TIMING'>): Outcome {
  const bad = timingProblem(c.timing);
  if (bad !== null) return reject('INVALID_COMMAND', bad);
  d.s.timing = copyTiming(c.timing as TableTimingState);
  return accept();
}

/** HOLD: takes effect between hands (a hand in progress always completes). */
export function hold(d: Draft, c: Cmd<'HOLD'>): Outcome {
  if (!isHoldReason(c.reason)) return reject('INVALID_COMMAND', 'unknown hold reason');
  const added = addHold(d, c.reason);
  settle(d, d.s.timing.betweenHandsDelayMs);
  return accept(added ? null : 'already held for this reason');
}

/** RELEASE: removing the last hold schedules NEXT_HAND (betweenHandsDelayMs). */
export function release(d: Draft, c: Cmd<'RELEASE'>): Outcome {
  if (!isHoldReason(c.reason)) return reject('INVALID_COMMAND', 'unknown hold reason');
  const removed = removeHold(d, c.reason);
  settle(d, d.s.timing.betweenHandsDelayMs);
  return accept(removed ? null : 'not held for this reason');
}

/**
 * SET_HAND_FOR_HAND. Enabling while no hand is in progress holds the table at
 * once (its hand of the current round is complete); otherwise the hold is added
 * when the running hand completes. Disabling also lifts the HAND_FOR_HAND hold.
 */
export function setHandForHand(d: Draft, c: Cmd<'SET_HAND_FOR_HAND'>): Outcome {
  if (typeof c.enabled !== 'boolean') return reject('INVALID_COMMAND', 'enabled must be a boolean');
  d.s.handForHand = c.enabled;
  if (c.enabled) {
    if (!handInProgress(d.s)) addHold(d, 'HAND_FOR_HAND');
  } else {
    removeHold(d, 'HAND_FOR_HAND');
  }
  settle(d, d.s.timing.betweenHandsDelayMs);
  return accept();
}

/** FREEZE: suspends timers and actions, preserving the remaining action / next-hand time. */
export function freeze(d: Draft): Outcome {
  if (d.s.frozen !== null) return accept('already frozen');
  const turn = d.s.turn;
  const next = d.s.nextHand;
  const visibleLeft = turn === null ? null : Math.max(0, turn.deadline - d.now);
  const hardLeft = turn === null ? null : Math.max(0, turn.deadline + turn.graceMs - d.now);
  d.s.frozen = {
    since: d.now,
    turnRemainingMs: visibleLeft,
    turnGraceRemainingMs: turn === null || visibleLeft === null || hardLeft === null ? null : hardLeft - visibleLeft,
    nextHandRemainingMs: next === null ? null : Math.max(0, next.dueAt - d.now),
  };
  return accept();
}

/** UNFREEZE: new deadline = now + remaining with a new timer token (turn and pending NEXT_HAND). */
export function unfreeze(d: Draft): Outcome {
  const f = d.s.frozen;
  if (f === null) return accept('not frozen');
  d.s.frozen = null;
  if (d.s.turn !== null) rearmTurn(d, d.now + (f.turnRemainingMs ?? 0), f.turnGraceRemainingMs ?? d.s.turn.graceMs);
  if (d.s.nextHand !== null) {
    const delay = f.nextHandRemainingMs ?? 0;
    const token = mintToken(d, 'NEXT_HAND');
    d.s.nextHand = { dueAt: d.now + delay, token };
    requestTimer(d, 'NEXT_HAND', d.now + delay, token);
  }
  settle(d, d.s.timing.betweenHandsDelayMs);
  return accept();
}

/** ADMIN_FORCE_TIMEOUT: applies the timeout action to the acting player now. */
export function forceTimeout(d: Draft): Outcome {
  if (d.s.frozen !== null) return reject('TABLE_FROZEN', 'the table is frozen');
  if (d.s.turn === null || !handInProgress(d.s)) return reject('NO_ACTIVE_HAND', 'nobody is acting');
  applyTimeout(d);
  return accept();
}

/** ADMIN_ADD_TIME: extends the acting player's deadline (counted from now if it already passed). */
export function addTime(d: Draft, c: Cmd<'ADMIN_ADD_TIME'>): Outcome {
  if (!isInt(c.ms, 1, MAX_ADD_TIME_MS))
    return reject('INVALID_COMMAND', `ms must be an integer in [1, ${MAX_ADD_TIME_MS}]`);
  const turn = d.s.turn;
  if (turn === null || !handInProgress(d.s)) return reject('NO_ACTIVE_HAND', 'nobody is acting');
  d.s.turn = { ...turn, addedMs: turn.addedMs + c.ms };
  if (d.s.frozen !== null) {
    d.s.frozen = { ...d.s.frozen, turnRemainingMs: (d.s.frozen.turnRemainingMs ?? 0) + c.ms };
  } else {
    rearmTurn(d, Math.max(turn.deadline, d.now) + c.ms);
  }
  return accept();
}

/** START: the table may deal. Deals the first hand immediately when possible. */
export function start(d: Draft, deckFor: (n: number) => CardCode[]): Outcome {
  if (d.s.started) return accept('already started');
  d.s.started = true;
  if (canDeal(d.s)) startHand(d, deckFor);
  else settle(d, 0);
  return accept();
}

/**
 * CLOSE (terminal): only between hands. Seats are kept as a final snapshot
 * (the director removes players first when breaking a table); every later
 * command is rejected with TABLE_CLOSED and timers are ignored.
 */
export function close(d: Draft): Outcome {
  if (handInProgress(d.s)) return reject('HAND_IN_PROGRESS', 'a hand is in progress; close after it completes');
  d.s.status = 'CLOSED';
  d.s.turn = null;
  d.s.nextHand = null;
  d.s.frozen = null;
  return accept();
}

/**
 * SET_SUSPENDED: an admin sanction. The player stays seated and keeps
 * posting blinds; while suspended every decision times out immediately
 * (check if legal, else fold) and their own PLAYER_ACTIONs are rejected.
 * Suspending the player who is acting applies the timeout now.
 */
export function setSuspended(d: Draft, c: Cmd<'SET_SUSPENDED'>): Outcome {
  if (typeof c.suspended !== 'boolean' || typeof c.playerId !== 'string') return reject('INVALID_COMMAND', 'playerId and suspended are required');
  const seat = d.s.seats.findIndex((o) => o !== null && o.playerId === c.playerId);
  if (seat < 0) return reject('PLAYER_NOT_SEATED', 'player is not seated at this table');
  const occ = d.s.seats[seat]!;
  d.s.seats[seat] = { ...occ, suspended: c.suspended };
  if (c.suspended && d.s.frozen === null && d.s.turn !== null && d.s.turn.seat === seat && handInProgress(d.s)) applyTimeout(d);
  return accept();
}
