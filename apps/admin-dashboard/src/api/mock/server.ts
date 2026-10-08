import { ROLE_PERMISSIONS, canTransitionTournament } from '@jpb/shared-types';
import type { AuditEntryDto, Permission, TournamentEvent, TournamentEventEnvelope, TournamentStatus } from '@jpb/shared-types';
import { breakAfterLevel } from '../../lib/schedule';
import { appendHand, ensureHands } from './hands';
import { Rng } from './rng';
import type { MockAdmin, MockPlayer, MockTable, MockTournament, MockWorld } from './state';
import { counters, isActivePlayer, openTables, summary } from './views';
import { auditHash, buildWorld } from './world';

export class MockHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: unknown = null,
  ) {
    super(message);
  }
}

export type EventListener = (t: MockTournament, env: TournamentEventEnvelope) => void;
export type TableListener = (t: MockTournament, table: MockTable) => void;

/**
 * The mock "game server": owns the world state, applies admin commands with
 * the same rules as the real server (FSM transitions, clock semantics,
 * audit entries), emits tournament events, and runs a scripted simulation
 * (`tick`) so the control room has realistic live traffic.
 */
export class MockServer {
  readonly world: MockWorld;
  private readonly eventListeners = new Set<EventListener>();
  private readonly tableListeners = new Set<TableListener>();
  private readonly rng = new Rng('ticker');
  private tickCount = 0;
  private lastMetricAt: number;

  constructor(readonly now: () => number = () => Date.now()) {
    this.world = buildWorld(now());
    this.lastMetricAt = now();
  }

  // ------------------------------------------------------------ lookup

  tournament(id: string): MockTournament {
    const t = this.world.tournaments.find((x) => x.id === id);
    if (!t) throw new MockHttpError(404, 'NOT_FOUND', 'Tournament not found.');
    return t;
  }

  findTable(tableId: string): { t: MockTournament; table: MockTable } {
    for (const t of this.world.tournaments) {
      const table = t.tables.find((x) => x.tableId === tableId);
      if (table) return { t, table };
    }
    throw new MockHttpError(404, 'NOT_FOUND', 'Table not found.');
  }

  findPlayer(playerId: string): { t: MockTournament; p: MockPlayer } {
    for (const t of this.world.tournaments) {
      const p = t.players.find((x) => x.playerId === playerId || x.entryId === playerId);
      if (p) return { t, p };
    }
    throw new MockHttpError(404, 'NOT_FOUND', 'Player not found.');
  }

  nextId(prefix: string): string {
    this.world.idCounter += 1;
    return `${prefix}_${this.world.idCounter}`;
  }

  // ------------------------------------------------------------ sessions

  currentAdmin(): MockAdmin | null {
    const s = this.world.sessions.find((x) => x.id === this.world.currentSessionId && x.revokedAt === null);
    if (!s || s.expiresAt < this.now()) return null;
    return this.world.admins.find((a) => a.id === s.adminId && !a.disabled) ?? null;
  }

  permissionsOf(admin: MockAdmin): Permission[] {
    return [...ROLE_PERMISSIONS[admin.role]];
  }

  // ------------------------------------------------------------ events & audit

  onEvent(l: EventListener): () => void {
    this.eventListeners.add(l);
    return () => this.eventListeners.delete(l);
  }

  onTable(l: TableListener): () => void {
    this.tableListeners.add(l);
    return () => this.tableListeners.delete(l);
  }

  emit(t: MockTournament, event: TournamentEvent): void {
    t.seq += 1;
    const env: TournamentEventEnvelope = { tournamentId: t.id, seq: t.seq, at: this.now(), event };
    t.events.push(env);
    if (t.events.length > 200) t.events.splice(0, t.events.length - 200);
    for (const l of [...this.eventListeners]) l(t, env);
  }

  tableChanged(t: MockTournament, table: MockTable): void {
    for (const l of [...this.tableListeners]) l(t, table);
  }

