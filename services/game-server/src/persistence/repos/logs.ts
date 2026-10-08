import type { Queryable } from '../db';

/**
 * Event-sourcing storage for actors (tables and tournament directors).
 * Payloads are opaque JSON produced by the pure reducers; the primary keys
 * (resource, seq) make the logs gap-free and act as a fencing mechanism: a
 * stale owner can never append a sequence number twice.
 */
export interface LoggedCommand<C = unknown> {
  seq: number;
  commandId: string;
  at: number;
  type: string;
  command: C;
  actionId: string | null;
}

export interface LoggedEvent<E = unknown> {
  seq: number;
  version: number;
  at: number;
  kind: string;
  visibility: 'PUBLIC' | 'PRIVATE';
  privateTo: string | null;
  payload: E;
}

export interface Snapshot<S = unknown> {
  commandSeq: number;
  version: number;
  at: number;
  state: S;
}

export class DuplicateSequenceError extends Error {
  constructor(resource: string, seq: number) {
    super(`Sequence ${seq} already exists for ${resource} (stale owner or replayed write)`);
  }
}

const isUniqueViolation = (err: unknown): boolean => (err as { code?: string })?.code === '23505';

export interface TableMetaInput {
  id: string;
  tournamentId: string;
  tableNumber: number;
  maxSeats: number;
  status: string;
  isFinalTable: boolean;
}

export interface TableMetaRecord extends TableMetaInput {
  playerCount: number;
  handsPlayed: number;
  lastEventSeq: number;
  lastCommandSeq: number;
  lastProgressAt: Date | null;
  ownerNode: string | null;
  createdAt: Date;
  closedAt: Date | null;
}

interface TableRow {
  id: string;
  tournament_id: string;
  table_number: number;
  max_seats: number;
  status: string;
  is_final_table: boolean;
  player_count: number;
  hands_played: number;
  last_event_seq: number;
  last_command_seq: number;
  last_progress_at: Date | null;
  owner_node: string | null;
  created_at: Date;
  closed_at: Date | null;
}

const toTable = (r: TableRow): TableMetaRecord => ({
  id: r.id,
  tournamentId: r.tournament_id,
  tableNumber: r.table_number,
  maxSeats: r.max_seats,
  status: r.status,
  isFinalTable: r.is_final_table,
  playerCount: r.player_count,
  handsPlayed: r.hands_played,
  lastEventSeq: r.last_event_seq,
  lastCommandSeq: r.last_command_seq,
  lastProgressAt: r.last_progress_at,
  ownerNode: r.owner_node,
  createdAt: r.created_at,
  closedAt: r.closed_at,
});

export class TableLogRepo {
  constructor(private readonly q: Queryable) {}

