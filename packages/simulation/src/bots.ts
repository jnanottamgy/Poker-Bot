import type { LegalActions, PlayerActionIntent } from '@jpb/shared-types';
import { uniformInt } from '@jpb/randomness';
import type { RandomSource } from '@jpb/randomness';

/**
 * Deterministic test agents (NOT AI): each decision is a fixed rule plus
 * draws from a seeded HMAC-DRBG stream, so a run is exactly reproducible.
 */
export type BotStrategy = 'ALWAYS_FOLD' | 'RANDOM_LEGAL_ACTION' | 'CALL_HEAVY' | 'RAISE_HEAVY' | 'ALL_IN_RANDOMLY' | 'TIMEOUT_ALWAYS';

export const BOT_STRATEGIES: readonly BotStrategy[] = ['ALWAYS_FOLD', 'RANDOM_LEGAL_ACTION', 'CALL_HEAVY', 'RAISE_HEAVY', 'ALL_IN_RANDOMLY', 'TIMEOUT_ALWAYS'];

function pct(rng: RandomSource, p: number): boolean {
  return uniformInt(rng, 100) < p;
}

function raiseTo(rng: RandomSource, legal: LegalActions): number {
  const span = legal.maxTo - legal.minTo;
  if (span <= 0) return legal.minTo;
  // Mostly small raises, occasionally big ones.
  const frac = pct(rng, 80) ? uniformInt(rng, 3) : uniformInt(rng, 101);
  return legal.minTo + Math.floor((span * frac) / 100);
}

function passive(legal: LegalActions): PlayerActionIntent {
  if (legal.canCheck) return { type: 'CHECK' };
  if (legal.canCall) return { type: 'CALL' };
  return { type: 'FOLD' };
}

/** Returns the bot's intent, or null to let the timer expire. */
export function decide(strategy: BotStrategy, legal: LegalActions, rng: RandomSource): PlayerActionIntent | null {
  switch (strategy) {
    case 'TIMEOUT_ALWAYS':
      return null;
    case 'ALWAYS_FOLD':
      return legal.canCheck ? { type: 'CHECK' } : { type: 'FOLD' };
    case 'CALL_HEAVY':
      if (legal.canRaise && pct(rng, 5)) return { type: 'RAISE', amount: legal.minTo };
      if (!legal.canCheck && legal.canCall && pct(rng, 10)) return { type: 'FOLD' };
      return passive(legal);
    case 'RAISE_HEAVY':
      if (legal.canBet && pct(rng, 50)) return { type: 'BET', amount: raiseTo(rng, legal) };
      if (legal.canRaise && pct(rng, 40)) return { type: 'RAISE', amount: raiseTo(rng, legal) };
      if (!legal.canCheck && pct(rng, 25)) return { type: 'FOLD' };
      return passive(legal);
    case 'ALL_IN_RANDOMLY':
      if (legal.canAllIn && pct(rng, 20)) return { type: 'ALL_IN' };
      if (!legal.canCheck && pct(rng, 40)) return { type: 'FOLD' };
      return passive(legal);
    case 'RANDOM_LEGAL_ACTION': {
      const options: PlayerActionIntent[] = [{ type: 'FOLD' }];
      if (legal.canCheck) options.push({ type: 'CHECK' }, { type: 'CHECK' });
      if (legal.canCall) options.push({ type: 'CALL' }, { type: 'CALL' });
      if (legal.canBet) options.push({ type: 'BET', amount: raiseTo(rng, legal) });
      if (legal.canRaise) options.push({ type: 'RAISE', amount: raiseTo(rng, legal) });
      if (legal.canAllIn) options.push({ type: 'ALL_IN' });
      return options[uniformInt(rng, options.length)]!;
    }
  }
}
