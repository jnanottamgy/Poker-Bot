import type { TournamentEvent, TournamentEventEnvelope } from '@jpb/shared-types';
import {
  bmGet,
  bmSet,
  bmValues,
  buildTableIndex,
  createDirectorState,
  directorReduce,
  directorStats,
  emptyBucketMap,
  getDirectorPlayer,
  leaderboard,
  nextTickAt,
  openTableList,
  playerSelf,
  tournamentSummary,
} from '@jpb/tournament-engine';
import type { BucketMap, CreateDirectorInput, DirectorEffect, DirectorInput, DirectorReply, DirectorState } from '@jpb/tournament-engine';
import type { TableCountIndex } from '@jpb/balancing-engine';
import { drawSource } from '@jpb/fairness-engine/node';
import { scoreSeatsForIncoming } from '@jpb/seating-engine';
import type { ActorDefinition, ActorEnvelope, OutboxMessage, StepResult, TimerRequest } from '../runtime/actor';
import { noopResult, stepResult } from '../runtime/actor';
import { channels } from '../bus/bus';
import type { PlayerChannelMessage, TournamentEventMessage } from '../runtime/contracts';
import type { Repos } from '../persistence/store';
import { newId } from '../security/ids';
import { OUTBOX_KICK_CHANNEL } from './messages';
import type { ToTable } from './messages';

/** Audit metadata carried by admin inputs; written in the same transaction as the change. */
export interface AuditMeta {
  adminId: string;
  adminUsername: string;
  action: string;
  target: string;
  reason: string | null;
  ip: string | null;
}

export interface DirectorActorState {
  tournamentId: string;
  director: DirectorState | null;
  /** Highest report sequence applied per table (idempotent re-delivery). */
  reportSeqs: BucketMap<number>;
  /** Tournament event sequence (gap-free). */
  eventSeq: number;
}

export type DirectorQuery =
  | { q: 'SUMMARY' }
  | { q: 'STATE' }
  | { q: 'PLAYER_SELF'; playerId: string }
  | { q: 'PLAYER'; playerId: string }
  | { q: 'LEADERBOARD'; mode: 'stack' | 'finish'; offset: number; limit: number }
  | { q: 'TABLES' }
  | { q: 'FEATURED' }
  | { q: 'HEALTH' }
  | { q: 'SEAT_SCORES'; tableId: string; playerId: string }
  | { q: 'OVERVIEW' };

export type DirectorActorCommand =
  | { kind: 'CREATE'; input: CreateDirectorInput }
  | { kind: 'INPUT'; input: DirectorInput; audit?: AuditMeta }
  | { kind: 'REPORT'; tableId: string; rseq: number; input: DirectorInput }
  /** Reports from many tables applied in order in one command (and one transaction): see OutboxDispatcher. */
  | { kind: 'REPORTS'; reports: Array<{ tableId: string; rseq: number; input: DirectorInput }> }
  | { kind: 'TICK' }
  | { kind: 'QUERY'; query: DirectorQuery };

export type DirectorActorReply = DirectorReply & { data?: unknown; duplicate?: boolean };

const OK: DirectorActorReply = { ok: true, code: null, message: null };

export interface DirectorActorDeps {
  seedFor(tournamentId: string): string;
  snapshotEvery: number;
}

function auditSnapshot(s: DirectorState | null) {
  if (!s) return null;
  return { status: s.status, frozen: s.frozen, level: s.config.blindSchedule[s.clock.levelIndex]?.level ?? null, counters: s.counters, handForHand: s.handForHand.enabled };
}

