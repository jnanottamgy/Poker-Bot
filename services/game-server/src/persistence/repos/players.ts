import type { PaymentStatus, TournamentPlayerStatus } from '@jpb/shared-types';
import type { Queryable } from '../db';

/** Personal data. Only ever returned to admins with PLAYER_VIEW_PII, or to the player themself. */
export interface PlayerRecord {
  id: string;
  tournamentId: string;
  publicId: string;
  displayName: string;
  nickname: string | null;
  participantId: string | null;
  email: string | null;
  phone: string | null;
  collegeId: string | null;
  createdAt: Date;
}

export interface EntryRecord {
  entryId: string;
  tournamentId: string;
  playerId: string;
  registrationSeq: number;
  entryNumber: number;
  status: TournamentPlayerStatus;
  clientSeed: string | null;
  registeredAt: Date;
  approvedAt: Date | null;
  approvedBy: string | null;
  tableId: string | null;
  seat: number | null;
  stack: number;
  handsPlayed: number;
  largestPotWon: number;
  finishPosition: number | null;
  tiedCount: number;
  prizeMinor: number;
  eliminatedAt: Date | null;
  eliminationHandId: string | null;
  paymentStatus: PaymentStatus;
  paidAt: Date | null;
  processedBy: string | null;
  paymentReference: string | null;
}

/** Joined view used by admin player search and lists. */
export interface PlayerEntryRow extends EntryRecord {
  publicId: string;
  displayName: string;
  nickname: string | null;
}

interface PlayerRow {
  id: string;
  tournament_id: string;
  public_id: string;
  display_name: string;
  nickname: string | null;
  participant_id: string | null;
  email: string | null;
  phone: string | null;
  college_id: string | null;
  created_at: Date;
}

interface EntryRow {
  entry_id: string;
  tournament_id: string;
  player_id: string;
  registration_seq: number;
  entry_number: number;
  status: TournamentPlayerStatus;
  client_seed: string | null;
  registered_at: Date;
  approved_at: Date | null;
  approved_by: string | null;
  table_id: string | null;
  seat: number | null;
  stack: number;
  hands_played: number;
  largest_pot_won: number;
  finish_position: number | null;
  tied_count: number;
  prize_minor: number;
  eliminated_at: Date | null;
  elimination_hand_id: string | null;
  payment_status: PaymentStatus;
  paid_at: Date | null;
  processed_by: string | null;
  payment_reference: string | null;
}

const toPlayer = (r: PlayerRow): PlayerRecord => ({
  id: r.id,
  tournamentId: r.tournament_id,
  publicId: r.public_id,
  displayName: r.display_name,
  nickname: r.nickname,
  participantId: r.participant_id,
  email: r.email,
  phone: r.phone,
  collegeId: r.college_id,
  createdAt: r.created_at,
});

const toEntry = (r: EntryRow): EntryRecord => ({
  entryId: r.entry_id,
  tournamentId: r.tournament_id,
  playerId: r.player_id,
  registrationSeq: r.registration_seq,
  entryNumber: r.entry_number,
  status: r.status,
  clientSeed: r.client_seed,
  registeredAt: r.registered_at,
  approvedAt: r.approved_at,
  approvedBy: r.approved_by,
  tableId: r.table_id,
  seat: r.seat,
  stack: r.stack,
  handsPlayed: r.hands_played,
  largestPotWon: r.largest_pot_won,
  finishPosition: r.finish_position,
  tiedCount: r.tied_count,
  prizeMinor: r.prize_minor,
  eliminatedAt: r.eliminated_at,
  eliminationHandId: r.elimination_hand_id,
  paymentStatus: r.payment_status,
  paidAt: r.paid_at,
  processedBy: r.processed_by,
  paymentReference: r.payment_reference,
});

export type EntrySort = 'registration' | 'stack_desc' | 'finish' | 'name';

const SORT_SQL: Record<EntrySort, string> = {
  registration: 'e.registration_seq ASC',
  stack_desc: 'e.stack DESC, e.registration_seq ASC',
  finish: 'e.finish_position ASC NULLS LAST, e.registration_seq ASC',
  name: 'lower(p.display_name) ASC, e.registration_seq ASC',
};

