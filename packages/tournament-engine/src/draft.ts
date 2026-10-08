import type {
  CurrentBlinds,
  HoldReason,
  PlayerId,
  PlayerNotice,
  TableCommand,
  TableId,
  TableTimingState,
  TournamentEvent,
  TournamentStatus,
} from '@jpb/shared-types';
import { canTransitionTournament } from '@jpb/shared-types';
import { TableCountIndex } from '@jpb/balancing-engine';
import { bmGet, bmSetMany, bmValues } from './bucketMap';
import type { DirectorContext, DirectorEffect, DirectorPlayer, DirectorReply, DirectorState, DirectorTable } from './types';

/**
 * Mutable working copy for one director transition. The input state is never
 * mutated: player/table writes are buffered and flushed into new bucket maps
 * at the end; every other field is replaced, not edited in place.
 */
export interface Draft {
  s: DirectorState;
  readonly now: number;
  readonly ctx: DirectorContext;
  readonly index: TableCountIndex;
  readonly effects: DirectorEffect[];
  readonly events: TournamentEvent[];
  readonly players: Map<PlayerId, DirectorPlayer>;
  readonly tables: Map<TableId, DirectorTable>;
}

export class DirectorError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function fail(code: string, message: string): never {
  throw new DirectorError(code, message);
}

export const OK: DirectorReply = { ok: true, code: null, message: null };

export function beginDraft(state: DirectorState, ctx: DirectorContext): Draft {
  return {
    s: { ...state },
    now: ctx.now,
    ctx,
    index: ctx.index ?? buildTableIndex(state),
    effects: [],
    events: [],
    players: new Map(),
    tables: new Map(),
  };
}

/** Writes buffered players/tables into new bucket maps and emits PLAYER_CHANGED for each changed player. */
export function flushDraft(d: Draft): DirectorState {
  if (d.players.size) {
    d.s.players = bmSetMany(d.s.players, [...d.players.entries()]);
    for (const p of d.players.values()) d.effects.push({ type: 'PLAYER_CHANGED', player: p });
  }
  if (d.tables.size) d.s.tables = bmSetMany(d.s.tables, [...d.tables.entries()]);
  return d.s;
}

/** Rebuilds the table-count index from state (after recovery or a failed transition). */
export function buildTableIndex(state: DirectorState): TableCountIndex {
  const index = new TableCountIndex();
  for (const t of bmValues(state.tables)) if (t.summary.status !== 'CLOSED') index.upsert(t.summary);
  return index;
}

// ---------------------------------------------------------------- players & tables

export function getPlayer(d: Draft, playerId: PlayerId): DirectorPlayer | undefined {
  return d.players.get(playerId) ?? bmGet(d.s.players, playerId);
}

export function mustPlayer(d: Draft, playerId: PlayerId): DirectorPlayer {
  const p = getPlayer(d, playerId);
  if (!p) fail('PLAYER_NOT_FOUND', `Unknown player ${playerId}`);
  return p;
}

export function putPlayer(d: Draft, p: DirectorPlayer): void {
  d.players.set(p.playerId, p);
}

export function getTable(d: Draft, tableId: TableId): DirectorTable | undefined {
  return d.tables.get(tableId) ?? bmGet(d.s.tables, tableId);
}

export function mustTable(d: Draft, tableId: TableId): DirectorTable {
  const t = getTable(d, tableId);
  if (!t) fail('TABLE_NOT_FOUND', `Unknown table ${tableId}`);
  return t;
}

/** Stores a table and keeps the count index in sync. */
export function putTable(d: Draft, t: DirectorTable): void {
  d.tables.set(t.summary.tableId, t);
  if (t.summary.status === 'CLOSED') d.index.remove(t.summary.tableId);
  else d.index.upsert(t.summary);
}

/** Every table that is not CLOSED, in table-number order (O(tables): global operations only). */
export function openTables(d: Draft): DirectorTable[] {
  const seen = new Map<TableId, DirectorTable>();
  for (const t of bmValues(d.s.tables)) seen.set(t.summary.tableId, t);
  for (const [id, t] of d.tables) seen.set(id, t);
  return [...seen.values()].filter((t) => t.summary.status !== 'CLOSED').sort((a, b) => a.summary.tableNumber - b.summary.tableNumber);
}

// ---------------------------------------------------------------- outputs

export function tableCommand(d: Draft, tableId: TableId, command: TableCommand): void {
  d.s.seq = { ...d.s.seq, effect: d.s.seq.effect + 1 };
  d.effects.push({ type: 'TABLE_COMMAND', tableId, command, key: `${d.s.tournamentId}:E${d.s.seq.effect}` });
}

export function holdAll(d: Draft, reason: HoldReason): void {
  for (const t of openTables(d)) tableCommand(d, t.summary.tableId, { type: 'HOLD', reason });
}

export function releaseAll(d: Draft, reason: HoldReason): void {
  for (const t of openTables(d)) tableCommand(d, t.summary.tableId, { type: 'RELEASE', reason });
}

export function notify(d: Draft, playerId: PlayerId, notice: PlayerNotice): void {
  d.effects.push({ type: 'NOTIFY_PLAYER', playerId, notice });
}

export function emit(d: Draft, event: TournamentEvent): void {
  d.events.push(event);
}

export function alert(d: Draft, severity: 'WARNING' | 'CRITICAL', code: string, detail: string, tableId: TableId | null): void {
  d.effects.push({ type: 'INTEGRITY_ALERT', severity, code, detail, tableId });
  emit(d, { kind: 'INTEGRITY_ALERT', severity, code, detail, tableId });
}

/** Status change guarded by TOURNAMENT_TRANSITIONS. */
export function transition(d: Draft, to: TournamentStatus, reason: string | null = null): void {
  const from = d.s.status;
  if (from === to) return;
  if (!canTransitionTournament(from, to)) fail('ILLEGAL_TRANSITION', `Cannot go from ${from} to ${to}`);
  d.s.status = to;
  emit(d, { kind: 'TOURNAMENT_STATUS_CHANGED', from, to, reason });
}

// ---------------------------------------------------------------- config helpers

export function tableTiming(d: Draft): TableTimingState {
  const t = d.s.config.timing;
  return {
    actionTimerMs: t.actionTimerSeconds * 1000,
    awayActionTimerMs: t.awayActionTimerSeconds * 1000,
    awayAfterTimeouts: t.awayAfterTimeouts,
    actionGraceMs: t.actionGraceMs,
    betweenHandsDelayMs: t.betweenHandsDelayMs,
    showdownDelayMs: t.showdownDelayMs,
  };
}

export function currentBlinds(d: Draft): CurrentBlinds {
  const schedule = d.s.config.blindSchedule;
  const level = schedule[Math.min(d.s.clock.levelIndex, schedule.length - 1)]!;
  return { level: level.level, smallBlind: level.smallBlind, bigBlind: level.bigBlind, ante: level.ante, anteType: d.s.config.anteType };
}

export const ZERO_STATS = { handsDealtAtTable: 0, handsSinceBigBlind: 0, handsSinceSmallBlind: 0, handsPlayedTotal: 0 } as const;
