import { Database, migrate } from '../../src/persistence/db';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/**
 * Creates an isolated schema per test file so files can run in parallel
 * against one PostgreSQL database.
 */
export async function createTestDatabase(name: string, opts: { migrate?: boolean } = {}): Promise<Database> {
  if (!TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL not set');
  const schema = `t_${name}_${process.pid}`.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const admin = new Database(TEST_DATABASE_URL, 1);
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.close();
  const db = new Database(TEST_DATABASE_URL, 10, { searchPath: schema });
  if (opts.migrate !== false) await migrate(db);
  const close = db.close.bind(db);
  db.close = async () => {
    await close();
    const cleanup = new Database(TEST_DATABASE_URL, 1);
    await cleanup.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await cleanup.close();
  };
  return db;
}
