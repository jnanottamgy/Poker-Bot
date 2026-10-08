import type { TableId } from '@jpb/shared-types';
import type { Draft } from './draft';
import { emit, getTable, openTables, tableCommand } from './draft';
import { paidPlaces } from './prizes';
import { processBusts } from './eliminations';
import type { Bust } from './eliminations';
import { rebalance } from './balance';

/**
 * HAND-FOR-HAND (normative): every table holds after each hand; when all
 * tables are held the director releases them together for exactly one hand
 * (a "round"); busts of a round form ONE elimination batch, ranked when the
 * last table of the round reports. Enabled automatically at the bubble
 * (active == paid places + 1, more than one table) when configured, or by an
 * admin; disabled when the bubble bursts, at the final table, or by an admin.
 */
export function enableHandForHand(d: Draft, manual: boolean): void {
  if (d.s.handForHand.enabled) return;
  d.s.handForHand = { enabled: true, manual, phase: 'SYNCING', round: d.s.handForHand.round, awaiting: [], roundBusts: [] };
  for (const t of openTables(d)) tableCommand(d, t.summary.tableId, { type: 'SET_HAND_FOR_HAND', enabled: true });
  emit(d, { kind: 'HAND_FOR_HAND', enabled: true });
}

export function disableHandForHand(d: Draft): void {
  if (!d.s.handForHand.enabled) return;
  const busts = d.s.handForHand.roundBusts;
  d.s.handForHand = { enabled: false, manual: false, phase: 'OFF', round: d.s.handForHand.round, awaiting: [], roundBusts: [] };
  for (const t of openTables(d)) tableCommand(d, t.summary.tableId, { type: 'SET_HAND_FOR_HAND', enabled: false });
  emit(d, { kind: 'HAND_FOR_HAND', enabled: false });
  processBusts(d, busts);
}

/** Automatic bubble rule; call after eliminations and table changes. */
export function autoHandForHand(d: Draft): void {
  const hfh = d.s.handForHand;
  if (d.s.finalTable.formed || d.s.finalTable.forming) {
    if (hfh.enabled) disableHandForHand(d);
    return;
  }
  if (!d.s.config.handForHand.autoAtBubble || hfh.manual) return;
  const paid = paidPlaces(d.s.config.prizeStructure);
  if (paid === 0) return;
  // A field that already fits the final table forms it instead: the bubble is then played there.
  const fitsFinalTable = d.s.counters.active <= d.s.config.tables.finalTableSize;
  if (!hfh.enabled && d.s.counters.active === paid + 1 && d.s.counters.tables > 1 && !fitsFinalTable) enableHandForHand(d, false);
  else if (hfh.enabled && d.s.counters.active <= paid) disableHandForHand(d);
}

/** Records a table's completed hand in the current round. Returns true when the busts were taken by the round. */
export function recordRoundHand(d: Draft, tableId: TableId, busts: Bust[]): boolean {
  const hfh = d.s.handForHand;
  if (!hfh.enabled) return false;
  d.s.handForHand = { ...hfh, awaiting: hfh.awaiting.filter((t) => t !== tableId), roundBusts: [...hfh.roundBusts, ...busts] };
  return true;
}

/** Drives the round state machine (SYNCING → PLAYING → SYNCING …). */
export function progressHandForHand(d: Draft): void {
  const hfh = d.s.handForHand;
  if (!hfh.enabled) return;
  if (hfh.phase === 'PLAYING') {
    const stillAwaiting = hfh.awaiting.filter((id) => {
      const t = getTable(d, id);
      return t !== undefined && t.summary.status !== 'CLOSED';
    });
    if (stillAwaiting.length > 0) {
      d.s.handForHand = { ...hfh, awaiting: stillAwaiting };
      return;
    }
    const busts = hfh.roundBusts;
    d.s.handForHand = { ...hfh, phase: 'SYNCING', awaiting: [], roundBusts: [] };
    processBusts(d, busts);
    autoHandForHand(d);
    // Between rounds balancing is allowed again — also when the bubble just burst and
    // hand-for-hand ended (otherwise nothing would merge the remaining tables).
    rebalance(d);
    if (!d.s.handForHand.enabled) return;
  }
  if (d.s.handForHand.phase !== 'SYNCING') return;
  if (d.s.frozen || d.s.status !== 'RUNNING') return;
  const tables = openTables(d);
  const settled = tables.every((t) => !t.summary.inHand && (t.status === 'HELD' || t.status === 'WAITING'));
  if (!settled || Object.values(d.s.pendingMoves).some((m) => m.status === 'REMOVING')) return;
  const playable = tables.filter((t) => t.summary.seats.filter((s) => !s.movingOut).length >= 2).map((t) => t.summary.tableId);
  if (playable.length === 0) return;
  d.s.handForHand = { ...d.s.handForHand, phase: 'PLAYING', round: d.s.handForHand.round + 1, awaiting: playable };
  for (const id of playable) tableCommand(d, id, { type: 'RELEASE', reason: 'HAND_FOR_HAND' });
}