  async createTable(input: TableMetaInput): Promise<void> {
    await this.q.query(
      `INSERT INTO tables (id, tournament_id, table_number, max_seats, status, is_final_table)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
      [input.id, input.tournamentId, input.tableNumber, input.maxSeats, input.status, input.isFinalTable],
    );
    await this.q.query(
      `INSERT INTO seats (table_id, seat_index) SELECT $1, s FROM generate_series(0, $2 - 1) s ON CONFLICT DO NOTHING`,
      [input.id, input.maxSeats],
    );
  }

  async getTable(id: string): Promise<TableMetaRecord | null> {
    const r = await this.q.query<TableRow>(`SELECT * FROM tables WHERE id = $1`, [id]);
    return r.rows[0] ? toTable(r.rows[0]) : null;
  }

  async listTables(
    tournamentId: string,
    opts: { statuses?: string[]; limit?: number; offset?: number; minPlayers?: number; maxPlayers?: number } = {},
  ): Promise<{ rows: TableMetaRecord[]; total: number }> {
    const where = `tournament_id = $1 AND ($2::text[] IS NULL OR status = ANY($2))
       AND ($3::int IS NULL OR player_count >= $3) AND ($4::int IS NULL OR player_count <= $4)`;
    const args = [tournamentId, opts.statuses ?? null, opts.minPlayers ?? null, opts.maxPlayers ?? null];
    const total = await this.q.query<{ n: number }>(`SELECT count(*)::int AS n FROM tables WHERE ${where}`, args);
    const r = await this.q.query<TableRow>(`SELECT * FROM tables WHERE ${where} ORDER BY table_number LIMIT $5 OFFSET $6`, [
      ...args,
      Math.min(opts.limit ?? 100, 1000),
      opts.offset ?? 0,
    ]);
    return { rows: r.rows.map(toTable), total: total.rows[0]?.n ?? 0 };
  }

  /** Tables with no progress for longer than `ms` while not closed (stall detection, spec §107). */
  async listStalled(tournamentId: string, olderThan: Date): Promise<TableMetaRecord[]> {
    const r = await this.q.query<TableRow>(
      `SELECT * FROM tables WHERE tournament_id = $1 AND status IN ('IN_HAND','BETWEEN_HANDS') AND last_progress_at < $2 ORDER BY last_progress_at`,
      [tournamentId, olderThan],
    );
    return r.rows.map(toTable);
  }

  /**
   * Appends one processed command and the events it produced, and updates the
   * table's meta row. Must run inside the actor's transaction.
   */
  async append(
    tableId: string,
    command: LoggedCommand,
    events: LoggedEvent[],
    meta: { status: string; playerCount: number; handsPlayed: number; progressed: boolean },
  ): Promise<void> {
    try {
      await this.q.query(
        `INSERT INTO table_commands (table_id, seq, command_id, at, type, command, action_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [tableId, command.seq, command.commandId, command.at, command.type, JSON.stringify(command.command), command.actionId],
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw new DuplicateSequenceError(`table ${tableId}`, command.seq);
      throw err;
    }
    if (events.length) {
      const values: unknown[] = [];
      const tuples = events.map((e, i) => {
        const b = i * 8;
        values.push(tableId, e.seq, e.version, e.at, e.kind, e.visibility, e.privateTo, JSON.stringify(e.payload));
        return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8})`;
      });
      await this.q.query(
        `INSERT INTO table_events (table_id, seq, version, at, kind, visibility, private_to, payload) VALUES ${tuples.join(',')}`,
        values,
      );
    }
    const lastEventSeq = events.length ? events[events.length - 1]!.seq : null;
    await this.q.query(
      `UPDATE tables SET status = $2, player_count = $3, hands_played = $4, last_command_seq = $5,
              last_event_seq = COALESCE($6, last_event_seq),
              last_progress_at = CASE WHEN $7 THEN to_timestamp($8 / 1000.0) ELSE COALESCE(last_progress_at, to_timestamp($8 / 1000.0)) END,
              closed_at = CASE WHEN $2 = 'CLOSED' THEN COALESCE(closed_at, now()) ELSE closed_at END
        WHERE id = $1`,
      [tableId, meta.status, meta.playerCount, meta.handsPlayed, command.seq, lastEventSeq, meta.progressed, command.at],
    );
  }

  async saveSnapshot(tableId: string, snap: Snapshot): Promise<void> {
    await this.q.query(
      `INSERT INTO table_snapshots (table_id, command_seq, version, at, state) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (table_id, command_seq) DO NOTHING`,
      [tableId, snap.commandSeq, snap.version, snap.at, JSON.stringify(snap.state)],
    );
    // Keep only the three most recent snapshots per table.
    await this.q.query(
      `DELETE FROM table_snapshots WHERE table_id = $1 AND command_seq < (
         SELECT min(command_seq) FROM (SELECT command_seq FROM table_snapshots WHERE table_id = $1 ORDER BY command_seq DESC LIMIT 3) s)`,
      [tableId],
    );
  }

  async latestSnapshot<S>(tableId: string): Promise<Snapshot<S> | null> {
    const r = await this.q.query<{ command_seq: number; version: number; at: number; state: S }>(
      `SELECT command_seq, version, at, state FROM table_snapshots WHERE table_id = $1 ORDER BY command_seq DESC LIMIT 1`,
      [tableId],
    );
    const row = r.rows[0];
    return row ? { commandSeq: row.command_seq, version: row.version, at: row.at, state: row.state } : null;
  }

  async commandsAfter<C>(tableId: string, afterSeq: number, limit = 100_000): Promise<LoggedCommand<C>[]> {
    const r = await this.q.query<{ seq: number; command_id: string; at: number; type: string; command: C; action_id: string | null }>(
      `SELECT seq, command_id, at, type, command, action_id FROM table_commands WHERE table_id = $1 AND seq > $2 ORDER BY seq LIMIT $3`,
      [tableId, afterSeq, limit],
    );
    return r.rows.map((row) => ({ seq: row.seq, commandId: row.command_id, at: row.at, type: row.type, command: row.command, actionId: row.action_id }));
  }

  async eventsAfter<E>(tableId: string, afterSeq: number, limit = 500): Promise<LoggedEvent<E>[]> {
    const r = await this.q.query<{ seq: number; version: number; at: number; kind: string; visibility: 'PUBLIC' | 'PRIVATE'; private_to: string | null; payload: E }>(
      `SELECT seq, version, at, kind, visibility, private_to, payload FROM table_events WHERE table_id = $1 AND seq > $2 ORDER BY seq LIMIT $3`,
      [tableId, afterSeq, limit],
    );
    return r.rows.map((row) => ({
      seq: row.seq,
      version: row.version,
      at: row.at,
      kind: row.kind,
      visibility: row.visibility,
      privateTo: row.private_to,
      payload: row.payload,
    }));
  }

  async findByActionId(tableId: string, actionId: string): Promise<LoggedCommand | null> {
    const r = await this.q.query<{ seq: number; command_id: string; at: number; type: string; command: unknown; action_id: string | null }>(
      `SELECT seq, command_id, at, type, command, action_id FROM table_commands WHERE table_id = $1 AND action_id = $2`,
      [tableId, actionId],
    );
    const row = r.rows[0];
    return row ? { seq: row.seq, commandId: row.command_id, at: row.at, type: row.type, command: row.command, actionId: row.action_id } : null;
  }

  async setSeat(tableId: string, seat: number, playerId: string | null, stack: number): Promise<void> {
    if (playerId) await this.q.query(`UPDATE seats SET player_id = NULL, stack = 0, updated_at = now() WHERE player_id = $1 AND NOT (table_id = $2 AND seat_index = $3)`, [playerId, tableId, seat]);
    await this.q.query(`UPDATE seats SET player_id = $3, stack = $4, updated_at = now() WHERE table_id = $1 AND seat_index = $2`, [tableId, seat, playerId, stack]);
  }

  async acquireLease(tableId: string, nodeId: string, ttlMs: number): Promise<number | null> {
    const r = await this.q.query<{ lease_epoch: number }>(
      `UPDATE tables SET owner_node = $2, lease_epoch = lease_epoch + 1, lease_expires_at = now() + ($3 || ' milliseconds')::interval
        WHERE id = $1 AND (owner_node IS NULL OR owner_node = $2 OR lease_expires_at < now()) RETURNING lease_epoch`,
      [tableId, nodeId, String(ttlMs)],
    );
    return r.rows[0]?.lease_epoch ?? null;
  }
}

export class DirectorLogRepo {
  constructor(private readonly q: Queryable) {}

  async append(tournamentId: string, input: { seq: number; at: number; type: string; input: unknown }): Promise<void> {
    try {
      await this.q.query(`INSERT INTO director_inputs (tournament_id, seq, at, type, input) VALUES ($1,$2,$3,$4,$5)`, [
        tournamentId,
        input.seq,
        input.at,
        input.type,
        JSON.stringify(input.input),
      ]);
    } catch (err) {
      if (isUniqueViolation(err)) throw new DuplicateSequenceError(`director ${tournamentId}`, input.seq);
      throw err;
    }
  }

  async appendEvents(tournamentId: string, events: Array<{ seq: number; at: number; kind: string; payload: unknown }>): Promise<void> {
    if (!events.length) return;
    const values: unknown[] = [];
    const tuples = events.map((e, i) => {
      const b = i * 5;
      values.push(tournamentId, e.seq, e.at, e.kind, JSON.stringify(e.payload));
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5})`;
    });
    await this.q.query(`INSERT INTO tournament_events (tournament_id, seq, at, kind, payload) VALUES ${tuples.join(',')}`, values);
  }

