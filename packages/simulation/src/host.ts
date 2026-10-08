import type {
  CommandReply,
  PlayerActionIntent,
  PlayerId,
  PlayerNotice,
  TableCommand,
  TableCommandEnvelope,
  TableEvent,
  TableId,
  TableTimerRequest,
  TournamentConfig,
  TournamentEvent,
} from '@jpb/shared-types';
import { checkTableInvariants, createTableState, reduceTable } from '@jpb/table-engine';
import type { CreateTableInput, TableState } from '@jpb/table-engine';
import { buildTableIndex, createDirectorState, directorReduce } from '@jpb/tournament-engine';
import type { DirectorEffect, DirectorInput, DirectorReply, DirectorState } from '@jpb/tournament-engine';
import type { TableCountIndex } from '@jpb/balancing-engine';
import { commitmentFor, createDeckProvider, drawSource } from '@jpb/fairness-engine/node';
import type { CardCode } from '@jpb/shared-types';
import { uniformInt } from '@jpb/randomness';
import type { RandomSource } from '@jpb/randomness';
import { VirtualScheduler } from './scheduler';
import { decide } from './bots';
import type { BotStrategy } from './bots';

type Message =
  | { kind: 'director'; input: DirectorInput }
  | { kind: 'table'; tableId: TableId; command: TableCommand; fromDirector: boolean };

type Timer =
  | { kind: 'TABLE_TIMER'; tableId: TableId; timer: TableTimerRequest }
  | { kind: 'DIRECTOR_TICK' }
  | { kind: 'BOT'; tableId: TableId; playerId: PlayerId; turnVersion: number; intent: PlayerActionIntent };

export interface HostOptions {
  tournamentId: string;
  config: TournamentConfig;
  serverSeed: string;
  startAt: number;
  /** Run checkTableInvariants after every table command (slower; on by default). */
  checkInvariants?: boolean;
  /** Throw on CRITICAL integrity alerts (default true). */
  strict?: boolean;
  /** Virtual think time range for bots, ms. */
  thinkMs?: [number, number];
}

export interface HostStats {
  directorInputs: number;
  tableCommands: number;
  actions: number;
  rejectedActions: number;
  timeouts: number;
  handsCompleted: number;
  maxTablesOpen: number;
}

/**
 * In-process host: routes director effects to table actors and table events
 * back to the director exactly as the production runtime does (commands per
 * actor strictly in order), on a virtual clock. Records every input so a run
 * can be replayed.
 */
export class SimulationHost {
  readonly scheduler: VirtualScheduler<Timer>;
  director: DirectorState;
  readonly tables = new Map<TableId, TableState>();
  readonly tableLogs = new Map<TableId, TableCommandEnvelope[]>();
  /** createTableState inputs per table (for replay). */
  readonly tableInits = new Map<TableId, CreateTableInput>();
  readonly directorLog: Array<{ at: number; input: DirectorInput }> = [];
  readonly tournamentEvents: TournamentEvent[] = [];
  readonly tableEvents: TableEvent[] = [];
  readonly notices = new Map<PlayerId, PlayerNotice[]>();
  readonly alerts: DirectorEffect[] = [];
  readonly stats: HostStats = { directorInputs: 0, tableCommands: 0, actions: 0, rejectedActions: 0, timeouts: 0, handsCompleted: 0, maxTablesOpen: 0 };
  readonly bots = new Map<PlayerId, { strategy: BotStrategy; rng: RandomSource }>();
  recordEvents = true;
  /** The configuration the tournament was created with (admin edits change director.config later). */
  readonly initialConfig: TournamentConfig;
  private readonly queue: Message[] = [];
  private index: TableCountIndex;
  private readonly decks = new Map<TableId, (n: number) => CardCode[]>();
  private readonly thinkRng: RandomSource;
  private commandSeq = 0;
  private draining = false;

  constructor(private readonly opts: HostOptions) {
    this.scheduler = new VirtualScheduler(opts.startAt);
    this.initialConfig = opts.config;
    this.director = createDirectorState({ tournamentId: opts.tournamentId, config: opts.config, createdAt: opts.startAt, serverSeedHash: commitmentFor(opts.serverSeed) });
    this.index = buildTableIndex(this.director);
    this.thinkRng = this.draw('think');
  }

  get now(): number {
    return this.scheduler.now;
  }

