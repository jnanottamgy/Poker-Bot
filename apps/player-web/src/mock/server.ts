/**
 * MOCK game server: tournament director + WebSocket hub for the player app
 * when it runs with VITE_MOCK=1. It speaks the real protocol
 * (packages/shared-types/src/protocol.ts) through MockSocket, and plays a
 * scripted tournament: lobby countdown, hands with your turn, a table move,
 * a milestone, a break, the elimination hand, spectating, and (with
 * ?scenario=champion) a final table you win.
 */
import type {
  ActionRejectCode,
  CardCode,
  ClientAudience,
  ClientMessage,
  LeaderboardDto,
  LeaderboardRowDto,
  MovementDto,
  PlayerHistoryDto,
  PlayerNotice,
  PlayerSelfSummary,
  ServerMessage,
  TournamentEvent,
  TournamentPlayerStatus,
  TournamentPublicSummary,
} from '@jpb/shared-types';
import { PROTOCOL_VERSION } from '@jpb/shared-types';
import {
  LEVELS,
  MOCK_CURRENCY,
  MOCK_FIELD_SIZE,
  MOCK_SEED_HASH,
  MOCK_STARTING_STACK,
  MOCK_TOURNAMENT_ID,
  MOCK_TOURNAMENT_NAME,
  blindsFor,
  mockField,
  prizeFor,
} from './data';
import type { FieldPlayer } from './data';
import { hashSeed, seededRng } from './rng';
import type { Rng } from './rng';
import type { MockScenario } from './scenario';
import { MockTable, realClock } from './table';
import type { BotStyle, HandReport, HandScript, MockClock, SimPlayer, TableBatch } from './table';

export interface MockConn {
  readonly id: number;
  audience: ClientAudience | null;
  controller: boolean;
  push(msg: ServerMessage): void;
  /** Server-side close (the client sees the socket drop). */
  drop(): void;
}

export interface MockIdentity {
  playerId: string;
  publicId: string;
  displayName: string;
  status: TournamentPlayerStatus;
}

type Stage = 'PENDING' | 'LOBBY' | 'T47' | 'T12' | 'BREAK' | 'PRESSURE' | 'FINAL' | 'OUT' | 'DONE' | 'HELD';

const STYLES: readonly BotStyle[] = ['tight', 'loose', 'aggro', 'station', 'tight', 'loose'];
const LOBBY_COUNTDOWN_MS = 27_000;
const BREAK_MS = 45_000;
const SPECTATOR_DELAY_MS = 1_500;
const PAUSED_REMAINING_MS = 271_000;
const MOVE_AFTER_HANDS = 3;

/** Scripted hands (hole cards by role; the hero is "H"). Outcomes follow from the cards. */
const SCRIPTS = {
  firstHand: { hero: ['Ah', 'Kh'], villain: ['Qs', 'Qc'], board: ['Qh', 'Jd', '4h', 'Th', '2c'] },
  junk: { hero: ['7c', '2d'] },
  setOfKings: { hero: ['Kc', 'Kd'], villain: ['As', '7s'], board: ['Kh', '7d', '2s', '9c', '3h'] },
  pressure: [
    { hero: ['Ah', 'Kd'], villain: ['Qs', 'Qh'], board: ['9c', '6d', '2s', 'Js', '4h'] },
    { hero: ['9h', '9s'], villain: ['Ac', 'Ad'], board: ['Kc', '7h', '3d', '2c', '8s'] },
  ],
  finalX: { hero: ['Ac', 'As'], villain: ['Kd', 'Qd'], board: ['9h', '5c', '2d', 'Th', '3s'] },
  finalY: { hero: ['Kh', 'Ks'], villain: ['Jc', 'Th'], board: ['8d', '4s', '2h', 'Qc', '7c'] },
} as const;

const pair = (cards: readonly string[]): [CardCode, CardCode] => [cards[0] as CardCode, cards[1] as CardCode];

export class MockServer {
  readonly conns = new Set<MockConn>();
  summary: TournamentPublicSummary;
  self: PlayerSelfSummary;
  private heroPlayer: SimPlayer;
  private heroTable: MockTable | null = null;
  private featured: MockTable | null = null;
  private readonly tables = new Map<string, MockTable>();
  private stage: Stage = 'LOBBY';
  private heroHandsAtTable = 0;
  private pressureRound = 0;
  private tournamentSeq = 0;
  private takenOver = false;
  private downUntil = 0;
  private droppedOnce = false;
  private replacedOnce = false;
  private largestPotWon = 0;
  private readonly movements: MovementDto[] = [];
  private readonly rng: Rng;
  private readonly botPool: FieldPlayer[];
  private botCursor = 0;
  private readonly timers: unknown[] = [];
  private readonly eliminatedBots = new Map<string, number>();
  private readonly speed: number;

