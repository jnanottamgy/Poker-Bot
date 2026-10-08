import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { RATE_LIMITS } from '../../security/rate-limit';
import { badRequest, HttpError } from '../errors';
import type { HttpContext } from '../context';
import { clearSessionCookies, clientIp, permissionsOf, rateLimit, requireAdmin, setSessionCookies } from '../context';

const loginBody = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
});

export function registerAdminAuthRoutes(app: FastifyInstance, ctx: HttpContext): void {
  app.post('/api/admin/auth/login', async (req, reply) => {
    const parsed = loginBody.safeParse(req.body);
    if (!parsed.success) throw badRequest('INVALID_INPUT', 'Enter a username and password.');
    const ip = clientIp(req);
    rateLimit(ctx, 'admin-login-ip', RATE_LIMITS.login, ip);
    rateLimit(ctx, 'admin-login-user', RATE_LIMITS.login, parsed.data.username.toLowerCase());
    const result = await ctx.adminAuth.login(parsed.data.username, parsed.data.password, ip);
    if (!result.ok) {
      if (result.reason === 'LOCKED') throw new HttpError(423, 'ACCOUNT_LOCKED', 'Too many failed attempts. Try again in 15 minutes.');
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid username or password.');
    }
    const issued = await ctx.sessions.issue({ kind: 'ADMIN', adminId: result.admin.id, userAgent: req.headers['user-agent'] ?? null, ip });
    await ctx.audit.record({
      admin: result.admin,
      action: 'ADMIN_LOGIN',
      target: `admin:${result.admin.username}`,
      tournamentId: null,
      reason: null,
      before: null,
      after: { sessionId: issued.session.id },
      ip,
    });
    setSessionCookies(ctx, reply, 'ADMIN', issued);
    return {
      admin: { id: result.admin.id, username: result.admin.username, displayName: result.admin.displayName, role: result.admin.role },
      permissions: permissionsOf({ kind: 'ADMIN', session: issued.session, admin: result.admin }),
      csrfToken: issued.csrfToken,
    };
  });

  app.post('/api/admin/auth/logout', async (req, reply) => {
    const principal = await requireAdmin(ctx, req, null);
    await ctx.sessions.revoke(principal.session, 'LOGOUT');
    clearSessionCookies(ctx, reply, 'ADMIN');
    return { ok: true };
  });

  app.get('/api/admin/auth/me', async (req) => {
    const principal = await requireAdmin(ctx, req, null);
    const { admin } = principal;
    return {
      admin: { id: admin.id, username: admin.username, displayName: admin.displayName, role: admin.role, tournamentScope: admin.tournamentScope },
      permissions: permissionsOf(principal),
      sessionExpiresAt: principal.session.expiresAt.getTime(),
    };
  });
}
