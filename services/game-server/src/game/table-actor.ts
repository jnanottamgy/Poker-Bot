import type {
  AdminTableView,
  CardCode,
  CommandReply,
  LegalActions,
  PlayerId,
  SeatIndex,
  TableCommand,
  TableCommandEnvelope,
  TableEvent,
} from '@jpb/shared-types';
import { adminView, checkTableInvariants, chipsAtTable, createTableState, handFairnessRecord, lastHandHistory, playerView, reduceTable, spectatorView } from '@jpb/table-engine';
import type { HandHistoryRecord, TableState } from '@jpb/table-engine';
import { createDeckProvider } from '@jpb/fairness-engine/node';
import type { DirectorInput } from '@jpb/tournament-engine';
import type { ActorDefinition, ActorEnvelope, StepResult, TimerRequest } from '../runtime/actor';
import { noopResult, stepResult } from '../runtime/actor';
import type { TableLogMeta } from '../runtime/pg-actor-log';
import { channels } from '../bus/bus';
import type { TableUpdateMessage } from '../runtime/contracts';
import type { Repos } from '../persistence/store';
import { OUTBOX_KICK_CHANNEL } from './messages';
import type { ToDirector, ToTable } from './messages';
import { projectHand } from './hand-projection';

/** Everything the table actor stores: the engine state plus delivery bookkeeping. */
export interface TableActorState {
  tableId: string;
  table: TableState | null;
  publicEntropy: string;
  serverSeedHash: string;
  /** Highest director delivery applied (idempotent re-delivery). */
  lastDirectorSeq: number;
  /** Reports sent to the director so far. */
  reportSeq: number;
}

export type TableQuery =
  | { q: 'UPDATE' }
  | { q: 'ADMIN'; includeHoleCards: boolean }
  | { q: 'PLAYER'; playerId: PlayerId }
  | { q: 'LAST_HAND' }
  | { q: 'STATE' }
  | { q: 'INTERNALS' };

/** Health data for the admin control room and integrity checks. */
export interface TableInternals {
  status: string;
  version: number;
  lastEventSeq: number;
  handNumber: number;
  chipsAtTable: number;
  invariantViolations: string[];
  lastProgressAt: number | null;
  seated: number;
  disconnected: number;
  frozen: boolean;
  holds: string[];
  /** Timers this state requires (deadline + token); the health monitor re-fires overdue ones. */
  timers: TimerRequest[];
}

export type TableActorCommand =
  | { kind: 'DIRECTOR'; dseq: number; command: ToTable['command'] }
  | { kind: 'PLAYER'; command: Extract<TableCommand, { type: 'PLAYER_ACTION' }> }
  | { kind: 'CONNECTION'; command: Extract<TableCommand, { type: 'PLAYER_CONNECTION' }> }
  | { kind: 'TIMER'; command: Extract<TableCommand, { type: 'TIMER_FIRED' }> }
  | { kind: 'QUERY'; query: TableQuery };

export type TableActorReply = CommandReply & { data?: unknown };

const OK: CommandReply = { ok: true, code: null, message: null, duplicate: false };
const DUPLICATE: CommandReply = { ok: true, code: null, message: null, duplicate: true };

export interface TableActorDeps {
  /** Decrypted server seed of a tournament (secret; never stored in actor state). */
  seedFor(tournamentId: string): string;
  snapshotEvery: number;
}

const DIRECTOR_FORWARDED = new Set(['HAND_RESULT', 'PLAYER_REMOVED', 'PLAYER_SEATED', 'TABLE_STATUS_CHANGED', 'STACK_ADJUSTED']);

/** Director input reporting a table event (null when the director does not need it). */
function reportFor(tableId: string, ev: TableEvent): DirectorInput | null {
  const e = ev.event;
  switch (e.kind) {
    case 'HAND_RESULT':
      return { type: 'TABLE_HAND_RESULT', report: e.result };
    case 'PLAYER_REMOVED':
      return { type: 'TABLE_PLAYER_REMOVED', tableId, playerId: e.playerId, seat: e.seat, stack: e.stack, reason: e.reason, moveId: e.moveId, ...(e.stats ? { stats: e.stats } : {}) };
    case 'PLAYER_SEATED':
      return { type: 'TABLE_PLAYER_SEATED', tableId, playerId: e.playerId, seat: e.seat, stack: e.stack, moveId: e.moveId };
    case 'TABLE_STATUS_CHANGED':
      return { type: 'TABLE_STATUS_CHANGED', tableId, status: e.status, holds: e.holds, frozen: e.frozen };
    case 'STACK_ADJUSTED':
      return { type: 'TABLE_STACK_ADJUSTED', tableId, playerId: e.playerId, before: e.before, after: e.after };
    default:
      return null;
  }
}