  audit(admin: MockAdmin | null, action: string, target: string, tournamentId: string | null, reason: string | null, before: unknown, after: unknown): AuditEntryDto {
    const prev = this.world.audit[this.world.audit.length - 1];
    const seq = (prev?.seq ?? 0) + 1;
    const base = { at: this.now(), tournamentId, adminId: admin?.id ?? null, adminUsername: admin?.username ?? 'SYSTEM', action, target, reason, beforeState: before, afterState: after, ip: '127.0.0.1' };
    const prevHash = prev?.hash ?? '0'.repeat(64);
    const entry: AuditEntryDto = { ...base, id: `aud_${seq}`, seq, prevHash, hash: auditHash(prevHash, seq, base) };
    this.world.audit.push(entry);
    return entry;
  }

  // ------------------------------------------------------------ lifecycle

  transition(t: MockTournament, to: TournamentStatus, reason: string | null): void {
    if (!canTransitionTournament(t.status, to)) {
      throw new MockHttpError(409, 'INVALID_TRANSITION', `The tournament cannot go from ${t.status.replace(/_/g, ' ').toLowerCase()} to ${to.replace(/_/g, ' ').toLowerCase()}.`);
    }
    const from = t.status;
    t.status = to;
    this.emit(t, { kind: 'TOURNAMENT_STATUS_CHANGED', from, to, reason });
  }

  private holdAll(t: MockTournament, reason: 'PAUSE' | 'BREAK'): void {
    for (const tb of openTables(t)) {
      if (!tb.holds.includes(reason)) tb.holds = [...tb.holds, reason];
      tb.status = 'HELD';
    }
  }

  private releaseAll(t: MockTournament, reason: 'PAUSE' | 'BREAK'): void {
    for (const tb of openTables(t)) {
      tb.holds = tb.holds.filter((h) => h !== reason);
      if (tb.holds.length === 0) tb.status = 'BETWEEN_HANDS';
      tb.lastProgressAt = this.now();
    }
  }

  private stopClock(t: MockTournament): void {
    if (t.clock.levelEndsAt !== null) t.clock = { ...t.clock, pausedRemainingMs: Math.max(0, t.clock.levelEndsAt - this.now()), levelEndsAt: null };
  }

  private startClock(t: MockTournament): void {
    if (t.clock.levelEndsAt === null && t.clock.breakEndsAt === null) {
      const dur = (t.config.blindSchedule[t.clock.levelIndex]?.durationSeconds ?? 600) * 1000;
      const rem = t.clock.pausedRemainingMs ?? dur;
      t.clock = { ...t.clock, levelStartedAt: this.now() - (dur - rem), levelEndsAt: this.now() + rem, pausedRemainingMs: null };
    }
  }

  pause(t: MockTournament, reason: string | null): void {
    if (t.status === 'PAUSED') throw new MockHttpError(409, 'ALREADY_PAUSED', 'The tournament is already paused.');
    t.resumeTo = t.status;
    this.transition(t, 'PAUSED', reason);
    this.stopClock(t);
    this.holdAll(t, 'PAUSE');
    this.emit(t, { kind: 'TOURNAMENT_PAUSED', mode: 'AFTER_HAND', reason });
  }

  resume(t: MockTournament): void {
    if (t.status !== 'PAUSED') throw new MockHttpError(409, 'NOT_PAUSED', 'The tournament is not paused.');
    const to = t.resumeTo ?? 'RUNNING';
    this.transition(t, to, null);
    t.resumeTo = null;
    if (to !== 'BREAK' && !t.frozen) this.startClock(t);
    this.releaseAll(t, 'PAUSE');
    this.emit(t, { kind: 'TOURNAMENT_RESUMED' });
  }

  freeze(t: MockTournament, reason: string): void {
    if (t.frozen) throw new MockHttpError(409, 'ALREADY_FROZEN', 'The tournament is already frozen.');
    t.frozen = true;
    this.stopClock(t);
    for (const tb of openTables(t)) tb.frozen = true;
    this.emit(t, { kind: 'TOURNAMENT_PAUSED', mode: 'EMERGENCY_FREEZE', reason });
  }