  draw(purpose: string): RandomSource {
    return drawSource({ serverSeed: this.opts.serverSeed, tournamentId: this.opts.tournamentId, purpose, publicEntropy: this.director.publicEntropy ?? '0'.repeat(64) });
  }

  addBot(playerId: PlayerId, strategy: BotStrategy): void {
    this.bots.set(playerId, { strategy, rng: this.draw(`bot:${playerId}`) });
  }

  /** Submits a director input and processes everything it causes (at the current virtual time). */
  submitDirector(input: DirectorInput): DirectorReply {
    const reply = this.applyDirector(input);
    this.drain();
    return reply;
  }

  submitTable(tableId: TableId, command: TableCommand): CommandReply | null {
    const reply = this.applyTable(tableId, command, false);
    this.drain();
    return reply;
  }

  /** Runs until the tournament ends, the queue is empty or `maxVirtualMs` elapses. Returns true if finished. */
  run(maxVirtualMs: number): boolean {
    const deadline = this.now + maxVirtualMs;
    for (;;) {
      this.drain();
      if (this.director.status === 'COMPLETED' || this.director.status === 'CANCELLED') return true;
      const t = this.scheduler.pop();
      if (!t) return false;
      if (this.now > deadline) return false;
      this.fire(t);
    }
  }

  private fire(t: Timer): void {
    if (t.kind === 'DIRECTOR_TICK') this.queue.push({ kind: 'director', input: { type: 'TICK' } });
    else if (t.kind === 'TABLE_TIMER') {
      if (t.timer.kind === 'ACTION_TIMEOUT') this.stats.timeouts += 0; // counted from events
      this.queue.push({ kind: 'table', tableId: t.tableId, command: { type: 'TIMER_FIRED', kind: t.timer.kind, token: t.timer.token }, fromDirector: false });
    } else {
      const table = this.tables.get(t.tableId);
      if (!table || table.turn?.playerId !== t.playerId || table.turn.turnVersion !== t.turnVersion) return;
      this.stats.actions += 1;
      this.queue.push({
        kind: 'table',
        tableId: t.tableId,
        command: { type: 'PLAYER_ACTION', actionId: `bot-${this.stats.actions}`, playerId: t.playerId, intent: t.intent, tableStateVersion: t.turnVersion },
        fromDirector: false,
      });
    }
  }