  async saveSnapshot(tournamentId: string, snap: { inputSeq: number; at: number; state: unknown }): Promise<void> {
    await this.q.query(
      `INSERT INTO director_snapshots (tournament_id, input_seq, at, state) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [tournamentId, snap.inputSeq, snap.at, JSON.stringify(snap.state)],
    );
    await this.q.query(
      `DELETE FROM director_snapshots WHERE tournament_id = $1 AND input_seq < (
         SELECT min(input_seq) FROM (SELECT input_seq FROM director_snapshots WHERE tournament_id = $1 ORDER BY input_seq DESC LIMIT 3) s)`,
      [tournamentId],
    );
  }

  async latestSnapshot<S>(tournamentId: string): Promise<{ inputSeq: number; at: number; state: S } | null> {
    const r = await this.q.query<{ input_seq: number; at: number; state: S }>(
      `SELECT input_seq, at, state FROM director_snapshots WHERE tournament_id = $1 ORDER BY input_seq DESC LIMIT 1`,
      [tournamentId],
    );
    const row = r.rows[0];
    return row ? { inputSeq: row.input_seq, at: row.at, state: row.state } : null;
  }

  async inputsAfter<I>(tournamentId: string, afterSeq: number, limit = 1_000_000): Promise<Array<{ seq: number; at: number; type: string; input: I }>> {
    const r = await this.q.query<{ seq: number; at: number; type: string; input: I }>(
      `SELECT seq, at, type, input FROM director_inputs WHERE tournament_id = $1 AND seq > $2 ORDER BY seq LIMIT $3`,
      [tournamentId, afterSeq, limit],
    );
    return r.rows;
  }

  async eventsAfter<E>(tournamentId: string, afterSeq: number, limit = 500): Promise<Array<{ seq: number; at: number; kind: string; payload: E }>> {
    const r = await this.q.query<{ seq: number; at: number; kind: string; payload: E }>(
      `SELECT seq, at, kind, payload FROM tournament_events WHERE tournament_id = $1 AND seq > $2 ORDER BY seq LIMIT $3`,
      [tournamentId, afterSeq, limit],
    );
    return r.rows;
  }

  async recentEvents<E>(tournamentId: string, kinds: string[] | null, limit = 50): Promise<Array<{ seq: number; at: number; kind: string; payload: E }>> {
    const r = await this.q.query<{ seq: number; at: number; kind: string; payload: E }>(
      `SELECT seq, at, kind, payload FROM tournament_events WHERE tournament_id = $1 AND ($2::text[] IS NULL OR kind = ANY($2)) ORDER BY seq DESC LIMIT $3`,
      [tournamentId, kinds, Math.min(limit, 1000)],
    );
    return r.rows;
  }
}
