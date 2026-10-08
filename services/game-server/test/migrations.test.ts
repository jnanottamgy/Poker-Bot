import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Database, migrate } from '../src/persistence/db';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('migrations (requires TEST_DATABASE_URL)', () => {
  let db: Database;
  beforeAll(async () => {
    db = new Database(url!);
    await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  });
  afterAll(async () => {
    await db?.close();
  });

  it('applies all migrations once and is idempotent', async () => {
    const first = await migrate(db);
    expect(first).toContain('001_initial.sql');
    expect(await migrate(db)).toEqual([]);
  });

  it('enforces append-only audit logs', async () => {
    await db.query(
      `INSERT INTO audit_logs (id, admin_username, action, target, prev_hash, hash) VALUES ('a1','system','TEST','t','0','1')`,
    );
    await expect(db.query(`UPDATE audit_logs SET action='X' WHERE id='a1'`)).rejects.toThrow(/append-only/);
    await expect(db.query(`DELETE FROM audit_logs WHERE id='a1'`)).rejects.toThrow(/append-only/);
  });

  it('rolls back failed transactions completely', async () => {
    await expect(
      db.transaction(async (c) => {
        await c.query(`INSERT INTO users (id, display_name) VALUES ('u1','A')`);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const r = await db.query(`SELECT count(*)::int AS n FROM users`);
    expect(r.rows[0]?.n).toBe(0);
  });
});