/** The full TABLE_UPDATE fan-out message (views per audience; never the deck). */
export function tableUpdate(state: TableState, events: TableEvent[], at: number): TableUpdateMessage {
  const privateByPlayer: TableUpdateMessage['privateByPlayer'] = {};
  for (const occ of state.seats) {
    if (!occ) continue;
    const v = playerView(state, occ.playerId, at);
    if (v) privateByPlayer[occ.playerId] = { seat: v.you.seat, holeCards: v.you.holeCards, legal: v.you.legal as LegalActions | null };
  }
  const withCards: AdminTableView = adminView(state, at, { includeHoleCards: true });
  const holeCardsBySeat: Record<SeatIndex, [CardCode, CardCode]> = withCards.holeCards ?? {};
  return {
    kind: 'TABLE_UPDATE',
    tableId: state.tableId,
    tournamentId: state.tournamentId,
    fromSeq: events[0]?.seq ?? state.nextEventSeq,
    toSeq: events.length ? events[events.length - 1]!.seq : state.nextEventSeq - 1,
    version: state.version,
    at,
    events,
    publicView: spectatorView(state, at),
    privateByPlayer,
    adminView: { ...withCards, holeCards: null },
    holeCardsBySeat,
  };
}

function seatedCount(t: TableState): number {
  return t.seats.filter((s) => s !== null).length;
}

