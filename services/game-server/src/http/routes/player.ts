import type { FastifyInstance } from 'fastify';
import type { PlayerHistoryDto, PlayerMeDto } from '@jpb/shared-types';
import { validatePlayerActionRequest } from '@jpb/validation';
import { clearSessionCookies, rateLimit, requirePlayer } from '../context';
import { badRequest, HttpError, notFound } from '../errors';
import { RATE_LIMITS } from '../../security/rate-limit';
import type { GameRouteDeps } from './game-common';
import { intParam } from './game-common';
import { handListItems } from './hand-dto';
import { publicHandFairness } from './admin-hands';

/** Player REST API (docs/API.md "Player"): self, history, own hands, fairness, REST action fallback, logout. */
export function registerPlayerRoutes(app: FastifyInstance, deps: GameRouteDeps): void {
  const { ctx, game } = deps;

  app.get('/api/player/me', async (req) => {
    const p = await requirePlayer(ctx, req);
    const t = await game.tournament(p.tournamentId);
    if (!t) throw notFound('Tournament');
    const self = await game.playerSelf(p.playerId);
    if (!self) throw notFound('Player');
    const dto: PlayerMeDto = { ...self, tournamentId: t.id, joinCode: t.joinCode, tournamentName: t.name };
    return dto;
  });

  app.get('/api/player/history', async (req) => {
    const p = await requirePlayer(ctx, req);
    const t = await game.tournament(p.tournamentId);
    const entry = await ctx.store.repos.players.getCurrentEntry(p.playerId);
    if (!t || !entry) throw notFound('Player');
    const self = await game.playerSelf(p.playerId);
    const moves = await ctx.store.repos.q.query<{ id: string; reason: string; from_table_id: string | null; from_seat: number | null; to_table_id: string; to_seat: number; stack: number; requested_at: number; completed_at: number | null; from_no: number | null; to_no: number | null }>(
      `SELECT m.*, f.table_number AS from_no, d.table_number AS to_no FROM player_movements m
         LEFT JOIN tables f ON f.id = m.from_table_id LEFT JOIN tables d ON d.id = m.to_table_id
        WHERE m.player_id = $1 ORDER BY m.requested_at`,
      [p.playerId],
    );
    const largest = await ctx.store.repos.q.query<{ amount: number | null }>(`SELECT max(amount)::bigint AS amount FROM pot_winners WHERE player_id = $1`, [p.playerId]);
    const dto: PlayerHistoryDto = {
      finishPosition: entry.finishPosition,
      tiedCount: entry.tiedCount,
      prizeMinor: entry.prizeMinor,
      currency: t.config.prizeStructure.currency,
      handsPlayed: self?.handsPlayed ?? entry.handsPlayed,
      largestPotWon: Number(largest.rows[0]?.amount ?? 0),
      startingStack: t.config.startingStack,
      finalStack: self?.stack ?? entry.stack,
      movements: moves.rows.map((m) => ({
        moveId: m.id,
        reason: m.reason as PlayerHistoryDto['movements'][number]['reason'],
        fromTableNumber: m.from_no,
        fromSeat: m.from_seat,
        toTableNumber: m.to_no ?? 0,
        toSeat: m.to_seat,
        stack: Number(m.stack),
        requestedAt: Number(m.requested_at),
        completedAt: m.completed_at === null ? null : Number(m.completed_at),
        scoreBreakdown: null,
      })),
    };
    return dto;
  });

  app.get('/api/player/hands', async (req) => {
    const p = await requirePlayer(ctx, req);
    const limit = intParam((req.query as Record<string, unknown>).limit, 20, 1, 100);
    const rows = await ctx.store.repos.hands.forPlayer(p.playerId, limit);
    return { rows: await handListItems(ctx.store.repos, rows) };
  });

  app.get<{ Params: { handId: string } }>('/api/player/hands/:handId/fairness', async (req) => {
    const p = await requirePlayer(ctx, req);
    const found = await ctx.store.repos.hands.get(req.params.handId);
    if (!found || found.row.tournamentId !== p.tournamentId || !found.history.players.some((x) => x.playerId === p.playerId)) throw notFound('Hand');
    const t = await game.tournament(p.tournamentId, 0);
    if (!t) throw notFound('Tournament');
    return publicHandFairness(t, found.history, p.playerId);
  });

  app.post('/api/player/action', async (req) => {
    const p = await requirePlayer(ctx, req);
    rateLimit(ctx, 'player-action', RATE_LIMITS.playerAction, p.playerId);
    const parsed = validatePlayerActionRequest(req.body);
    if (!parsed.ok) throw badRequest('INVALID_INPUT', parsed.error.message, parsed.error.issues);
    const self = await game.playerSelf(p.playerId);
    if (!self?.tableId) throw new HttpError(409, 'PLAYER_NOT_SEATED', 'You are not seated at a table right now.');
    const a = parsed.value;
    const reply = await game.submitPlayerAction({
      playerId: p.playerId,
      tableId: self.tableId,
      actionId: a.actionId,
      type: a.type,
      ...(a.amount !== undefined ? { amount: a.amount } : {}),
      tableStateVersion: a.tableStateVersion,
      receivedAt: ctx.now(),
    });
    return reply;
  });

  app.post('/api/player/logout', async (req, reply) => {
    const p = await requirePlayer(ctx, req);
    await ctx.sessions.revoke(p.session, 'LOGOUT');
    clearSessionCookies(ctx, reply, 'PLAYER');
    return { ok: true };
  });
}