  constructor(
    readonly scenario: MockScenario,
    identity: MockIdentity,
    private readonly clock: MockClock = realClock,
  ) {
    this.speed = scenario.speed;
    this.rng = seededRng(hashSeed(`server:${scenario.id}:${scenario.at}`));
    this.botPool = mockField().slice(40, 400);
    const now = clock.now();
    this.heroPlayer = { playerId: identity.playerId, displayName: identity.displayName, publicId: identity.publicId, stack: MOCK_STARTING_STACK, style: 'tight', human: true };
    this.summary = {
      tournamentId: MOCK_TOURNAMENT_ID,
      name: MOCK_TOURNAMENT_NAME,
      status: 'STARTING',
      clock: { levelIndex: 0, levelStartedAt: now + LOBBY_COUNTDOWN_MS, levelEndsAt: null, pausedRemainingMs: null, breakEndsAt: null, pendingBreakAfterLevel: 4 },
      currentLevel: LEVELS[0] ?? null,
      nextLevel: LEVELS[1] ?? null,
      counters: { registered: MOCK_FIELD_SIZE, active: MOCK_FIELD_SIZE, eliminated: 0, inTransit: 0, tables: 250, handsCompleted: 0, totalChips: MOCK_FIELD_SIZE * MOCK_STARTING_STACK, largestPot: 0 },
      handForHand: false,
      lastSeq: 0,
      serverSeedHash: MOCK_SEED_HASH,
    };
    this.self = {
      playerId: identity.playerId,
      publicId: identity.publicId,
      displayName: identity.displayName,
      status: identity.status,
      tableId: null,
      tableNumber: null,
      seat: null,
      stack: MOCK_STARTING_STACK,
      finishPosition: null,
      prizeMinor: 0,
      handsPlayed: 0,
    };
    this.boot();
  }

  /* ------------------------------------------------------------ hub */

  isDown(): boolean {
    return this.clock.now() < this.downUntil;
  }

  onClose(conn: MockConn): void {
    this.conns.delete(conn);
    if (conn.audience === 'PLAYER' && conn.controller && this.heroTable && ![...this.conns].some((c) => c.audience === 'PLAYER' && c.controller)) {
      this.heroTable.setConnected(this.self.playerId, false);
    }
  }

  onMessage(conn: MockConn, msg: ClientMessage): void {
    switch (msg.t) {
      case 'hello':
        this.onHello(conn, msg.audience);
        return;
      case 'ping':
        conn.push({ t: 'pong', st: this.clock.now(), ct: msg.ct });
        return;
      case 'snapshot_request':
        if (conn.audience) this.sendSnapshot(conn);
        return;
      case 'takeover':
        this.onTakeover(conn);
        return;
      case 'watch':
        if (conn.audience === 'SPECTATOR') this.sendSnapshot(conn);
        return;
      case 'action': {
        const reply = (ok: boolean, code: ActionRejectCode | null, message: string | null) =>
          conn.push({ t: 'action_result', st: this.clock.now(), actionId: msg.actionId, ok, code, message });
        if (conn.audience !== 'PLAYER' || !conn.controller) return reply(false, 'INVALID_COMMAND', 'Another device controls your seat. Take over to play here.');
        const table = this.heroTable;
        if (!table || table.tableId !== msg.tableId) return reply(false, 'PLAYER_NOT_SEATED', 'You are not seated at this table.');
        const r = table.submit(this.self.playerId, msg.type, msg.amount, msg.tableStateVersion);
        return reply(r.ok, r.code, r.message);
      }
    }
  }

  private onHello(conn: MockConn, audience: ClientAudience): void {
    const now = this.clock.now();
    if (audience === 'PLAYER' && this.scenario.id === 'expired') {
      conn.push({ t: 'error', st: now, code: 'UNAUTHORIZED', message: 'Please join or rejoin the tournament first.' });
      conn.drop();
      return;
    }
    conn.audience = audience;
    this.conns.add(conn);
    conn.push({ t: 'welcome', st: now, sessionId: `ses_${conn.id}`, audience, protocol: PROTOCOL_VERSION });
    if (audience === 'PLAYER') {
      const otherController = [...this.conns].some((c) => c !== conn && c.audience === 'PLAYER' && c.controller);
      if ((this.scenario.id === 'another-device' && !this.takenOver) || otherController) {
        conn.controller = false;
        conn.push({ t: 'another_device', st: now });
        return;
      }
      conn.controller = true;
      this.heroTable?.setConnected(this.self.playerId, true);
    }
    this.sendSnapshot(conn);
    if (audience === 'PLAYER') this.scheduleConnectionScenario(conn);
  }

  private onTakeover(conn: MockConn): void {
    if (conn.audience !== 'PLAYER') return;
    this.takenOver = true;
    for (const c of [...this.conns]) {
      if (c !== conn && c.audience === 'PLAYER' && c.controller) {
        c.push({ t: 'session_replaced', st: this.clock.now() });
        c.controller = false;
        this.conns.delete(c);
      }
    }
    conn.controller = true;
    this.heroTable?.setConnected(this.self.playerId, true);
    this.sendSnapshot(conn);
  }

  private scheduleConnectionScenario(conn: MockConn): void {
    if (this.scenario.id === 'reconnect' && !this.droppedOnce) {
      this.droppedOnce = true;
      this.later(5_000, () => {
        this.downUntil = this.clock.now() + this.scenario.downSeconds * 1000;
        for (const c of [...this.conns]) if (c.audience === 'PLAYER') c.drop();
      }, false);
    }
    if (this.scenario.id === 'replaced' && !this.replacedOnce) {
      this.replacedOnce = true;
      this.later(4_000, () => {
        conn.push({ t: 'session_replaced', st: this.clock.now() });
        conn.controller = false;
        this.conns.delete(conn);
      }, false);
    }
  }