export function createDirectorActorDefinition(deps: DirectorActorDeps): ActorDefinition<DirectorActorState, DirectorActorCommand, DirectorActorReply> {
  // The table-count index is derived data; it is cached per state object and rebuilt when missing.
  const indexes = new WeakMap<DirectorState, TableCountIndex>();
  const indexFor = (s: DirectorState) => {
    let i = indexes.get(s);
    if (!i) {
      i = buildTableIndex(s);
      indexes.set(s, i);
    }
    return i;
  };

  function step(state: DirectorActorState, env: ActorEnvelope<DirectorActorCommand>): StepResult<DirectorActorState, DirectorActorReply> {
    const c = env.command;
    if (c.kind === 'QUERY') return noopResult(state, query(state, c.query, env.at));
    if (c.kind === 'CREATE') {
      if (state.director) return noopResult(state, { ...OK, duplicate: true });
      const director = createDirectorState(c.input);
      return stepResult({ ...state, director }, OK, {
        projection: async (repos) => {
          await repos.tournaments.setCounters(state.tournamentId, { registered: 0, active: 0, eliminated: 0, tables: 0, handsCompleted: 0 });
        },
      });
    }
    if (!state.director) return noopResult(state, { ok: false, code: 'NOT_CREATED', message: 'Tournament director not initialized.' });
    const b = newBatch(state);
    if (c.kind === 'REPORT' || c.kind === 'REPORTS') {
      // Reports already applied (re-delivery after a lost acknowledgement) are skipped one by one.
      for (const r of c.kind === 'REPORT' ? [c] : c.reports) {
        if (r.rseq <= (bmGet(b.state.reportSeqs, r.tableId) ?? 0)) continue;
        apply(b, env, r.input, { tableId: r.tableId, rseq: r.rseq });
      }
      if (!b.changed) return noopResult(state, { ...OK, duplicate: true });
      return finish(b, env, OK, null);
    }
    const input: DirectorInput = c.kind === 'TICK' ? { type: 'TICK' } : c.input;
    const reply = apply(b, env, input, null);
    if (!reply.ok) return noopResult(state, reply);
    return finish(b, env, OK, c.kind === 'INPUT' ? (c.audit ?? null) : null);
  }

  /** Accumulated effects of one or more director inputs applied in order within one command. */
  interface Batch {
    first: DirectorActorState;
    state: DirectorActorState;
    changed: boolean;
    events: TournamentEvent[];
    envelopes: TournamentEventEnvelope[];
    toTables: Array<{ targetKind: string; targetId: string; payload: ToTable }>;
    notices: OutboxMessage[];
    /** Net TICK timer directive of the whole batch (the last one wins). */
    tick: { at: number | null } | null;
    changedPlayers: Set<string>;
    alerts: Array<Extract<DirectorEffect, { type: 'INTEGRITY_ALERT' }>>;
    createdTables: Array<Extract<DirectorEffect, { type: 'CREATE_TABLE' }>>;
  }

  function newBatch(state: DirectorActorState): Batch {
    return { first: state, state, changed: false, events: [], envelopes: [], toTables: [], notices: [], tick: null, changedPlayers: new Set(), alerts: [], createdTables: [] };
  }

  /** Applies one input to the batch. A rejected input changes nothing, except that a report still advances its dedupe mark. */
  function apply(b: Batch, env: ActorEnvelope<DirectorActorCommand>, input: DirectorInput, report: { tableId: string; rseq: number } | null): DirectorReply {
    const state = b.state;
    const before = state.director!;
    const index = indexFor(before);
    let tr;
    try {
      tr = directorReduce(before, input, {
        now: env.at,
        index,
        drawSource: (purpose, publicEntropy) => drawSource({ serverSeed: deps.seedFor(state.tournamentId), tournamentId: state.tournamentId, purpose, publicEntropy }),
      });
    } catch (err) {
      indexes.delete(before);
      throw err;
    }
    if (!tr.reply.ok) {
      indexes.delete(before);
      if (report) {
        b.state = { ...state, reportSeqs: bmSet(state.reportSeqs, report.tableId, report.rseq) };
        b.changed = true;
      }
      return tr.reply;
    }
    const director = tr.state;
    indexes.delete(before);
    indexes.set(director, index);

    let eventSeq = state.eventSeq;
    for (const event of tr.events) {
      b.envelopes.push({ tournamentId: state.tournamentId, seq: ++eventSeq, at: env.at, event });
      b.events.push(event);
    }
    b.state = { ...state, director, eventSeq, reportSeqs: report ? bmSet(state.reportSeqs, report.tableId, report.rseq) : state.reportSeqs };
    b.changed = true;

    for (const e of tr.effects) {
      switch (e.type) {
        case 'CREATE_TABLE':
          b.createdTables.push(e);
          b.toTables.push({
            targetKind: 'table',
            targetId: e.tableId,
            payload: {
              dseq: 0,
              command: {
                type: 'INIT',
                input: { tableId: e.tableId, tournamentId: state.tournamentId, tableNumber: e.tableNumber, maxSeats: e.maxSeats, timing: e.timing, blinds: e.blinds, initialButtonSeat: e.initialButtonSeat, createdAt: env.at },
                publicEntropy: director.publicEntropy ?? '',
                serverSeedHash: director.serverSeedHash,
              },
            },
          });
          break;
        case 'TABLE_COMMAND': {
          const dseq = Number(e.key.slice(e.key.lastIndexOf(':E') + 2));
          b.toTables.push({ targetKind: 'table', targetId: e.tableId, payload: { dseq, command: e.command } });
          break;
        }
        case 'NOTIFY_PLAYER':
          b.notices.push({ channel: channels.player(e.playerId), message: { kind: 'NOTICE', notice: e.notice } satisfies PlayerChannelMessage });
          break;
        case 'SCHEDULE_TICK':
          b.tick = { at: e.at };
          break;
        case 'INTEGRITY_ALERT':
          b.alerts.push(e);
          break;
        case 'PLAYER_CHANGED':
          b.changedPlayers.add(e.player.playerId);
          break;
      }
    }
    return tr.reply;
  }

  /** One state transition, one transaction and one set of messages for everything the batch did. */
  function finish(b: Batch, env: ActorEnvelope<DirectorActorCommand>, reply: DirectorActorReply, audit: AuditMeta | null): StepResult<DirectorActorState, DirectorActorReply> {
    const state = b.first;
    const before = state.director!;
    const director = b.state.director!;
    const timers: TimerRequest[] = [];
    const cancelTimers: string[] = [];
    if (b.tick) {
      if (b.tick.at === null) cancelTimers.push('TICK');
      else timers.push({ key: 'TICK', at: b.tick.at, token: String(b.tick.at) });
    }
    const bus: OutboxMessage[] = [...b.notices];
    const changedPlayers = [...b.changedPlayers];
    for (const pid of changedPlayers) {
      const self = playerSelf(director, pid);
      if (self) bus.push({ channel: channels.player(pid), message: { kind: 'SELF_UPDATE', self } satisfies PlayerChannelMessage });
    }
    const summary = b.envelopes.length ? tournamentSummary(director, b.state.eventSeq) : null;
    for (const envelope of b.envelopes) {
      bus.push({ channel: channels.tournamentEvents(state.tournamentId), message: { kind: 'TOURNAMENT_EVENT', tournamentId: state.tournamentId, envelope, summary: summary! } satisfies TournamentEventMessage });
    }
    for (const a of b.alerts) bus.push({ channel: channels.admin(state.tournamentId), message: { kind: 'ALERT', alert: a } });
    if (b.toTables.length) bus.push({ channel: OUTBOX_KICK_CHANNEL, message: { sourceKind: 'director', sourceId: state.tournamentId } });

    const { createdTables, toTables, events, alerts } = b;
    const projection = async (repos: Repos) => {
      for (const t of createdTables) {
        await repos.tableLogs.createTable({ id: t.tableId, tournamentId: state.tournamentId, tableNumber: t.tableNumber, maxSeats: t.maxSeats, status: 'WAITING', isFinalTable: t.isFinalTable });
      }
      if (toTables.length) await repos.outbox.add('director', state.tournamentId, toTables);
      await projectPlayers(repos, director, changedPlayers);
      await projectEvents(repos, state.tournamentId, director, events, env.at);
      if (before.counters !== director.counters || before.status !== director.status) {
        await repos.tournaments.setCounters(state.tournamentId, {
          registered: director.counters.registered,
          active: director.counters.active,
          eliminated: director.counters.eliminated,
          tables: director.counters.tables,
          handsCompleted: director.counters.handsCompleted,
        });
      }
      for (const a of alerts) {
        const target = a.tableId ? `table:${a.tableId}` : null;
        const code = (['CHIP_CONSERVATION_FAILED', 'INVARIANT_VIOLATION', 'TABLE_STALLED'].includes(a.code) ? a.code : 'INVARIANT_VIOLATION') as 'INVARIANT_VIOLATION';
        if (!(await repos.alerts.findOpen(state.tournamentId, code, target))) {
          await repos.alerts.create({ id: newId('alt'), tournamentId: state.tournamentId, severity: a.severity, code, message: `${a.code}: ${a.detail}`, target });
        }
      }
      if (audit) {
        await repos.audit.append({
          id: newId('aud'),
          at: env.at,
          tournamentId: state.tournamentId,
          adminId: audit.adminId,
          adminUsername: audit.adminUsername,
          action: audit.action,
          target: audit.target,
          reason: audit.reason,
          beforeState: auditSnapshot(before),
          afterState: { ...auditSnapshot(director), input: env.command.kind === 'INPUT' ? env.command.input : null },
          ip: audit.ip,
        });
      }
    };

    return stepResult(b.state, reply, {
      events: b.envelopes.map((e) => ({ seq: e.seq, version: e.seq, at: e.at, kind: e.event.kind, visibility: 'PUBLIC', privateTo: null, payload: e.event })),
      timers,
      cancelTimers,
      outbox: bus,
      projection,
    });
  }

  function query(state: DirectorActorState, q: DirectorQuery, now: number): DirectorActorReply {
    const d = state.director;
    if (!d) return { ...OK, data: null };
    switch (q.q) {
      case 'SUMMARY':
        return { ...OK, data: tournamentSummary(d, state.eventSeq) };
      case 'STATE':
        return { ...OK, data: d };
      case 'PLAYER_SELF':
        return { ...OK, data: playerSelf(d, q.playerId) };
      case 'PLAYER': {
        const p = getDirectorPlayer(d, q.playerId);
        const move = p ? Object.values(d.pendingMoves).find((m) => m.playerId === p.playerId) ?? null : null;
        return { ...OK, data: p ? { player: p, pendingMove: move } : null };
      }
      case 'LEADERBOARD': {
        const lb = leaderboard(d, q.mode, q.offset, q.limit);
        return { ...OK, data: { total: lb.total, rows: lb.rows.map((r) => ({ rank: r.rank, tableNumber: r.tableNumber, player: r.player })) } };
      }
      case 'TABLES':
        return { ...OK, data: openTableList(d) };
      case 'SEAT_SCORES': {
        const table = bmGet(d.tables, q.tableId);
        const player = getDirectorPlayer(d, q.playerId);
        if (!table || table.summary.status === 'CLOSED' || !player) return { ...OK, data: null };
        const choices = scoreSeatsForIncoming(table.summary, { playerId: player.playerId, stats: player.stats }, d.config.balancing.weights);
        return { ...OK, data: choices.map((c, i) => ({ seat: c.seat, score: c.score, breakdown: c.breakdown, best: i === 0 })) };
      }
      case 'HEALTH':
        return { ...OK, data: { status: d.status, nextTickAt: nextTickAt(d), frozen: d.frozen, integrityOk: d.integrity.ok } };
      case 'FEATURED': {
        if (d.featuredTableId) return { ...OK, data: d.featuredTableId };
        const open = openTableList(d);
        const final = open.find((t) => t.isFinalTable);
        return { ...OK, data: (final ?? open[0])?.summary.tableId ?? null };
      }
      case 'OVERVIEW':
        return { ...OK, data: { director: { ...d, players: { size: d.players.size, buckets: {} } }, stats: directorStats(d, now), summary: tournamentSummary(d, state.eventSeq), eventSeq: state.eventSeq } };
    }
  }

  return {
    kind: 'director',
    snapshotEvery: deps.snapshotEvery,
    initialState: (actorId) => ({ tournamentId: actorId, director: null, reportSeqs: emptyBucketMap(), eventSeq: 0 }),
    step,
    commandType: (c) => (c.kind === 'INPUT' || c.kind === 'REPORT' ? c.input.type : c.kind),
    actionIdOf: () => null,
    timerCommand: () => ({ kind: 'TICK' }),
    pendingTimers: (s) => {
      if (!s.director) return [];
      const at = nextTickAt(s.director);
      return at === null ? [] : [{ key: 'TICK', at, token: String(at) }];
    },
    eventSeqOf: (s) => s.eventSeq,
    read: (s, q, now) => query(s, q as DirectorQuery, now),
  };
}