export class PlayerRepo {
  constructor(private readonly q: Queryable) {}

  async createPlayer(input: Omit<PlayerRecord, 'createdAt'>): Promise<PlayerRecord> {
    const r = await this.q.query<PlayerRow>(
      `INSERT INTO players (id, tournament_id, public_id, display_name, nickname, participant_id, email, phone, college_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        input.id,
        input.tournamentId,
        input.publicId,
        input.displayName,
        input.nickname,
        input.participantId,
        input.email,
        input.phone,
        input.collegeId,
      ],
    );
    return toPlayer(r.rows[0]!);
  }

  async createEntry(input: {
    entryId: string;
    tournamentId: string;
    playerId: string;
    registrationSeq: number;
    entryNumber: number;
    status: TournamentPlayerStatus;
    clientSeed: string | null;
    stack: number;
  }): Promise<EntryRecord> {
    const r = await this.q.query<EntryRow>(
      `INSERT INTO tournament_players (entry_id, tournament_id, player_id, registration_seq, entry_number, status, client_seed, stack)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [input.entryId, input.tournamentId, input.playerId, input.registrationSeq, input.entryNumber, input.status, input.clientSeed, input.stack],
    );
    return toEntry(r.rows[0]!);
  }

  async publicIdExists(tournamentId: string, publicId: string): Promise<boolean> {
    const r = await this.q.query(`SELECT 1 FROM players WHERE tournament_id = $1 AND public_id = $2`, [tournamentId, publicId]);
    return (r.rowCount ?? 0) > 0;
  }

  async getPlayer(id: string): Promise<PlayerRecord | null> {
    const r = await this.q.query<PlayerRow>(`SELECT * FROM players WHERE id = $1`, [id]);
    return r.rows[0] ? toPlayer(r.rows[0]) : null;
  }

  async getByPublicId(tournamentId: string, publicId: string): Promise<PlayerRecord | null> {
    const r = await this.q.query<PlayerRow>(`SELECT * FROM players WHERE tournament_id = $1 AND public_id = upper($2)`, [tournamentId, publicId]);
    return r.rows[0] ? toPlayer(r.rows[0]) : null;
  }

  /** Latest entry of a player (re-entries create additional entries). */
  async getCurrentEntry(playerId: string): Promise<EntryRecord | null> {
    const r = await this.q.query<EntryRow>(
      `SELECT * FROM tournament_players WHERE player_id = $1 ORDER BY entry_number DESC LIMIT 1`,
      [playerId],
    );
    return r.rows[0] ? toEntry(r.rows[0]) : null;
  }

  async getEntry(entryId: string): Promise<EntryRecord | null> {
    const r = await this.q.query<EntryRow>(`SELECT * FROM tournament_players WHERE entry_id = $1`, [entryId]);
    return r.rows[0] ? toEntry(r.rows[0]) : null;
  }

  async listEntries(
    tournamentId: string,
    opts: { statuses?: TournamentPlayerStatus[]; sort?: EntrySort; limit?: number; offset?: number; tableId?: string } = {},
  ): Promise<{ rows: PlayerEntryRow[]; total: number }> {
    const where = `e.tournament_id = $1 AND ($2::text[] IS NULL OR e.status = ANY($2)) AND ($3::text IS NULL OR e.table_id = $3)`;
    const args = [tournamentId, opts.statuses ?? null, opts.tableId ?? null];
    const total = await this.q.query<{ n: number }>(`SELECT count(*)::int AS n FROM tournament_players e WHERE ${where}`, args);
    const r = await this.q.query<EntryRow & { public_id: string; display_name: string; nickname: string | null }>(
      `SELECT e.*, p.public_id, p.display_name, p.nickname
         FROM tournament_players e JOIN players p ON p.id = e.player_id
        WHERE ${where}
        ORDER BY ${SORT_SQL[opts.sort ?? 'registration']}
        LIMIT $4 OFFSET $5`,
      [...args, Math.min(opts.limit ?? 50, 1000), opts.offset ?? 0],
    );
    return {
      total: total.rows[0]?.n ?? 0,
      rows: r.rows.map((row) => ({ ...toEntry(row), publicId: row.public_id, displayName: row.display_name, nickname: row.nickname })),
    };
  }

