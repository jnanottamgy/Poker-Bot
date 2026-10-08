import type { Queryable } from '../db';
import { AUDIT_GENESIS_HASH, chainEntry, verifyAuditChain } from '../../audit/chain';
import type { AuditContent, ChainedAuditEntry } from '../../audit/chain';

/** Constant for the advisory lock serializing audit-chain appends across nodes. */
const AUDIT_LOCK_KEY = 4_242_018;

interface Row {
  id: string;
  seq: number;
  at: Date;
  tournament_id: string | null;
  admin_id: string | null;
  admin_username: string;
  action: string;
  target: string;
  reason: string | null;
  before_state: unknown;
  after_state: unknown;
  ip: string | null;
  prev_hash: string;
  hash: string;
}

export interface AuditRow extends ChainedAuditEntry {
  seq: number;
}

const toEntry = (r: Row): AuditRow => ({
  id: r.id,
  seq: r.seq,
  at: r.at.getTime(),
  tournamentId: r.tournament_id,
  adminId: r.admin_id,
  adminUsername: r.admin_username,
  action: r.action,
  target: r.target,
  reason: r.reason,
  beforeState: r.before_state,
  afterState: r.after_state,
  ip: r.ip,
  prevHash: r.prev_hash,
  hash: r.hash,
});

export interface AuditQuery {
  tournamentId?: string | null;
  adminId?: string;
  action?: string;
  target?: string;
  beforeSeq?: number;
  limit?: number;
}

export class AuditRepo {
  constructor(private readonly q: Queryable) {}

  /**
   * Appends one entry to the global hash chain. MUST run inside a
   * transaction: the advisory xact lock serializes concurrent appenders.
   */
  async append(content: AuditContent): Promise<AuditRow> {
    await this.q.query('SELECT pg_advisory_xact_lock($1)', [AUDIT_LOCK_KEY]);
    const last = await this.q.query<{ hash: string }>(`SELECT hash FROM audit_logs ORDER BY seq DESC LIMIT 1`);
    const entry = chainEntry(last.rows[0]?.hash ?? AUDIT_GENESIS_HASH, content);
    const r = await this.q.query<Row>(
      `INSERT INTO audit_logs (id, at, tournament_id, admin_id, admin_username, action, target, reason, before_state, after_state, ip, prev_hash, hash)
       VALUES ($1, to_timestamp($2 / 1000.0), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
      [
        entry.id,
        entry.at,
        entry.tournamentId,
        entry.adminId,
        entry.adminUsername,
        entry.action,
        entry.target,
        entry.reason,
        JSON.stringify(entry.beforeState ?? null),
        JSON.stringify(entry.afterState ?? null),
        entry.ip,
        entry.prevHash,
        entry.hash,
      ],
    );
    return toEntry(r.rows[0]!);
  }

  async list(query: AuditQuery = {}): Promise<AuditRow[]> {
    const r = await this.q.query<Row>(
      `SELECT * FROM audit_logs
        WHERE ($1::text IS NULL OR tournament_id = $1)
          AND ($2::text IS NULL OR admin_id = $2)
          AND ($3::text IS NULL OR action = $3)
          AND ($4::text IS NULL OR target ILIKE '%' || $4 || '%')
          AND ($5::bigint IS NULL OR seq < $5)
        ORDER BY seq DESC LIMIT $6`,
      [query.tournamentId ?? null, query.adminId ?? null, query.action ?? null, query.target ?? null, query.beforeSeq ?? null, Math.min(query.limit ?? 100, 1000)],
    );
    return r.rows.map(toEntry);
  }

  /**
   * Re-verifies the whole chain (or a window). Returns the seq of the first
   * broken entry, or null when intact. Note: the stored `at` has microsecond
   * precision; hashes are computed over the millisecond value written.
   */
  async verify(fromSeq = 0, limit = 100_000): Promise<{ checked: number; brokenAtSeq: number | null }> {
    const prev = await this.q.query<{ hash: string }>(`SELECT hash FROM audit_logs WHERE seq < $1 ORDER BY seq DESC LIMIT 1`, [fromSeq]);
    const r = await this.q.query<Row>(`SELECT * FROM audit_logs WHERE seq >= $1 ORDER BY seq ASC LIMIT $2`, [fromSeq, limit]);
    const entries = r.rows.map(toEntry);
    const idx = verifyAuditChain(
      entries.map(({ seq: _seq, ...e }) => e),
      prev.rows[0]?.hash ?? AUDIT_GENESIS_HASH,
    );
    return { checked: entries.length, brokenAtSeq: idx === -1 ? null : (entries[idx]?.seq ?? null) };
  }
}
