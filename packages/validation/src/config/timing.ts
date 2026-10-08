import { z } from 'zod';
import { CONFIG_LIMITS } from '../constants';
import { WHEN_VALID, intInRange } from '../primitives';

const actionSeconds = () => intInRange(CONFIG_LIMITS.MIN_ACTION_TIMER_SECONDS, CONFIG_LIMITS.MAX_ACTION_TIMER_SECONDS);

/** Timing: action timer 1..300 s, grace 0..5000 ms, delays bounded, away timer <= action timer. */
export const timingConfigSchema = z
  .strictObject({
    actionTimerSeconds: actionSeconds(),
    awayActionTimerSeconds: actionSeconds(),
    awayAfterTimeouts: intInRange(1, CONFIG_LIMITS.MAX_AWAY_AFTER_TIMEOUTS),
    actionGraceMs: intInRange(0, CONFIG_LIMITS.MAX_ACTION_GRACE_MS),
    timeoutBehavior: z.literal('CHECK_ELSE_FOLD'),
    betweenHandsDelayMs: intInRange(0, CONFIG_LIMITS.MAX_BETWEEN_HANDS_DELAY_MS),
    showdownDelayMs: intInRange(0, CONFIG_LIMITS.MAX_SHOWDOWN_DELAY_MS),
    startCountdownSeconds: intInRange(0, CONFIG_LIMITS.MAX_START_COUNTDOWN_SECONDS),
  })
  .superRefine((t, ctx) => {
    if (t.awayActionTimerSeconds > t.actionTimerSeconds) {
      ctx.addIssue({
        code: 'custom',
        path: ['awayActionTimerSeconds'],
        message: `The away timer (${t.awayActionTimerSeconds}s) must not be longer than the action timer (${t.actionTimerSeconds}s).`,
      });
    }
  }, WHEN_VALID);
