import { COOKIES } from '../auth/sessions';
import type { SessionService } from '../auth/sessions';
import type { GatewayPrincipal } from './connection';

/**
 * Resolves raw session tokens to a gateway principal. A missing, forged,
 * expired or revoked token (or a disabled admin) yields no identity rather
 * than an error, so a stale cookie never locks anyone out of public audiences.
 */
export async function resolveTokens(sessions: SessionService, tokens: { player: string | null; admin: string | null }): Promise<GatewayPrincipal> {
  const [p, a] = await Promise.all([
    tokens.player ? sessions.resolve(tokens.player) : Promise.resolve(null),
    tokens.admin ? sessions.resolve(tokens.admin) : Promise.resolve(null),
  ]);
  const player =
    tokens.player && p && p.session.kind === 'PLAYER' && p.session.playerId && p.session.tournamentId
      ? { token: tokens.player, sessionId: p.session.id, playerId: p.session.playerId, tournamentId: p.session.tournamentId }
      : null;
  const admin =
    tokens.admin && a && a.session.kind === 'ADMIN' && a.admin && !a.admin.disabledAt ? { token: tokens.admin, sessionId: a.session.id, admin: a.admin } : null;
  return { player, admin };
}

export function resolvePrincipal(sessions: SessionService, cookies: Record<string, string | undefined>): Promise<GatewayPrincipal> {
  return resolveTokens(sessions, { player: cookies[COOKIES.player] ?? null, admin: cookies[COOKIES.admin] ?? null });
}
