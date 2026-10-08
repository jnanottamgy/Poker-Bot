import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { TOURNAMENT_TRANSITIONS } from '@jpb/shared-types';
import type {
  ChipConservationDto,
  TableListItemDto,
  TournamentConfig,
  TournamentListItemDto,
  TournamentOverviewDto,
  TournamentPublicSummary,
  TournamentStatsDto,
  TournamentStatus,
} from '@jpb/shared-types';
import { checkRunningConfigEdit, validateTournamentConfig } from '@jpb/validation';
import type { DirectorInput, DirectorState, DirectorStats, DirectorTable } from '@jpb/tournament-engine';
import { requireAdmin } from '../context';
import { badRequest, conflict, notFound } from '../errors';
import { qrSvg, joinUrl } from '../qr';
import type { TournamentRecord } from '../../persistence/repos/tournaments';
import type { LiveMetricsSampler } from '../../game/live-metrics';
import { channels } from '../../bus/bus';
import type { MessageBus } from '../../bus/bus';
import type { DisplayFeaturedMessage } from '../../runtime/contracts';
import { randomInt } from 'node:crypto';
import type { TableInternals } from '../../game/table-actor';
import type { GameRouteDeps } from './game-common';
import { OK, adminForTournament, boolParam, directorAdmin, ensureOk, intParam, limitAdmin, reasonFor, strParam } from './game-common';

export interface TournamentRouteDeps extends GameRouteDeps {
  live: LiveMetricsSampler;
  bus: MessageBus;
}

const LIVE: readonly TournamentStatus[] = ['STARTING', 'RUNNING', 'BREAK', 'PAUSED', 'FINAL_TABLE'];

export function tournamentListItem(t: TournamentRecord): TournamentListItemDto {
  return {
    id: t.id,
    name: t.name,
    joinCode: t.joinCode,
    status: t.status,
    isSimulation: t.isSimulation,
    createdAt: t.createdAt.getTime(),
    startedAt: t.startedAt?.getTime() ?? null,
    completedAt: (t.completedAt ?? t.cancelledAt)?.getTime() ?? null,
    registered: t.counters.registered,
    active: t.counters.active,
    tables: t.counters.tables,
  };
}

interface OverviewData {
  director: Omit<DirectorState, 'players'>;
  stats: DirectorStats;
  summary: TournamentPublicSummary;
  eventSeq: number;
}

/**
 * Estimated time remaining (documented formula, docs/ADMIN_CONTROL_ROOM.md):
 * players are eliminated at the average rate observed so far, so
 * remaining ≈ elapsed × (active − 1) / eliminated. Null until 2 eliminations
 * and one minute of play.
 */
export function estimateRemainingMs(elapsedMs: number, active: number, eliminated: number): number | null {
  if (active <= 1) return 0;
  if (eliminated < 2 || elapsedMs < 60_000) return null;
  return Math.round((elapsedMs * (active - 1)) / eliminated);
}

