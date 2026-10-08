import type { Permission } from '@jpb/shared-types';
import { roleHasPermission } from '@jpb/shared-types';
import { randomToken, sha256Hex, constantTimeEqual } from '../security/crypto';
import { newId } from '../security/ids';
import type { Store } from '../persistence/store';
import type { SessionKind, SessionRecord } from '../persistence/repos/sessions';
import type { AdminUserRecord } from '../persistence/repos/admins';

export const COOKIES = {
  player: 'jpb_ps',
  admin: 'jpb_as',
  /** Readable by JS (not HttpOnly) — the double-submit CSRF token. */
  csrf: 'jpb_csrf',
} as const;

export const CSRF_HEADER = 'x-csrf-token';

export interface IssuedSession {
  session: SessionRecord;
  /** Raw bearer token — only ever sent to the client in a Set-Cookie header. */
  token: string;
  csrfToken: string;
}

export interface AdminPrincipal {
  kind: 'ADMIN';
  session: SessionRecord;
  admin: AdminUserRecord;
}

export interface PlayerPrincipal {
  kind: 'PLAYER';
  session: SessionRecord;
  playerId: string;
  tournamentId: string;
}

interface CacheEntry {
  session: SessionRecord;
  admin: AdminUserRecord | null;
  cachedAt: number;
}

/**
 * Session issuance and verification. Tokens are 256-bit random values; only
 * their SHA-256 is stored. Verified sessions are cached briefly so WebSocket
 * reconnect storms don't hammer the database; revocation clears the cache on
 * this node and the TTL bounds staleness on others.
 */
export class SessionService {
  private readonly cache = new Map<string, CacheEntry>();
  private static readonly CACHE_TTL_MS = 15_000;
  private static readonly CACHE_MAX = 50_000;

  constructor(
    private readonly store: Store,
    private readonly ttl: { playerMs: number; adminMs: number },
    private readonly now: () => number = Date.now,
  ) {}

  async issue(input: {
    kind: SessionKind;
    playerId?: string | null;
    adminId?: string | null;
    tournamentId?: string | null;
    userAgent: string | null;
    ip: string | null;
  }): Promise<IssuedSession> {
    const token = randomToken(32);
    const csrfToken = randomToken(24);
    const ttlMs = input.kind === 'ADMIN' ? this.ttl.adminMs : this.ttl.playerMs;
    const session = await this.store.repos.sessions.create({
      id: newId('ses'),
      tokenHash: sha256Hex(token),
      kind: input.kind,
      playerId: input.playerId ?? null,
      adminId: input.adminId ?? null,
      tournamentId: input.tournamentId ?? null,
      csrfTokenHash: sha256Hex(csrfToken),
      expiresAt: new Date(this.now() + ttlMs),
      userAgent: input.userAgent,
      ip: input.ip,
    });
    return { session, token, csrfToken };
  }

  async resolve(token: string | undefined): Promise<{ session: SessionRecord; admin: AdminUserRecord | null } | null> {
    if (!token || token.length > 128) return null;
    const hash = sha256Hex(token);
    const now = this.now();
    const cached = this.cache.get(hash);
    if (cached && now - cached.cachedAt < SessionService.CACHE_TTL_MS && cached.session.expiresAt.getTime() > now) {
      return { session: cached.session, admin: cached.admin };
    }
    const session = await this.store.repos.sessions.findActiveByTokenHash(hash);
    if (!session) {
      this.cache.delete(hash);
      return null;
    }
    let admin: AdminUserRecord | null = null;
    if (session.kind === 'ADMIN' && session.adminId) {
      admin = await this.store.repos.admins.findById(session.adminId);
      if (!admin || admin.disabledAt) return null;
    }
    if (this.cache.size >= SessionService.CACHE_MAX) this.cache.delete(this.cache.keys().next().value as string);
    this.cache.set(hash, { session, admin, cachedAt: now });
    // Best-effort activity tracking; never blocks authentication.
    void this.store.repos.sessions.touch(session.id).catch(() => undefined);
    return { session, admin };
  }

  verifyCsrf(session: SessionRecord, headerValue: string | undefined): boolean {
    if (!headerValue || headerValue.length > 128) return false;
    return constantTimeEqual(sha256Hex(headerValue), session.csrfTokenHash);
  }

  async revoke(session: SessionRecord, reason: string): Promise<void> {
    await this.store.repos.sessions.revoke(session.id, reason);
    this.forgetSession(session.id);
  }

  async revokeAllForPlayer(playerId: string, reason: string, exceptSessionId: string | null = null): Promise<number> {
    const n = await this.store.repos.sessions.revokeAllForPlayer(playerId, reason, exceptSessionId);
    for (const [k, v] of this.cache) if (v.session.playerId === playerId && v.session.id !== exceptSessionId) this.cache.delete(k);
    return n;
  }

  async revokeAllForAdmin(adminId: string, reason: string): Promise<number> {
    const n = await this.store.repos.sessions.revokeAllForAdmin(adminId, reason);
    for (const [k, v] of this.cache) if (v.session.adminId === adminId) this.cache.delete(k);
    return n;
  }

  forgetSession(sessionId: string): void {
    for (const [k, v] of this.cache) if (v.session.id === sessionId) this.cache.delete(k);
  }
}

/** RBAC + tournament scope check (spec §72). */
export function adminCan(admin: AdminUserRecord, permission: Permission, tournamentId: string | null = null): boolean {
  if (admin.disabledAt) return false;
  if (!roleHasPermission(admin.role, permission)) return false;
  if (tournamentId && admin.tournamentScope && !admin.tournamentScope.includes(tournamentId)) return false;
  return true;
}
