import { z } from 'zod';
import { CONFIG_LIMITS } from '../constants';
import { WHEN_VALID, intInRange, weightSchema } from '../primitives';

/** `untilLevel` is checked against the schedule by the cross-field checks. */
export const lateRegistrationConfigSchema = z.strictObject({
  enabled: z.boolean(),
  untilLevel: intInRange(0, CONFIG_LIMITS.MAX_BLIND_LEVELS),
});

export const reentryConfigSchema = z
  .strictObject({
    enabled: z.boolean(),
    maxEntriesPerPlayer: intInRange(1, CONFIG_LIMITS.MAX_ENTRIES_PER_PLAYER),
    untilLevel: intInRange(0, CONFIG_LIMITS.MAX_BLIND_LEVELS),
  })
  .superRefine((r, ctx) => {
    if (r.enabled && r.maxEntriesPerPlayer < 2) {
      ctx.addIssue({
        code: 'custom',
        path: ['maxEntriesPerPlayer'],
        message: 'With re-entry enabled, allow at least 2 entries per player (the first entry counts).',
      });
    }
  }, WHEN_VALID);

export const spectatorConfigSchema = z.strictObject({
  enabled: z.boolean(),
  allowEliminatedPlayers: z.boolean(),
  publicWatch: z.boolean(),
  delaySeconds: intInRange(0, CONFIG_LIMITS.MAX_SPECTATOR_DELAY_SECONDS),
});

const weight = () => weightSchema(CONFIG_LIMITS.MAX_WEIGHT);

export const balancingConfigSchema = z.strictObject({
  maxImbalance: intInRange(1, CONFIG_LIMITS.MAX_IMBALANCE),
  recentMoveWindowHands: intInRange(0, CONFIG_LIMITS.MAX_RECENT_MOVE_WINDOW_HANDS),
  weights: z.strictObject({
    position: weight(),
    blindFairness: weight(),
    recentMove: weight(),
    seatCompatibility: weight(),
  }),
  consolidateBy: z.enum(['TARGET', 'MAX']),
});

export const handForHandConfigSchema = z.strictObject({
  autoAtBubble: z.boolean(),
});

export const featureFlagsSchema = z.strictObject({
  spectatorMode: z.boolean(),
  advancedFairnessAudit: z.boolean(),
  lateRegistration: z.boolean(),
  soundEffects: z.boolean(),
  haptics: z.boolean(),
  broadcastDisplay: z.boolean(),
});
