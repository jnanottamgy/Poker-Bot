import { TABLE_SIZE_LIMITS } from '@jpb/shared-types';
import type { BalancingConfig, TableSizeConfig } from '@jpb/shared-types';

/** 'TARGET' sizes tables by targetSize, 'MAX' by maxSize (see computeTableCount). */
export type ConsolidateBy = BalancingConfig['consolidateBy'];

/** The scoring weights from BalancingConfig. */
export type SeatingWeights = BalancingConfig['weights'];

/** While more than finalTableSize players remain, play is spread over at least this many tables. */
export const MIN_TABLES_BEFORE_FINAL = 2;

function isPositiveInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 1;
}

/**
 * Throws RangeError when a TableSizeConfig cannot produce well-defined seating
 * math. Full user-facing validation lives in @jpb/validation; this guards the
 * mathematical preconditions only (programmer errors).
 */
export function assertTableSizeConfig(cfg: TableSizeConfig): void {
  const { targetSize, maxSize, minSize, finalTableSize } = cfg;
  if (!isPositiveInt(targetSize)) throw new RangeError(`targetSize must be a positive integer, got ${String(targetSize)}`);
  if (!isPositiveInt(maxSize)) throw new RangeError(`maxSize must be a positive integer, got ${String(maxSize)}`);
  if (!isPositiveInt(minSize)) throw new RangeError(`minSize must be a positive integer, got ${String(minSize)}`);
  if (!isPositiveInt(finalTableSize)) {
    throw new RangeError(`finalTableSize must be a positive integer, got ${String(finalTableSize)}`);
  }
  if (maxSize > TABLE_SIZE_LIMITS.ABSOLUTE_MAX_SEATS) {
    throw new RangeError(`maxSize ${maxSize} exceeds ABSOLUTE_MAX_SEATS ${TABLE_SIZE_LIMITS.ABSOLUTE_MAX_SEATS}`);
  }
  if (targetSize > maxSize) throw new RangeError(`targetSize ${targetSize} exceeds maxSize ${maxSize}`);
  if (minSize > maxSize) throw new RangeError(`minSize ${minSize} exceeds maxSize ${maxSize}`);
  if (finalTableSize > maxSize) throw new RangeError(`finalTableSize ${finalTableSize} exceeds maxSize ${maxSize}`);
}

/** Upper bound for a scoring weight; keeps every weighted sum finite (no Infinity/NaN in comparisons). */
export const MAX_WEIGHT = 1e9;

/** Throws RangeError unless every weight is a finite number in [0, MAX_WEIGHT]. */
export function assertWeights(weights: SeatingWeights): void {
  for (const [key, value] of Object.entries(weights)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_WEIGHT) {
      throw new RangeError(`weight ${key} must be a number in [0, ${MAX_WEIGHT}], got ${String(value)}`);
    }
  }
}

export function assertNonNegativeInt(name: string, n: number): void {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`${name} must be a non-negative safe integer, got ${String(n)}`);
}
