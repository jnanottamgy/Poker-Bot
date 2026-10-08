import type { EliminationRecord, PlayerId, TableId } from '@jpb/shared-types';
import { bmValues } from './bucketMap';
import type { Draft } from './draft';
import { emit, getPlayer, getTable, holdAll, notify, putPlayer, tableCommand, transition } from './draft';
import { cancelMove, pendingMoveFor } from './moves';
import { prizeAt, splitTiedPrizes } from './prizes';
import { positionsDeferred } from './registration';
import { fireMilestones } from './commentary';

export interface Bust {
  playerId: PlayerId;
  tableId: TableId;
  startingStack: number;
  handId: string;
  handNumber: number;
}

/**
 * RANKING (normative):
 * - All busts of one hand (or of one hand-for-hand round) form one batch.
 * - With R players remaining before the batch and k busting, the batch takes
 *   positions R-k+1 … R. Within the batch the player who started the hand
 *   with more chips finishes higher; equal starting stacks share the best
 *   position of their group (tiedCount) and split the prizes of the covered
 *   positions (remainder rule in prizes.ts).
 * - Later batches finish higher than earlier ones.
 * - While late registration or re-entry is open, positions are deferred (the
 *   field may still grow) and assigned in bust order when entries close.
 * - The last remaining player is 1st and the tournament completes.
 */
export function processBusts(d: Draft, busts: readonly Bust[]): void {
  const unique = busts.filter((b, i) => busts.findIndex((x) => x.playerId === b.playerId) === i && getPlayer(d, b.playerId)?.status !== 'ELIMINATED');
  if (unique.length === 0) return;
  const batchNo = d.s.seq.batch + 1;
  d.s.seq = { ...d.s.seq, batch: batchNo };
  const batchId = `${d.s.tournamentId}:B${batchNo}`;
  const remaining = d.s.counters.active;
  const deferred = positionsDeferred(d.s);
  const sorted = [...unique].sort((a, b) => b.startingStack - a.startingStack);
  let position = remaining - sorted.length + 1;
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1]!.startingStack === sorted[i]!.startingStack) j++;
    const group = sorted.slice(i, j + 1);
    const players = group.map((b) => getPlayer(d, b.playerId)!);
    const prizes = deferred ? group.map(() => 0) : splitTiedPrizes(d.s.config.prizeStructure, position, players.map((p) => p.registrationSeq));
    group.forEach((b, g) => {
      const p = players[g]!;
      const record: EliminationRecord = {
        playerId: p.playerId,
        entryId: p.entryId,
        finishPosition: deferred ? 0 : position,
        tiedCount: group.length,
        eliminatedAt: d.now,
        handId: b.handId,
        handNumber: b.handNumber,
        tableId: b.tableId,
        startingStackOfHand: b.startingStack,
        batchId,
      };
      const move = pendingMoveFor(d, p.playerId);
      if (move) cancelMove(d, move);
      d.s.bustSeq += 1;
      putPlayer(d, {
        ...p,
        status: 'ELIMINATED',
        stack: 0,
        tableId: null,
        seat: null,
        finishPosition: deferred ? null : position,
        tiedCount: deferred ? 1 : group.length,
        prizeMinor: prizes[g]!,
        elimination: record,
        pendingBustOrder: deferred ? d.s.bustSeq : null,
      });
      d.s.counters = { ...d.s.counters, active: d.s.counters.active - 1, eliminated: d.s.counters.eliminated + 1 };
      emit(d, { kind: 'PLAYER_ELIMINATED', record, displayName: p.displayName, playersRemaining: d.s.counters.active });
      if (!deferred) {
        notify(d, p.playerId, {
          kind: 'ELIMINATED',
          finishPosition: position,
          tiedCount: group.length,
          handsPlayed: p.stats.handsPlayedTotal,
          prizeMinor: prizes[g]!,
          currency: d.s.config.prizeStructure.currency,
        });
      }
    });
    position += group.length;
    i = j + 1;
  }
  fireMilestones(d);
  if (d.s.counters.active === 1) completeTournament(d);
}

