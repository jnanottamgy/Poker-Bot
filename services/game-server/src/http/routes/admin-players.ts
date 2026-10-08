import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type {
  AdminTableView,
  MovementDto,
  Permission,
  PlayerDetailDto,
  PlayerListItemDto,
  PlayerPiiDto,
  SessionDto,
  TournamentPlayerStatus,
} from '@jpb/shared-types';
import type { DirectorInput, DirectorPlayer, DirectorState } from '@jpb/tournament-engine';
import { requireAdmin } from '../context';
import { badRequest, conflict, HttpError, notFound } from '../errors';
import { rejoinUrl } from '../qr';
import { channels } from '../../bus/bus';
import type { MessageBus } from '../../bus/bus';
import type { PlayerChannelMessage } from '../../runtime/contracts';
import type { PlayerEntryRow, PlayerRecord } from '../../persistence/repos/players';
import type { RegistrationService } from '../../services/registration';
import type { GameRouteDeps } from './game-common';
import { OK, adminForTournament, directorAdmin, intParam, limitAdmin, reasonFor, strParam } from './game-common';
import type { Danger } from './game-common';

export interface PlayerRouteDeps extends GameRouteDeps {
  bus: MessageBus;
  registration: RegistrationService;
}

const ACTIVE: ReadonlySet<TournamentPlayerStatus> = new Set(['SEATED', 'IN_TRANSIT', 'SUSPENDED']);
const STATUSES: ReadonlySet<string> = new Set(['PENDING_APPROVAL', 'REGISTERED', 'SEATED', 'IN_TRANSIT', 'ELIMINATED', 'SUSPENDED', 'DISQUALIFIED', 'WITHDRAWN']);

interface LiveSeat {
  connected: boolean;
  consecutiveTimeouts: number;
  stack: number;
}