  private sendSnapshot(conn: MockConn): void {
    const st = this.clock.now();
    this.syncSelfStack();
    if (conn.audience === 'PLAYER') {
      conn.push({ t: 'snapshot', st, snapshot: { audience: 'PLAYER', tournament: this.summary, self: this.self, table: this.heroTable?.playerView(this.self.playerId) ?? null } });
    } else if (conn.audience === 'SPECTATOR') {
      conn.push({ t: 'snapshot', st, snapshot: { audience: 'SPECTATOR', tournament: this.summary, table: this.featuredTable()?.spectatorView() ?? null } });
    }
  }

  private featuredTable(): MockTable | null {
    return this.featured ?? this.heroTable;
  }

  private players(): MockConn[] {
    return [...this.conns].filter((c) => c.audience === 'PLAYER');
  }

  private pushPlayers(msg: ServerMessage): void {
    for (const c of this.players()) c.push(msg);
  }

  private tevent(event: TournamentEvent): void {
    this.tournamentSeq += 1;
    this.summary = { ...this.summary, lastSeq: this.tournamentSeq };
    const msg: ServerMessage = {
      t: 'tournament_event',
      st: this.clock.now(),
      event: { tournamentId: MOCK_TOURNAMENT_ID, seq: this.tournamentSeq, at: this.clock.now(), event },
      summary: this.summary,
    };
    for (const c of this.conns) c.push(msg);
  }

  private selfUpdate(patch: Partial<PlayerSelfSummary>): void {
    this.self = { ...this.self, ...patch };
    this.pushPlayers({ t: 'self_update', st: this.clock.now(), self: this.self });
  }

  private notice(notice: PlayerNotice): void {
    this.pushPlayers({ t: 'notice', st: this.clock.now(), notice });
  }

  private later(ms: number, fn: () => void, scaled = true): void {
    this.timers.push(this.clock.setTimeout(fn, scaled ? Math.round(ms / this.speed) : ms));
  }

  dispose(): void {
    for (const t of this.timers) this.clock.clearTimeout(t);
    for (const t of this.tables.values()) t.stop();
  }

  /* ------------------------------------------------------------ tables */

  private nextBot(stack: number): SimPlayer {
    const f = this.botPool[this.botCursor % this.botPool.length] as FieldPlayer;
    this.botCursor += 1;
    return { playerId: f.playerId, displayName: f.displayName, publicId: f.publicId, stack, style: STYLES[this.botCursor % STYLES.length] as BotStyle };
  }

  private createTable(tableNumber: number, levelIndex: number, stacks: Array<number | null>, opts: { finalTable?: boolean } = {}): MockTable {
    const table = new MockTable({
      tableId: `tbl_${tableNumber.toString().padStart(3, '0')}`,
      tournamentId: MOCK_TOURNAMENT_ID,
      tableNumber,
      maxSeats: 9,
      blinds: blindsFor(levelIndex),
      seed: hashSeed(`table:${tableNumber}:${this.scenario.id}`),
      clock: this.clock,
      speed: this.speed,
      firstHandNumber: opts.finalTable ? 2_088 : 40 + tableNumber * 3,
    });
    stacks.forEach((stack, seat) => {
      if (stack !== null) table.seatPlayer(this.nextBot(stack), seat);
    });
    table.subscribe((batch) => this.deliver(table, batch));
    table.onHandComplete = (report) => this.onHandComplete(table, report);
    this.tables.set(table.tableId, table);
    return table;
  }

  private seatHero(table: MockTable, seat: number): void {
    table.seatPlayer(this.heroPlayer, seat);
    this.heroTable = table;
    this.heroHandsAtTable = 0;
    this.self = { ...this.self, status: 'SEATED', tableId: table.tableId, tableNumber: table.tableNumber, seat, stack: this.heroPlayer.stack };
  }

  private deliver(table: MockTable, batch: TableBatch): void {
    const heroId = this.self.playerId;
    const fromSeq = batch.events[0]?.seq ?? table.seq + 1;
    if (table === this.heroTable) {
      for (const e of batch.events) {
        if (e.event.kind === 'HAND_STARTED' && e.event.players.some((p) => p.playerId === heroId)) this.self = { ...this.self, handsPlayed: this.self.handsPlayed + 1 };
        if (e.event.kind === 'POT_AWARDED') {
          const won = e.event.winners.find((w) => w.playerId === heroId);
          if (won) this.largestPotWon = Math.max(this.largestPotWon, e.event.amount);
        }
        if (e.event.kind === 'POT_AWARDED' && e.event.amount > this.summary.counters.largestPot) {
          this.summary = { ...this.summary, counters: { ...this.summary.counters, largestPot: e.event.amount } };
        }
      }
      this.syncSelfStack();
      const view = table.playerView(heroId);
      if (view) {
        const events = batch.events.filter((e) => e.visibility === 'PUBLIC' || e.privateTo === heroId);
        for (const c of this.players()) {
          if (!c.controller) continue;
          c.push({ t: 'table_update', st: this.clock.now(), tableId: table.tableId, fromSeq, toSeq: table.seq, version: batch.version, events, view });
        }
      }
    }
    if (table === this.featuredTable()) {
      const spectators = [...this.conns].filter((c) => c.audience === 'SPECTATOR');
      if (spectators.length === 0) return;
      const view = table.spectatorView();
      const events = batch.events.filter((e) => e.visibility === 'PUBLIC');
      const toSeq = table.seq;
      this.later(SPECTATOR_DELAY_MS, () => {
        for (const c of spectators) c.push({ t: 'table_update', st: this.clock.now(), tableId: table.tableId, fromSeq, toSeq, version: batch.version, events, view });
      }, false);
    }
  }

