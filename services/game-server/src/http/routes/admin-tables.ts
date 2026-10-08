import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AdminTableView, Permission, SeatScoreDto, TableDetailDto } from '@jpb/shared-types';
import type { DirectorInput } from '@jpb/tournament-engine';
import { requireAdmin } from '../context';
import { notFound } from '../errors';
import { channels } from '../../bus/bus';
import type { MessageBus } from '../../bus/bus';
import type { AdminChannelMessage } from '../../runtime/contracts';
import type { TableInternals } from '../../game/table-actor';
import type { GameRouteDeps } from './game-common';
import { OK, directorAdmin, intParam, limitAdmin, reasonFor } from './game-common';
import type { Danger } from './game-common';
import { handListItems } from './hand-dto';

export interface TableRouteDeps extends GameRouteDeps {
  bus: MessageBus;
}

/** How long an audited hole-card reveal stays active for the admin who performed it. */
export const REVEAL_TTL_MS = 30 * 60_000;

export function registerAdminTableRoutes(app: FastifyInstance, deps: TableRouteDeps): void {
  const { ctx, game } = deps;
  type P = { Params: { tableId: string } };
  /** adminId|tableId → reveal expiry (audited; per node). */
  const reveals = new Map<string, number>();

  async function tableFor(req: FastifyRequest<P>, permission: Permission) {
    const tournamentId = await game.tableTournament(req.params.tableId);
    if (!tournamentId) throw notFound('Table');
    const principal = await requireAdmin(ctx, req, permission, tournamentId);
    limitAdmin(deps, req, principal);
    return { principal, tournamentId, tableId: req.params.tableId };
  }

  app.get<P>('/api/admin/tables/:tableId', async (req) => {
    const { principal, tableId, tournamentId } = await tableFor(req, 'PLAYER_VIEW');
    const view = await game.tableQuery<AdminTableView>(tableId, { q: 'ADMIN', includeHoleCards: false });
    if (!view) throw notFound('Table');
    const internals = await game.tableQuery<TableInternals>(tableId, { q: 'INTERNALS' });
    const row = await ctx.store.repos.tableLogs.getTable(tableId);
    const stat = game.node.host.stat('table', tableId);
    const revealed = (reveals.get(`${principal.admin.id}|${tableId}`) ?? 0) > ctx.now();
    const holeCards = revealed ? ((await game.tableQuery<AdminTableView>(tableId, { q: 'ADMIN', includeHoleCards: true }))?.holeCards ?? {}) : null;
    const recent = await ctx.store.repos.hands.list(tournamentId, { tableId, limit: 10 });
    const dto: TableDetailDto = {
      view,
      internals: {
        version: internals?.version ?? view.version,
        lastEventSeq: internals?.lastEventSeq ?? view.lastEventSeq,
        lastCommandSeq: stat?.seq ?? row?.lastCommandSeq ?? 0,
        ownerNode: stat ? game.node.nodeId : (row?.ownerNode ?? null),
        leaseEpoch: stat?.leaseEpoch ?? null,
        queueLength: stat?.queueLength ?? 0,
        faulted: stat?.faulted ?? false,
        lastProgressAt: internals?.lastProgressAt ?? view.lastProgressAt,
        invariantViolations: internals?.invariantViolations ?? [],
        chipsAtTable: internals?.chipsAtTable ?? 0,
      },
      holeCards,
      recentHands: await handListItems(ctx.store.repos, recent.rows),
    };
    return dto;
  });

  app.get<P>('/api/admin/tables/:tableId/events', async (req) => {
    const { tableId, tournamentId } = await tableFor(req, 'HAND_HISTORY_VIEW');
    const q = req.query as Record<string, unknown>;
    const after = intParam(q.after, 0);
    const limit = intParam(q.limit, 50, 1, 500);
    const rows = await ctx.store.repos.tableLogs.eventsAfter<{ event: unknown }>(tableId, after, limit + 1);
    const page = rows.slice(0, limit);
    return {
      // Admin event log never includes hole cards (HOLE_CARDS_DEALT stays private to its player).
      events: page
        .filter((e) => e.visibility === 'PUBLIC')
        .map((e) => ({ tableId, tournamentId, seq: e.seq, version: e.version, at: e.at, visibility: e.visibility, privateTo: null, event: (e.payload as { event?: unknown })?.event ?? e.payload })),
      nextAfter: rows.length > limit ? page[page.length - 1]!.seq : null,
    };
  });

  const op = (path: string, danger: Danger, action: string, build: (tableId: string, admin: { adminId: string; reason: string | null }) => DirectorInput) =>
    app.post<P>(`/api/admin/tables/:tableId/${path}`, async (req) => {
      const { principal, tableId, tournamentId } = await tableFor(req, 'TABLE_CONTROL');
      const reason = reasonFor(req.body, danger);
      await directorAdmin(deps, req, principal, tournamentId, build(tableId, { adminId: principal.admin.id, reason }), { action, target: `table:${tableId}`, reason });
      return OK;
    });

  op('hold', { level: 1 }, 'TABLE_HOLD', (tableId, admin) => ({ type: 'HOLD_TABLE', tableId, admin }));
  op('release', { level: 1 }, 'TABLE_RELEASE', (tableId, admin) => ({ type: 'RELEASE_TABLE', tableId, admin }));
  op('freeze', { level: 1 }, 'TABLE_FREEZE', (tableId, admin) => ({ type: 'FREEZE_TABLE', tableId, admin }));
  op('unfreeze', { level: 1 }, 'TABLE_UNFREEZE', (tableId, admin) => ({ type: 'UNFREEZE_TABLE', tableId, admin }));
  app.post<P>('/api/admin/tables/:tableId/force-timeout', async (req) => {
    const { principal, tableId, tournamentId } = await tableFor(req, 'TABLE_CONTROL');
    const reason = reasonFor(req.body, { level: 1, reasonRequired: true });
    // With the turn version the operator saw, a turn that moved on meanwhile is never timed out by mistake.
    const raw = (req.body as { turnVersion?: unknown } | null)?.turnVersion;
    const turnVersion = Number.isSafeInteger(raw) ? (raw as number) : undefined;
    await directorAdmin(deps, req, principal, tournamentId, { type: 'FORCE_TIMEOUT', tableId, ...(turnVersion !== undefined ? { turnVersion } : {}), admin: { adminId: principal.admin.id, reason } }, { action: 'FORCE_TIMEOUT', target: `table:${tableId}`, reason });
    return OK;
  });

  app.get<P>('/api/admin/tables/:tableId/seat-scores', async (req) => {
    const { tournamentId, tableId } = await tableFor(req, 'PLAYER_MOVE');
    const playerId = (req.query as { playerId?: unknown }).playerId;
    if (typeof playerId !== 'string' || !playerId) throw notFound('Player');
    const scores = await game.directorQuery<SeatScoreDto[]>(tournamentId, { q: 'SEAT_SCORES', tableId, playerId });
    if (!scores) throw notFound('Table or player');
    return { seats: scores };
  });
  op('break', { level: 2, word: 'BREAK' }, 'BREAK_TABLE', (tableId, admin) => ({ type: 'BREAK_TABLE', tableId, admin }));

  app.post<P>('/api/admin/tables/:tableId/add-time', async (req) => {
    const { principal, tableId, tournamentId } = await tableFor(req, 'TABLE_CONTROL');
    const reason = reasonFor(req.body, { level: 1 });
    const ms = intParam((req.body as { ms?: unknown } | null)?.ms, 0, 0, 600_000);
    await directorAdmin(deps, req, principal, tournamentId, { type: 'TABLE_ADD_TIME', tableId, ms: ms || 30_000, admin: { adminId: principal.admin.id, reason } }, { action: 'TABLE_ADD_TIME', target: `table:${tableId}`, reason });
    return OK;
  });

  app.post<P>('/api/admin/tables/:tableId/reveal-hole-cards', async (req) => {
    const { principal, tableId, tournamentId } = await tableFor(req, 'VIEW_HOLE_CARDS');
    const reason = reasonFor(req.body, { level: 2, word: 'REVEAL' });
    const view = await game.tableQuery<AdminTableView>(tableId, { q: 'ADMIN', includeHoleCards: true });
    if (!view) throw notFound('Table');
    await ctx.audit.record({
      admin: principal.admin,
      action: 'REVEAL_HOLE_CARDS',
      target: `table:${tableId}`,
      tournamentId,
      reason,
      before: null,
      after: { handNumber: view.hand?.handNumber ?? null, seats: Object.keys(view.holeCards ?? {}).length },
      ip: req.ip,
    });
    reveals.set(`${principal.admin.id}|${tableId}`, ctx.now() + REVEAL_TTL_MS);
    await deps.bus.publish(channels.admin(tournamentId), { kind: 'HOLE_CARDS_REVEALED', tableId, adminId: principal.admin.id, sessionId: principal.session.id } satisfies AdminChannelMessage);
    return { holeCards: view.holeCards ?? {} };
  });
}