  unfreeze(t: MockTournament): void {
    if (!t.frozen) throw new MockHttpError(409, 'NOT_FROZEN', 'The tournament is not frozen.');
    t.frozen = false;
    for (const tb of openTables(t)) {
      tb.frozen = false;
      tb.lastProgressAt = this.now();
    }
    if (t.status === 'RUNNING' || t.status === 'FINAL_TABLE') this.startClock(t);
    this.emit(t, { kind: 'TOURNAMENT_RESUMED' });
  }

  cancel(t: MockTournament, reason: string): void {
    this.transition(t, 'CANCELLED', reason);
    t.completedAt = this.now();
    for (const tb of t.tables) tb.status = 'CLOSED';
    t.clock = { ...t.clock, levelEndsAt: null, breakEndsAt: null };
  }

  start(t: MockTournament): void {
    const seated = t.players.filter((p) => p.status === 'REGISTERED');
    if (seated.length < t.config.minPlayers) throw new MockHttpError(409, 'NOT_ENOUGH_PLAYERS', `At least ${t.config.minPlayers} registered players are needed to start.`);
    this.transition(t, 'STARTING', null);
    const size = t.config.tables.targetSize;
    const count = Math.ceil(seated.length / size);
    t.tables = Array.from({ length: count }, (_, i) => ({
      tableId: `tbl_${t.seedKey}_${i + 1}`,
      tableNumber: i + 1,
      maxSeats: t.config.tables.maxSize,
      seats: Array.from({ length: t.config.tables.maxSize }, () => null),
      status: 'BETWEEN_HANDS',
      holds: [],
      frozen: false,
      handNumber: 0,
      isFinalTable: count === 1,
      lastProgressAt: this.now(),
      stalled: false,
      handStep: 0,
      revealedTo: [],
    }));
    seated.forEach((p, i) => {
      const tb = t.tables[i % count]!;
      const seat = Math.floor(i / count);
      tb.seats[seat] = p.playerId;
      Object.assign(p, { status: 'SEATED', tableId: tb.tableId, seat, connected: true });
    });
    t.startedAt = this.now();
    t.publicEntropy = t.serverSeedHash.split('').reverse().join('');
    t.clock = { levelIndex: 0, levelStartedAt: null, levelEndsAt: null, pausedRemainingMs: null, breakEndsAt: null, pendingBreakAfterLevel: null };
    this.startClock(t);
    this.transition(t, count === 1 ? 'FINAL_TABLE' : 'RUNNING', null);
  }

  // ------------------------------------------------------------ clock

  setLevel(t: MockTournament, index: number): void {
    const schedule = t.config.blindSchedule;
    if (index < 0 || index >= schedule.length) throw new MockHttpError(400, 'INVALID_LEVEL', `Choose a level between 1 and ${schedule.length}.`);
    const from = schedule[t.clock.levelIndex] ?? null;
    const dur = schedule[index]!.durationSeconds * 1000;
    const running = t.clock.levelEndsAt !== null;
    t.clock = { ...t.clock, levelIndex: index, levelStartedAt: running ? this.now() : null, levelEndsAt: running ? this.now() + dur : null, pausedRemainingMs: running ? null : dur };
    this.emit(t, { kind: 'BLIND_LEVEL_CHANGED', from, to: schedule[index]!, levelEndsAt: t.clock.levelEndsAt });
  }

  addTime(t: MockTournament, ms: number): void {
    if (t.clock.breakEndsAt !== null) {
      t.clock = { ...t.clock, breakEndsAt: Math.max(this.now() + 1000, t.clock.breakEndsAt + ms) };
    } else if (t.clock.levelEndsAt !== null) {
      t.clock = { ...t.clock, levelEndsAt: Math.max(this.now() + 1000, t.clock.levelEndsAt + ms) };
    } else {
      t.clock = { ...t.clock, pausedRemainingMs: Math.max(1000, (t.clock.pausedRemainingMs ?? 0) + ms) };
    }
    this.emit(t, { kind: 'COUNTERS', counters: counters(t) });
  }

