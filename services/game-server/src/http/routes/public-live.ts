import type { FastifyInstance, FastifyRequest } from 'fastify';
import { clientIp, rateLimit } from '../context';
import { notFound } from '../errors';
import { RATE_LIMITS } from '../../security/rate-limit';
import type { TournamentRecord } from '../../persistence/repos/tournaments';
import type { GameRouteDeps } from './game-common';
import { intParam } from './game-common';
import { clientSeedCount, fairnessDtoOf, leaderboardOf, publicHandFairness } from './admin-hands';

const JOIN_CODE = /^[A-Za-z0-9]{4,12}$/;

/** Live public data by join code (no session): summary, leaderboards, fairness (docs/API.md "Public"). */
export function registerPublicLiveRoutes(app: FastifyInstance, deps: GameRouteDeps): void {
  const { ctx, game } = deps;
  type J = { Params: { joinCode: string } };

  async function byJoinCode(req: FastifyRequest<J>): Promise<TournamentRecord> {
    rateLimit(ctx, 'public-read', RATE_LIMITS.publicRead, clientIp(req));
    if (!JOIN_CODE.test(req.params.joinCode)) throw notFound('Tournament');
    const t = await ctx.store.repos.tournaments.getByJoinCode(req.params.joinCode.toUpperCase());
    if (!t || t.status === 'DRAFT') throw notFound('Tournament');
    return t;
  }

  app.get<J>('/api/public/tournaments/:joinCode/summary', async (req) => {
    const t = await byJoinCode(req);
    const summary = await game.tournamentSummary(t.id);
    if (!summary) throw notFound('Tournament');
    return summary;
  });

  app.get<J>('/api/public/tournaments/:joinCode/leaderboard', async (req) => {
    const t = await byJoinCode(req);
    const q = req.query as Record<string, unknown>;
    return leaderboardOf(ctx, t, q.mode === 'finish' ? 'finish' : 'stack', intParam(q.offset, 0), intParam(q.limit, 50, 1, 200));
  });

  app.get<J>('/api/public/tournaments/:joinCode/fairness', async (req) => {
    const t = await byJoinCode(req);
    return fairnessDtoOf(t, await clientSeedCount(ctx, t.id));
  });

  app.get<{ Params: { handId: string } }>('/api/public/hands/:handId/fairness', async (req) => {
    rateLimit(ctx, 'public-read', RATE_LIMITS.publicRead, clientIp(req));
    const found = await ctx.store.repos.hands.get(req.params.handId);
    if (!found) throw notFound('Hand');
    const t = await game.tournament(found.row.tournamentId, 0);
    if (!t) throw notFound('Hand');
    return publicHandFairness(t, found.history);
  });
}
