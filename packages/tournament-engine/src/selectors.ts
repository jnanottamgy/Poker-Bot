import type { BlindClockState, PlayerId, PlayerSelfSummary, TournamentPublicSummary } from '@jpb/shared-types';
import { bmGet, bmValues } from './bucketMap';
import { currentLevel, levelRemainingMs, nextLevel } from './clock';
import type { DirectorPlayer, DirectorState, DirectorTable } from './types';

/** Public summary for players, spectators and displays. `lastSeq` is filled in by the host. */
export function tournamentSummary(state: DirectorState, lastSeq = 0): TournamentPublicSummary {
  const c = state.clock;
  const clock: BlindClockState = {
    levelIndex: c.levelIndex,
    levelStartedAt: c.levelStartedAt,
    levelEndsAt: c.levelEndsAt,
    pausedRemainingMs: c.pausedRemainingMs,
    breakEndsAt: c.breakEndsAt,
    pendingBreakAfterLevel: c.pendingBreakAfterLevel,
  };
  return {
    tournamentId: state.tournamentId,
    name: state.config.name,
    status: state.status,
    clock,
    currentLevel: state.clock.levelStartedAt === null && state.status !== 'RUNNING' ? state.config.blindSchedule[0] ?? null : currentLevel(state),
    nextLevel: nextLevel(state),
    counters: state.counters,
    handForHand: state.handForHand.enabled,
    lastSeq,
    serverSeedHash: state.serverSeedHash,
  };
}

export function getDirectorPlayer(state: DirectorState, playerId: PlayerId): DirectorPlayer | undefined {
  return bmGet(state.players, playerId);
}

export function getDirectorTable(state: DirectorState, tableId: string): DirectorTable | undefined {
  return bmGet(state.tables, tableId);
}

export function playerSelf(state: DirectorState, playerId: PlayerId): PlayerSelfSummary | null {
  const p = bmGet(state.players, playerId);
  if (!p) return null;
  const table = p.tableId ? bmGet(state.tables, p.tableId) : undefined;
  return {
    playerId: p.playerId,
    publicId: p.publicId,
    displayName: p.displayName,
    status: p.status,
    tableId: p.tableId,
    tableNumber: table?.summary.tableNumber ?? null,
    seat: p.seat,
    stack: table?.summary.seats.find((s) => s.playerId === playerId)?.stack ?? p.stack,
    finishPosition: p.finishPosition,
    prizeMinor: p.prizeMinor,
    handsPlayed: p.stats.handsPlayedTotal,
  };
}

const ACTIVE = new Set(['SEATED', 'SUSPENDED', 'IN_TRANSIT']);

export interface RankedPlayer {
  rank: number;
  player: DirectorPlayer;
  tableNumber: number | null;
}

/**
 * Leaderboards. "Current stack ranking" (active players by stack; ties by
 * registration order) is NOT the finishing order; "Finishing positions" lists
 * eliminated entries by their final position, followed by the champion.
 * O(N log N): hosts cache it and never compute it per action.
 */
export function leaderboard(state: DirectorState, mode: 'stack' | 'finish', offset = 0, limit = 50): { rows: RankedPlayer[]; total: number } {
  const all = bmValues(state.players);
  const tableNumber = (p: DirectorPlayer) => (p.tableId ? (bmGet(state.tables, p.tableId)?.summary.tableNumber ?? null) : null);
  if (mode === 'stack') {
    const active = all.filter((p) => ACTIVE.has(p.status)).sort((a, b) => b.stack - a.stack || a.registrationSeq - b.registrationSeq);
    return { total: active.length, rows: active.slice(offset, offset + limit).map((p, i) => ({ rank: offset + i + 1, player: p, tableNumber: tableNumber(p) })) };
  }
  const finished = all.filter((p) => p.finishPosition !== null).sort((a, b) => a.finishPosition! - b.finishPosition! || a.registrationSeq - b.registrationSeq);
  return { total: finished.length, rows: finished.slice(offset, offset + limit).map((p) => ({ rank: p.finishPosition!, player: p, tableNumber: tableNumber(p) })) };
}

export function openTableList(state: DirectorState): DirectorTable[] {
  return bmValues(state.tables)
    .filter((t) => t.summary.status !== 'CLOSED')
    .sort((a, b) => a.summary.tableNumber - b.summary.tableNumber);
}

export interface DirectorStats {
  averageStack: number;
  medianStack: number;
  chipLeader: { playerId: PlayerId; displayName: string; stack: number } | null;
  elapsedMs: number;
}

export function directorStats(state: DirectorState, now: number): DirectorStats {
  const stacks = bmValues(state.players).filter((p) => ACTIVE.has(p.status));
  const sorted = stacks.map((p) => p.stack).sort((a, b) => a - b);
  const leader = stacks.reduce<DirectorPlayer | null>((best, p) => (!best || p.stack > best.stack ? p : best), null);
  const paused = state.clock.pausedAt !== null ? now - state.clock.pausedAt : 0;
  return {
    averageStack: state.counters.active ? Math.round(state.counters.totalChips / state.counters.active) : 0,
    medianStack: sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 0,
    chipLeader: leader ? { playerId: leader.playerId, displayName: leader.displayName, stack: leader.stack } : null,
    elapsedMs: state.startedAt === null ? 0 : Math.max(0, (state.completedAt ?? now) - state.startedAt - state.clock.pausedTotalMs - paused),
  };
}

export { levelRemainingMs, currentLevel, nextLevel };
