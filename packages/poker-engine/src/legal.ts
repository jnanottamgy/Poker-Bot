import type { ActionType, Chips, HandPhase, LegalActions, PlayerActionIntent, Street } from '@jpb/shared-types';
import type { HandPlayerState, HandRejection, HandState } from './types';

const BETTING_PHASES: readonly HandPhase[] = ['PREFLOP', 'FLOP', 'TURN', 'RIVER'];
const ACTION_TYPES: readonly ActionType[] = ['FOLD', 'CHECK', 'CALL', 'BET', 'RAISE', 'ALL_IN'];

export function isBettingPhase(phase: HandPhase): phase is Street {
  return BETTING_PHASES.includes(phase);
}

/** Rule 4: a player can act if not folded and not all-in. */
export function canAct(p: HandPlayerState): boolean {
  return !p.folded && !p.allIn;
}

export function livePlayers(state: HandState): HandPlayerState[] {
  return state.players.filter((p) => !p.folded);
}

/** A player who can act and has not yet acted since the bet was last raised. */
export function needsToAct(state: HandState, p: HandPlayerState): boolean {
  return canAct(p) && (!p.actedThisStreet || p.streetContribution < state.currentBet);
}

/**
 * Highest street contribution among the live players other than `p`: the
 * amount `p` must have put in to cover every opponent still in the hand.
 */
function highestOpponentContribution(live: readonly HandPlayerState[], p: HandPlayerState): number {
  return live.reduce((max, o) => (o === p ? max : Math.max(max, o.streetContribution)), 0);
}

/**
 * Rule 7. The round is complete when no live player needs to act. Betting is
 * also closed when at most one player can still act and that player has
 * matched every live opponent's street contribution: nobody is left to bet
 * against and the player already covers everyone, so there is no decision.
 *
 * The comparison is with what the (all-in) opponents actually put in, not with
 * the nominal `currentBet`. The two differ only preflop when the big blind is
 * all-in for less than the nominal blind; there, e.g. a small blind of 50
 * facing a big blind all-in for 30 has nothing to call (the excess 20 comes
 * back as an uncalled bet) and must not be asked to "call or fold" — a timeout
 * (CHECK_ELSE_FOLD) would otherwise forfeit a covered hand.
 */
export function isRoundComplete(state: HandState): boolean {
  const live = livePlayers(state);
  if (live.length <= 1) return true;
  const actors = live.filter(canAct);
  if (actors.length === 0) return true;
  const lone = actors.length === 1 ? (actors[0] as HandPlayerState) : null;
  if (lone !== null && lone.streetContribution >= highestOpponentContribution(live, lone)) return true;
  return !actors.some((p) => needsToAct(state, p));
}

/**
 * Rule 6. Raising is open to a player who has not acted on this street, or
 * whose last action was followed by a cumulative increase of at least a full
 * raise (`currentBet - betLevelAtLastAction >= minRaiseIncrement`). Any full
 * raise since their last action satisfies this automatically.
 */
export function isRaiseOpen(state: HandState, p: HandPlayerState): boolean {
  if (!p.actedThisStreet || p.betLevelAtLastAction === null) return true;
  return state.currentBet - p.betLevelAtLastAction >= state.minRaiseIncrement;
}

/** Legal actions for player `p` (assumed to be the acting player). Rule 5. */
export function computeLegalActions(state: HandState, p: HandPlayerState): LegalActions {
  const contrib = p.streetContribution;
  const toCall = Math.max(0, state.currentBet - contrib);
  const allInTo = contrib + p.stack;
  const canBet = state.currentBet === 0 && p.stack > 0;
  const canRaise = state.currentBet > 0 && p.stack > toCall && isRaiseOpen(state, p);
  let minTo = 0;
  let maxTo = 0;
  if (canBet) {
    minTo = Math.min(state.bigBlind, allInTo);
    maxTo = allInTo;
  } else if (canRaise) {
    minTo = Math.min(state.currentBet + state.minRaiseIncrement, allInTo);
    maxTo = allInTo;
  }
  return {
    seat: p.seat,
    playerId: p.playerId,
    canFold: true,
    canCheck: toCall === 0,
    canCall: toCall > 0,
    callAmount: Math.min(toCall, p.stack),
    canBet,
    canRaise,
    minTo,
    maxTo,
    canAllIn: p.stack > 0 && (allInTo <= state.currentBet || canBet || canRaise),
    allInTo,
    currentBet: state.currentBet,
    contributedThisStreet: contrib,
    stack: p.stack,
    pot: state.pot,
  };
}