/** Entry projection for players whose director record changed (batched). */
async function projectPlayers(repos: Repos, d: DirectorState, playerIds: string[]): Promise<void> {
  const rows = [];
  for (const id of playerIds) {
    const p = getDirectorPlayer(d, id);
    if (!p) continue;
    const table = p.tableId ? bmGet(d.tables, p.tableId) : undefined;
    const stack = table?.summary.seats.find((s) => s.playerId === id)?.stack ?? p.stack;
    rows.push({
      entryId: p.entryId,
      status: p.status,
      tableId: p.tableId,
      seat: p.seat,
      stack,
      handsPlayed: p.stats.handsPlayedTotal,
      finishPosition: p.finishPosition,
      tiedCount: p.tiedCount,
      prizeMinor: p.prizeMinor,
      eliminatedAt: p.elimination ? new Date(p.elimination.eliminatedAt) : null,
      eliminationHandId: p.elimination?.handId || null,
    });
  }
  if (rows.length) await repos.players.updateEntryStates(rows);
}

/** Status, eliminations, movements and completion projections from tournament events (multi-row inserts). */
async function projectEvents(repos: Repos, tournamentId: string, d: DirectorState, events: TournamentEvent[], at: number): Promise<void> {
  const eliminations: unknown[][] = [];
  const movements: unknown[][] = [];
  for (const e of events) {
    switch (e.kind) {
      case 'TOURNAMENT_STATUS_CHANGED':
        await repos.tournaments.updateStatus(tournamentId, e.to);
        if (e.to === 'STARTING') {
          await repos.tournaments.lockConfig(tournamentId);
          if (d.publicEntropy) await repos.tournaments.setPublicEntropy(tournamentId, d.publicEntropy);
        }
        break;
      case 'PLAYER_ELIMINATED': {
        const r = e.record;
        eliminations.push([tournamentId, r.entryId, r.playerId, Math.max(1, r.finishPosition || 1), r.tiedCount, r.eliminatedAt, r.handId || null, r.handNumber || null, r.tableId, r.batchId, r.startingStackOfHand, r.handId ? 'BUSTED' : 'DISQUALIFIED']);
        break;
      }
      case 'TABLE_MOVE': {
        const m = e.movement;
        movements.push([m.moveId, tournamentId, m.playerId, m.reason, m.fromTableId, m.fromSeat, m.toTableId, m.toSeat, m.stack, m.requestedAt, m.completedAt, m.scoreBreakdown ? JSON.stringify(m.scoreBreakdown) : null]);
        break;
      }
      default:
        break;
    }
  }
  // Later rows for the same key win (a re-ranked elimination), as with one statement per event.
  for (const rows of chunks(dedupeLast(eliminations, (r) => String(r[1])), 400)) {
    await repos.q.query(
      `INSERT INTO eliminations (tournament_id, entry_id, player_id, finish_position, tied_count, eliminated_at, hand_id, hand_number, table_id, batch_id, starting_stack_of_hand, reason)
       VALUES ${valuesList(rows.length, 12)}
       ON CONFLICT (tournament_id, entry_id) DO UPDATE SET finish_position = EXCLUDED.finish_position, tied_count = EXCLUDED.tied_count`,
      rows.flat(),
    );
  }
  for (const rows of chunks(dedupeLast(movements, (r) => String(r[0])), 400)) {
    await repos.q.query(
      `INSERT INTO player_movements (id, tournament_id, player_id, reason, from_table_id, from_seat, to_table_id, to_seat, stack, requested_at, completed_at, score_breakdown)
       VALUES ${valuesList(rows.length, 12)} ON CONFLICT (id) DO NOTHING`,
      rows.flat(),
    );
  }
  for (const e of events) {
    if (e.kind !== 'TOURNAMENT_COMPLETED') continue;
    await repos.tournaments.setWinner(tournamentId, e.winnerId);
    await projectPlayers(repos, d, bmValues(d.players).filter((p) => p.finishPosition !== null).map((p) => p.playerId).slice(0, 10_000));
  }
  void at;
}

function valuesList(rows: number, cols: number): string {
  const out: string[] = [];
  for (let r = 0; r < rows; r++) out.push(`(${Array.from({ length: cols }, (_, c) => `$${r * cols + c + 1}`).join(',')})`);
  return out.join(',');
}

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Keeps the last row per key (a multi-row upsert may touch each key only once). */
function dedupeLast<T>(rows: T[], key: (row: T) => string): T[] {
  const byKey = new Map<string, T>();
  for (const r of rows) {
    const k = key(r);
    byKey.delete(k);
    byKey.set(k, r);
  }
  return [...byKey.values()];
}
