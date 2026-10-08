import type { TournamentConfig, TournamentStatus } from '@jpb/shared-types';
import type { Queryable } from '../db';

export interface TournamentCountersRecord {
  registered: number;
  active: number;
  eliminated: number;
  tables: number;
  handsCompleted: number;
}

export interface TournamentRecord {
  id: string;
  joinCode: string;
  name: string;
  status: TournamentStatus;
  config: TournamentConfig;
  configLockedAt: Date | null;
  serverSeedHash: string;
  serverSeedEnc: string;
  serverSeedRevealed: string | null;
  publicEntropy: string | null;
  isSimulation: boolean;
  createdBy: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  winnerPlayerId: string | null;
  counters: TournamentCountersRecord;
  updatedAt: Date;
}

interface Row {
  id: string;
  join_code: string;
  name: string;
  status: TournamentStatus;
  config: TournamentConfig;
  config_locked_at: Date | null;
  server_seed_hash: string;
  server_seed_enc: string;
  server_seed_revealed: string | null;
  public_entropy: string | null;
  is_simulation: boolean;
  created_by: string | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  winner_player_id: string | null;
  registered_count: number;
  active_count: number;
  eliminated_count: number;
  table_count: number;
  hands_completed: number;
  updated_at: Date;
}

const toRecord = (r: Row): TournamentRecord => ({
  id: r.id,
  joinCode: r.join_code,
  name: r.name,
  status: r.status,
  config: r.config,
  configLockedAt: r.config_locked_at,
  serverSeedHash: r.server_seed_hash,
  serverSeedEnc: r.server_seed_enc,
  serverSeedRevealed: r.server_seed_revealed,
  publicEntropy: r.public_entropy,
  isSimulation: r.is_simulation,
  createdBy: r.created_by,
  createdAt: r.created_at,
  startedAt: r.started_at,
  completedAt: r.completed_at,
  cancelledAt: r.cancelled_at,
  winnerPlayerId: r.winner_player_id,
  counters: {
    registered: r.registered_count,
    active: r.active_count,
    eliminated: r.eliminated_count,
    tables: r.table_count,
    handsCompleted: r.hands_completed,
  },
  updatedAt: r.updated_at,
});

export class TournamentConfigLockedError extends Error {
  constructor() {
    super('Tournament configuration is locked once the tournament starts');
  }
}

export class TournamentRepo {
  constructor(private readonly q: Queryable) {}

  async create(input: {
    id: string;
    joinCode: string;
    config: TournamentConfig;
    serverSeedHash: string;
    serverSeedEnc: string;
    isSimulation: boolean;
    createdBy: string | null;
  }): Promise<TournamentRecord> {
    const r = await this.q.query<Row>(
      `INSERT INTO tournaments (id, join_code, name, status, config, server_seed_hash, server_seed_enc, is_simulation, created_by)
       VALUES ($1, $2, $3, 'DRAFT', $4, $5, $6, $7, $8) RETURNING *`,
      [input.id, input.joinCode, input.config.name, JSON.stringify(input.config), input.serverSeedHash, input.serverSeedEnc, input.isSimulation, input.createdBy],
    );
    await this.syncConfigTables(input.id, input.config);
    return toRecord(r.rows[0]!);
  }

  async get(id: string): Promise<TournamentRecord | null> {
    const r = await this.q.query<Row>(`SELECT * FROM tournaments WHERE id = $1`, [id]);
    return r.rows[0] ? toRecord(r.rows[0]) : null;
  }

  async getByJoinCode(joinCode: string): Promise<TournamentRecord | null> {
    const r = await this.q.query<Row>(`SELECT * FROM tournaments WHERE join_code = upper($1)`, [joinCode]);
    return r.rows[0] ? toRecord(r.rows[0]) : null;
  }

  async joinCodeExists(joinCode: string): Promise<boolean> {
    const r = await this.q.query(`SELECT 1 FROM tournaments WHERE join_code = upper($1)`, [joinCode]);
    return (r.rowCount ?? 0) > 0;
  }

