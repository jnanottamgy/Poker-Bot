import type { AdminRole } from '@jpb/shared-types';
import type { Queryable } from '../db';

export interface AdminUserRecord {
  id: string;
  username: string;
  displayName: string;
  role: AdminRole;
  passwordHash: string;
  tournamentScope: string[] | null;
  createdAt: Date;
  createdBy: string | null;
  disabledAt: Date | null;
  lastLoginAt: Date | null;
  failedLogins: number;
  lockedUntil: Date | null;
}

interface Row {
  id: string;
  username: string;
  display_name: string;
  role: AdminRole;
  password_hash: string;
  tournament_scope: string[] | null;
  created_at: Date;
  created_by: string | null;
  disabled_at: Date | null;
  last_login_at: Date | null;
  failed_logins: number;
  locked_until: Date | null;
}

const toRecord = (r: Row): AdminUserRecord => ({
  id: r.id,
  username: r.username,
  displayName: r.display_name,
  role: r.role,
  passwordHash: r.password_hash,
  tournamentScope: r.tournament_scope,
  createdAt: r.created_at,
  createdBy: r.created_by,
  disabledAt: r.disabled_at,
  lastLoginAt: r.last_login_at,
  failedLogins: r.failed_logins,
  lockedUntil: r.locked_until,
});

/** After this many consecutive failures the account locks for LOCKOUT_MS. */
export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MS = 15 * 60_000;

export class AdminRepo {
  constructor(private readonly q: Queryable) {}

  async create(input: {
    id: string;
    username: string;
    displayName: string;
    role: AdminRole;
    passwordHash: string;
    tournamentScope: string[] | null;
    createdBy: string | null;
  }): Promise<AdminUserRecord> {
    const r = await this.q.query<Row>(
      `INSERT INTO admin_users (id, username, display_name, role, password_hash, tournament_scope, created_by)
       VALUES ($1, lower($2), $3, $4, $5, $6, $7) RETURNING *`,
      [input.id, input.username, input.displayName, input.role, input.passwordHash, input.tournamentScope, input.createdBy],
    );
    return toRecord(r.rows[0]!);
  }

  async count(): Promise<number> {
    const r = await this.q.query<{ n: number }>(`SELECT count(*)::int AS n FROM admin_users`);
    return r.rows[0]?.n ?? 0;
  }

  async findByUsername(username: string): Promise<AdminUserRecord | null> {
    const r = await this.q.query<Row>(`SELECT * FROM admin_users WHERE username = lower($1)`, [username]);
    return r.rows[0] ? toRecord(r.rows[0]) : null;
  }

  async findById(id: string): Promise<AdminUserRecord | null> {
    const r = await this.q.query<Row>(`SELECT * FROM admin_users WHERE id = $1`, [id]);
    return r.rows[0] ? toRecord(r.rows[0]) : null;
  }

  async list(): Promise<AdminUserRecord[]> {
    const r = await this.q.query<Row>(`SELECT * FROM admin_users ORDER BY created_at`);
    return r.rows.map(toRecord);
  }

  async recordLoginSuccess(id: string): Promise<void> {
    await this.q.query(`UPDATE admin_users SET last_login_at = now(), failed_logins = 0, locked_until = NULL WHERE id = $1`, [id]);
  }

  async recordLoginFailure(id: string): Promise<void> {
    await this.q.query(
      `UPDATE admin_users
          SET failed_logins = failed_logins + 1,
              locked_until = CASE WHEN failed_logins + 1 >= $2 THEN now() + ($3 || ' milliseconds')::interval ELSE locked_until END
        WHERE id = $1`,
      [id, MAX_FAILED_LOGINS, String(LOCKOUT_MS)],
    );
  }

  async update(
    id: string,
    patch: Partial<{ displayName: string; role: AdminRole; tournamentScope: string[] | null; disabled: boolean; passwordHash: string }>,
  ): Promise<AdminUserRecord | null> {
    const sets: string[] = [];
    const values: unknown[] = [id];
    const add = (sql: string, v: unknown) => {
      values.push(v);
      sets.push(`${sql} = $${values.length}`);
    };
    if (patch.displayName !== undefined) add('display_name', patch.displayName);
    if (patch.role !== undefined) add('role', patch.role);
    if (patch.tournamentScope !== undefined) add('tournament_scope', patch.tournamentScope);
    if (patch.passwordHash !== undefined) add('password_hash', patch.passwordHash);
    if (patch.disabled !== undefined) sets.push(patch.disabled ? 'disabled_at = now()' : 'disabled_at = NULL');
    if (sets.length === 0) return this.findById(id);
    const r = await this.q.query<Row>(`UPDATE admin_users SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, values);
    return r.rows[0] ? toRecord(r.rows[0]) : null;
  }
}
