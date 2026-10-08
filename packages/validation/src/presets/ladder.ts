/**
 * "Nice number" grids used to build and scale blind schedules. All values
 * are integers; selection uses exact BigInt arithmetic (no floating point),
 * so results are identical on every platform.
 */

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

function decadeGrid(small: readonly number[], mantissas: readonly number[]): readonly number[] {
  const out: number[] = [...small];
  for (let scale = 1n; ; scale *= 10n) {
    for (const m of mantissas) {
      const value = BigInt(m) * scale;
      if (value > MAX_SAFE) return Object.freeze(out);
      out.push(Number(value));
    }
  }
}

/**
 * Big-blind ladder for generated schedules: 2, 3, 4, 6, then
 * {10, 15, 20, 30, 40, 60} × 10^k (k = 0, 1, 2, …): 100, 150, 200, 300, 400,
 * 600, 1000, 1500, … — about ×1.47 per rung, six rungs per decade.
 */
export const BIG_BLIND_LADDER: readonly number[] = decadeGrid([2, 3, 4, 6], [10, 15, 20, 30, 40, 60]);

/**
 * Finer grid used when scaling arbitrary schedules: 1, 2, 3, 4, 5, 6, 8, then
 * {10, 12, 15, 20, 25, 30, 40, 50, 60, 80} × 10^k. Contains every ladder rung.
 */
export const SCALING_GRID: readonly number[] = decadeGrid([1, 2, 3, 4, 5, 6, 8], [10, 12, 15, 20, 25, 30, 40, 50, 60, 80]);

/** Exact rational num/den (den > 0). */
export interface Ratio {
  num: bigint;
  den: bigint;
}

/** Index of the first grid value >= num/den, or grid.length. */
function lowerBound(grid: readonly number[], target: Ratio): number {
  let lo = 0;
  let hi = grid.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (BigInt(grid[mid]!) * target.den >= target.num) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/**
 * Index of the grid value nearest to num/den. Exact comparison
 * |g·den − num|; a tie goes to the larger value (round half up).
 */
export function nearestGridIndex(grid: readonly number[], target: Ratio): number {
  const upper = lowerBound(grid, target);
  if (upper === 0) return 0;
  if (upper === grid.length) return grid.length - 1;
  const above = BigInt(grid[upper]!) * target.den - target.num;
  const below = target.num - BigInt(grid[upper - 1]!) * target.den;
  return below < above ? upper - 1 : upper;
}

/** Index of the largest grid value <= limit, or -1. */
export function floorGridIndex(grid: readonly number[], limit: number): number {
  return lowerBound(grid, { num: BigInt(limit) + 1n, den: 1n }) - 1;
}