  async list(opts: { status?: TournamentStatus[]; includeSimulations?: boolean; limit?: number; offset?: number } = {}): Promise<TournamentRecord[]> {
    const r = await this.q.query<Row>(
      `SELECT * FROM tournaments
        WHERE ($1::text[] IS NULL OR status = ANY($1))
          AND ($2::boolean OR NOT is_simulation)
        ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
      [opts.status ?? null, opts.includeSimulations ?? true, Math.min(opts.limit ?? 50, 500), opts.offset ?? 0],
    );
    return r.rows.map(toRecord);
  }

  /** Lists tournaments whose director must be running (for recovery after a restart). */
  async listLive(): Promise<TournamentRecord[]> {
    const r = await this.q.query<Row>(
      `SELECT * FROM tournaments WHERE status IN ('REGISTRATION','REGISTRATION_CLOSED','STARTING','RUNNING','BREAK','PAUSED','FINAL_TABLE')`,
    );
    return r.rows.map(toRecord);
  }

  async updateConfig(id: string, config: TournamentConfig): Promise<TournamentRecord> {
    const r = await this.q.query<Row>(
      `UPDATE tournaments SET config = $2, name = $3, updated_at = now() WHERE id = $1 AND config_locked_at IS NULL RETURNING *`,
      [id, JSON.stringify(config), config.name],
    );
    if (!r.rows[0]) throw new TournamentConfigLockedError();
    await this.syncConfigTables(id, config);
    return toRecord(r.rows[0]);
  }

  /** Mutable-while-running fields (blind schedule future levels, timing...) bypass the lock deliberately; callers audit-log. */
  async replaceRunningConfig(id: string, config: TournamentConfig): Promise<void> {
    await this.q.query(`UPDATE tournaments SET config = $2, updated_at = now() WHERE id = $1`, [id, JSON.stringify(config)]);
    await this.syncConfigTables(id, config, { keepPrizes: true });
  }

  async lockConfig(id: string): Promise<void> {
    await this.q.query(`UPDATE tournaments SET config_locked_at = COALESCE(config_locked_at, now()) WHERE id = $1`, [id]);
    await this.q.query(`UPDATE prize_structures SET locked_at = COALESCE(locked_at, now()) WHERE tournament_id = $1`, [id]);
  }

  async updateStatus(id: string, status: TournamentStatus): Promise<void> {
    await this.q.query(
      `UPDATE tournaments SET status = $2, updated_at = now(),
              started_at = CASE WHEN $2 IN ('STARTING','RUNNING','FINAL_TABLE') THEN COALESCE(started_at, now()) ELSE started_at END,
              completed_at = CASE WHEN $2 = 'COMPLETED' THEN now() ELSE completed_at END,
              cancelled_at = CASE WHEN $2 = 'CANCELLED' THEN now() ELSE cancelled_at END
        WHERE id = $1`,
      [id, status],
    );
  }

  async setPublicEntropy(id: string, entropy: string): Promise<void> {
    await this.q.query(`UPDATE tournaments SET public_entropy = $2 WHERE id = $1 AND public_entropy IS NULL`, [id, entropy]);
  }

  async revealSeed(id: string, seed: string): Promise<void> {
    await this.q.query(`UPDATE tournaments SET server_seed_revealed = $2 WHERE id = $1`, [id, seed]);
  }

  async setWinner(id: string, playerId: string): Promise<void> {
    await this.q.query(`UPDATE tournaments SET winner_player_id = $2 WHERE id = $1`, [id, playerId]);
  }

  async setCounters(id: string, c: Partial<TournamentCountersRecord>): Promise<void> {
    await this.q.query(
      `UPDATE tournaments SET
          registered_count = COALESCE($2, registered_count),
          active_count = COALESCE($3, active_count),
          eliminated_count = COALESCE($4, eliminated_count),
          table_count = COALESCE($5, table_count),
          hands_completed = COALESCE($6, hands_completed),
          updated_at = now()
        WHERE id = $1`,
      [id, c.registered ?? null, c.active ?? null, c.eliminated ?? null, c.tables ?? null, c.handsCompleted ?? null],
    );
  }

  /** Atomically reserves the next registration sequence number. */
  async nextRegistrationSeq(id: string): Promise<number> {
    const r = await this.q.query<{ registered_count: number }>(
      `UPDATE tournaments SET registered_count = registered_count + 1 WHERE id = $1 RETURNING registered_count`,
      [id],
    );
    if (!r.rows[0]) throw new Error(`Tournament ${id} not found`);
    return r.rows[0].registered_count;
  }

  /** Normalized copies of blind levels and prizes for querying/reporting (config JSON stays authoritative). */
  private async syncConfigTables(id: string, config: TournamentConfig, opts: { keepPrizes?: boolean } = {}): Promise<void> {
    await this.q.query(`DELETE FROM blind_levels WHERE tournament_id = $1`, [id]);
    for (const l of config.blindSchedule) {
      await this.q.query(
        `INSERT INTO blind_levels (tournament_id, level, small_blind, big_blind, ante, duration_seconds) VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, l.level, l.smallBlind, l.bigBlind, l.ante, l.durationSeconds],
      );
    }
    if (opts.keepPrizes) return;
    await this.q.query(`DELETE FROM prize_structures WHERE tournament_id = $1 AND locked_at IS NULL`, [id]);
    for (const p of config.prizeStructure.places) {
      await this.q.query(
        `INSERT INTO prize_structures (tournament_id, position, amount_minor, currency, label) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (tournament_id, position) DO NOTHING`,
        [id, p.position, p.amountMinor, config.prizeStructure.currency, p.label ?? null],
      );
    }
  }
}