  startBreak(t: MockTournament, durationSeconds: number, message: string | null = null): void {
    t.resumeTo = t.status === 'FINAL_TABLE' ? 'FINAL_TABLE' : 'RUNNING';
    this.transition(t, 'BREAK', null);
    this.stopClock(t);
    t.clock = { ...t.clock, breakEndsAt: this.now() + durationSeconds * 1000 };
    this.holdAll(t, 'BREAK');
    const next = t.config.blindSchedule[t.clock.levelIndex] ?? null;
    this.emit(t, { kind: 'BREAK_STARTED', endsAt: t.clock.breakEndsAt!, nextLevel: next, message });
  }

  endBreak(t: MockTournament): void {
    if (t.status !== 'BREAK') throw new MockHttpError(409, 'NOT_ON_BREAK', 'The tournament is not on a break.');
    this.transition(t, t.resumeTo ?? 'RUNNING', null);
    t.resumeTo = null;
    t.clock = { ...t.clock, breakEndsAt: null };
    if (!t.frozen) this.startClock(t);
    this.releaseAll(t, 'BREAK');
    this.emit(t, { kind: 'BREAK_ENDED' });
  }

  private advanceClock(t: MockTournament, now: number): void {
    if (t.frozen) return;
    if (t.status === 'BREAK' && t.clock.breakEndsAt !== null && now >= t.clock.breakEndsAt) {
      this.endBreak(t);
      return;
    }
    if ((t.status === 'RUNNING' || t.status === 'FINAL_TABLE') && t.clock.levelEndsAt !== null && now >= t.clock.levelEndsAt) {
      const schedule = t.config.blindSchedule;
      const ended = schedule[t.clock.levelIndex]!;
      const nextIndex = Math.min(t.clock.levelIndex + 1, schedule.length - 1);
      const rule = breakAfterLevel(t.config.breaks, ended.level);
      if (rule) {
        t.clock = { ...t.clock, levelIndex: nextIndex, levelEndsAt: null, pausedRemainingMs: schedule[nextIndex]!.durationSeconds * 1000 };
        this.emit(t, { kind: 'BLIND_LEVEL_CHANGED', from: ended, to: schedule[nextIndex]!, levelEndsAt: null });
        t.resumeTo = t.status;
        this.transition(t, 'BREAK', null);
        t.clock = { ...t.clock, breakEndsAt: now + rule.durationSeconds * 1000 };
        this.holdAll(t, 'BREAK');
        this.emit(t, { kind: 'BREAK_STARTED', endsAt: t.clock.breakEndsAt!, nextLevel: schedule[nextIndex]!, message: rule.message ?? null });
      } else {
        this.setLevel(t, nextIndex);
      }
    }
  }

  // ------------------------------------------------------------ simulation

  /** One step of scripted live traffic (≈ every 1.2 s in the browser; manual in tests). */
  tick(): void {
    const now = this.now();
    this.tickCount += 1;
    for (const t of this.world.tournaments) {
      if (t.startedAt === null) continue;
      if (t.status === 'COMPLETED' || t.status === 'CANCELLED' || t.status === 'DRAFT') continue;
      this.advanceClock(t, now);
      if (t.frozen || !(t.status === 'RUNNING' || t.status === 'FINAL_TABLE')) continue;
      this.progressTables(t, now);
      const field = counters(t).active;
      const bustChance = t.seedKey === 'campus' ? 0.015 : field > 100 ? 0.42 : 0.12;
      if (this.rng.chance(bustChance)) this.eliminateOne(t, now);
      if (this.tickCount % 23 === 0) this.balanceMove(t, now);
      if (this.tickCount % 5 === 0) this.emit(t, { kind: 'COUNTERS', counters: counters(t) });
    }
    if (now - this.lastMetricAt >= 15_000) {
      this.lastMetricAt = now;
      for (const t of this.world.tournaments) if (t.metrics.length && (t.status === 'RUNNING' || t.status === 'FINAL_TABLE' || t.status === 'BREAK' || t.status === 'PAUSED')) this.appendMetric(t, now);
    }
  }

