import { z } from 'zod';
import { CONFIG_LIMITS } from '../constants';
import { WHEN_VALID, chipsSchema, intInRange, positiveChipsSchema } from '../primitives';

/** One level: 0 < smallBlind <= bigBlind, ante >= 0, 1 s <= duration <= 24 h. */
export const blindLevelSchema = z
  .strictObject({
    level: intInRange(1, CONFIG_LIMITS.MAX_BLIND_LEVELS),
    smallBlind: positiveChipsSchema,
    bigBlind: positiveChipsSchema,
    ante: chipsSchema,
    durationSeconds: intInRange(CONFIG_LIMITS.MIN_LEVEL_SECONDS, CONFIG_LIMITS.MAX_LEVEL_SECONDS),
  })
  .superRefine((l, ctx) => {
    if (l.bigBlind < l.smallBlind) {
      ctx.addIssue({
        code: 'custom',
        path: ['bigBlind'],
        message: `The big blind (${l.bigBlind}) must be at least the small blind (${l.smallBlind}).`,
      });
    }
  }, WHEN_VALID);

/**
 * The schedule: 1..MAX_BLIND_LEVELS levels numbered 1, 2, …, N in array
 * order; big blinds never decrease from one level to the next.
 */
export const blindScheduleSchema = z
  .array(blindLevelSchema)
  .min(1, { error: 'The blind schedule needs at least one level.' })
  .max(CONFIG_LIMITS.MAX_BLIND_LEVELS)
  .superRefine((levels, ctx) => {
    levels.forEach((l, i) => {
      if (l.level !== i + 1) {
        ctx.addIssue({
          code: 'custom',
          path: [i, 'level'],
          message: `Levels must be numbered 1, 2, 3, … in order: expected ${i + 1}, found ${l.level}.`,
        });
      }
      const prev = levels[i - 1];
      if (prev !== undefined && l.bigBlind < prev.bigBlind) {
        ctx.addIssue({
          code: 'custom',
          path: [i, 'bigBlind'],
          message: `Big blinds must not decrease: level ${i + 1} (${l.bigBlind}) is below level ${i} (${prev.bigBlind}).`,
        });
      }
    });
  }, WHEN_VALID);

export const anteTypeSchema = z.enum(['NONE', 'BB_ANTE', 'ALL_PLAYERS']);
