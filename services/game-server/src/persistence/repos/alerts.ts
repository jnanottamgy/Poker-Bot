import type { Alert, AlertCode, AlertSeverity } from '@jpb/shared-types';
import type { Queryable } from '../db';

interface Row {
  id: string;
  at: Date;
  tournament_id: string | null;
  severity: AlertSeverity;
  code: AlertCode;
  message: string;
  target: string | null;
  acknowledged_by: string | null;
  acknowledged_at: Date | null;
  resolved_at: Date | null;
}

const toAlert = (r: Row): Alert => ({
  id: r.id,
  at: r.at.getTime(),
  tournamentId: r.tournament_id,
  severity: r.severity,
  code: r.code,
  message: r.message,
  target: r.target,
  acknowledgedBy: r.acknowledged_by,
  acknowledgedAt: r.acknowledged_at?.getTime() ?? null,
  resolvedAt: r.resolved_at?.getTime() ?? null,
});

export class AlertRepo {
  constructor(private readonly q: Queryable) {}

  async create(a: Pick<Alert, 'id' | 'tournamentId' | 'severity' | 'code' | 'message' | 'target'>): Promise<Alert> {
    const r = await this.q.query<Row>(
      `INSERT INTO alerts (id, tournament_id, severity, code, message, target) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [a.id, a.tournamentId, a.severity, a.code, a.message, a.target],
    );
    return toAlert(r.rows[0]!);
  }

  /** An open alert with the same code+target, used to avoid alert storms. */
  async findOpen(tournamentId: string | null, code: AlertCode, target: string | null): Promise<Alert | null> {
    const r = await this.q.query<Row>(
      `SELECT * FROM alerts WHERE resolved_at IS NULL AND code = $2 AND tournament_id IS NOT DISTINCT FROM $1 AND target IS NOT DISTINCT FROM $3 LIMIT 1`,
      [tournamentId, code, target],
    );
    return r.rows[0] ? toAlert(r.rows[0]) : null;
  }

  async list(opts: { tournamentId?: string | null; openOnly?: boolean; limit?: number } = {}): Promise<Alert[]> {
    const r = await this.q.query<Row>(
      `SELECT * FROM alerts
        WHERE ($1::text IS NULL OR tournament_id = $1) AND (NOT $2::boolean OR resolved_at IS NULL)
        ORDER BY at DESC LIMIT $3`,
      [opts.tournamentId ?? null, opts.openOnly ?? false, Math.min(opts.limit ?? 100, 1000)],
    );
    return r.rows.map(toAlert);
  }

  async acknowledge(id: string, adminId: string): Promise<Alert | null> {
    const r = await this.q.query<Row>(
      `UPDATE alerts SET acknowledged_by = $2, acknowledged_at = now() WHERE id = $1 AND acknowledged_at IS NULL RETURNING *`,
      [id, adminId],
    );
    return r.rows[0] ? toAlert(r.rows[0]) : null;
  }

  async resolve(id: string): Promise<void> {
    await this.q.query(`UPDATE alerts SET resolved_at = now() WHERE id = $1 AND resolved_at IS NULL`, [id]);
  }

  async resolveByCode(tournamentId: string | null, code: AlertCode, target: string | null): Promise<number> {
    const r = await this.q.query(
      `UPDATE alerts SET resolved_at = now() WHERE resolved_at IS NULL AND code = $2 AND tournament_id IS NOT DISTINCT FROM $1 AND target IS NOT DISTINCT FROM $3`,
      [tournamentId, code, target],
    );
    return r.rowCount ?? 0;
  }
}