  private syncSelfStack(): void {
    const p = this.heroTable?.player(this.self.playerId);
    if (p && p.stack !== this.self.stack) this.self = { ...this.self, stack: p.stack };
  }

  /* ------------------------------------------------------------ boot */

  private boot(): void {
    const at = this.scenario.at;
    if (this.scenario.id === 'pending' || this.self.status === 'PENDING_APPROVAL') {
      this.bootPending();
      return;
    }
    switch (at) {
      case 'lobby':
        this.bootLobby();
        break;
      case 'table':
      case 'move':
        this.bootTable47(at === 'move');
        break;
      case 'break':
        this.bootBreak();
        break;
      case 'paused':
      case 'frozen':
        this.bootHeld(at === 'frozen');
        break;
      case 'elim':
        this.bootPressure();
        break;
      case 'spectate':
        this.bootSpectate();
        break;
      case 'final':
        this.bootFinal();
        break;
    }
    this.later(5_000, () => this.tickCounters());
  }

  private table47(): MockTable {
    const t = this.createTable(47, 0, [9_850, 10_000, 10_400, 10_000, 9_700, null, 10_150, null, 10_000]);
    this.seatHero(t, 5);
    const villain = t.seats[3]?.player.playerId as string;
    t.queueScript({ hole: { [this.self.playerId]: pair(SCRIPTS.firstHand.hero), [villain]: pair(SCRIPTS.firstHand.villain) }, board: [...SCRIPTS.firstHand.board] as CardCode[] });
    t.queueScript({ hole: { [this.self.playerId]: pair(SCRIPTS.junk.hero) } });
    this.movements.push({ moveId: 'mv_initial', reason: 'INITIAL_SEATING', fromTableNumber: null, fromSeat: null, toTableNumber: 47, toSeat: 5, stack: MOCK_STARTING_STACK, requestedAt: this.clock.now(), completedAt: this.clock.now(), scoreBreakdown: null });
    return t;
  }

  private bootPending(): void {
    this.stage = 'PENDING';
    this.summary = { ...this.summary, status: 'REGISTRATION', clock: { ...this.summary.clock, levelStartedAt: null }, counters: { ...this.summary.counters, registered: 1_846, active: 0 } };
    this.self = { ...this.self, status: 'PENDING_APPROVAL' };
    this.later(9_000, () => {
      this.selfUpdate({ status: 'REGISTERED' });
      this.tevent({ kind: 'ANNOUNCEMENT', text: 'Your registration was approved. Seats are announced shortly.', from: 'DIRECTOR' });
      this.later(3_000, () => {
        const t = this.table47();
        const startAt = this.clock.now() + LOBBY_COUNTDOWN_MS;
        this.summary = {
          ...this.summary,
          status: 'STARTING',
          clock: { ...this.summary.clock, levelStartedAt: startAt },
          counters: { ...this.summary.counters, registered: MOCK_FIELD_SIZE, active: MOCK_FIELD_SIZE },
        };
        this.tevent({ kind: 'TOURNAMENT_STATUS_CHANGED', from: 'REGISTRATION', to: 'STARTING', reason: null });
        this.selfUpdate({});
        this.stage = 'LOBBY';
        this.later(LOBBY_COUNTDOWN_MS, () => this.beginRunning(t), false);
      });
    }, false);
  }

  private bootLobby(): void {
    const t = this.table47();
    this.stage = 'LOBBY';
    this.later(LOBBY_COUNTDOWN_MS, () => this.beginRunning(t), false);
  }

  private beginRunning(t: MockTable): void {
    const now = this.clock.now();
    this.summary = {
      ...this.summary,
      status: 'RUNNING',
      clock: { ...this.summary.clock, levelStartedAt: now, levelEndsAt: now + 900_000 },
    };
    this.tevent({ kind: 'TOURNAMENT_STATUS_CHANGED', from: 'STARTING', to: 'RUNNING', reason: null });
    this.stage = 'T47';
    t.start(1_200);
  }

  private bootTable47(moveSoon: boolean): void {
    const t = this.table47();
    const now = this.clock.now();
    this.summary = {
      ...this.summary,
      status: 'RUNNING',
      clock: { ...this.summary.clock, levelStartedAt: now - 140_000, levelEndsAt: now + 760_000 },
      counters: { ...this.summary.counters, active: 1_912, eliminated: 88, tables: 239, handsCompleted: 2_904 },
    };
    this.stage = 'T47';
    if (moveSoon) this.later(2_500, () => this.moveHero(t));
    else t.start(1_200);
  }

  private table12(levelIndex: number, stacks: Array<number | null> = [null, null, 18_250, 6_100, 41_300, 27_700, null, 15_400, 9_850]): MockTable {
    const t = this.createTable(12, levelIndex, stacks);
    return t;
  }

