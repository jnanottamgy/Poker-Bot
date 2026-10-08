import { checkHandInvariants } from '@jpb/poker-engine';
import { HOLD_REASONS, RECENT_ACTION_CAPACITY } from './constants';
import { handInProgress } from './queries';
import type { TableState } from './types';
import { blindsProblem, isInt, statsProblem, timingProblem } from './validate';

/**
 * Structural and accounting invariants of a TableState (CONTRACTS §4).
 * Returns the list of violations (empty when healthy). Never throws.
 */
export function checkTableInvariants(s: TableState): string[] {
  const out: string[] = [];
  try {
    checkSeats(s, out);
    checkStatus(s, out);
    checkHand(s, out);
    checkBookkeeping(s, out);
  } catch (e) {
    out.push(`invariant check crashed: ${e instanceof Error ? e.message : String(e)}`);
  }
  return out;
}

function checkSeats(s: TableState, out: string[]): void {
  if (s.seats.length !== s.maxSeats) out.push(`seats.length ${s.seats.length} != maxSeats ${s.maxSeats}`);
  const ids = new Set<string>();
  const live = handInProgress(s);
  s.seats.forEach((occ, seat) => {
    if (occ === null) return;
    if (ids.has(occ.playerId)) out.push(`player ${occ.playerId} seated twice`);
    ids.add(occ.playerId);
    if (!isInt(occ.stack, 1)) out.push(`seat ${seat}: stack ${occ.stack} must be a positive integer`);
    if (!isInt(occ.consecutiveTimeouts, 0)) out.push(`seat ${seat}: bad consecutiveTimeouts`);
    const stats = statsProblem(occ.stats);
    if (stats !== null) out.push(`seat ${seat}: ${stats}`);
    if (occ.waitingForNextHand && !live) out.push(`seat ${seat}: waitingForNextHand outside a hand`);
    const dealt = live && s.hand !== null && s.hand.players.some((p) => p.seat === seat && p.playerId === occ.playerId);
    if (occ.waitingForNextHand && dealt) out.push(`seat ${seat}: waiting player is dealt in`);
    if (occ.pendingRemoval !== null && !dealt) out.push(`seat ${seat}: pendingRemoval for a player not in the hand`);
    if (live && !dealt && !occ.waitingForNextHand)
      out.push(`seat ${seat}: seated during a hand without being dealt in or waiting`);
  });
}

function checkStatus(s: TableState, out: string[]): void {
  const live = handInProgress(s);
  const unique = new Set(s.holds);
  if (unique.size !== s.holds.length) out.push('duplicate holds');
  for (const h of s.holds) if (!HOLD_REASONS.includes(h)) out.push(`unknown hold ${h}`);
  if (live !== (s.status === 'IN_HAND')) out.push(`status ${s.status} but hand in progress = ${live}`);
  if (s.status === 'HELD' && s.holds.length === 0) out.push('HELD without holds');
  if ((s.status === 'WAITING' || s.status === 'BETWEEN_HANDS') && s.holds.length > 0)
    out.push(`${s.status} with holds`);
  if (s.status === 'BETWEEN_HANDS' && s.nextHand === null) out.push('BETWEEN_HANDS without a NEXT_HAND timer');
  if (s.status !== 'BETWEEN_HANDS' && s.nextHand !== null) out.push(`NEXT_HAND timer pending in ${s.status}`);
  if (s.status === 'CLOSED' && (s.turn !== null || s.frozen !== null)) out.push('CLOSED with a turn or freeze');
  if (s.frozen !== null) {
    if ((s.frozen.turnRemainingMs === null) !== (s.turn === null)) out.push('frozen turn time inconsistent with turn');
    if ((s.frozen.nextHandRemainingMs === null) !== (s.nextHand === null))
      out.push('frozen next-hand time inconsistent');
  }
  if (!live && s.pendingBlinds !== null) out.push('pendingBlinds outside a hand');
  const blinds = blindsProblem(s.blinds);
  if (blinds !== null) out.push(blinds);
  const timing = timingProblem(s.timing);
  if (timing !== null) out.push(timing);
}

function checkHand(s: TableState, out: string[]): void {
  const hand = s.hand;
  if (hand === null) {
    if (s.turn !== null) out.push('turn without a hand');
    return;
  }
  if (s.handMeta === null) out.push('hand without handMeta');
  if (hand.handNumber !== s.handNumber) out.push(`hand number ${hand.handNumber} != table ${s.handNumber}`);
  if (hand.handId !== `${s.tableId}:${hand.handNumber}`) out.push(`unexpected handId ${hand.handId}`);
  for (const v of checkHandInvariants(hand)) out.push(`hand: ${v}`);
  const live = handInProgress(s);
  if (!live) {
    if (s.turn !== null) out.push('turn after the hand completed');
    return;
  }
  // chips at table during a hand == chips at hand start (dealt-in players).
  let chips = hand.pot;
  for (const p of hand.players) {
    chips += p.stack;
    const occ = s.seats[p.seat];
    if (occ === null || occ === undefined || occ.playerId !== p.playerId)
      out.push(`dealt-in seat ${p.seat} lost its player`);
    else if (occ.stack !== p.startingStack)
      out.push(`seat ${p.seat}: seat stack ${occ.stack} != hand starting stack ${p.startingStack}`);
  }
  if (s.handMeta !== null && chips !== s.handMeta.startingChips) {
    out.push(`chips in hand ${chips} != chips at hand start ${s.handMeta.startingChips}`);
  }
  // deadline set iff a player is acting; at most one acting seat, a live non-all-in player.
  const acting = hand.actingSeat;
  if ((acting === null) !== (s.turn === null)) out.push(`turn ${s.turn?.seat ?? null} vs acting seat ${acting}`);
  if (s.turn !== null && acting !== null) {
    if (s.turn.seat !== acting) out.push(`turn seat ${s.turn.seat} != acting seat ${acting}`);
    const p = hand.players.find((x) => x.seat === acting);
    if (p === undefined || p.folded || p.allIn) out.push(`acting seat ${acting} cannot act`);
    else if (p.playerId !== s.turn.playerId) out.push('turn player mismatch');
    if (!isInt(s.turn.deadline, 0) || s.turn.deadline < s.turn.requestedAt) out.push('turn deadline invalid');
    if (s.turn.turnVersion > s.version) out.push('turnVersion ahead of version');
    if (!isInt(s.turn.graceMs, 0)) out.push('turn graceMs invalid');
  }
}

function checkBookkeeping(s: TableState, out: string[]): void {
  if (!isInt(s.version, 0)) out.push('version must be a non-negative integer');
  if (!isInt(s.nextEventSeq, 1)) out.push('nextEventSeq must be >= 1');
  if (s.recentActions.length > RECENT_ACTION_CAPACITY) out.push('recentActions over capacity');
  const ids = new Set(s.recentActions.map((a) => `${a.playerId}\u0000${a.actionId}`));
  if (ids.size !== s.recentActions.length) out.push('duplicate (playerId, actionId) in recentActions');
  if (s.handNumber > 0 && (s.lastBigBlindSeat === null || s.lastSmallBlindSeat === null || s.buttonSeat === null)) {
    out.push('positions missing after a hand was dealt');
  }
  const c = s.counters;
  for (const [k, v] of Object.entries(c)) if (!isInt(v, 0)) out.push(`counter ${k} invalid`);
  if (c.handsPlayed > s.handNumber) out.push('more hands played than dealt');
  if (c.largestPot > c.totalPotChips) out.push('largestPot above totalPotChips');
}