  private progressTables(t: MockTournament, now: number): void {
    const open = openTables(t);
    const n = Math.max(1, Math.round(open.length * 0.35));
    for (let i = 0; i < n; i++) {
      const tb = this.rng.pick(open);
      if (tb.stalled || tb.frozen || tb.status === 'HELD' || tb.status === 'CLOSED') continue;
      tb.handStep += 1;
      tb.lastProgressAt = now;
      if (tb.handStep > 8) {
        tb.handStep = 0;
        tb.handNumber += 1;
        t.handsCompleted += 1;
        tb.status = 'IN_HAND';
        const row = appendHand(t, tb, now);
        if (row.totalPot > t.largestPot) t.largestPot = row.totalPot;
      } else {
        tb.status = tb.handStep === 8 ? 'BETWEEN_HANDS' : 'IN_HAND';
      }
      this.tableChanged(t, tb);
    }
  }

  private eliminateOne(t: MockTournament, now: number): void {
    const tables = openTables(t).filter((tb) => tb.seats.filter(Boolean).length >= 3 && !tb.stalled && tb.status !== 'HELD');
    if (tables.length === 0) return;
    const tb = this.rng.pick(tables);
    const ids = tb.seats.filter((x): x is string => x !== null);
    const victim = t.players.find((p) => p.playerId === this.rng.pick(ids));
    const winnerId = ids.find((id) => id !== victim?.playerId);
    const winner = t.players.find((p) => p.playerId === winnerId);
    if (!victim || !winner || victim.status !== 'SEATED') return;
    const remainingBefore = t.players.filter(isActivePlayer).length;
    winner.stack += victim.stack;
    const record = {
      playerId: victim.playerId,
      entryId: victim.entryId,
      finishPosition: remainingBefore,
      tiedCount: 1,
      eliminatedAt: now,
      handId: `hand_${t.seedKey}_${Math.max(0, t.hands.length - 1)}`,
      handNumber: tb.handNumber,
      tableId: tb.tableId,
      startingStackOfHand: victim.stack,
      batchId: this.nextId('batch'),
    };
    tb.seats[victim.seat ?? 0] = null;
    Object.assign(victim, { status: 'ELIMINATED', stack: 0, finishPosition: remainingBefore, tableId: null, seat: null, elimination: record });
    const place = t.config.prizeStructure.places.find((x) => x.position === remainingBefore);
    if (place) victim.prizeMinor = place.amountMinor;
    const remaining = remainingBefore - 1;
    this.emit(t, { kind: 'PLAYER_ELIMINATED', record, displayName: victim.displayName, playersRemaining: remaining });
    if (remaining % 100 === 0 || remaining === t.config.prizeStructure.places.length) {
      const bubble = remaining === t.config.prizeStructure.places.length;
      this.emit(t, { kind: 'MILESTONE', code: bubble ? 'IN_THE_MONEY' : `PLAYERS_${remaining}`, text: bubble ? `In the money! ${remaining} players remain` : `${remaining.toLocaleString('en-US')} players remain`, playersRemaining: remaining });
    }
    if (tb.seats.filter(Boolean).length <= 4 && openTables(t).length > 1 && this.rng.chance(0.5)) this.breakTable(t, tb, now);
    this.tableChanged(t, tb);
  }

