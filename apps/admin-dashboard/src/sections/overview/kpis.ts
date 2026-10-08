import type { LiveMetricsPoint } from '@jpb/shared-types';
import type { StatDelta } from '@jpb/ui';
import { formatCount } from '@jpb/ui';

/** Documented on screen next to the estimate (ADMIN_CONTROL_ROOM §2.3). The server computes it. */
export const ETA_FORMULA = 'ETA = (players remaining − 1) ÷ eliminations per minute, measured over the last 30 minutes. Re-estimated continuously; breaks and pauses are not included.';

const WINDOW_MS = 10 * 60_000;

/** Last `n` values of a metric (sparklines). */
export function series(points: LiveMetricsPoint[] | undefined, key: keyof LiveMetricsPoint, n = 40): number[] {
  return (points ?? []).slice(-n).map((p) => p[key]);
}

/** Change of a metric over the last 10 minutes as a StatTile delta (arrow + text, never colour alone). */
export function delta(points: LiveMetricsPoint[] | undefined, key: keyof LiveMetricsPoint, goodWhenUp: boolean, unit = ''): StatDelta | undefined {
  if (!points || points.length < 2) return undefined;
  const last = points[points.length - 1]!;
  const ref = points.find((p) => p.at >= last.at - WINDOW_MS) ?? points[0]!;
  const d = last[key] - ref[key];
  const dir = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
  return {
    text: `${d > 0 ? '+' : d < 0 ? '−' : ''}${formatCount(Math.abs(Math.round(d)))}${unit}`,
    direction: dir,
    good: dir === 'flat' ? true : (dir === 'up') === goodWhenUp,
    context: 'last 10 min',
  };
}

/** Table counts grouped for the overview (keys of `tablesByStatus` are table statuses; see contract notes). */
export function tableBreakdown(byStatus: Record<string, number>) {
  const get = (k: string) => byStatus[k] ?? 0;
  return {
    active: get('IN_HAND') + get('BETWEEN_HANDS') + get('WAITING') + get('ACTIVE'),
    held: Math.max(0, get('HELD') - get('BREAKING')),
    breaking: get('BREAKING'),
    stalled: get('STALLED'),
    frozen: get('FROZEN'),
    closed: get('CLOSED'),
  };
}