export function registerAdminTournamentRoutes(app: FastifyInstance, deps: TournamentRouteDeps): void {
  const { ctx, game } = deps;
  const T = '/api/admin/tournaments/:id';
  type P = { Params: { id: string } };

  async function overview(t: TournamentRecord, now: number): Promise<TournamentOverviewDto> {
    const data = await game.directorQuery<OverviewData>(t.id, { q: 'OVERVIEW' }).catch(() => null);
    const d = data?.director ?? null;
    const tables = (await game.directorQuery<DirectorTable[]>(t.id, { q: 'TABLES' }).catch(() => null)) ?? [];
    const tablesByStatus: Record<string, number> = {};
    for (const tb of tables) tablesByStatus[tb.status] = (tablesByStatus[tb.status] ?? 0) + 1;
    const counters = d?.counters ?? { ...t.counters, inTransit: 0, totalChips: 0, largestPot: 0 };
    const hands = await ctx.store.repos.hands.stats(t.id);
    const level = data?.summary.currentLevel ?? null;
    const elapsedMs = data?.stats.elapsedMs ?? 0;
    const stats: TournamentStatsDto = {
      averageStack: data?.stats.averageStack ?? 0,
      averageStackBB: level && level.bigBlind > 0 ? Math.round(((data?.stats.averageStack ?? 0) / level.bigBlind) * 10) / 10 : 0,
      medianStack: data?.stats.medianStack ?? 0,
      chipLeader: data?.stats.chipLeader ?? null,
      largestPot: counters.largestPot,
      handsCompleted: counters.handsCompleted,
      handsPerMinute: deps.live.handsPerMinute(t.id),
      actionsPerSecond: deps.live.points(t.id).at(-1)?.actionsPerSecond ?? 0,
      averageHandDurationMs: Math.round(hands.avgDurationMs ?? 0),
      elapsedMs,
      estimatedRemainingMs: d && LIVE.includes(d.status) ? estimateRemainingMs(elapsedMs, counters.active, counters.eliminated) : null,
    };
    const chipConservation: ChipConservationDto | null = d
      ? { expectedTotal: d.integrity.expectedTotal, actualTotal: d.integrity.actualTotal, ok: d.integrity.ok, checkedAt: d.integrity.checkedAt ?? now, offendingTables: d.integrity.offendingTables }
      : null;
    const openAlerts = (await ctx.store.repos.alerts.list({ tournamentId: t.id, openOnly: true, limit: 1000 })).length;
    const status = d?.status ?? t.status;
    return {
      id: t.id,
      name: t.name,
      joinCode: t.joinCode,
      status,
      resumeTo: d?.resumeTo ?? null,
      allowedTransitions: [...(TOURNAMENT_TRANSITIONS[status] ?? [])],
      isSimulation: t.isSimulation,
      config: d?.config ?? t.config,
      configLocked: t.configLockedAt !== null,
      createdAt: t.createdAt.getTime(),
      startedAt: d?.startedAt ?? t.startedAt?.getTime() ?? null,
      completedAt: d?.completedAt ?? t.completedAt?.getTime() ?? null,
      serverSeedHash: t.serverSeedHash,
      seedRevealed: t.serverSeedRevealed !== null,
      publicEntropy: d?.publicEntropy ?? t.publicEntropy,
      summary: data?.summary ?? null,
      clock: data?.summary.clock ?? null,
      currentLevel: data?.summary.currentLevel ?? null,
      nextLevel: data?.summary.nextLevel ?? null,
      counters,
      tablesByStatus,
      stats,
      chipConservation,
      handForHand: d?.handForHand.enabled ?? false,
      frozen: d?.frozen ?? false,
      openAlerts,
    };
  }

  // ------------------------------------------------------------------ list / create / overview

  app.get('/api/admin/tournaments', async (req) => {
    const p = await requireAdmin(ctx, req, 'PLAYER_VIEW');
    limitAdmin(deps, req, p);
    const q = req.query as Record<string, unknown>;
    const status = strParam(q.status, 40) as TournamentStatus | undefined;
    const rows = await ctx.store.repos.tournaments.list({ ...(status ? { status: [status] } : {}), includeSimulations: boolParam(q.simulations) ?? false, limit: 500 });
    const scope = p.admin.tournamentScope;
    return { tournaments: rows.filter((t) => !scope || scope.includes(t.id)).map(tournamentListItem) };
  });

  app.post('/api/admin/tournaments', async (req) => {
    const p = await requireAdmin(ctx, req, 'TOURNAMENT_CREATE');
    limitAdmin(deps, req, p);
    const config = parseConfig((req.body as { config?: unknown } | null)?.config, ctx.env.speedModeAllowed);
    const t = await game.createTournament({ config, createdBy: p.admin.id });
    await ctx.audit.record({ admin: p.admin, action: 'TOURNAMENT_CREATED', target: `tournament:${t.id}`, tournamentId: t.id, reason: null, before: null, after: { name: t.name, joinCode: t.joinCode }, ip: req.ip });
    return { tournament: tournamentListItem(t) };
  });

  app.get<P>(T, async (req) => {
    const { tournament } = await adminForTournament(deps, req, 'PLAYER_VIEW', req.params.id);
    return overview(tournament, ctx.now());
  });

  app.put<P>(`${T}/config`, async (req) => {
    const { principal, tournament } = await adminForTournament(deps, req, 'TOURNAMENT_EDIT_CONFIG', req.params.id);
    const reason = reasonFor(req.body, { level: 1 });
    if (!['DRAFT', 'REGISTRATION'].includes(tournament.status)) throw conflict('CONFIG_LOCKED', 'The configuration is locked once registration closes. Use the running edit for future levels, timing and policies.');
    const config = parseConfig((req.body as { config?: unknown } | null)?.config, ctx.env.speedModeAllowed);
    if (config.joinCode.toUpperCase() !== tournament.joinCode.toUpperCase() && (await ctx.store.repos.tournaments.joinCodeExists(config.joinCode))) {
      throw conflict('JOIN_CODE_TAKEN', 'Another tournament already uses that join code.');
    }
    await directorAdmin(deps, req, principal, tournament.id, { type: 'SET_CONFIG', config, admin: { adminId: principal.admin.id, reason } }, { action: 'CONFIG_UPDATED', target: `tournament:${tournament.id}`, reason });
    await ctx.store.repos.tournaments.updateConfig(tournament.id, config);
    game.invalidateTournament(tournament.id);
    return OK;
  });

  app.patch<P>(`${T}/config/running`, async (req) => {
    const { principal, tournament } = await adminForTournament(deps, req, 'TOURNAMENT_EDIT_CONFIG', req.params.id);
    const reason = reasonFor(req.body, { level: 2, word: 'EDIT' });
    const changes = ((req.body as { changes?: unknown } | null)?.changes ?? {}) as Record<string, unknown>;
    if (typeof changes !== 'object' || changes === null || Array.isArray(changes)) throw badRequest('INVALID_INPUT', 'Send the changed settings in "changes".');
    const d = await game.directorQuery<DirectorState>(tournament.id, { q: 'STATE' });
    if (!d) throw notFound('Tournament');
    const before = d.config;
    const merged = {
      ...before,
      ...(changes.blindSchedule ? { blindSchedule: changes.blindSchedule } : {}),
      ...(changes.breaks ? { breaks: changes.breaks } : {}),
      ...(changes.timing ? { timing: { ...before.timing, ...(changes.timing as object) } } : {}),
      ...(changes.spectators ? { spectators: { ...before.spectators, ...(changes.spectators as object) } } : {}),
      ...(changes.features ? { features: { ...before.features, ...(changes.features as object) } } : {}),
    };
    const unknown = Object.keys(changes).filter((k) => !['blindSchedule', 'breaks', 'timing', 'spectators', 'features'].includes(k));
    if (unknown.length) throw badRequest('NOT_MUTABLE', `These settings cannot change while the tournament runs: ${unknown.join(', ')}.`);
    const currentLevel = d.clock.levelStartedAt === null ? 0 : (before.blindSchedule[d.clock.levelIndex]?.level ?? 0);
    const checked = checkRunningConfigEdit(before, merged, { currentLevel }, { allowSpeedMode: ctx.env.speedModeAllowed || before.speedMode });
    if (!checked.ok) throw badRequest('INVALID_CONFIG', checked.error.message, checked.error.issues);
    const next = checked.value;
    const meta = { adminId: principal.admin.id, reason };
    const target = `tournament:${tournament.id}`;
    if (JSON.stringify(next.blindSchedule) !== JSON.stringify(before.blindSchedule) || JSON.stringify(next.breaks) !== JSON.stringify(before.breaks)) {
      await directorAdmin(deps, req, principal, tournament.id, { type: 'UPDATE_SCHEDULE', blindSchedule: next.blindSchedule, breaks: next.breaks, admin: meta }, { action: 'SCHEDULE_EDITED', target, reason });
    }
    if (JSON.stringify(next.timing) !== JSON.stringify(before.timing)) {
      await directorAdmin(deps, req, principal, tournament.id, { type: 'UPDATE_TIMING', timing: next.timing, admin: meta }, { action: 'TIMING_EDITED', target, reason });
    }
    if (JSON.stringify(next.spectators) !== JSON.stringify(before.spectators) || JSON.stringify(next.features) !== JSON.stringify(before.features)) {
      await directorAdmin(deps, req, principal, tournament.id, { type: 'SET_POLICIES', spectators: next.spectators, features: next.features, admin: meta }, { action: 'POLICIES_EDITED', target, reason });
    }
    await ctx.store.repos.tournaments.replaceRunningConfig(tournament.id, next);
    game.invalidateTournament(tournament.id);
    return OK;
  });

  app.post<P>(`${T}/clone`, async (req) => {
    const { principal, tournament } = await adminForTournament(deps, req, 'TOURNAMENT_CREATE', req.params.id);
    let joinCode = `${tournament.joinCode.slice(0, 8)}${randomInt(10, 100)}`;
    for (let i = 0; i < 20 && (await ctx.store.repos.tournaments.joinCodeExists(joinCode)); i++) joinCode = `${tournament.joinCode.slice(0, 6)}${randomInt(1000, 10000)}`;
    const config: TournamentConfig = { ...tournament.config, name: `${tournament.config.name} (copy)`.slice(0, 80), joinCode, startTime: null, registrationDeadline: null };
    const parsed = parseConfig(config, true);
    const t = await game.createTournament({ config: parsed, createdBy: principal.admin.id });
    await ctx.audit.record({ admin: principal.admin, action: 'TOURNAMENT_CLONED', target: `tournament:${t.id}`, tournamentId: t.id, reason: null, before: { from: tournament.id }, after: { id: t.id }, ip: req.ip });
    return { tournament: tournamentListItem(t) };
  });

  app.delete<P>(T, async (req) => {
    const { principal, tournament } = await adminForTournament(deps, req, 'TOURNAMENT_CREATE', req.params.id);
    const reason = reasonFor(req.body, { level: 1 });
    if (tournament.status !== 'DRAFT') throw conflict('INVALID_STATE', 'Only draft tournaments can be deleted. Cancel it instead.');
    await ctx.store.transaction(async (repos) => {
      await repos.q.query(`DELETE FROM director_inputs WHERE tournament_id = $1`, [tournament.id]);
      await repos.q.query(`DELETE FROM director_snapshots WHERE tournament_id = $1`, [tournament.id]);
      await repos.q.query(`DELETE FROM tournament_events WHERE tournament_id = $1`, [tournament.id]);
      await repos.q.query(`DELETE FROM tournaments WHERE id = $1 AND status = 'DRAFT'`, [tournament.id]);
    });
    await game.node.host.deactivate('director', tournament.id, 'tournament deleted').catch(() => undefined);
    game.invalidateTournament(tournament.id);
    await ctx.audit.record({ admin: principal.admin, action: 'TOURNAMENT_DELETED', target: `tournament:${tournament.id}`, tournamentId: null, reason, before: { name: tournament.name }, after: null, ip: req.ip });
    return OK;
  });

  // ------------------------------------------------------------------ lifecycle

  const lifecycle = (path: string, permission: Parameters<typeof adminForTournament>[2], danger: Parameters<typeof reasonFor>[1], action: string, build: (admin: { adminId: string; reason: string | null }) => DirectorInput) =>
    app.post<P>(`${T}/${path}`, async (req) => {
      const { principal, tournament } = await adminForTournament(deps, req, permission, req.params.id);
      const reason = reasonFor(req.body, danger);
      await directorAdmin(deps, req, principal, tournament.id, build({ adminId: principal.admin.id, reason }), { action, target: `tournament:${tournament.id}`, reason });
      return OK;
    });

  lifecycle('registration/open', 'TOURNAMENT_LIFECYCLE', { level: 1 }, 'REGISTRATION_OPENED', (admin) => ({ type: 'OPEN_REGISTRATION', admin }));
  lifecycle('registration/close', 'TOURNAMENT_LIFECYCLE', { level: 1 }, 'REGISTRATION_CLOSED', (admin) => ({ type: 'CLOSE_REGISTRATION', admin }));
  lifecycle('registration/reopen', 'TOURNAMENT_LIFECYCLE', { level: 1 }, 'REGISTRATION_REOPENED', (admin) => ({ type: 'REOPEN_REGISTRATION', admin }));
  lifecycle('pause', 'TOURNAMENT_PAUSE', { level: 1 }, 'TOURNAMENT_PAUSED', (admin) => ({ type: 'PAUSE', admin }));
  lifecycle('resume', 'TOURNAMENT_PAUSE', { level: 1 }, 'TOURNAMENT_RESUMED', (admin) => ({ type: 'RESUME', admin }));
  lifecycle('freeze', 'TOURNAMENT_FREEZE', { level: 2, word: 'FREEZE' }, 'EMERGENCY_FREEZE', (admin) => ({ type: 'FREEZE', admin }));
  lifecycle('unfreeze', 'TOURNAMENT_FREEZE', { level: 2, word: 'FREEZE' }, 'EMERGENCY_UNFREEZE', (admin) => ({ type: 'UNFREEZE', admin }));
  lifecycle('cancel', 'TOURNAMENT_CANCEL', { level: 2, word: 'CANCEL' }, 'CANCEL_TOURNAMENT', (admin) => ({ type: 'CANCEL', admin }));
  lifecycle('clock/advance', 'CLOCK_CONTROL', { level: 1 }, 'CLOCK_ADVANCE', (admin) => ({ type: 'ADVANCE_LEVEL', admin }));
  lifecycle('break/end', 'CLOCK_CONTROL', { level: 1 }, 'BREAK_ENDED', (admin) => ({ type: 'END_BREAK', admin }));
  lifecycle('rebalance', 'TABLE_CONTROL', { level: 1 }, 'REBALANCE', (admin) => ({ type: 'REBALANCE', admin }));

  app.post<P>(`${T}/start`, async (req) => {
    const { principal, tournament } = await adminForTournament(deps, req, 'TOURNAMENT_LIFECYCLE', req.params.id);
    const reason = reasonFor(req.body, { level: 1 });
    const adminEntropy = strParam((req.body as { adminEntropy?: unknown } | null)?.adminEntropy, 256) ?? null;
    const reply = await game.start(tournament.id, { adminId: principal.admin.id, reason }, adminEntropy, {
      adminId: principal.admin.id,
      adminUsername: principal.admin.username,
      action: 'TOURNAMENT_STARTED',
      target: `tournament:${tournament.id}`,
      reason,
      ip: req.ip,
    });
    ensureOk(reply);
    return { ok: true, publicEntropy: reply.publicEntropy };
  });

  app.post<P>(`${T}/clock/set-level`, async (req) => {
    const { principal, tournament } = await adminForTournament(deps, req, 'CLOCK_CONTROL', req.params.id);
    const reason = reasonFor(req.body, { level: 2, word: 'LEVEL' });
    const level = intParam((req.body as { level?: unknown } | null)?.level, -1, -1, 10_000);
    if (level < 1) throw badRequest('INVALID_INPUT', 'Choose a level number.');
    await directorAdmin(deps, req, principal, tournament.id, { type: 'SET_LEVEL', level, admin: { adminId: principal.admin.id, reason } }, { action: 'SET_BLIND_LEVEL', target: `tournament:${tournament.id}`, reason });
    return OK;
  });

  app.post<P>(`${T}/clock/add-time`, async (req) => {
    const { principal, tournament } = await adminForTournament(deps, req, 'CLOCK_CONTROL', req.params.id);
    const reason = reasonFor(req.body, { level: 1 });
    const ms = Number((req.body as { ms?: unknown } | null)?.ms);
    if (!Number.isInteger(ms) || ms === 0 || Math.abs(ms) > 3_600_000) throw badRequest('INVALID_INPUT', 'Add or remove between 1 second and 60 minutes.');
    await directorAdmin(deps, req, principal, tournament.id, { type: 'ADD_TIME', ms, admin: { adminId: principal.admin.id, reason } }, { action: 'CLOCK_ADD_TIME', target: `tournament:${tournament.id}`, reason });
    return OK;
  });

  app.post<P>(`${T}/break/start`, async (req) => {
    const { principal, tournament } = await adminForTournament(deps, req, 'CLOCK_CONTROL', req.params.id);
    const reason = reasonFor(req.body, { level: 1 });
    const s = Number((req.body as { durationSeconds?: unknown } | null)?.durationSeconds);
    if (!Number.isInteger(s) || s < 60 || s > 3 * 3600) throw badRequest('INVALID_INPUT', 'A break lasts between 1 minute and 3 hours.');
    await directorAdmin(deps, req, principal, tournament.id, { type: 'START_BREAK', durationSeconds: s, admin: { adminId: principal.admin.id, reason } }, { action: 'BREAK_STARTED', target: `tournament:${tournament.id}`, reason });
    return OK;
  });

  app.post<P>(`${T}/hand-for-hand`, async (req) => {
    const { principal, tournament } = await adminForTournament(deps, req, 'TABLE_CONTROL', req.params.id);
    const reason = reasonFor(req.body, { level: 1 });
    const enabled = boolParam((req.body as { enabled?: unknown } | null)?.enabled);
    if (enabled === undefined) throw badRequest('INVALID_INPUT', 'Say whether hand-for-hand should be on or off.');
    await directorAdmin(deps, req, principal, tournament.id, { type: 'SET_HAND_FOR_HAND', enabled, admin: { adminId: principal.admin.id, reason } }, { action: 'HAND_FOR_HAND', target: `tournament:${tournament.id}`, reason });
    return OK;
  });

  // ------------------------------------------------------------------ tables

  app.get<P>(`${T}/tables`, async (req) => {
    const { tournament } = await adminForTournament(deps, req, 'PLAYER_VIEW', req.params.id);
    const q = req.query as Record<string, unknown>;
    const now = ctx.now();
    const stallMs = ctx.env.stallThresholdMs;
    const dTables = (await game.directorQuery<DirectorTable[]>(tournament.id, { q: 'TABLES' })) ?? [];
    const meta = await ctx.store.repos.tableLogs.listTables(tournament.id, { limit: 1000 });
    const metaById = new Map(meta.rows.map((m) => [m.id, m]));
    const status = strParam(q.status, 40);
    let rows: TableListItemDto[] = dTables.map((t) => {
      const m = metaById.get(t.summary.tableId);
      const lastProgressAt = m?.lastProgressAt?.getTime() ?? t.lastHandAt ?? null;
      const stalled = (t.status === 'IN_HAND' || t.status === 'BETWEEN_HANDS') && !t.frozen && t.holds.length === 0 && lastProgressAt !== null && now - lastProgressAt > stallMs;
      return {
        tableId: t.summary.tableId,
        tableNumber: t.summary.tableNumber,
        status: stalled ? 'STALLED' : t.status,
        holds: t.holds,
        frozen: t.frozen,
        players: t.summary.seats.length,
        maxSeats: t.summary.maxSeats,
        handNumber: m?.handsPlayed ?? t.handsCompleted,
        isFinalTable: t.isFinalTable,
        lastProgressAt,
        disconnectedPlayers: 0,
        chips: t.chips,
        breaking: t.summary.status === 'BREAKING',
      };
    });
    if (status) rows = rows.filter((r) => r.status === status);
    const min = strParam(q.minPlayers);
    const max = strParam(q.maxPlayers);
    if (min) rows = rows.filter((r) => r.players >= Number(min));
    if (max) rows = rows.filter((r) => r.players <= Number(max));
    if (boolParam(q.stalled)) rows = rows.filter((r) => r.status === 'STALLED');
    const search = (strParam(q.q, 10) ?? '').replace(/^t/i, '');
    if (search) rows = rows.filter((r) => String(r.tableNumber).startsWith(search));
    const sort = strParam(q.sort, 20) ?? 'number';
    const cmp: Record<string, (a: TableListItemDto, b: TableListItemDto) => number> = {
      number: (a, b) => a.tableNumber - b.tableNumber,
      players: (a, b) => b.players - a.players || a.tableNumber - b.tableNumber,
      stall: (a, b) => (a.lastProgressAt ?? 0) - (b.lastProgressAt ?? 0),
      chips: (a, b) => b.chips - a.chips,
    };
    rows.sort(cmp[sort] ?? cmp.number);
    const offset = intParam(q.offset, 0);
    const limit = intParam(q.limit, 50, 1, 500);
    const page = rows.slice(offset, offset + limit);
    // Live connection counts come from the table actors (cheap mailbox queries, only for this page).
    await Promise.all(
      page.map(async (r) => {
        const internals = await game.tableQuery<TableInternals>(r.tableId, { q: 'INTERNALS' }).catch(() => null);
        if (internals) {
          r.disconnectedPlayers = internals.disconnected;
          r.handNumber = internals.handNumber;
        }
      }),
    );
    return { rows: page, total: rows.length, offset, limit };
  });

  app.post<P>(`${T}/integrity-check`, async (req) => {
    const { principal, tournament } = await adminForTournament(deps, req, 'TABLE_CONTROL', req.params.id);
    const now = ctx.now();
    const d = await game.directorQuery<DirectorState>(tournament.id, { q: 'STATE' });
    if (!d) throw notFound('Tournament');
    const tables = (await game.directorQuery<DirectorTable[]>(tournament.id, { q: 'TABLES' })) ?? [];
    const violations: Array<{ tableId: string; tableNumber: number; code: string; detail: string }> = [];
    let actual = 0;
    for (const t of tables) {
      const internals = await game.tableQuery<TableInternals>(t.summary.tableId, { q: 'INTERNALS' }).catch(() => null);
      if (!internals) {
        violations.push({ tableId: t.summary.tableId, tableNumber: t.summary.tableNumber, code: 'TABLE_UNREACHABLE', detail: 'The table actor did not answer.' });
        continue;
      }
      actual += internals.chipsAtTable;
      for (const v of internals.invariantViolations) violations.push({ tableId: t.summary.tableId, tableNumber: t.summary.tableNumber, code: 'INVARIANT_VIOLATION', detail: v });
      if ((internals.status === 'IN_HAND' || internals.status === 'BETWEEN_HANDS') && internals.lastProgressAt !== null && now - internals.lastProgressAt > ctx.env.stallThresholdMs) {
        violations.push({ tableId: t.summary.tableId, tableNumber: t.summary.tableNumber, code: 'TABLE_STALLED', detail: `No progress for ${Math.round((now - internals.lastProgressAt) / 1000)}s` });
      }
    }
    const inTransit = Object.values(d.pendingMoves).reduce((n, m) => n + (m.status === 'SEATING' ? (m.stack ?? 0) : 0), 0);
    const expected = d.counters.totalChips;
    const conservationOk = d.status === 'DRAFT' || d.status === 'REGISTRATION' || d.status === 'REGISTRATION_CLOSED' || actual + inTransit === expected;
    await ctx.audit.record({ admin: principal.admin, action: 'INTEGRITY_CHECK', target: `tournament:${tournament.id}`, tournamentId: tournament.id, reason: null, before: null, after: { violations: violations.length, expected, actual: actual + inTransit }, ip: req.ip });
    return { ok: violations.length === 0 && conservationOk, checkedTables: tables.length, checkedAt: now, violations, chipConservation: { expectedTotal: expected, actualTotal: actual + inTransit, ok: conservationOk } };
  });

  // ------------------------------------------------------------------ broadcast & QR

  app.post<P>(`${T}/announce`, async (req) => {
    const { principal, tournament } = await adminForTournament(deps, req, 'ANNOUNCE', req.params.id);
    const body = z
      .object({ text: z.string().trim().min(1).max(280), scope: z.enum(['ALL', 'TABLE', 'PLAYER', 'DISPLAY']).default('ALL'), targetId: z.string().max(120).nullable().optional() })
      .safeParse(req.body ?? {});
    if (!body.success) throw badRequest('INVALID_INPUT', 'Write the announcement (up to 280 characters).');
    const { text, scope, targetId } = body.data;
    const reason = reasonFor(req.body, { level: 1 });
    if (scope === 'PLAYER') {
      if (!targetId) throw badRequest('INVALID_INPUT', 'Choose the player.');
      await deps.bus.publish(channels.player(targetId), { kind: 'NOTICE', notice: { kind: 'MESSAGE', text, from: 'ADMIN' } });
      await ctx.audit.record({ admin: principal.admin, action: 'ANNOUNCE', target: `player:${targetId}`, tournamentId: tournament.id, reason, before: null, after: { text, scope }, ip: req.ip });
      return OK;
    }
    if (scope === 'TABLE') {
      if (!targetId) throw badRequest('INVALID_INPUT', 'Choose the table.');
      const players = (await game.directorQuery<DirectorTable[]>(tournament.id, { q: 'TABLES' }))?.find((t) => t.summary.tableId === targetId)?.summary.seats ?? [];
      for (const s of players) await deps.bus.publish(channels.player(s.playerId), { kind: 'NOTICE', notice: { kind: 'MESSAGE', text, from: 'ADMIN' } });
      await ctx.audit.record({ admin: principal.admin, action: 'ANNOUNCE', target: `table:${targetId}`, tournamentId: tournament.id, reason, before: null, after: { text, scope, recipients: players.length }, ip: req.ip });
      return OK;
    }
    await directorAdmin(deps, req, principal, tournament.id, { type: 'ANNOUNCE', text, admin: { adminId: principal.admin.id, reason } }, { action: 'ANNOUNCE', target: `scope:${scope}`, reason });
    return OK;
  });

  app.post<P>(`${T}/display`, async (req) => {
    const { principal, tournament } = await adminForTournament(deps, req, 'ANNOUNCE', req.params.id);
    const body = (req.body ?? {}) as { scene?: unknown; featuredTableId?: unknown };
    const scene = strParam(body.scene, 40) ?? 'OVERVIEW';
    const featured = typeof body.featuredTableId === 'string' && body.featuredTableId ? body.featuredTableId : null;
    if (featured && (await game.tableTournament(featured)) !== tournament.id) throw badRequest('INVALID_TABLE', 'That table is not part of this tournament.');
    await directorAdmin(deps, req, principal, tournament.id, { type: 'SET_FEATURED_TABLE', tableId: featured, admin: { adminId: principal.admin.id, reason: null } }, { action: 'DISPLAY_SCENE', target: 'display', reason: null });
    await deps.bus.publish(channels.tournamentEvents(tournament.id), { kind: 'DISPLAY_FEATURED_CHANGED', tournamentId: tournament.id, tableId: featured } satisfies DisplayFeaturedMessage);
    await deps.bus.publish(channels.tournamentEvents(tournament.id), { kind: 'DISPLAY_SCENE', tournamentId: tournament.id, scene, tableId: featured });
    return OK;
  });

  app.get<P>(`${T}/qr.svg`, async (req, reply) => {
    const { tournament } = await adminForTournament(deps, req, 'PLAYER_VIEW', req.params.id);
    const size = intParam((req.query as Record<string, unknown>).size, 512, 128, 4096);
    reply.header('Content-Type', 'image/svg+xml; charset=utf-8');
    reply.header('Cache-Control', 'private, max-age=60');
    return qrSvg(joinUrl(ctx.env.publicBaseUrl, tournament.joinCode), size);
  });

  app.get<P>(`${T}/metrics/live`, async (req) => {
    const { tournament } = await adminForTournament(deps, req, 'METRICS_VIEW', req.params.id);
    return { points: deps.live.points(tournament.id) };
  });
}

export function parseConfig(input: unknown, allowSpeedMode: boolean): TournamentConfig {
  const r = validateTournamentConfig(input, { allowSpeedMode });
  if (!r.ok) throw badRequest('INVALID_CONFIG', r.error.message, r.error.issues);
  return r.value;
}