/** Legal actions of the acting seat, or null when nobody is to act. */
export function getLegalActions(state: HandState): LegalActions | null {
  if (state.actingSeat === null || !isBettingPhase(state.phase)) return null;
  const p = state.players.find((x) => x.seat === state.actingSeat);
  return p === undefined ? null : computeLegalActions(state, p);
}

/** Timeout behaviour CHECK_ELSE_FOLD: CHECK if legal, otherwise FOLD. */
export function timeoutIntent(state: HandState): PlayerActionIntent {
  const legal = getLegalActions(state);
  return legal !== null && legal.canCheck ? { type: 'CHECK' } : { type: 'FOLD' };
}

/** A validated action ready to apply. `to` is the street contribution after the action. */
export interface ResolvedAction {
  intent: ActionType;
  action: Exclude<ActionType, 'ALL_IN'>;
  to: Chips;
}

export function reject(code: HandRejection['code'], message: string): HandRejection {
  return { ok: false, code, message };
}

function validateAmount(raw: unknown, minTo: Chips, maxTo: Chips): HandRejection | null {
  if (raw === undefined || raw === null) return reject('AMOUNT_REQUIRED', 'An amount is required');
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw)) {
    return reject('AMOUNT_NOT_INTEGER', 'Amount must be a whole number of chips');
  }
  if (raw < minTo) return reject('AMOUNT_BELOW_MINIMUM', `Amount must be at least ${minTo}`);
  if (raw > maxTo) return reject('AMOUNT_ABOVE_MAXIMUM', `Amount must be at most ${maxTo}`);
  return null;
}

/**
 * Validates a client intent for the acting player and resolves it to a
 * concrete action. Never throws: malformed input yields a rejection code.
 * ALL_IN is classified by amount: a call if the stack does not exceed the
 * amount to call, a bet if there is no bet yet, otherwise a raise (which must
 * be open to the player, rule 6).
 */
export function resolveIntent(state: HandState, p: HandPlayerState, intent: unknown): ResolvedAction | HandRejection {
  if (typeof intent !== 'object' || intent === null) return reject('UNKNOWN_ACTION', 'Malformed action');
  const type = (intent as { type?: unknown }).type;
  if (typeof type !== 'string' || !ACTION_TYPES.includes(type as ActionType)) {
    return reject('UNKNOWN_ACTION', 'Unknown action type');
  }
  const amount = (intent as { amount?: unknown }).amount;
  const legal = computeLegalActions(state, p);
  const contrib = p.streetContribution;
  switch (type as ActionType) {
    case 'FOLD':
      return { intent: 'FOLD', action: 'FOLD', to: contrib };
    case 'CHECK':
      if (!legal.canCheck) return reject('CHECK_NOT_ALLOWED', 'Cannot check facing a bet');
      return { intent: 'CHECK', action: 'CHECK', to: contrib };
    case 'CALL':
      if (!legal.canCall) return reject('CALL_NOT_ALLOWED', 'There is no bet to call');
      return { intent: 'CALL', action: 'CALL', to: contrib + legal.callAmount };
    case 'BET': {
      if (!legal.canBet) return reject('BET_NOT_ALLOWED', 'Cannot bet when there is already a bet; raise instead');
      const bad = validateAmount(amount, legal.minTo, legal.maxTo);
      return bad ?? { intent: 'BET', action: 'BET', to: amount as number };
    }
    case 'RAISE': {
      if (!legal.canRaise) {
        return reject(
          'RAISE_NOT_ALLOWED',
          state.currentBet === 0 ? 'There is no bet to raise' : 'Raising is not allowed',
        );
      }
      const bad = validateAmount(amount, legal.minTo, legal.maxTo);
      return bad ?? { intent: 'RAISE', action: 'RAISE', to: amount as number };
    }
    case 'ALL_IN': {
      if (legal.allInTo <= state.currentBet) return { intent: 'ALL_IN', action: 'CALL', to: legal.allInTo };
      if (legal.canBet) return { intent: 'ALL_IN', action: 'BET', to: legal.allInTo };
      if (legal.canRaise) return { intent: 'ALL_IN', action: 'RAISE', to: legal.allInTo };
      return reject('RAISE_NOT_ALLOWED', 'Raising is not re-opened by an incomplete raise; call or fold');
    }
  }
}
