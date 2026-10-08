import { z } from 'zod';
import { CONFIG_LIMITS, CURRENCY_PATTERN } from '../constants';
import { WHEN_VALID, codeSchema, displayTextSchema, intInRange, moneyMinorSchema } from '../primitives';

export const prizePlaceSchema = z.strictObject({
  position: intInRange(1, CONFIG_LIMITS.MAX_PRIZE_PLACES),
  amountMinor: moneyMinorSchema,
  label: displayTextSchema({ max: CONFIG_LIMITS.PRIZE_LABEL_MAX_LENGTH }).optional(),
});

/**
 * Fixed prize table: positions 1, 2, …, N in array order; amounts are
 * non-negative integer minor units that never increase with position; the
 * total stays a safe integer.
 */
export const prizeStructureSchema = z
  .strictObject({
    currency: codeSchema(CURRENCY_PATTERN, 'Use a three-letter currency code such as INR.'),
    places: z.array(prizePlaceSchema).max(CONFIG_LIMITS.MAX_PRIZE_PLACES),
    notes: displayTextSchema({ min: 0, max: CONFIG_LIMITS.PRIZE_NOTES_MAX_LENGTH, multiline: true }).optional(),
  })
  .superRefine((p, ctx) => {
    let total = 0n;
    p.places.forEach((place, i) => {
      if (place.position !== i + 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['places', i, 'position'],
          message: `Prize positions must be 1, 2, 3, … in order: expected ${i + 1}, found ${place.position}.`,
        });
      }
      const prev = p.places[i - 1];
      if (prev !== undefined && place.amountMinor > prev.amountMinor) {
        ctx.addIssue({
          code: 'custom',
          path: ['places', i, 'amountMinor'],
          message: `Prizes must not increase with position: place ${i + 1} pays more than place ${i}.`,
        });
      }
      total += BigInt(place.amountMinor);
    });
    if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
      ctx.addIssue({ code: 'custom', path: ['places'], message: 'The total prize pool is too large to represent exactly.' });
    }
  }, WHEN_VALID);