  /** Prefix search on name, nickname or public id (spec §55). */
  async search(tournamentId: string, query: string, limit = 25): Promise<PlayerEntryRow[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const like = q.replace(/[\\%_]/g, (c) => `\\${c}`) + '%';
    const r = await this.q.query<EntryRow & { public_id: string; display_name: string; nickname: string | null }>(
      `SELECT DISTINCT ON (p.id) e.*, p.public_id, p.display_name, p.nickname
         FROM players p JOIN tournament_players e ON e.player_id = p.id
        WHERE p.tournament_id = $1
          AND (lower(p.display_name) LIKE $2 OR lower(p.nickname) LIKE $2 OR lower(p.public_id) LIKE $2
               OR lower(p.display_name) LIKE '% ' || $2 OR p.id = $3)
        ORDER BY p.id, e.entry_number DESC
        LIMIT $4`,
      [tournamentId, like, query.trim(), Math.min(limit, 100)],
    );
    return r.rows.map((row) => ({ ...toEntry(row), publicId: row.public_id, displayName: row.display_name, nickname: row.nickname }));
  }

  /** Projection update from the director/table event stream (no PII involved). */
  async updateEntryState(
    entryId: string,
    patch: Partial<{
      status: TournamentPlayerStatus;
      tableId: string | null;
      seat: number | null;
      stack: number;
      handsPlayed: number;
      largestPotWon: number;
      finishPosition: number | null;
      tiedCount: number;
      prizeMinor: number;
      eliminatedAt: Date | null;
      eliminationHandId: string | null;
      approvedAt: Date | null;
      approvedBy: string | null;
    }>,
  ): Promise<void> {
    const cols: Record<string, string> = {
      status: 'status',
      tableId: 'table_id',
      seat: 'seat',
      stack: 'stack',
      handsPlayed: 'hands_played',
      largestPotWon: 'largest_pot_won',
      finishPosition: 'finish_position',
      tiedCount: 'tied_count',
      prizeMinor: 'prize_minor',
      eliminatedAt: 'eliminated_at',
      eliminationHandId: 'elimination_hand_id',
      approvedAt: 'approved_at',
      approvedBy: 'approved_by',
    };
    const sets: string[] = [];
    const values: unknown[] = [entryId];
    for (const [k, v] of Object.entries(patch)) {
      const col = cols[k];
      if (!col || v === undefined) continue;
      values.push(v);
      sets.push(`${col} = $${values.length}`);
    }
    if (!sets.length) return;
    await this.q.query(`UPDATE tournament_players SET ${sets.join(', ')}, updated_at = now() WHERE entry_id = $1`, values);
  }

  async setPayment(
    entryId: string,
    input: { status: PaymentStatus; processedBy: string; reference: string | null },
  ): Promise<EntryRecord | null> {
    const r = await this.q.query<EntryRow>(
      `UPDATE tournament_players
          SET payment_status = $2, processed_by = $3, payment_reference = $4,
              paid_at = CASE WHEN $2 = 'PAID' THEN now() ELSE NULL END, updated_at = now()
        WHERE entry_id = $1 RETURNING *`,
      [entryId, input.status, input.processedBy, input.reference],
    );
    return r.rows[0] ? toEntry(r.rows[0]) : null;
  }

  async countByStatus(tournamentId: string): Promise<Record<string, number>> {
    const r = await this.q.query<{ status: string; n: number }>(
      `SELECT status, count(*)::int AS n FROM tournament_players WHERE tournament_id = $1 GROUP BY status`,
      [tournamentId],
    );
    return Object.fromEntries(r.rows.map((row) => [row.status, row.n]));
  }

  async listClientSeeds(tournamentId: string): Promise<string[]> {
    const r = await this.q.query<{ client_seed: string }>(
      `SELECT client_seed FROM tournament_players WHERE tournament_id = $1 AND client_seed IS NOT NULL AND status NOT IN ('WITHDRAWN','PENDING_APPROVAL')`,
      [tournamentId],
    );
    return r.rows.map((row) => row.client_seed);
  }
}