export function registerAdminPlayerRoutes(app: FastifyInstance, deps: PlayerRouteDeps): void {
  const { ctx, game } = deps;
  type P = { Params: { playerId: string } };

  async function playerFor(req: FastifyRequest<P>, permission: Permission): Promise<{ principal: Awaited<ReturnType<typeof requireAdmin>>; player: PlayerRecord }> {
    const player = await ctx.store.repos.players.getPlayer(req.params.playerId);
    if (!player) throw notFound('Player');
    const principal = await requireAdmin(ctx, req, permission, player.tournamentId);
    limitAdmin(deps, req, principal);
    return { principal, player };
  }

  /** Table numbers of a tournament (one query). */
  async function tableNumbers(tournamentId: string): Promise<Map<string, number>> {
    const r = await ctx.store.repos.q.query<{ id: string; table_number: number }>(`SELECT id, table_number FROM tables WHERE tournament_id = $1`, [tournamentId]);
    return new Map(r.rows.map((x) => [x.id, x.table_number]));
  }

  /** Live seat data (connection, timeouts, live stack) from the table actors of the given tables. */
  async function liveSeats(tableIds: Iterable<string>): Promise<Map<string, LiveSeat>> {
    const out = new Map<string, LiveSeat>();
    await Promise.all(
      [...new Set(tableIds)].map(async (tableId) => {
        const view = await game.tableQuery<AdminTableView>(tableId, { q: 'ADMIN', includeHoleCards: false }).catch(() => null);
        for (const s of view?.seatDetails ?? []) if (s) out.set(s.playerId, { connected: s.connected, consecutiveTimeouts: s.consecutiveTimeouts, stack: s.stack });
      }),
    );
    return out;
  }

  function listItem(row: PlayerEntryRow, numbers: Map<string, number>, live: Map<string, LiveSeat>, bigBlind: number, stackRank: number | null): PlayerListItemDto {
    const l = live.get(row.playerId);
    const stack = l?.stack ?? row.stack;
    return {
      playerId: row.playerId,
      entryId: row.entryId,
      publicId: row.publicId,
      displayName: row.displayName,
      nickname: row.nickname,
      status: row.status,
      tableId: row.tableId,
      tableNumber: row.tableId ? (numbers.get(row.tableId) ?? null) : null,
      seat: row.seat,
      stack,
      stackBB: bigBlind > 0 ? Math.round((stack / bigBlind) * 10) / 10 : 0,
      stackRank,
      finishPosition: row.finishPosition,
      connected: l ? l.connected : null,
      consecutiveTimeouts: l?.consecutiveTimeouts ?? 0,
      registrationSeq: row.registrationSeq,
      registeredAt: row.registeredAt.getTime(),
    };
  }

  async function bigBlindOf(tournamentId: string): Promise<number> {
    const summary = await game.tournamentSummary(tournamentId).catch(() => null);
    return summary?.currentLevel?.bigBlind ?? 0;
  }

  async function stackRankOf(tournamentId: string, row: PlayerEntryRow): Promise<number | null> {
    if (!ACTIVE.has(row.status)) return null;
    const r = await ctx.store.repos.q.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM tournament_players WHERE tournament_id = $1 AND status IN ('SEATED','IN_TRANSIT','SUSPENDED')
          AND (stack > $2 OR (stack = $2 AND registration_seq < $3))`,
      [tournamentId, row.stack, row.registrationSeq],
    );
    return (r.rows[0]?.n ?? 0) + 1;
  }

  // ------------------------------------------------------------------ list & detail

  app.get<{ Params: { id: string } }>('/api/admin/tournaments/:id/players', async (req) => {
    const { tournament } = await adminForTournament(deps, req, 'PLAYER_VIEW', req.params.id);
    const q = req.query as Record<string, unknown>;
    const offset = intParam(q.offset, 0);
    const limit = intParam(q.limit, 50, 1, 500);
    const needle = strParam(q.q, 80);
    const status = strParam(q.status, 40);
    const tableId = strParam(q.tableId, 120);
    const sortParam = strParam(q.sort, 20) ?? (tournament.startedAt ? 'stack' : 'registration');
    const sort = sortParam === 'stack' ? 'stack_desc' : sortParam === 'finish' ? 'finish' : sortParam === 'name' ? 'name' : 'registration';
    const numbers = await tableNumbers(tournament.id);
    const bigBlind = await bigBlindOf(tournament.id);

    let rows: PlayerEntryRow[];
    let total: number;
    if (needle) {
      const found = await ctx.store.repos.players.search(tournament.id, needle, 200);
      rows = found.filter((r) => (!status || !STATUSES.has(status) || r.status === status) && (!tableId || r.tableId === tableId));
      total = rows.length;
      rows = rows.slice(offset, offset + limit);
    } else if (status === 'CONNECTED' || status === 'DISCONNECTED' || status === 'AWAY') {
      // Live-only filters: read the seated players from the tables.
      const all = await ctx.store.repos.players.listEntries(tournament.id, { statuses: ['SEATED', 'SUSPENDED'], sort, limit: 100_000, ...(tableId ? { tableId } : {}) });
      const live = await liveSeats(all.rows.map((r) => r.tableId).filter((x): x is string => !!x));
      const away = tournament.config.timing.awayAfterTimeouts;
      const keep = all.rows.filter((r) => {
        const l = live.get(r.playerId);
        if (!l) return false;
        return status === 'CONNECTED' ? l.connected : status === 'DISCONNECTED' ? !l.connected : l.consecutiveTimeouts >= away;
      });
      total = keep.length;
      rows = keep.slice(offset, offset + limit);
    } else {
      const statuses = status && STATUSES.has(status) ? [status as TournamentPlayerStatus] : undefined;
      const page = await ctx.store.repos.players.listEntries(tournament.id, { ...(statuses ? { statuses } : {}), sort, limit, offset, ...(tableId ? { tableId } : {}) });
      rows = page.rows;
      total = page.total;
    }
    const live = await liveSeats(rows.map((r) => r.tableId).filter((x): x is string => !!x));
    const ranks = await Promise.all(
      rows.map((r, i) => (sort === 'stack_desc' && !needle && !status ? Promise.resolve(ACTIVE.has(r.status) ? offset + i + 1 : null) : stackRankOf(tournament.id, r))),
    );
    return { rows: rows.map((r, i) => listItem(r, numbers, live, bigBlind, ranks[i] ?? null)), total, offset, limit };
  });

  app.get<P>('/api/admin/players/:playerId', async (req) => {
    const { principal, player } = await playerFor(req, 'PLAYER_VIEW');
    const entry = await ctx.store.repos.players.getCurrentEntry(player.id);
    if (!entry) throw notFound('Player entry');
    const row: PlayerEntryRow = { ...entry, publicId: player.publicId, displayName: player.displayName, nickname: player.nickname };
    const numbers = await tableNumbers(player.tournamentId);
    const live = await liveSeats(entry.tableId ? [entry.tableId] : []);
    const director = await game.directorQuery<{ player: DirectorPlayer; pendingMove: unknown }>(player.tournamentId, { q: 'PLAYER', playerId: player.id });
    const sessions = await ctx.store.repos.sessions.listForPlayer(player.id);
    const movements = await movementsOf(player.tournamentId, player.id, numbers);
    const actions = await ctx.store.repos.q.query<{ hand_id: string; hand_number: number; street: string; action: string; amount: number; to_amount: number; timeout: boolean; at: number }>(
      `SELECT a.hand_id, h.hand_number, a.street, a.action, a.amount, a.to_amount, a.timeout, a.at
         FROM actions a JOIN hands h ON h.id = a.hand_id WHERE a.player_id = $1 AND a.action NOT LIKE 'POST_%'
        ORDER BY a.at DESC, a.seq DESC LIMIT 25`,
      [player.id],
    );
    const base = listItem(row, numbers, live, await bigBlindOf(player.tournamentId), await stackRankOf(player.tournamentId, row));
    const dto: PlayerDetailDto = {
      ...base,
      handsPlayed: director?.player.stats.handsPlayedTotal ?? entry.handsPlayed,
      largestPotWon: entry.largestPotWon,
      prizeMinor: entry.prizeMinor,
      tiedCount: entry.tiedCount,
      elimination: director?.player.elimination ?? null,
      paymentStatus: entry.paymentStatus,
      sessions: sessions.map(
        (s): SessionDto => ({
          id: s.id,
          createdAt: s.createdAt.getTime(),
          lastSeenAt: s.lastSeenAt.getTime(),
          expiresAt: s.expiresAt.getTime(),
          revokedAt: s.revokedAt?.getTime() ?? null,
          revokedReason: s.revokedReason,
          ip: s.ip,
          userAgent: s.userAgent,
          isController: false,
        }),
      ),
      movements,
      recentActions: actions.rows.map((a) => ({ handId: a.hand_id, handNumber: a.hand_number, street: a.street as never, action: a.action as never, amount: a.amount, toAmount: a.to_amount, timeout: a.timeout, at: a.at })),
      piiAvailable: (await import('../../auth/sessions')).adminCan(principal.admin, 'PLAYER_VIEW_PII', player.tournamentId),
    };
    return dto;
  });

  async function movementsOf(tournamentId: string, playerId: string, numbers: Map<string, number>): Promise<MovementDto[]> {
    const r = await ctx.store.repos.q.query<{
      id: string;
      reason: MovementDto['reason'];
      from_table_id: string | null;
      from_seat: number | null;
      to_table_id: string;
      to_seat: number;
      stack: number;
      requested_at: number;
      completed_at: number | null;
      score_breakdown: Record<string, number> | null;
    }>(`SELECT * FROM player_movements WHERE tournament_id = $1 AND player_id = $2 ORDER BY requested_at`, [tournamentId, playerId]);
    return r.rows.map((m) => ({
      moveId: m.id,
      reason: m.reason,
      fromTableNumber: m.from_table_id ? (numbers.get(m.from_table_id) ?? null) : null,
      fromSeat: m.from_seat,
      toTableNumber: numbers.get(m.to_table_id) ?? 0,
      toSeat: m.to_seat,
      stack: Number(m.stack),
      requestedAt: Number(m.requested_at),
      completedAt: m.completed_at === null ? null : Number(m.completed_at),
      scoreBreakdown: m.score_breakdown,
    }));
  }

  app.get<P>('/api/admin/players/:playerId/pii', async (req) => {
    const { principal, player } = await playerFor(req, 'PLAYER_VIEW_PII');
    await ctx.audit.record({ admin: principal.admin, action: 'VIEW_PII', target: `player:${player.publicId}`, tournamentId: player.tournamentId, reason: null, before: null, after: null, ip: req.ip });
    const dto: PlayerPiiDto = {
      playerId: player.id,
      name: player.displayName,
      nickname: player.nickname,
      participantId: player.participantId,
      email: player.email,
      phone: player.phone,
      collegeId: player.collegeId,
    };
    return dto;
  });

  // ------------------------------------------------------------------ director-backed actions

  const op = (path: string, permission: Permission, danger: Danger, action: string, build: (playerId: string, admin: { adminId: string; reason: string | null }, body: Record<string, unknown>) => DirectorInput) =>
    app.post<P>(`/api/admin/players/:playerId/${path}`, async (req) => {
      const { principal, player } = await playerFor(req, permission);
      const reason = reasonFor(req.body, danger);
      const body = (req.body ?? {}) as Record<string, unknown>;
      await directorAdmin(deps, req, principal, player.tournamentId, build(player.id, { adminId: principal.admin.id, reason }, body), { action, target: `player:${player.publicId}`, reason });
      return OK;
    });

  op('move', 'PLAYER_MOVE', { level: 1, reasonRequired: true }, 'PLAYER_MOVED', (playerId, admin, body) => {
    const toTableId = strParam(body.toTableId, 120);
    if (!toTableId) throw badRequest('INVALID_TABLE', 'Choose an open destination table.');
    const toSeat = body.toSeat === null || body.toSeat === undefined ? null : intParam(body.toSeat, -1, -1, 9);
    if (toSeat === -1) throw badRequest('INVALID_INPUT', 'Seats are numbered 1 to 10.');
    return { type: 'MOVE_PLAYER', playerId, toTableId, toSeat, admin };
  });
  op('suspend', 'PLAYER_SUSPEND', { level: 1 }, 'PLAYER_SUSPENDED', (playerId, admin) => ({ type: 'SUSPEND_PLAYER', playerId, admin }));
  op('restore', 'PLAYER_SUSPEND', { level: 2, word: 'RESTORE' }, 'RESTORE_PLAYER', (playerId, admin) => ({ type: 'RESTORE_PLAYER', playerId, admin }));
  op('disqualify', 'PLAYER_DISQUALIFY', { level: 2, word: 'DISQUALIFY' }, 'DISQUALIFY_PLAYER', (playerId, admin) => ({ type: 'DISQUALIFY_PLAYER', playerId, admin }));
  op('adjust-stack', 'STACK_ADJUST', { level: 2, word: 'ADJUST' }, 'ADJUST_STACK', (playerId, admin, body) => {
    const newStack = Number(body.newStack);
    if (!Number.isSafeInteger(newStack) || newStack < 0) throw badRequest('INVALID_INPUT', 'The new stack must be a whole number of chips (0 or more).');
    return { type: 'ADJUST_STACK', playerId, newStack, admin };
  });
  op('approve', 'PLAYER_APPROVE_REGISTRATION', { level: 1 }, 'PLAYER_APPROVED', (playerId, admin) => ({ type: 'APPROVE_PLAYER', playerId, admin }));
  op('reject', 'PLAYER_APPROVE_REGISTRATION', { level: 1 }, 'PLAYER_REJECTED', (playerId, admin) => ({ type: 'REJECT_PLAYER', playerId, admin }));

  // ------------------------------------------------------------------ sessions, rejoin codes, notices

  app.post<P>('/api/admin/players/:playerId/revoke-sessions', async (req) => {
    const { principal, player } = await playerFor(req, 'PLAYER_SUSPEND');
    const reason = reasonFor(req.body, { level: 2, word: 'REVOKE' });
    const revoked = await ctx.sessions.revokeAllForPlayer(player.id, 'REVOKED_BY_ADMIN');
    await deps.bus.publish(channels.player(player.id), { kind: 'SESSIONS_REVOKED', playerId: player.id } satisfies PlayerChannelMessage);
    await ctx.audit.record({ admin: principal.admin, action: 'REVOKE_SESSIONS', target: `player:${player.publicId}`, tournamentId: player.tournamentId, reason, before: null, after: { revoked }, ip: req.ip });
    return { ok: true, revoked };
  });

  app.post<P>('/api/admin/players/:playerId/rejoin-code', async (req) => {
    const { principal, player } = await playerFor(req, 'PLAYER_SUSPEND');
    const reason = reasonFor(req.body, { level: 1 });
    const code = await deps.registration.reissueRejoinCode(player.id);
    const t = await game.tournament(player.tournamentId);
    await ctx.audit.record({ admin: principal.admin, action: 'NEW_REJOIN_CODE', target: `player:${player.publicId}`, tournamentId: player.tournamentId, reason, before: null, after: null, ip: req.ip });
    return { publicId: player.publicId, rejoinCode: code, rejoinUrl: rejoinUrl(ctx.env.publicBaseUrl, t?.joinCode ?? '', player.publicId, code) };
  });

  app.post<P>('/api/admin/players/:playerId/notice', async (req) => {
    const { principal, player } = await playerFor(req, 'ANNOUNCE');
    const body = z.object({ text: z.string().trim().min(1).max(280) }).safeParse(req.body ?? {});
    if (!body.success) throw badRequest('INVALID_INPUT', 'Write a message first (up to 280 characters).');
    const reason = reasonFor(req.body, { level: 1 });
    await deps.bus.publish(channels.player(player.id), { kind: 'NOTICE', notice: { kind: 'MESSAGE', text: body.data.text, from: 'ADMIN' } } satisfies PlayerChannelMessage);
    await ctx.audit.record({ admin: principal.admin, action: 'PRIVATE_NOTICE', target: `player:${player.publicId}`, tournamentId: player.tournamentId, reason, before: null, after: { text: body.data.text }, ip: req.ip });
    return OK;
  });

  // ------------------------------------------------------------------ manual registration

  app.post<{ Params: { id: string } }>('/api/admin/tournaments/:id/registrations/manual', async (req) => {
    const { principal, tournament } = await adminForTournament(deps, req, 'PLAYER_APPROVE_REGISTRATION', req.params.id);
    const fields = ((req.body as { fields?: unknown } | null)?.fields ?? {}) as Record<string, unknown>;
    const result = await deps.registration.register(tournament.joinCode, { fields, accessCode: null, clientSeed: null }, { byStaff: { adminId: principal.admin.id } });
    if (!result.ok) {
      if (result.code === 'INVALID_FIELDS') throw badRequest('INVALID_FIELDS', result.message, result.errors);
      if (result.code === 'NOT_FOUND') throw notFound('Tournament');
      throw conflict(result.code, result.message);
    }
    await ctx.audit.record({ admin: principal.admin, action: 'MANUAL_REGISTRATION', target: `player:${result.player.publicId}`, tournamentId: tournament.id, reason: null, before: null, after: { displayName: result.player.displayName }, ip: req.ip });
    const entry = await ctx.store.repos.players.getCurrentEntry(result.player.id);
    if (!entry) throw new HttpError(500, 'INTERNAL', 'Registration was not stored.');
    const row: PlayerEntryRow = { ...entry, publicId: result.player.publicId, displayName: result.player.displayName, nickname: result.player.nickname };
    return {
      player: listItem(row, new Map(), new Map(), 0, null),
      rejoinCode: result.rejoinCode,
      rejoinUrl: rejoinUrl(ctx.env.publicBaseUrl, tournament.joinCode, result.player.publicId, result.rejoinCode),
    };
  });

  void (null as unknown as DirectorState);
}
