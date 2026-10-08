import type { TableId } from '@jpb/shared-types';
import type { Draft } from './draft';
import { alert, mustTable, tableCommand } from './draft';

/**
 * CHIP CONSERVATION (normative):
 *   expectedTotal = Σ starting stacks of all entries + Σ audited adjustments − chips removed by disqualification
 *   actualTotal   = Σ chips at tables (incrementally tracked) + Σ stacks of players in transit
 * Per table: a HAND_RESULT's totalChipsAtTable must equal the chips the
 * director tracked for that table (no chips may appear or vanish in a hand).
 * Any mismatch raises a CRITICAL alert and holds the offending table(s).
 */
export function inTransitChips(d: Draft): number {
  let sum = 0;
  for (const m of Object.values(d.s.pendingMoves)) if (m.status === 'SEATING' && m.stack !== null) sum += m.stack;
  return sum;
}

export function checkGlobal(d: Draft, offending: TableId[] = []): void {
  const expected = d.s.counters.totalChips;
  const actual = d.s.chipsAtTables + inTransitChips(d);
  const ok = expected === actual && offending.length === 0;
  d.s.integrity = { ok, expectedTotal: expected, actualTotal: actual, checkedAt: d.now, offendingTables: offending };
  if (expected !== actual) alert(d, 'CRITICAL', 'CHIP_CONSERVATION_FAILED', `Expected ${expected} chips in play, found ${actual}.`, offending[0] ?? null);
}

/** Per-table check on HAND_RESULT. Returns true when the table is consistent. */
export function checkTableReport(d: Draft, tableId: TableId, reported: number): boolean {
  const t = mustTable(d, tableId);
  if (t.chips === reported) return true;
  alert(d, 'CRITICAL', 'CHIP_CONSERVATION_FAILED', `Table ${t.summary.tableNumber} reported ${reported} chips; ${t.chips} expected.`, tableId);
  tableCommand(d, tableId, { type: 'HOLD', reason: 'INTEGRITY' });
  return false;
}
