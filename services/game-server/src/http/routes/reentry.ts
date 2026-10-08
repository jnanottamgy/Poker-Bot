import type { FastifyInstance } from 'fastify';
import { requireAdmin, requirePlayer } from '../context';
import { HttpError, notFound } from '../errors';
import type { RegistrationService, ReentryResult } from '../../services/registration';
import type { GameRouteDeps } from './game-common';
import { limitAdmin, reasonFor } from './game-common';

function fail(r: Extract<ReentryResult, { ok: false }>): never {
  throw new HttpError(r.code === 'NOT_FOUND' ? 404 : 409, r.code, r.message);
}

/**
 * Re-entry: an eliminated player buys back in (when the tournament allows it,
 * until the configured level, up to the maximum entries). The player does it
 * from their phone; staff can do it for them at the desk.
 */
export function registerReentryRoutes(app: FastifyInstance, deps: GameRouteDeps & { registration: RegistrationService }): void {
  const { ctx, game } = deps;

  app.post('/api/player/reenter', async (req) => {
    const p = await requirePlayer(ctx, req);
    const r = await deps.registration.reenter(p.playerId);
    if (!r.ok) fail(r);
    return { ok: true, entryId: r.entryId, entryNumber: r.entryNumber, self: await game.playerSelf(p.playerId) };
  });

  app.post<{ Params: { playerId: string } }>('/api/admin/players/:playerId/reenter', async (req) => {
    const player = await ctx.store.repos.players.getPlayer(req.params.playerId);
    if (!player) throw notFound('Player');
    const principal = await requireAdmin(ctx, req, 'PLAYER_APPROVE_REGISTRATION', player.tournamentId);
    limitAdmin(deps, req, principal);
    const reason = reasonFor(req.body, { level: 1 });
    const r = await deps.registration.reenter(player.id, { byStaff: { adminId: principal.admin.id } });
    if (!r.ok) fail(r);
    await ctx.audit.record({ admin: principal.admin, action: 'PLAYER_REENTERED', target: `player:${player.publicId}`, tournamentId: player.tournamentId, reason, before: null, after: { entryNumber: r.entryNumber }, ip: req.ip });
    return { ok: true, entryId: r.entryId, entryNumber: r.entryNumber };
  });
}