  private drain(): void {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length) {
        const m = this.queue.shift()!;
        if (m.kind === 'director') this.applyDirector(m.input);
        else this.applyTable(m.tableId, m.command, m.fromDirector);
      }
    } finally {
      this.draining = false;
    }
  }

  private applyDirector(input: DirectorInput): DirectorReply {
    this.stats.directorInputs += 1;
    this.directorLog.push({ at: this.now, input });
    let tr;
    try {
      tr = directorReduce(this.director, input, { now: this.now, drawSource: (p) => this.draw(p), index: this.index });
    } catch (err) {
      this.index = buildTableIndex(this.director);
      throw err;
    }
    if (!tr.reply.ok) {
      this.index = buildTableIndex(this.director);
      return tr.reply;
    }
    this.director = tr.state;
    if (this.recordEvents) this.tournamentEvents.push(...tr.events);
    for (const e of tr.effects) this.effect(e);
    return tr.reply;
  }

  private effect(e: DirectorEffect): void {
    switch (e.type) {
      case 'CREATE_TABLE': {
        const init: CreateTableInput = {
          tableId: e.tableId,
          tournamentId: this.opts.tournamentId,
          tableNumber: e.tableNumber,
          maxSeats: e.maxSeats,
          timing: e.timing,
          blinds: e.blinds,
          initialButtonSeat: e.initialButtonSeat,
          createdAt: this.now,
        };
        this.tableInits.set(e.tableId, init);
        const state = createTableState(init);
        this.tables.set(e.tableId, state);
        this.tableLogs.set(e.tableId, []);
        this.decks.set(
          e.tableId,
          createDeckProvider({ serverSeed: this.opts.serverSeed, tournamentId: this.opts.tournamentId, tableId: e.tableId, publicEntropy: this.director.publicEntropy ?? '0'.repeat(64) }),
        );
        const open = [...this.tables.values()].filter((t) => t.status !== 'CLOSED').length;
        this.stats.maxTablesOpen = Math.max(this.stats.maxTablesOpen, open);
        return;
      }
      case 'TABLE_COMMAND':
        this.queue.push({ kind: 'table', tableId: e.tableId, command: e.command, fromDirector: true });
        return;
      case 'SCHEDULE_TICK':
        if (e.at !== null) this.scheduler.schedule(e.at, { kind: 'DIRECTOR_TICK' });
        return;
      case 'NOTIFY_PLAYER': {
        const list = this.notices.get(e.playerId) ?? [];
        list.push(e.notice);
        this.notices.set(e.playerId, list);
        return;
      }
      case 'INTEGRITY_ALERT':
        this.alerts.push(e);
        if (e.severity === 'CRITICAL' && this.opts.strict !== false) throw new Error(`CRITICAL integrity alert: ${e.code} ${e.detail}`);
        return;
      case 'PLAYER_CHANGED':
        return;
    }
  }

  private applyTable(tableId: TableId, command: TableCommand, fromDirector: boolean): CommandReply | null {
    const state = this.tables.get(tableId);
    if (!state) throw new Error(`command for unknown table ${tableId}`);
    this.stats.tableCommands += 1;
    this.commandSeq += 1;
    const envelope: TableCommandEnvelope = { commandId: `${tableId}:${this.commandSeq}`, tableId, at: this.now, command };
    this.tableLogs.get(tableId)!.push(envelope);
    const tr = reduceTable(state, envelope, { deckFor: this.decks.get(tableId)! });
    this.tables.set(tableId, tr.state);
    if (this.opts.checkInvariants !== false && tr.state !== state) {
      const v = checkTableInvariants(tr.state);
      if (v.length) throw new Error(`table ${tableId} invariants broken after ${command.type}: ${v.join('; ')}`);
    }
    if (fromDirector && tr.reply && !tr.reply.ok && !tr.reply.duplicate) {
      this.queue.push({ kind: 'director', input: { type: 'TABLE_COMMAND_FAILED', tableId, command, code: tr.reply.code ?? 'UNKNOWN' } });
    }
    if (command.type === 'PLAYER_ACTION' && tr.reply && !tr.reply.ok) this.stats.rejectedActions += 1;
    for (const t of tr.timers) this.scheduler.schedule(t.at, { kind: 'TABLE_TIMER', tableId, timer: t });
    for (const ev of tr.events) this.route(tableId, ev);
    return tr.reply;
  }

  private route(tableId: TableId, ev: TableEvent): void {
    if (this.recordEvents) this.tableEvents.push(ev);
    const e = ev.event;
    switch (e.kind) {
      case 'HAND_RESULT':
        this.stats.handsCompleted += 1;
        this.queue.push({ kind: 'director', input: { type: 'TABLE_HAND_RESULT', report: e.result } });
        return;
      case 'PLAYER_REMOVED':
        this.queue.push({
          kind: 'director',
          input: { type: 'TABLE_PLAYER_REMOVED', tableId, playerId: e.playerId, seat: e.seat, stack: e.stack, reason: e.reason, moveId: e.moveId, ...(e.stats ? { stats: e.stats } : {}) },
        });
        return;
      case 'PLAYER_SEATED':
        this.queue.push({ kind: 'director', input: { type: 'TABLE_PLAYER_SEATED', tableId, playerId: e.playerId, seat: e.seat, stack: e.stack, moveId: e.moveId } });
        return;
      case 'TABLE_STATUS_CHANGED':
        this.queue.push({ kind: 'director', input: { type: 'TABLE_STATUS_CHANGED', tableId, status: e.status, holds: e.holds, frozen: e.frozen } });
        return;
      case 'STACK_ADJUSTED':
        this.queue.push({ kind: 'director', input: { type: 'TABLE_STACK_ADJUSTED', tableId, playerId: e.playerId, before: e.before, after: e.after } });
        return;
      case 'PLAYER_ACTED':
        if (e.timeout) this.stats.timeouts += 1;
        return;
      case 'ACTION_REQUESTED': {
        const bot = this.bots.get(e.playerId);
        if (!bot) return;
        const intent = decide(bot.strategy, e.legal, bot.rng);
        if (intent === null) return;
        const [lo, hi] = this.opts.thinkMs ?? [200, 2500];
        const think = lo + uniformInt(this.thinkRng, Math.max(1, hi - lo + 1));
        this.scheduler.schedule(this.now + Math.min(think, Math.max(0, e.deadline - this.now)), { kind: 'BOT', tableId, playerId: e.playerId, turnVersion: e.turnVersion, intent });
        return;
      }
      default:
        return;
    }
  }
}