  private moveHero(from: MockTable): void {
    const fromSeat = from.seatOf(this.self.playerId);
    from.removePlayer(this.self.playerId, 'MOVED');
    const to = this.table12(this.summary.clock.levelIndex);
    const villain = to.seats[4]?.player.playerId as string;
    to.queueScript({ hole: { [this.self.playerId]: pair(SCRIPTS.setOfKings.hero), [villain]: pair(SCRIPTS.setOfKings.villain) }, board: [...SCRIPTS.setOfKings.board] as CardCode[], moves: { [villain]: 'call' } });
    this.seatHero(to, 1);
    this.featured = to;
    this.stage = 'T12';
    const now = this.clock.now();
    this.movements.push({ moveId: 'mv_balance_1', reason: 'BALANCE', fromTableNumber: 47, fromSeat, toTableNumber: 12, toSeat: 1, stack: this.heroPlayer.stack, requestedAt: now, completedAt: now, scoreBreakdown: null });
    this.selfUpdate({});
    this.notice({ kind: 'TABLE_MOVE', fromTableNumber: 47, fromSeat, toTableNumber: 12, toSeat: 1, stack: this.heroPlayer.stack });
    this.tevent({
      kind: 'TABLE_MOVE',
      movement: { moveId: 'mv_balance_1', playerId: this.self.playerId, reason: 'BALANCE', fromTableId: from.tableId, fromSeat, toTableId: to.tableId, toSeat: 1, stack: this.heroPlayer.stack, requestedAt: now, completedAt: now, scoreBreakdown: null },
      fromTableNumber: 47,
      toTableNumber: 12,
    });
    to.start(2_500);
    from.stop();
  }

  private bootBreak(): void {
    this.heroPlayer.stack = 12_450;
    const t = this.table12(4);
    this.seatHero(t, 1);
    const now = this.clock.now();
    const endsAt = now + 522_000;
    this.summary = {
      ...this.summary,
      status: 'BREAK',
      clock: { levelIndex: 4, levelStartedAt: now - 900_000, levelEndsAt: null, pausedRemainingMs: null, breakEndsAt: endsAt, pendingBreakAfterLevel: 4 },
      currentLevel: LEVELS[4] ?? null,
      nextLevel: LEVELS[5] ?? null,
      counters: { ...this.summary.counters, active: 412, eliminated: 1_588, tables: 52, handsCompleted: 18_211 },
    };
    t.hold('BREAK');
    t.start(500);
    this.stage = 'BREAK';
    this.later(522_000, () => this.endBreak(), false);
  }

  private bootHeld(frozen: boolean): void {
    this.heroPlayer.stack = 12_450;
    const t = this.table12(3);
    this.seatHero(t, 1);
    this.summary = {
      ...this.summary,
      status: 'PAUSED',
      clock: { levelIndex: 3, levelStartedAt: null, levelEndsAt: null, pausedRemainingMs: PAUSED_REMAINING_MS, breakEndsAt: null, pendingBreakAfterLevel: 4 },
      currentLevel: LEVELS[3] ?? null,
      nextLevel: LEVELS[4] ?? null,
      counters: { ...this.summary.counters, active: 640, eliminated: 1_360, tables: 80, handsCompleted: 12_390 },
    };
    if (frozen) t.frozen = true;
    t.hold(frozen ? 'ADMIN' : 'PAUSE');
    t.start(500);
    this.stage = 'HELD';
    this.later(800, () => this.tevent({ kind: 'TOURNAMENT_PAUSED', mode: frozen ? 'EMERGENCY_FREEZE' : 'AFTER_HAND', reason: null }), false);
  }

  private bootPressure(): void {
    this.heroPlayer.stack = 2_350;
    const t = this.table12(4, [null, null, 18_250, 6_100, 48_200, 27_700, null, 15_400, 9_850]);
    this.seatHero(t, 1);
    const now = this.clock.now();
    this.summary = {
      ...this.summary,
      status: 'RUNNING',
      clock: { levelIndex: 4, levelStartedAt: now - 300_000, levelEndsAt: now + 600_000, pausedRemainingMs: null, breakEndsAt: null, pendingBreakAfterLevel: 8 },
      currentLevel: LEVELS[4] ?? null,
      nextLevel: LEVELS[5] ?? null,
      counters: { ...this.summary.counters, active: 184, eliminated: 1_816, tables: 23, handsCompleted: 21_450 },
    };
    this.self = { ...this.self, handsPlayed: 211 };
    this.stage = 'PRESSURE';
    this.featured = t;
    this.queuePressure(t);
    t.start(1_500);
  }

  private bootSpectate(): void {
    const t = this.table12(4, [null, 22_400, 18_250, 6_100, 48_200, 27_700, null, 15_400, 9_850]);
    const now = this.clock.now();
    this.summary = {
      ...this.summary,
      status: 'RUNNING',
      clock: { levelIndex: 4, levelStartedAt: now - 300_000, levelEndsAt: now + 600_000, pausedRemainingMs: null, breakEndsAt: null, pendingBreakAfterLevel: 8 },
      currentLevel: LEVELS[4] ?? null,
      nextLevel: LEVELS[5] ?? null,
      counters: { ...this.summary.counters, active: 183, eliminated: 1_817, tables: 23, handsCompleted: 21_470 },
    };
    this.self = { ...this.self, status: 'ELIMINATED', stack: 0, finishPosition: 184, handsPlayed: 212, prizeMinor: 0 };
    this.featured = t;
    this.stage = 'OUT';
    t.start(800);
  }

