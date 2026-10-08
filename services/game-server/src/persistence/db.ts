import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import pg from 'pg';

/**
 * PostgreSQL access. BIGINT columns are parsed as JS numbers: every chip/money
 * value in this system is a safe integer (validated before it is written), so
 * the conversion is lossless; a guard throws if that assumption ever breaks.
 */
pg.types.setTypeParser(20, (v: string) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error(`BIGINT ${v} exceeds the safe integer range`);
  return n;
});

export type Queryable = Pick<pg.PoolClient, 'query'>;

export interface DatabaseOptions {
  searchPath?: string;
  /** A connection died (server restart, failover, idle kill). Informational: the pool already discarded it. */
  onConnectionError?: (err: Error) => void;
}

export class Database {
  readonly pool: pg.Pool;
  private readonly onConnectionError: (err: Error) => void;

  constructor(connectionString: string, max = 20, opts: DatabaseOptions = {}) {
    if (opts.searchPath !== undefined && !/^[a-z_][a-z0-9_]*$/.test(opts.searchPath)) throw new Error('Invalid schema name');
    this.pool = new pg.Pool({
      connectionString,
      max,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ...(opts.searchPath ? { options: `-c search_path=${opts.searchPath}` } : {}),
    });
    this.onConnectionError = opts.onConnectionError ?? (() => undefined);
    // pg emits 'error' when a backend dies; an 'error' event without a listener
    // is an uncaught exception that would kill the whole node.
    this.pool.on('error', (err) => this.onConnectionError(err));
  }

  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>> {
    return this.pool.query<R>(text, values);
  }

  /** Runs `fn` inside one transaction (all-or-nothing, spec §63). */
  async transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    // pg-pool removes its own 'error' listener while a client is checked out.
    let broken: Error | undefined;
    const onError = (err: Error) => {
      broken ??= err;
      this.onConnectionError(err);
    };
    client.on('error', onError);
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch((rollbackErr: unknown) => {
        broken ??= rollbackErr instanceof Error ? rollbackErr : new Error(String(rollbackErr));
      });
      throw err;
    } finally {
      // A connection whose ROLLBACK failed or that errored is destroyed, never pooled again.
      client.release(broken);
      client.removeListener('error', onError);
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url));

/** Arbitrary constant used for the cross-node migration advisory lock. */
const MIGRATION_LOCK_KEY = 4_242_017;

/**
 * Applies pending *.sql migrations in lexical order, each in its own
 * transaction, under a PostgreSQL advisory lock so concurrently booting nodes
 * never race.
 */
export async function migrate(db: Database, dir = MIGRATIONS_DIR): Promise<string[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const client = await db.pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    const done = new Set((await client.query<{ version: string }>('SELECT version FROM schema_migrations')).rows.map((r) => r.version));
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err });
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => undefined);
    client.release();
  }
  return applied;
}
