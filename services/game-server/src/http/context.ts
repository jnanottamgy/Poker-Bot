import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Permission } from '@jpb/shared-types';
import { ROLE_PERMISSIONS } from '@jpb/shared-types';
import type { ServerEnv } from '../config/env';
import type { Store } from '../persistence/store';
import type { AdminPrincipal, IssuedSession, PlayerPrincipal, SessionService } from '../auth/sessions';
import { COOKIES, CSRF_HEADER, adminCan } from '../auth/sessions';
import type { AdminAuthService } from '../auth/admin-auth';
import type { AuditService } from '../audit/audit-service';
import type { MetricsRegistry } from '../observability/metrics';
import { RateLimiter } from '../security/rate-limit';
import type { RateLimitRule } from '../security/rate-limit';
import { forbidden, tooManyRequests, unauthorized } from './errors';

/** Everything route modules need. Runtime-specific services are attached by later modules via `extras`. */
export interface HttpContext {
  env: ServerEnv;
  store: Store;
  sessions: SessionService;
  adminAuth: AdminAuthService;
  audit: AuditService;
  metrics: MetricsRegistry;
  limiters: Map<string, RateLimiter>;
  now: () => number;
}

export function clientIp(req: FastifyRequest): string {
  return req.ip ?? 'unknown';
}

export function rateLimit(ctx: HttpContext, name: string, rule: RateLimitRule, key: string): void {
  let limiter = ctx.limiters.get(name);
  if (!limiter) {
    limiter = new RateLimiter(rule);
    ctx.limiters.set(name, limiter);
  }
  const now = ctx.now();
  if (!limiter.take(key, now)) throw tooManyRequests(limiter.retryAfterSeconds(key, now));
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function requireAdmin(
  ctx: HttpContext,
  req: FastifyRequest,
  permission: Permission | null,
  tournamentId: string | null = null,
): Promise<AdminPrincipal> {
  const resolved = await ctx.sessions.resolve(req.cookies[COOKIES.admin]);
  if (!resolved || resolved.session.kind !== 'ADMIN' || !resolved.admin) throw unauthorized();
  if (MUTATING.has(req.method) && !ctx.sessions.verifyCsrf(resolved.session, header(req, CSRF_HEADER))) {
    throw forbidden('Security check failed (CSRF). Reload the page and try again.');
  }
  if (permission && !adminCan(resolved.admin, permission, tournamentId)) throw forbidden();
  return { kind: 'ADMIN', session: resolved.session, admin: resolved.admin };
}

export async function requirePlayer(ctx: HttpContext, req: FastifyRequest): Promise<PlayerPrincipal> {
  const resolved = await ctx.sessions.resolve(req.cookies[COOKIES.player]);
  if (!resolved || resolved.session.kind !== 'PLAYER' || !resolved.session.playerId || !resolved.session.tournamentId) throw unauthorized();
  if (MUTATING.has(req.method) && !ctx.sessions.verifyCsrf(resolved.session, header(req, CSRF_HEADER))) {
    throw forbidden('Security check failed (CSRF). Reload the page and try again.');
  }
  return { kind: 'PLAYER', session: resolved.session, playerId: resolved.session.playerId, tournamentId: resolved.session.tournamentId };
}

export function header(req: FastifyRequest, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

/** Sets the HttpOnly session cookie and the JS-readable CSRF cookie. */
export function setSessionCookies(ctx: HttpContext, reply: FastifyReply, kind: 'PLAYER' | 'ADMIN', issued: IssuedSession): void {
  const maxAge = Math.floor((issued.session.expiresAt.getTime() - ctx.now()) / 1000);
  const base = { path: '/', secure: ctx.env.cookieSecure, sameSite: 'lax' as const, maxAge };
  reply.setCookie(kind === 'ADMIN' ? COOKIES.admin : COOKIES.player, issued.token, { ...base, httpOnly: true });
  reply.setCookie(COOKIES.csrf, issued.csrfToken, { ...base, httpOnly: false });
}

export function clearSessionCookies(ctx: HttpContext, reply: FastifyReply, kind: 'PLAYER' | 'ADMIN'): void {
  const base = { path: '/', secure: ctx.env.cookieSecure, sameSite: 'lax' as const };
  reply.clearCookie(kind === 'ADMIN' ? COOKIES.admin : COOKIES.player, base);
}

export function permissionsOf(principal: AdminPrincipal): readonly Permission[] {
  return ROLE_PERMISSIONS[principal.admin.role];
}
