import { planAfterHand } from '@jpb/balancing-engine';
import type { Draft } from './draft';
import { emit, mustTable, putTable } from './draft';
import { issueMove } from './moves';
import { beginFinalTable } from './finalTable';

/** Balancing runs only while play is structurally stable (not frozen, not forming the final table, not mid hand-for-hand round). */
export function balancingAllowed(d: Draft): boolean {
  if (d.s.frozen) return false;
  if (!['RUNNING', 'PAUSED', 'BREAK'].includes(d.s.status)) return false;
  if (d.s.finalTable.formed || d.s.finalTable.forming) return false;
  if (d.s.handForHand.enabled && d.s.handForHand.phase === 'PLAYING') return false;
  return d.s.counters.active >= 2;
}

/**
 * Runs the deterministic balancing planner (@jpb/balancing-engine planAfterHand,
 * documented in docs/SEATING_AND_BALANCING.md) and executes its plan.
 */
export function rebalance(d: Draft): void {
  if (!balancingAllowed(d)) return;
  const plan = planAfterHand({
    index: d.index,
    getTable: (id) => mustTable(d, id).summary,
    tableCfg: d.s.config.tables,
    balancing: d.s.config.balancing,
    activePlayers: d.s.counters.active,
    finalTableFormed: d.s.finalTable.formed,
  });
  for (const action of plan.actions) {
    if (action.type === 'FORM_FINAL_TABLE') {
      beginFinalTable(d);
      return;
    }
    if (action.type === 'BREAK_TABLE') {
      const t = mustTable(d, action.tableId);
      if (t.summary.status === 'ACTIVE') {
        putTable(d, { ...t, summary: { ...t.summary, status: 'BREAKING' } });
        emit(d, { kind: 'TABLE_BROKEN', tableId: t.summary.tableId, tableNumber: t.summary.tableNumber, playersMoved: t.summary.seats.length });
      }
      continue;
    }
    issueMove(d, {
      playerId: action.playerId,
      reason: action.reason,
      fromTableId: action.fromTableId,
      toTableId: action.toTableId,
      toSeat: action.toSeat,
      breakdown: action.breakdown,
    });
  }
}