  breakTable(t: MockTournament, tb: MockTable, now: number): void {
    const movers = tb.seats.filter((x): x is string => x !== null);
    let moved = 0;
    for (const id of movers) {
      const dest = openTables(t).find((x) => x !== tb && x.seats.some((s) => s === null));
      const p = t.players.find((x) => x.playerId === id);
      if (!dest || !p) continue;
      const seat = dest.seats.findIndex((s) => s === null);
      const fromSeat = p.seat;
      tb.seats[fromSeat ?? 0] = null;
      dest.seats[seat] = id;
      Object.assign(p, { tableId: dest.tableId, seat });
      moved += 1;
      const movement = { moveId: this.nextId('mv'), playerId: id, reason: 'TABLE_BREAK' as const, fromTableId: tb.tableId, fromSeat, toTableId: dest.tableId, toSeat: seat, stack: p.stack, requestedAt: now, completedAt: now + 2000, scoreBreakdown: { position: 1.5, blindFairness: 2, recentMove: 0, seatCompatibility: 0.5 } };
      p.movements.push({ moveId: movement.moveId, reason: 'TABLE_BREAK', fromTableNumber: tb.tableNumber, fromSeat, toTableNumber: dest.tableNumber, toSeat: seat, stack: p.stack, requestedAt: now, completedAt: now + 2000, scoreBreakdown: movement.scoreBreakdown });
      this.emit(t, { kind: 'TABLE_MOVE', movement, fromTableNumber: tb.tableNumber, toTableNumber: dest.tableNumber });
    }
    tb.status = 'CLOSED';
    tb.holds = [];
    this.emit(t, { kind: 'TABLE_BROKEN', tableId: tb.tableId, tableNumber: tb.tableNumber, playersMoved: moved });
  }

  private balanceMove(t: MockTournament, now: number): void {
    const open = openTables(t).filter((tb) => tb.status !== 'HELD' && !tb.stalled);
    if (open.length < 2) return;
    const sorted = open.slice().sort((a, b) => b.seats.filter(Boolean).length - a.seats.filter(Boolean).length);
    const from = sorted[0]!;
    const to = sorted[sorted.length - 1]!;
    if (from.seats.filter(Boolean).length - to.seats.filter(Boolean).length < 2) return;
    const fromSeat = from.seats.findIndex((s) => s !== null);
    const id = from.seats[fromSeat]!;
    const seat = to.seats.findIndex((s) => s === null);
    const p = t.players.find((x) => x.playerId === id);
    if (!p || seat < 0) return;
    from.seats[fromSeat] = null;
    to.seats[seat] = id;
    Object.assign(p, { tableId: to.tableId, seat });
    const movement = { moveId: this.nextId('mv'), playerId: id, reason: 'BALANCE' as const, fromTableId: from.tableId, fromSeat, toTableId: to.tableId, toSeat: seat, stack: p.stack, requestedAt: now, completedAt: now + 1500, scoreBreakdown: { position: 3, blindFairness: 1.5, recentMove: 0, seatCompatibility: 1 } };
    this.emit(t, { kind: 'TABLE_MOVE', movement, fromTableNumber: from.tableNumber, toTableNumber: to.tableNumber });
  }

  private appendMetric(t: MockTournament, now: number): void {
    const c = counters(t);
    const tables = openTables(t).length;
    const hpm = t.status === 'RUNNING' || t.status === 'FINAL_TABLE' ? Math.max(1, Math.round(tables * 1.55 * (1 + this.rng.gauss() * 0.04))) : 0;
    const p50 = Math.round(16 + this.rng.gauss() * 1.5);
    t.metrics.push({
      at: now,
      playersRemaining: c.active,
      tables,
      handsPerMinute: hpm,
      actionsPerSecond: Math.round(((hpm * 9) / 60) * 10) / 10,
      actionLatencyP50: p50,
      actionLatencyP95: Math.round(p50 * 2.6 + this.rng.int(0, 8)),
      actionLatencyP99: Math.round(p50 * 5.2 + this.rng.int(0, 16)),
      connections: Math.round(c.active * 1.22) + 6,
    });
    if (t.metrics.length > 240) t.metrics.splice(0, t.metrics.length - 240);
  }

  /** Hand list for a tournament (generated on first use). */
  hands(t: MockTournament) {
    return ensureHands(t);
  }

  summaryOf(t: MockTournament) {
    return summary(t);
  }
}