/** Positions deferred during late registration are assigned once entries close (bust order: later = better). */
export function assignDeferredPositions(d: Draft): void {
  if (positionsDeferred(d.s)) return;
  const pending = bmValues(d.s.players)
    .map((p) => d.players.get(p.playerId) ?? p)
    .filter((p) => p.status === 'ELIMINATED' && p.finishPosition === null && p.pendingBustOrder !== null)
    .sort((a, b) => b.pendingBustOrder! - a.pendingBustOrder!);
  let position = d.s.counters.active + 1;
  for (const p of pending) {
    const prize = prizeAt(d.s.config.prizeStructure, position);
    putPlayer(d, { ...p, finishPosition: position, tiedCount: 1, prizeMinor: prize, pendingBustOrder: null, elimination: p.elimination ? { ...p.elimination, finishPosition: position } : null });
    notify(d, p.playerId, { kind: 'ELIMINATED', finishPosition: position, tiedCount: 1, handsPlayed: p.stats.handsPlayedTotal, prizeMinor: prize, currency: d.s.config.prizeStructure.currency });
    position += 1;
  }
}

/** Disqualification (normative): chips leave play; the player takes the worst remaining position, without prize. */
export function disqualified(d: Draft, playerId: PlayerId, tableId: TableId, stack: number): void {
  const p = getPlayer(d, playerId);
  if (!p) return;
  const position = d.s.counters.active;
  d.s.counters = { ...d.s.counters, active: d.s.counters.active - 1, eliminated: d.s.counters.eliminated + 1, totalChips: d.s.counters.totalChips - stack };
  d.s.chipsRemoved += stack;
  const batchNo = d.s.seq.batch + 1;
  d.s.seq = { ...d.s.seq, batch: batchNo };
  const record: EliminationRecord = {
    playerId,
    entryId: p.entryId,
    finishPosition: position,
    tiedCount: 1,
    eliminatedAt: d.now,
    handId: '',
    handNumber: 0,
    tableId,
    startingStackOfHand: stack,
    batchId: `${d.s.tournamentId}:B${batchNo}`,
  };
  putPlayer(d, { ...p, status: 'DISQUALIFIED', stack: 0, tableId: null, seat: null, finishPosition: position, tiedCount: 1, prizeMinor: 0, elimination: record });
  emit(d, { kind: 'PLAYER_ELIMINATED', record, displayName: p.displayName, playersRemaining: d.s.counters.active });
  if (d.s.counters.active === 1) completeTournament(d);
}

export function completeTournament(d: Draft): void {
  const winner = bmValues(d.s.players)
    .map((p) => d.players.get(p.playerId) ?? p)
    .find((p) => p.status === 'SEATED' || p.status === 'SUSPENDED' || p.status === 'IN_TRANSIT');
  if (!winner) return;
  const prize = prizeAt(d.s.config.prizeStructure, 1);
  putPlayer(d, { ...winner, finishPosition: 1, tiedCount: 1, prizeMinor: prize });
  d.s.winnerId = winner.playerId;
  d.s.completedAt = d.now;
  if (d.s.status === 'PAUSED') d.s.pausedFrom = null;
  transition(d, 'COMPLETED', 'champion decided');
  holdAll(d, 'ADMIN');
  if (winner.tableId) tableCommand(d, winner.tableId, { type: 'CLOSE' });
  const table = winner.tableId ? getTable(d, winner.tableId) : undefined;
  notify(d, winner.playerId, { kind: 'CHAMPION', playersInField: d.s.counters.registered, stack: table?.summary.seats.find((s) => s.playerId === winner.playerId)?.stack ?? winner.stack });
  emit(d, { kind: 'TOURNAMENT_COMPLETED', winnerId: winner.playerId, winnerName: winner.displayName, completedAt: d.now });
}