  private bootFinal(): void {
    this.heroPlayer.stack = 11_400_000;
    const t = this.createTable(1, 23, [null, 3_000_000, null, null, null, 5_600_000, null, null, null], { finalTable: true });
    this.seatHero(t, 3);
    const now = this.clock.now();
    this.summary = {
      ...this.summary,
      status: 'RUNNING',
      clock: { levelIndex: 23, levelStartedAt: now - 120_000, levelEndsAt: now + 780_000, pausedRemainingMs: null, breakEndsAt: null, pendingBreakAfterLevel: null },
      currentLevel: LEVELS[23] ?? null,
      nextLevel: null,
      counters: { ...this.summary.counters, active: 3, eliminated: 1_997, tables: 1, handsCompleted: 31_204, largestPot: 6_200_000 },
    };
    this.self = { ...this.self, handsPlayed: 486 };
    this.stage = 'FINAL';
    this.featured = t;
    this.queueFinal(t);
    this.later(2_500, () => {
      const players = t.seats.flatMap((s) => (s ? [{ playerId: s.player.playerId, displayName: s.player.displayName, seat: s.seat, stack: s.player.stack }] : []));
      this.summary = { ...this.summary, status: 'FINAL_TABLE' };
      this.tevent({ kind: 'FINAL_TABLE_FORMED', tableId: t.tableId, players });
      this.tevent({ kind: 'TOURNAMENT_STATUS_CHANGED', from: 'RUNNING', to: 'FINAL_TABLE', reason: null });
      t.start(4_500);
    }, false);
  }

  /* ------------------------------------------------------------ script */

  private onHandComplete(table: MockTable, report: HandReport): void {
    this.summary = { ...this.summary, counters: { ...this.summary.counters, handsCompleted: this.summary.counters.handsCompleted + 1 } };
    const heroBusted = report.busted.includes(this.self.playerId);
    for (const id of report.busted) if (id !== this.self.playerId) this.bustBot(table, id, report);
    if (heroBusted) {
      this.eliminateHero(table);
      this.refill(table);
      return;
    }
    if (table !== this.heroTable) {
      this.refill(table);
      return;
    }
    this.heroHandsAtTable += 1;
    switch (this.stage) {
      case 'T47':
        if (this.heroHandsAtTable >= MOVE_AFTER_HANDS) this.moveHero(table);
        break;
      case 'T12':
        if (this.heroHandsAtTable === 1) this.milestone(250);
        if (this.heroHandsAtTable >= 2) this.startBreak();
        break;
      case 'PRESSURE':
        this.queuePressure(table);
        break;
      case 'FINAL':
        this.afterFinalHand(table);
        return;
      default:
        break;
    }
    this.refill(table);
  }

  private bustBot(table: MockTable, playerId: string, report: HandReport): void {
    const name = table.player(playerId)?.displayName ?? 'A player';
    const finishPosition = this.summary.counters.active;
    this.eliminatedBots.set(playerId, finishPosition);
    table.removePlayer(playerId, 'ELIMINATED');
    this.summary = {
      ...this.summary,
      counters: { ...this.summary.counters, active: Math.max(1, this.summary.counters.active - 1), eliminated: this.summary.counters.eliminated + 1 },
    };
    this.tevent({
      kind: 'PLAYER_ELIMINATED',
      record: {
        playerId,
        entryId: `ent_${playerId}`,
        finishPosition,
        tiedCount: 1,
        eliminatedAt: this.clock.now(),
        handId: `H-${table.tableNumber}-${report.handNumber}`,
        handNumber: report.handNumber,
        tableId: table.tableId,
        startingStackOfHand: report.startingStacks[playerId] ?? 0,
        batchId: `b_${report.handNumber}`,
      },
      displayName: name,
      playersRemaining: this.summary.counters.active,
    });
  }

  /** Balancing stand-in: keep busy tables at six or more players (not at the final table). */
  private refill(table: MockTable): void {
    if (this.stage === 'FINAL' || this.stage === 'DONE') return;
    const occupied = table.seats.filter(Boolean).length;
    if (occupied >= 6) return;
    const seat = table.seats.findIndex((s) => s === null);
    if (seat < 0) return;
    table.seatPlayer(this.nextBot(14_000 + Math.round(this.rng() * 30) * 500), seat);
  }

  private milestone(remaining: number): void {
    this.summary = { ...this.summary, counters: { ...this.summary.counters, active: Math.min(this.summary.counters.active, remaining) } };
    this.tevent({ kind: 'MILESTONE', code: `PLAYERS_${remaining}`, text: `${remaining} players remain`, playersRemaining: remaining });
  }

  private startBreak(): void {
    const table = this.heroTable;
    if (!table) return;
    this.stage = 'BREAK';
    const now = this.clock.now();
    const breakMs = Math.round(BREAK_MS / this.speed);
    const endsAt = now + breakMs;
    const nextLevel = LEVELS[this.summary.clock.levelIndex + 1] ?? null;
    this.summary = { ...this.summary, status: 'BREAK', clock: { ...this.summary.clock, levelEndsAt: null, breakEndsAt: endsAt } };
    this.tevent({ kind: 'TOURNAMENT_STATUS_CHANGED', from: 'RUNNING', to: 'BREAK', reason: 'Scheduled break' });
    this.tevent({ kind: 'BREAK_STARTED', endsAt, nextLevel, message: 'Stretch your legs — play resumes automatically.' });
    table.hold('BREAK');
    this.later(breakMs, () => this.endBreak(), false);
  }

