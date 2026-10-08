import type { LegalActions } from '@jpb/shared-types';

/** LegalActions with everything off; override what the case needs. */
export function legal(p: Partial<LegalActions> = {}): LegalActions {
  return {
    seat: 0,
    playerId: 'p',
    canFold: true,
    canCheck: false,
    canCall: false,
    callAmount: 0,
    canBet: false,
    canRaise: false,
    minTo: 0,
    maxTo: 0,
    canAllIn: false,
    allInTo: 0,
    currentBet: 0,
    contributedThisStreet: 0,
    stack: 10_000,
    pot: 1500,
    ...p,
  };
}
