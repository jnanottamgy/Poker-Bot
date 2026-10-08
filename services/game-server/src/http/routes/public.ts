import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { HttpContext } from '../context';
import { clientIp, rateLimit, setSessionCookies } from '../context';
import { RATE_LIMITS } from '../../security/rate-limit';
import { HttpError, badRequest, notFound } from '../errors';
import type { RegistrationService } from '../../services/registration';

const registerBody = z.object({
  fields: z.record(z.string(), z.unknown()).default({}),
  accessCode: z.string().max(64).nullable().optional(),
  clientSeed: z.string().max(256).nullable().optional(),
});

const rejoinBody = z.object({
  publicId: z.string().trim().min(4).max(16),
  rejoinCode: z.string().trim().min(8).max(16),
});

const joinCodeParam = z.string().regex(/^[A-Za-z0-9]{4,12}$/);

/** Player-facing join, registration and rejoin (spec §7–§9). */
export function registerPublicRoutes(app: FastifyInstance, ctx: HttpContext, registration: RegistrationService): void {
  app.get<{ Params: { joinCode: string } }>('/api/public/tournaments/:joinCode', async (req) => {
    rateLimit(ctx, 'public-read', RATE_LIMITS.publicRead, clientIp(req));
    const code = joinCodeParam.safeParse(req.params.joinCode);
    if (!code.success) throw notFound('Tournament');
    const info = await registration.joinInfo(code.data);
    if (!info) throw notFound('Tournament');
    return info;
  });

  app.post<{ Params: { joinCode: string } }>('/api/public/tournaments/:joinCode/register', async (req, reply) => {
    const ip = clientIp(req);
    rateLimit(ctx, 'registration', RATE_LIMITS.registration, ip);
    const code = joinCodeParam.safeParse(req.params.joinCode);
    if (!code.success) throw notFound('Tournament');
    const body = registerBody.parse(req.body ?? {});
    const result = await registration.register(code.data, { fields: body.fields, accessCode: body.accessCode ?? null, clientSeed: body.clientSeed ?? null });
    if (!result.ok) {
      if (result.code === 'NOT_FOUND') throw notFound('Tournament');
      if (result.code === 'INVALID_FIELDS') throw badRequest('INVALID_FIELDS', result.message, result.errors);
      if (result.code === 'ACCESS_CODE') throw new HttpError(403, 'ACCESS_CODE', result.message);
      throw new HttpError(409, result.code, result.message);
    }
    const issued = await ctx.sessions.issue({
      kind: 'PLAYER',
      playerId: result.player.id,
      tournamentId: result.player.tournamentId,
      userAgent: req.headers['user-agent'] ?? null,
      ip,
    });
    setSessionCookies(ctx, reply, 'PLAYER', issued);
    return {
      player: { playerId: result.player.id, publicId: result.player.publicId, displayName: result.player.displayName, status: result.status },
      tournamentId: result.player.tournamentId,
      rejoinCode: result.rejoinCode,
      csrfToken: issued.csrfToken,
    };
  });

  app.post<{ Params: { joinCode: string } }>('/api/public/tournaments/:joinCode/rejoin', async (req, reply) => {
    const ip = clientIp(req);
    const body = rejoinBody.parse(req.body ?? {});
    rateLimit(ctx, 'rejoin-ip', RATE_LIMITS.login, ip);
    rateLimit(ctx, 'rejoin-player', RATE_LIMITS.login, body.publicId.toUpperCase());
    const code = joinCodeParam.safeParse(req.params.joinCode);
    if (!code.success) throw notFound('Tournament');
    const player = await registration.rejoin(code.data, body.publicId, body.rejoinCode);
    if (!player) throw new HttpError(401, 'REJOIN_FAILED', 'That player ID and rejoin code do not match. Ask a tournament staff member for help.');
    const issued = await ctx.sessions.issue({ kind: 'PLAYER', playerId: player.id, tournamentId: player.tournamentId, userAgent: req.headers['user-agent'] ?? null, ip });
    setSessionCookies(ctx, reply, 'PLAYER', issued);
    return { player: { playerId: player.id, publicId: player.publicId, displayName: player.displayName }, tournamentId: player.tournamentId, csrfToken: issued.csrfToken };
  });
}
