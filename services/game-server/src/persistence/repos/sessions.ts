import type { Queryable } from '../db';

export type SessionKind = 'PLAYER' | 'ADMIN' | 'SPECTATOR';

export interface SessionRecord {
  id: string;
  kind: SessionKind;
  playerId: string | null;
  adminId: string | null;
  tournamentId: string | null;
  csrfTokenHash: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
  userAgent: string | null;
  ip: string | null;
}

interface Row {
  id: string;
  kind: SessionKind;
  player_id: string | null;
  admin_id: string | null;
  tournament_id: string | null;
  csrf_token_hash: string;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  revoked_reason: string | null;
  user_agent: string | null;
  ip: string | null;
}

const toRecord = (r: Row): SessionRecord => ({
  id: r.id,
  kind: r.kind,
  playerId: r.player_id,
  adminId: r.admin_id,
  tournamentId: r.tournament_id,
  csrfTokenHash: r.csrf_token_hash,
  createdAt: r.created_at,
  lastSeenAt: r.last_seen_at,
  expiresAt: r.expires_at,
  revokedAt: r.revoked_at,
  revokedReason: r.revoked_reason,
  userAgent: r.user_agent,
  ip: r.ip,
});

export class SessionRepo {
  constructor(private readonly q: Queryable) {}

  async create(input: {
    id: string;
    tokenHash: string;
    kind: SessionKind;
    playerId: string | null;
    adminId: string | null;
    tournamentId: string | null;
    csrfTokenHash: string;
    expiresAt: Date;
    userAgent: string | null;
    ip: string | null;
  }): Promise<SessionRecord> {
    const r = await this.q.query<Row>(
      `INSERT INTO sessions (id, token_hash, kind, player_id, admin_id, tournament_id, csrf_token_hash, expires_at, user_agent, ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        input.id,
        input.tokenHash,
        input.kind,
        input.playerId,
        input.adminId,
        input.tournamentId,
        input.csrfTokenHash,
        input.expiresAt,
        input.userAgent?.slice(0, 512) ?? null,
        input.ip,
      ],
    );
    return toRecord(r.rows[0]!);
  }

  /** Returns the session only if it is not revoked and not expired. */
  async findActiveByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    const r = await this.q.query<Row>(
      `SELECT * FROM sessions WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [tokenHash],
    );
    return r.rows[0] ? toRecord(r.rows[0]) : null;
  }

  async touch(id: string): Promise<void> {
    await this.q.query(`UPDATE sessions SET last_seen_at = now() WHERE id = $1`, [id]);
  }

  async revoke(id: string, reason: string): Promise<void> {
    await this.q.query(`UPDATE sessions SET revoked_at = now(), revoked_reason = $2 WHERE id = $1 AND revoked_at IS NULL`, [id, reason]);
  }

  async revokeAllForPlayer(playerId: string, reason: string, exceptSessionId: string | null = null): Promise<number> {
    const r = await this.q.query(
      `UPDATE sessions SET revoked_at = now(), revoked_reason = $2
        WHERE player_id = $1 AND revoked_at IS NULL AND ($3::text IS NULL OR id <> $3)`,
      [playerId, reason, exceptSessionId],
    );
    return r.rowCount ?? 0;
  }

  async revokeAllForAdmin(adminId: string, reason: string): Promise<number> {
    const r = await this.q.query(`UPDATE sessions SET revoked_at = now(), revoked_reason = $2 WHERE admin_id = $1 AND revoked_at IS NULL`, [
      adminId,
      reason,
    ]);
    return r.rowCount ?? 0;
  }

  async listForPlayer(playerId: string): Promise<SessionRecord[]> {
    const r = await this.q.query<Row>(`SELECT * FROM sessions WHERE player_id = $1 ORDER BY created_at DESC LIMIT 50`, [playerId]);
    return r.rows.map(toRecord);
  }

  async listActiveAdminSessions(): Promise<SessionRecord[]> {
    const r = await this.q.query<Row>(
      `SELECT * FROM sessions WHERE kind = 'ADMIN' AND revoked_at IS NULL AND expires_at > now() ORDER BY last_seen_at DESC LIMIT 500`,
    );
    return r.rows.map(toRecord);
  }

  async purgeExpired(olderThanDays = 30): Promise<number> {
    const r = await this.q.query(`DELETE FROM sessions WHERE expires_at < now() - ($1 || ' days')::interval`, [String(olderThanDays)]);
    return r.rowCount ?? 0;
  }
}
