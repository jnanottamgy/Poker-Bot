import { applyAction } from '@jpb/poker-engine';
import type { CardCode, SeatOccupant, TableCommand } from '@jpb/shared-types';
import { occupantOf } from '../draft';
import type { Draft } from '../draft';
import { applyHandTransition, applyTimeout, settle, startHand } from '../lifecycle';
import { accept, reject } from '../outcome';
import type { Outcome } from '../outcome';
import { canDeal, handInProgress, handPlayer } from '../queries';

type Cmd<T extends TableCommand['type']> = Extract<TableCommand, { type: T }>;

/**
 * PLAYER_ACTION (after the duplicate and closed checks done by the reducer).
 * Rejection order: PLAYER_NOT_SEATED, TABLE_FROZEN, NO_ACTIVE_HAND,
 * PLAYER_NOT_IN_HAND / PLAYER_FOLDED / PLAYER_ALL_IN / NOT_YOUR_TURN,
 * STALE_STATE_VERSION (tableStateVersion !== turnVersion; null skips the check),
 * ACTION_DEADLINE_PASSED (now > deadline + graceMs pinned for the turn), then the poker
 * engine's own codes. A voluntary action resets consecutiveTimeouts.
 */
export function playerAction(d: Draft, c: Cmd<'PLAYER_ACTION'>): Outcome {
  const found = occupantOf(d.s, c.playerId);
  if (found === null) return reject('PLAYER_NOT_SEATED', 'player is not seated at this table');
  if (d.s.frozen !== null) return reject('TABLE_FROZEN', 'the table is frozen');
  const hand = d.s.hand;
  if (hand === null || !handInProgress(d.s)) return reject('NO_ACTIVE_HAND', 'no hand is in progress');
  const hp = handPlayer(hand, c.playerId);
  if (hp === null) return reject('PLAYER_NOT_IN_HAND', 'player is not dealt into this hand');
  if (hp.folded) return reject('PLAYER_FOLDED', 'player has folded');
  if (hp.allIn) return reject('PLAYER_ALL_IN', 'player is all-in');
  if (d.s.seats[hp.seat]?.suspended === true) return reject('PLAYER_SUSPENDED', 'this player is suspended by the tournament director');
  const turn = d.s.turn;
  if (turn === null || turn.seat !== hp.seat) return reject('NOT_YOUR_TURN', 'it is not this player’s turn');
  if (c.tableStateVersion !== null && c.tableStateVersion !== turn.turnVersion) {
    return reject('STALE_STATE_VERSION', 'the table has changed since this action was chosen');
  }
  if (d.now > turn.deadline + turn.graceMs) {
    return reject('ACTION_DEADLINE_PASSED', 'the time to act has expired');
  }
  const r = applyAction(hand, hp.seat, c.intent);
  if (!r.ok) return reject(r.code, r.message);
  (d.s.seats[hp.seat] as SeatOccupant).consecutiveTimeouts = 0;
  applyHandTransition(d, r);
  return accept();
}

/** What a TIMER_FIRED did: applied (version++), ignored (no change) or premature (re-requested, no change). */
export type TimerOutcome = { kind: 'applied' } | { kind: 'ignored' } | { kind: 'premature'; at: number; token: string };

/**
 * TIMER_FIRED. Ignored when the token is not the pending one (stale), the
 * table is frozen or closed. A timer delivered before its due time is not
 * applied; the same timer is requested again.
 */
export function timerFired(d: Draft, c: Cmd<'TIMER_FIRED'>, deckFor: (n: number) => CardCode[]): TimerOutcome {
  if (d.s.status === 'CLOSED' || d.s.frozen !== null || typeof c.token !== 'string') return { kind: 'ignored' };
  if (c.kind === 'ACTION_TIMEOUT') {
    const turn = d.s.turn;
    if (turn === null || turn.timerToken !== c.token || !handInProgress(d.s)) return { kind: 'ignored' };
    const due = turn.deadline + turn.graceMs;
    if (d.now < due) return { kind: 'premature', at: due, token: turn.timerToken };
    applyTimeout(d);
    return { kind: 'applied' };
  }
  if (c.kind === 'NEXT_HAND') {
    const next = d.s.nextHand;
    if (next === null || next.token !== c.token) return { kind: 'ignored' };
    if (d.now < next.dueAt) return { kind: 'premature', at: next.dueAt, token: next.token };
    d.s.nextHand = null;
    if (canDeal(d.s)) startHand(d, deckFor);
    else settle(d, d.s.timing.betweenHandsDelayMs);
    return { kind: 'applied' };
  }
  return { kind: 'ignored' };
}
