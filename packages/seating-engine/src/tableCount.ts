import type { TableSizeConfig } from '@jpb/shared-types';
import { assertNonNegativeInt, assertTableSizeConfig, MIN_TABLES_BEFORE_FINAL } from './config';
import type { ConsolidateBy } from './config';

function ceilDiv(a: number, b: number): number {
  return Math.floor((a + b - 1) / b);
}

/**
 * Number of tables needed for `activePlayers` players.
 *
 *   active <= finalTableSize                     -> 1
 *   otherwise T = max( 2,                         (never consolidate to one table above the final-table size)
 *                      ceil(active / maxSize),    (hard: no table above maxSize)
 *                      min( ceil(active / d),     (d = targetSize for 'TARGET', maxSize for 'MAX')
 *                           floor(active / minSize) ) )   (soft: honour minSize when the hard rules allow)
 *
 * With the default config (target 8, max 9, min 2, final 9) this is exactly
 * the contract formula max(2, ceil(active / targetSize)).
 */
export function computeTableCount(activePlayers: number, cfg: TableSizeConfig, consolidateBy: ConsolidateBy): number {
  assertNonNegativeInt('activePlayers', activePlayers);
  assertTableSizeConfig(cfg);
  if (activePlayers <= cfg.finalTableSize) return 1;
  const divisor = consolidateBy === 'TARGET' ? cfg.targetSize : cfg.maxSize;
  const preferred = ceilDiv(activePlayers, divisor);
  const hardLower = ceilDiv(activePlayers, cfg.maxSize);
  const softUpper = Math.floor(activePlayers / cfg.minSize);
  return Math.max(MIN_TABLES_BEFORE_FINAL, hardLower, Math.min(preferred, softUpper));
}

/**
 * Balanced table sizes in descending order: the first (total mod T) tables get
 * floor(total / T) + 1 players, the rest floor(total / T). Hence
 * max - min <= 1 and the sum is exactly `totalPlayers`. Throws RangeError when
 * the players cannot fit (total > T * maxSize) or the inputs are not
 * non-negative integers.
 */
export function distributeSizes(totalPlayers: number, tableCount: number, maxSize: number): number[] {
  assertNonNegativeInt('totalPlayers', totalPlayers);
  assertNonNegativeInt('tableCount', tableCount);
  if (!Number.isSafeInteger(maxSize) || maxSize < 1) throw new RangeError(`maxSize must be a positive integer, got ${maxSize}`);
  if (tableCount === 0) {
    if (totalPlayers === 0) return [];
    throw new RangeError(`cannot seat ${totalPlayers} players at 0 tables`);
  }
  if (totalPlayers > tableCount * maxSize) {
    throw new RangeError(`cannot seat ${totalPlayers} players at ${tableCount} tables of at most ${maxSize}`);
  }
  const base = Math.floor(totalPlayers / tableCount);
  const remainder = totalPlayers - base * tableCount;
  const sizes = new Array<number>(tableCount);
  for (let i = 0; i < tableCount; i += 1) sizes[i] = i < remainder ? base + 1 : base;
  return sizes;
}
