import type { Queryable } from '../db';

export interface OutboxRow {
  id: number;
  sourceKind: string;
  sourceId: string;
  targetKind: string;
  targetId: string;
  payload: unknown;
  attempts: number;
}

interface Row {
  id: number;
  source_kind: string;
  source_id: string;
  target_kind: string;
  target_id: string;
  payload: unknown;
  attempts: number;
}

const toRow = (r: Row): OutboxRow => ({
  id: r.id,
  sourceKind: r.source_kind,
  sourceId: r.source_id,
  targetKind: r.target_kind,
  targetId: r.target_id,
  payload: r.payload,
  attempts: r.attempts,
});

export class OutboxRepo {
  constructor(private readonly q: Queryable) {}

  /** Inserts messages in order (ids increase in insertion order). */
  async add(sourceKind: string, sourceId: string, messages: Array<{ targetKind: string; targetId: string; payload: unknown }>): Promise<void> {
    const CHUNK = 500;
    for (let i = 0; i < messages.length; i += CHUNK) {
      const chunk = messages.slice(i, i + CHUNK);
      const values: unknown[] = [];
      const tuples = chunk.map((m, j) => {
        const b = j * 5;
        values.push(sourceKind, sourceId, m.targetKind, m.targetId, JSON.stringify(m.payload));
        return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5})`;
      });
      await this.q.query(`INSERT INTO actor_outbox (source_kind, source_id, target_kind, target_id, payload) VALUES ${tuples.join(',')}`, values);
    }
  }

  async pendingFor(sourceKind: string, sourceId: string, limit = 1000): Promise<OutboxRow[]> {
    const r = await this.q.query<Row>(
      `SELECT id, source_kind, source_id, target_kind, target_id, payload, attempts FROM actor_outbox
        WHERE source_kind = $1 AND source_id = $2 ORDER BY id LIMIT $3`,
      [sourceKind, sourceId, limit],
    );
    return r.rows.map(toRow);
  }

  /** Sources with undelivered messages (recovery sweep). */
  async sources(limit = 10_000): Promise<Array<{ sourceKind: string; sourceId: string }>> {
    const r = await this.q.query<{ source_kind: string; source_id: string }>(
      `SELECT DISTINCT source_kind, source_id FROM actor_outbox LIMIT $1`,
      [limit],
    );
    return r.rows.map((x) => ({ sourceKind: x.source_kind, sourceId: x.source_id }));
  }

  async remove(ids: number[]): Promise<void> {
    if (ids.length) await this.q.query(`DELETE FROM actor_outbox WHERE id = ANY($1::bigint[])`, [ids]);
  }

  async recordFailure(id: number, error: string): Promise<void> {
    await this.q.query(`UPDATE actor_outbox SET attempts = attempts + 1, last_error = $2 WHERE id = $1`, [id, error.slice(0, 500)]);
  }

  async countPending(): Promise<number> {
    const r = await this.q.query<{ n: number }>(`SELECT count(*)::int AS n FROM actor_outbox`);
    return r.rows[0]?.n ?? 0;
  }
}