  private endBreak(): void {
    const table = this.heroTable;
    const now = this.clock.now();
    const levelIndex = this.summary.clock.levelIndex + 1;
    const from = this.summary.currentLevel;
    const to = LEVELS[levelIndex] ?? LEVELS[LEVELS.length - 1];
    this.summary = {
      ...this.summary,
      status: 'RUNNING',
      clock: { ...this.summary.clock, levelIndex, levelStartedAt: now, levelEndsAt: now + 900_000, breakEndsAt: null },
      currentLevel: to ?? null,
      nextLevel: LEVELS[levelIndex + 1] ?? null,
    };
    this.tevent({ kind: 'BREAK_ENDED' });
    this.tevent({ kind: 'TOURNAMENT_STATUS_CHANGED', from: 'BREAK', to: 'RUNNING', reason: null });
    if (to) this.tevent({ kind: 'BLIND_LEVEL_CHANGED', from, to, levelEndsAt: now + 900_000 });
    if (table) {
      table.setBlinds(blindsFor(levelIndex));
      this.stage = 'PRESSURE';
      this.queuePressure(table);
      table.release('BREAK');
    }
  }

  private biggestBot(table: MockTable): string | null {
    let best: { id: string; stack: number } | null = null;
    for (const s of table.seats) {
      if (!s || s.player.human) continue;
      if (!best || s.player.stack > best.stack) best = { id: s.player.playerId, stack: s.player.stack };
    }
    return best?.id ?? null;
  }

  private queuePressure(table: MockTable): void {
    const villain = this.biggestBot(table);
    if (!villain) return;
    const script = SCRIPTS.pressure[this.pressureRound % SCRIPTS.pressure.length] as (typeof SCRIPTS.pressure)[number];
    this.pressureRound += 1;
    const moves: HandScript['moves'] = {};
    for (const s of table.seats) if (s && !s.player.human) moves[s.player.playerId] = s.player.playerId === villain ? 'shove' : 'fold';
    table.queueScript({ hole: { [this.self.playerId]: pair(script.hero), [villain]: pair(script.villain) }, board: [...script.board] as CardCode[], moves });
  }

  private queueFinal(table: MockTable): void {
    const bots = table.seats.filter((s) => s !== null && !s.player.human).map((s) => s?.player.playerId as string);
    const [x, y] = bots.length >= 2 ? [bots[0] as string, bots[1] as string] : [null, bots[0] ?? null];
    const villain = x ?? y;
    if (!villain) return;
    const script = x ? SCRIPTS.finalX : SCRIPTS.finalY;
    const moves: HandScript['moves'] = { [villain]: 'shove' };
    if (x && y) moves[y] = 'fold';
    table.queueScript({ hole: { [this.self.playerId]: pair(script.hero), [villain]: pair(script.villain) }, board: [...script.board] as CardCode[], moves });
  }

  private afterFinalHand(table: MockTable): void {
    const remaining = table.seats.filter((s) => s !== null && s.player.stack > 0);
    if (remaining.length === 2 && this.summary.counters.active === 2 && !this.headsUpAnnounced) {
      this.headsUpAnnounced = true;
      this.tevent({ kind: 'MILESTONE', code: 'HEADS_UP', text: 'Heads-up for the title', playersRemaining: 2 });
    }
    if (remaining.length === 1 && remaining[0]?.player.human) {
      this.crownHero(table);
      return;
    }
    this.queueFinal(table);
  }

  private headsUpAnnounced = false;

  private crownHero(table: MockTable): void {
    table.stop();
    this.stage = 'DONE';
    const now = this.clock.now();
    const stack = this.heroPlayer.stack;
    this.summary = { ...this.summary, status: 'COMPLETED', counters: { ...this.summary.counters, active: 1 } };
    this.selfUpdate({ finishPosition: 1, prizeMinor: prizeFor(1), stack });
    this.notice({ kind: 'CHAMPION', playersInField: MOCK_FIELD_SIZE, stack });
    this.tevent({ kind: 'TOURNAMENT_COMPLETED', winnerId: this.self.playerId, winnerName: this.self.displayName, completedAt: now });
    this.tevent({ kind: 'TOURNAMENT_STATUS_CHANGED', from: 'FINAL_TABLE', to: 'COMPLETED', reason: null });
  }

  private eliminateHero(table: MockTable): void {
    const finishPosition = this.summary.counters.active;
    const prizeMinor = prizeFor(finishPosition);
    table.removePlayer(this.self.playerId, 'ELIMINATED');
    this.featured = table;
    this.heroTable = null;
    this.stage = 'OUT';
    this.summary = {
      ...this.summary,
      counters: { ...this.summary.counters, active: Math.max(1, finishPosition - 1), eliminated: this.summary.counters.eliminated + 1 },
    };
    this.selfUpdate({ status: 'ELIMINATED', tableId: null, tableNumber: null, seat: null, stack: 0, finishPosition, prizeMinor });
    this.notice({ kind: 'ELIMINATED', finishPosition, tiedCount: 1, handsPlayed: this.self.handsPlayed, prizeMinor, currency: MOCK_CURRENCY });
    this.tevent({
      kind: 'PLAYER_ELIMINATED',
      record: {
        playerId: this.self.playerId,
        entryId: `ent_${this.self.playerId}`,
        finishPosition,
        tiedCount: 1,
        eliminatedAt: this.clock.now(),
        handId: `H-${table.tableNumber}-${table.handNumber}`,
        handNumber: table.handNumber,
        tableId: table.tableId,
        startingStackOfHand: 0,
        batchId: `b_${table.handNumber}`,
      },
      displayName: this.self.displayName,
      playersRemaining: this.summary.counters.active,
    });
  }