export function createTableActorDefinition(deps: TableActorDeps): ActorDefinition<TableActorState, TableActorCommand, TableActorReply, TableLogMeta> {
  const decks = new Map<string, (n: number) => CardCode[]>();
  const deckFor = (s: TableActorState) => {
    let fn = decks.get(s.tableId);
    if (!fn) {
      const t = s.table!;
      fn = createDeckProvider({ serverSeed: deps.seedFor(t.tournamentId), tournamentId: t.tournamentId, tableId: t.tableId, publicEntropy: s.publicEntropy });
      decks.set(s.tableId, fn);
    }
    return fn;
  };

  function step(state: TableActorState, env: ActorEnvelope<TableActorCommand>): StepResult<TableActorState, TableActorReply> {
    const c = env.command;
    if (c.kind === 'QUERY') return noopResult(state, query(state, c.query, env.at));

    if (c.kind === 'DIRECTOR') {
      if (c.command.type === 'INIT') {
        // The first message a table ever receives; deduplicated by existence.
        if (state.table !== null) return noopResult(state, DUPLICATE);
        const table = createTableState(c.command.input);
        const next: TableActorState = { ...state, table, publicEntropy: c.command.publicEntropy, serverSeedHash: c.command.serverSeedHash };
        return stepResult(next, OK, { outbox: [{ channel: channels.tableEvents(state.tableId), message: tableUpdate(table, [], env.at) }] });
      }
      if (c.dseq <= state.lastDirectorSeq) return noopResult(state, DUPLICATE);
    }
    if (state.table === null) return noopResult(state, { ok: false, code: 'TABLE_CLOSED', message: 'Table is not initialized.', duplicate: false });

    const command = c.command as TableCommand;
    return apply(state, env, command, c.kind === 'DIRECTOR' ? c.dseq : null);
  }

  function apply(state: TableActorState, env: ActorEnvelope<TableActorCommand>, command: TableCommand, dseq: number | null): StepResult<TableActorState, TableActorReply> {
    const table = state.table!;
    const envelope: TableCommandEnvelope = { commandId: env.commandId, tableId: state.tableId, at: env.at, command };
    const tr = reduceTable(table, envelope, { deckFor: deckFor(state) });
    const reply: CommandReply = tr.reply ?? OK;
    const changed = tr.state !== table || tr.events.length > 0 || tr.timers.length > 0;
    const directorRejected = dseq !== null && !reply.ok && !reply.duplicate;
    if (!changed && dseq === null) return noopResult(state, reply);

    let reportSeq = state.reportSeq;
    const reports: ToDirector[] = [];
    for (const ev of tr.events) {
      if (!DIRECTOR_FORWARDED.has(ev.event.kind)) continue;
      const input = reportFor(state.tableId, ev);
      if (input) reports.push({ tableId: state.tableId, rseq: ++reportSeq, input });
    }
    if (directorRejected) {
      reports.push({ tableId: state.tableId, rseq: ++reportSeq, input: { type: 'TABLE_COMMAND_FAILED', tableId: state.tableId, command, code: reply.code ?? 'UNKNOWN' } });
    }
    const next: TableActorState = { ...state, table: tr.state, reportSeq, lastDirectorSeq: dseq ?? state.lastDirectorSeq };
    const completedHand = tr.events.some((e) => e.event.kind === 'HAND_RESULT') ? lastHandHistory(tr.state) : null;
    const tournamentId = table.tournamentId;
    const projection = async (repos: Repos) => {
      if (reports.length) {
        await repos.outbox.add(
          'table',
          state.tableId,
          reports.map((r) => ({ targetKind: 'director', targetId: tournamentId, payload: r })),
        );
      }
      for (const ev of tr.events) {
        const e = ev.event;
        if (e.kind === 'PLAYER_SEATED') await repos.tableLogs.setSeat(state.tableId, e.seat, e.playerId, e.stack);
        else if (e.kind === 'PLAYER_REMOVED') await repos.tableLogs.setSeat(state.tableId, e.seat, null, 0);
      }
      if (completedHand) await projectHand(repos, completedHand, { serverSeedHash: state.serverSeedHash, publicEntropy: state.publicEntropy });
    };
    const outbox = [{ channel: channels.tableEvents(state.tableId), message: tableUpdate(tr.state, tr.events, env.at) as unknown }];
    if (reports.length) outbox.push({ channel: OUTBOX_KICK_CHANNEL, message: { sourceKind: 'table', sourceId: state.tableId } });
    return stepResult(next, reply, {
      events: tr.events.map((e) => ({ seq: e.seq, version: e.version, at: e.at, kind: e.event.kind, visibility: e.visibility, privateTo: e.privateTo, payload: e })),
      timers: tr.timers.map((t) => ({ key: t.kind, at: t.at, token: t.token })),
      outbox,
      projection,
    });
  }

  function query(state: TableActorState, q: TableQuery, at: number): TableActorReply {
    const t = state.table;
    if (!t) return { ...OK, data: null };
    switch (q.q) {
      case 'UPDATE':
        return { ...OK, data: tableUpdate(t, [], at) };
      case 'ADMIN':
        return { ...OK, data: adminView(t, at, { includeHoleCards: q.includeHoleCards }) };
      case 'PLAYER':
        return { ...OK, data: playerView(t, q.playerId, at) };
      case 'LAST_HAND':
        return { ...OK, data: lastHandHistory(t) };
      case 'STATE':
        return { ...OK, data: { status: t.status, holds: t.holds, frozen: t.frozen !== null, seated: seatedCount(t), handNumber: t.handNumber, version: t.version, nextEventSeq: t.nextEventSeq, lastProgressAt: t.lastProgressAt } };
      case 'INTERNALS': {
        const data: TableInternals = {
          status: t.status,
          version: t.version,
          lastEventSeq: t.nextEventSeq - 1,
          handNumber: t.handNumber,
          chipsAtTable: chipsAtTable(t),
          invariantViolations: checkTableInvariants(t),
          lastProgressAt: t.lastProgressAt,
          seated: seatedCount(t),
          disconnected: t.seats.filter((o) => o !== null && !o.connected).length,
          frozen: t.frozen !== null,
          holds: [...t.holds],
          timers: pendingTimers(state),
        };
        return { ...OK, data };
      }
    }
  }

  return {
    kind: 'table',
    snapshotEvery: deps.snapshotEvery,
    initialState: (actorId) => ({ tableId: actorId, table: null, publicEntropy: '', serverSeedHash: '', lastDirectorSeq: 0, reportSeq: 0 }),
    step,
    commandType: (c) => (c.kind === 'QUERY' ? 'QUERY' : c.kind === 'DIRECTOR' ? c.command.type : c.command.type),
    actionIdOf: (c) => (c.kind === 'PLAYER' ? `${c.command.playerId}:${c.command.actionId}` : null),
    timerCommand: (key, token) => ({ kind: 'TIMER', command: { type: 'TIMER_FIRED', kind: key as 'ACTION_TIMEOUT' | 'NEXT_HAND', token } }),
    pendingTimers: (s) => pendingTimers(s),
    logMeta: (s, env) => ({
      status: s.table?.status ?? 'WAITING',
      playerCount: s.table ? seatedCount(s.table) : 0,
      handsPlayed: s.table?.counters.handsPlayed ?? 0,
      progressed: env.command.kind === 'PLAYER' || env.command.kind === 'TIMER',
    }),
    versionOf: (s) => s.table?.version ?? 0,
    eventSeqOf: (s) => (s.table ? s.table.nextEventSeq - 1 : 0),
    read: (s, q, now) => query(s, q as TableQuery, now),
  };
}

/** Timers implied by a recovered table state (deadlines are absolute server times in state). */
export function pendingTimers(s: TableActorState): TimerRequest[] {
  const t = s.table;
  if (!t || t.frozen !== null) return [];
  const out: TimerRequest[] = [];
  if (t.turn) out.push({ key: 'ACTION_TIMEOUT', at: t.turn.deadline + t.turn.graceMs, token: t.turn.timerToken });
  if (t.nextHand) out.push({ key: 'NEXT_HAND', at: t.nextHand.dueAt, token: t.nextHand.token });
  return out;
}

export function fairnessRecordOf(history: HandHistoryRecord, input: { serverSeedHash: string; publicEntropy: string }) {
  return handFairnessRecord({ lastHand: history } as unknown as TableState, input, history);
}
