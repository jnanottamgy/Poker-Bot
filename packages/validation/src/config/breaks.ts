import { z } from 'zod';
import type { BreakRule } from '@jpb/shared-types';
import { CONFIG_LIMITS } from '../constants';
import { WHEN_VALID, displayTextSchema, intInRange } from '../primitives';

/** A break: exactly one of `afterLevel` / `everyLevels`, a duration and an optional message. */
export const breakRuleSchema = z
  .strictObject({
    afterLevel: intInRange(1, CONFIG_LIMITS.MAX_BLIND_LEVELS).optional(),
    everyLevels: intInRange(1, CONFIG_LIMITS.MAX_BLIND_LEVELS).optional(),
    durationSeconds: intInRange(CONFIG_LIMITS.MIN_BREAK_SECONDS, CONFIG_LIMITS.MAX_BREAK_SECONDS),
    message: displayTextSchema({ max: CONFIG_LIMITS.BREAK_MESSAGE_MAX_LENGTH }).optional(),
  })
  .superRefine((b, ctx) => {
    const hasAfter = b.afterLevel !== undefined;
    const hasEvery = b.everyLevels !== undefined;
    if (hasAfter && hasEvery) {
      ctx.addIssue({
        code: 'custom',
        path: ['everyLevels'],
        message: 'Use either "after level" or "every N levels" for a break, not both.',
      });
    } else if (!hasAfter && !hasEvery) {
      ctx.addIssue({
        code: 'custom',
        path: ['afterLevel'],
        message: 'Choose when the break happens: after a specific level or every N levels.',
      });
    }
  }, WHEN_VALID);

export const breakRulesSchema = z.array(breakRuleSchema).max(CONFIG_LIMITS.MAX_BREAKS);

/**
 * True when `rule` schedules a break at the end of `level`:
 * `afterLevel === level`, or `level` is a positive multiple of `everyLevels`.
 */
export function breakMatchesLevel(rule: BreakRule, level: number): boolean {
  if (rule.afterLevel !== undefined) return rule.afterLevel === level;
  if (rule.everyLevels !== undefined && rule.everyLevels > 0) return level > 0 && level % rule.everyLevels === 0;
  return false;
}

/** The break taken at the end of `level` (first matching rule in array order), or null. */
export function breakAfterLevel(breaks: readonly BreakRule[], level: number): BreakRule | null {
  return breaks.find((b) => breakMatchesLevel(b, level)) ?? null;
}