  private tickCounters(): void {
    const c = this.summary.counters;
    const running = this.summary.status === 'RUNNING';
    if (running && c.active > 420 && (this.stage === 'T47' || this.stage === 'T12')) {
      const busts = 1 + Math.floor(this.rng() * 5);
      const active = c.active - busts;
      this.summary = { ...this.summary, counters: { ...c, active, eliminated: c.eliminated + busts, tables: Math.ceil(active / 8), handsCompleted: c.handsCompleted + 7 } };
      this.tevent({ kind: 'COUNTERS', counters: this.summary.counters });
    }
    if (this.stage !== 'DONE') this.later(5_000, () => this.tickCounters());
  }

  /* ------------------------------------------------------------ REST data */

  history(): PlayerHistoryDto {
    this.syncSelfStack();
    return {
      finishPosition: this.self.finishPosition,
      tiedCount: 1,
      prizeMinor: this.self.prizeMinor,
      currency: MOCK_CURRENCY,
      handsPlayed: this.self.handsPlayed,
      largestPotWon: this.largestPotWon,
      startingStack: MOCK_STARTING_STACK,
      finalStack: this.self.stack,
      movements: this.movements,
    };
  }

  leaderboard(mode: 'stack' | 'finish', offset: number, limit: number): LeaderboardDto {
    this.syncSelfStack();
    const rows = mode === 'stack' ? this.stackRows() : this.finishRows();
    return {
      mode,
      label: mode === 'stack' ? 'Current stack ranking' : 'Finishing positions',
      rows: rows.slice(offset, offset + limit),
      total: rows.length,
      offset,
      limit,
    };
  }

  private liveStacks(): Map<string, { stack: number; tableNumber: number }> {
    const out = new Map<string, { stack: number; tableNumber: number }>();
    for (const t of this.tables.values()) {
      for (const s of t.seats) if (s) out.set(s.player.playerId, { stack: s.player.stack, tableNumber: t.tableNumber });
    }
    return out;
  }

  private stackRows(): LeaderboardRowDto[] {
    const c = this.summary.counters;
    const heroAlive = this.self.status !== 'ELIMINATED';
    const fieldAlive = this.fieldAliveCount();
    const field = mockField().filter((f) => !this.eliminatedBots.has(f.playerId)).slice(0, fieldAlive);
    const live = this.liveStacks();
    const weights = field.map((f) => f.strength ** 3 + 0.05);
    const liveChips = [...live.values()].reduce((s, v) => s + v.stack, 0);
    const pool = Math.max(0, c.totalChips - liveChips);
    const weightSum = weights.reduce((s, w, i) => s + (live.has((field[i] as FieldPlayer).playerId) ? 0 : w), 0) || 1;
    const tables = Math.max(1, c.tables);
    const rows: LeaderboardRowDto[] = field.map((f, i) => {
      const l = live.get(f.playerId);
      const stack = l ? l.stack : Math.max(100, Math.round(((weights[i] as number) / weightSum) * pool / 25) * 25);
      return { rank: 0, playerId: f.playerId, publicId: f.publicId, displayName: f.displayName, stack, finishPosition: null, tiedCount: 1, prizeMinor: 0, status: 'SEATED', tableNumber: l?.tableNumber ?? (i % tables) + 1 };
    });
    if (heroAlive && this.self.status !== 'PENDING_APPROVAL') {
      rows.push({ rank: 0, playerId: this.self.playerId, publicId: this.self.publicId, displayName: this.self.displayName, stack: this.self.stack, finishPosition: null, tiedCount: 1, prizeMinor: 0, status: this.self.status, tableNumber: this.self.tableNumber });
    }
    rows.sort((a, b) => b.stack - a.stack || a.displayName.localeCompare(b.displayName));
    rows.forEach((r, i) => (r.rank = i + 1));
    return rows;
  }

  private fieldAliveCount(): number {
    const heroAlive = this.self.status !== 'ELIMINATED' && this.self.status !== 'PENDING_APPROVAL';
    return Math.max(0, this.summary.counters.active - (heroAlive ? 1 : 0));
  }

  private finishRows(): LeaderboardRowDto[] {
    const c = this.summary.counters;
    const byId = new Map(mockField().map((f) => [f.playerId, f]));
    const row = (f: { playerId: string; publicId: string; displayName: string }, pos: number, status: TournamentPlayerStatus = 'ELIMINATED'): LeaderboardRowDto => ({
      rank: pos,
      playerId: f.playerId,
      publicId: f.publicId,
      displayName: f.displayName,
      stack: 0,
      finishPosition: pos,
      tiedCount: 1,
      prizeMinor: prizeFor(pos),
      status,
      tableNumber: null,
    });
    const taken = new Map<number, LeaderboardRowDto>();
    for (const [id, pos] of this.eliminatedBots) {
      const f = byId.get(id);
      if (f) taken.set(pos, row(f, pos));
    }
    if (this.self.finishPosition !== null) taken.set(this.self.finishPosition, row(this.self, this.self.finishPosition, this.self.status));
    const out = mockField().filter((f) => !this.eliminatedBots.has(f.playerId)).slice(this.fieldAliveCount());
    let idx = out.length - 1;
    for (let pos = MOCK_FIELD_SIZE; pos > c.active && idx >= 0; pos--) {
      if (taken.has(pos)) continue;
      taken.set(pos, row(out[idx] as FieldPlayer, pos));
      idx -= 1;
    }
    return [...taken.values()].sort((a, b) => (a.finishPosition ?? 0) - (b.finishPosition ?? 0));
  }
}
