import { effectivePlayerCount } from '@jpb/seating-engine';
import type { TableId, TableSummary } from '@jpb/shared-types';

/**
 * Table to break: among ACTIVE tables with no players in transit TO them
 * (reservedSeats empty — breaking such a table would strand those players),
 * the one with the fewest effective players; ties → highest tableNumber.
 * Null when no such table exists (the break is deferred).
 */
export function selectTableToBreak(tables: readonly TableSummary[]): TableId | null {
  let best: TableSummary | null = null;
  let bestCount = 0;
  for (const t of tables) {
    if (t.status !== 'ACTIVE' || t.reservedSeats.length > 0) continue;
    const count = effectivePlayerCount(t);
    if (best === null || count < bestCount || (count === bestCount && t.tableNumber > best.tableNumber)) {
      best = t;
      bestCount = count;
    }
  }
  return best === null ? null : best.tableId;
}
