import { z } from 'zod';
import { CONFIG_LIMITS } from '../constants';
import { WHEN_VALID, intInRange } from '../primitives';

const tableSize = () => intInRange(CONFIG_LIMITS.MIN_TABLE_SIZE, CONFIG_LIMITS.MAX_TABLE_SIZE);

/**
 * Table sizes: 2 <= minSize <= targetSize <= maxSize <= 10 and
 * 2 <= finalTableSize <= maxSize.
 */
export const tableSizeConfigSchema = z
  .strictObject({
    targetSize: tableSize(),
    maxSize: tableSize(),
    minSize: tableSize(),
    finalTableSize: tableSize(),
  })
  .superRefine((t, ctx) => {
    if (t.minSize > t.targetSize) {
      ctx.addIssue({
        code: 'custom',
        path: ['minSize'],
        message: `The minimum table size (${t.minSize}) must not exceed the target size (${t.targetSize}).`,
      });
    }
    if (t.targetSize > t.maxSize) {
      ctx.addIssue({
        code: 'custom',
        path: ['targetSize'],
        message: `The target table size (${t.targetSize}) must not exceed the maximum size (${t.maxSize}).`,
      });
    }
    if (t.finalTableSize > t.maxSize) {
      ctx.addIssue({
        code: 'custom',
        path: ['finalTableSize'],
        message: `The final table size (${t.finalTableSize}) must not exceed the maximum table size (${t.maxSize}).`,
      });
    }
  }, WHEN_VALID);
