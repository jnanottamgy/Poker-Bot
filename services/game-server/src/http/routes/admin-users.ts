import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ROLE_PERMISSIONS } from '@jpb/shared-types';
import { hashPassword } from '../../security/crypto';
import { validatePassword } from '../../auth/admin-auth';
import { badRequest, conflict, forbidden, notFound } from '../errors';
import type { HttpContext } from '../context';
import { clientIp, rateLimit, requireAdmin } from '../context';
import { RATE_LIMITS } from '../../security/rate-limit';
import { requireDangerConfirmation, requireReason } from '../danger';
import type { AdminUserRecord } from '../../persistence/repos/admins';

const roleSchema = z.enum(['SUPER_ADMIN', 'TOURNAMENT_DIRECTOR', 'STAFF', 'VIEWER']);

const createBody = z.object({
  username: z.string().trim().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/, 'Use letters, digits, dot, dash or underscore.'),
  displayName: z.string().trim().min(1).max(80),
  role: roleSchema,
  password: z.string().min(12).max(256),
  tournamentScope: z.array(z.string().min(1).max(80)).max(500).nullable().default(null),
});

const patchBody = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  role: roleSchema.optional(),
  tournamentScope: z.array(z.string().min(1).max(80)).max(500).nullable().optional(),
  disabled: z.boolean().optional(),
});

/** Public projection of an admin account (never the password hash). */
export function adminDto(a: AdminUserRecord) {
  return {
    id: a.id,
    username: a.username,
    displayName: a.displayName,
    role: a.role,
    tournamentScope: a.tournamentScope,
    createdAt: a.createdAt.getTime(),
    createdBy: a.createdBy,
    disabled: a.disabledAt !== null,
    lastLoginAt: a.lastLoginAt?.getTime() ?? null,
    locked: a.lockedUntil !== null && a.lockedUntil.getTime() > Date.now(),
    failedLogins: a.failedLogins,
  };
}

export function registerAdminUserRoutes(app: FastifyInstance, ctx: HttpContext): void {
  app.get('/api/admin/users', async (req) => {
    await requireAdmin(ctx, req, 'ADMIN_USERS_MANAGE');
    return { users: (await ctx.store.repos.admins.list()).map(adminDto), rolePermissions: ROLE_PERMISSIONS };
  });

  app.post('/api/admin/users', async (req) => {
    const p = await requireAdmin(ctx, req, 'ADMIN_USERS_MANAGE');
    rateLimit(ctx, 'admin-write', RATE_LIMITS.adminWrite, p.admin.id);
    const body = createBody.parse(req.body);
    if (await ctx.store.repos.admins.findByUsername(body.username)) throw conflict('USERNAME_TAKEN', 'That username is already in use.');
    try {
      const created = await ctx.adminAuth.createAdmin(p.admin, body, clientIp(req));
      return { user: adminDto(created) };
    } catch (err) {
      throw badRequest('INVALID_INPUT', (err as Error).message);
    }
  });

  app.patch<{ Params: { id: string } }>('/api/admin/users/:id', async (req) => {
    const p = await requireAdmin(ctx, req, 'ADMIN_USERS_MANAGE');
    rateLimit(ctx, 'admin-write', RATE_LIMITS.adminWrite, p.admin.id);
    const reason = requireDangerConfirmation(req.body, 'USER');
    const body = patchBody.parse(req.body);
    const target = await ctx.store.repos.admins.findById(req.params.id);
    if (!target) throw notFound('Admin user');
    if (target.id === p.admin.id && (body.disabled || (body.role && body.role !== target.role))) {
      throw forbidden('You cannot disable yourself or change your own role.');
    }
    if ((body.role === 'SUPER_ADMIN' || target.role === 'SUPER_ADMIN') && p.admin.role !== 'SUPER_ADMIN') {
      throw forbidden('Only a SUPER_ADMIN can change SUPER_ADMIN accounts.');
    }
    const updated = await ctx.store.transaction(async (repos) => {
      const u = await repos.admins.update(target.id, body);
      await ctx.audit.recordWith(repos, {
        admin: p.admin,
        action: 'ADMIN_USER_UPDATED',
        target: `admin:${target.username}`,
        tournamentId: null,
        reason,
        before: adminDto(target),
        after: u ? adminDto(u) : null,
        ip: clientIp(req),
      });
      return u;
    });
    if (body.disabled) await ctx.sessions.revokeAllForAdmin(target.id, 'ACCOUNT_DISABLED');
    return { user: updated ? adminDto(updated) : null };
  });

  app.post<{ Params: { id: string } }>('/api/admin/users/:id/reset-password', async (req) => {
    const p = await requireAdmin(ctx, req, 'ADMIN_USERS_MANAGE');
    const reason = requireDangerConfirmation(req.body, 'USER');
    const password = z.string().min(12).max(256).safeParse((req.body as { password?: unknown }).password);
    if (!password.success) throw badRequest('WEAK_PASSWORD', 'Password must be at least 12 characters.');
    const problem = validatePassword(password.data);
    if (problem) throw badRequest('WEAK_PASSWORD', problem);
    const target = await ctx.store.repos.admins.findById(req.params.id);
    if (!target) throw notFound('Admin user');
    if (target.role === 'SUPER_ADMIN' && p.admin.role !== 'SUPER_ADMIN') throw forbidden();
    const hash = await hashPassword(password.data);
    await ctx.store.transaction(async (repos) => {
      await repos.admins.update(target.id, { passwordHash: hash });
      await ctx.audit.recordWith(repos, {
        admin: p.admin,
        action: 'ADMIN_PASSWORD_RESET',
        target: `admin:${target.username}`,
        tournamentId: null,
        reason,
        before: null,
        after: null,
        ip: clientIp(req),
      });
    });
    await ctx.sessions.revokeAllForAdmin(target.id, 'PASSWORD_RESET');
    return { ok: true };
  });

  app.get('/api/admin/sessions', async (req) => {
    await requireAdmin(ctx, req, 'ADMIN_USERS_MANAGE');
    const sessions = await ctx.store.repos.sessions.listActiveAdminSessions();
    return {
      sessions: sessions.map((s) => ({
        id: s.id,
        adminId: s.adminId,
        createdAt: s.createdAt.getTime(),
        lastSeenAt: s.lastSeenAt.getTime(),
        expiresAt: s.expiresAt.getTime(),
        ip: s.ip,
        userAgent: s.userAgent,
      })),
    };
  });

  app.post<{ Params: { id: string } }>('/api/admin/sessions/:id/revoke', async (req) => {
    const p = await requireAdmin(ctx, req, 'ADMIN_USERS_MANAGE');
    const reason = requireReason(req.body);
    const sessions = await ctx.store.repos.sessions.listActiveAdminSessions();
    const target = sessions.find((s) => s.id === req.params.id);
    if (!target) throw notFound('Session');
    await ctx.sessions.revoke(target, 'REVOKED_BY_ADMIN');
    await ctx.audit.record({
      admin: p.admin,
      action: 'ADMIN_SESSION_REVOKED',
      target: `session:${target.id}`,
      tournamentId: null,
      reason,
      before: { adminId: target.adminId },
      after: null,
      ip: clientIp(req),
    });
    return { ok: true };
  });
}
