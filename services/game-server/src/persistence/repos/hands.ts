import type { HandHistoryRecord } from '@jpb/table-engine';
import type { Queryable } from '../db';

export interface HandRow {
  handId: string;
  tournamentId: string;
  tableId: string;
  tableNumber: number;
  handNumber: number;
  startedAt: number;
  completedAt: number | null;
  level: number;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  totalPot: number;
  showdown: boolean;
  allIn: boolean;
  playerCount: number;
  deckHash: string;
}

interface Row {
  id: string;
  tournament_id: string;
  table_id: string;
  table_number: number;
  hand_number: number;
  started_at: number;
  completed_at: number | null;
  level: number;
  small_blind: number;
  big_blind: number;
  ante: number;
  total_pot: number;
  showdown: boolean;
  all_in: boolean;
  player_count: number;
  deck_hash: string;
}

const toRow = (r: Row): HandRow => ({
  handId: r.id,
  tournamentId: r.tournament_id,
  tableId: r.table_id,
  tableNumber: r.table_number,
  handNumber: r.hand_number,
  startedAt: r.started_at,
  completedAt: r.completed_at,
  level: r.level,
  smallBlind: r.small_blind,
  bigBlind: r.big_blind,
  ante: r.ante,
  totalPot: r.total_pot,
  showdown: r.showdown,
  allIn: r.all_in,
  playerCount: r.player_count,
  deckHash: r.deck_hash,
});

export interface HandQuery {
  tableId?: string;
  playerId?: string;
  minPot?: number;
  showdown?: boolean;
  allIn?: boolean;
  handNumber?: number;
  offset?: number;
  limit?: number;
}

export class HandRepo {
  constructor(private readonly q: Queryable) {}

  /** Writes one completed hand (idempotent: a replayed projection never duplicates). */
  async insert(h: HandHistoryRecord, randomness: Record<string, unknown>): Promise<void> {
    const allIn = h.actionLog.some((a) => a.allIn);
    const inserted = await this.q.query(
      `INSERT INTO hands (id, tournament_id, table_id, hand_number, started_at, completed_at, button_seat, small_blind_seat, big_blind_seat,
                          level, small_blind, big_blind, ante, board, total_pot, deck_hash, randomness, history, showdown, all_in, table_number, player_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       ON CONFLICT (id) DO NOTHING`,
      [
        h.handId,
        h.tournamentId,
        h.tableId,
        h.handNumber,
        h.startedAt,
        h.completedAt,
        h.buttonSeat,
        h.smallBlindSeat,
        h.bigBlindSeat,
        h.blinds.level,
        h.blinds.smallBlind,
        h.blinds.bigBlind,
        h.blinds.ante,
        h.board,
        h.totalPot,
        h.deckHash,
        JSON.stringify(randomness),
        JSON.stringify(h),
        h.winType === 'SHOWDOWN',
        allIn,
        h.tableNumber,
        h.players.length,
      ],
    );
    if ((inserted.rowCount ?? 0) === 0) return;
    for (const p of h.players) {
      await this.q.query(
        `INSERT INTO hand_players (hand_id, player_id, seat, starting_stack, final_stack, hole_cards, showed_cards) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [h.handId, p.playerId, p.seat, p.startingStack, p.finalStack, p.holeCards, p.shownCards !== null],
      );
    }
    let seq = 0;
    for (const a of h.actionLog) {
      seq += 1;
      await this.q.query(
        `INSERT INTO actions (hand_id, seq, player_id, seat, street, action, amount, to_amount, all_in, timeout, at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          h.handId,
          seq,
          a.playerId,
          a.seat,
          a.street,
          a.kind === 'ACTION' ? a.action : `POST_${a.betType === 'SMALL_BLIND' ? 'SB' : a.betType === 'BIG_BLIND' ? 'BB' : 'ANTE'}`,
          a.amount,
          a.kind === 'ACTION' ? a.toAmount : a.amount,
          a.allIn,
          a.kind === 'ACTION' ? a.timeout : false,
          h.completedAt,
        ],
      );
    }
    for (const pot of h.pots) {
      await this.q.query(`INSERT INTO pots (hand_id, pot_index, pot_type, amount, eligible_seats) VALUES ($1,$2,$3,$4,$5)`, [
        h.handId,
        pot.potIndex,
        pot.potType,
        pot.amount,
        pot.eligibleSeats,
      ]);
      for (const w of pot.winners) {
        await this.q.query(`INSERT INTO pot_winners (hand_id, pot_index, player_id, amount, odd_chips) VALUES ($1,$2,$3,$4,$5)`, [
          h.handId,
          pot.potIndex,
          w.playerId,
          w.amount,
          w.oddChips,
        ]);
      }
    }
  }

  async list(tournamentId: string, q: HandQuery = {}): Promise<{ rows: HandRow[]; total: number }> {
    const where = `h.tournament_id = $1
      AND ($2::text IS NULL OR h.table_id = $2)
      AND ($3::text IS NULL OR EXISTS (SELECT 1 FROM hand_players hp WHERE hp.hand_id = h.id AND hp.player_id = $3))
      AND ($4::bigint IS NULL OR h.total_pot >= $4)
      AND ($5::boolean IS NULL OR h.showdown = $5)
      AND ($6::boolean IS NULL OR h.all_in = $6)
      AND ($7::int IS NULL OR h.hand_number = $7)`;
    const args = [tournamentId, q.tableId ?? null, q.playerId ?? null, q.minPot ?? null, q.showdown ?? null, q.allIn ?? null, q.handNumber ?? null];
    const total = await this.q.query<{ n: number }>(`SELECT count(*)::int AS n FROM hands h WHERE ${where}`, args);
    const r = await this.q.query<Row>(
      `SELECT h.id, h.tournament_id, h.table_id, h.table_number, h.hand_number, h.started_at, h.completed_at, h.level, h.small_blind, h.big_blind,
              h.ante, h.total_pot, h.showdown, h.all_in, h.player_count, h.deck_hash
         FROM hands h WHERE ${where} ORDER BY h.completed_at DESC NULLS LAST, h.id DESC LIMIT $8 OFFSET $9`,
      [...args, Math.min(q.limit ?? 50, 500), q.offset ?? 0],
    );
    return { rows: r.rows.map(toRow), total: total.rows[0]?.n ?? 0 };
  }

  async get(handId: string): Promise<{ row: HandRow; history: HandHistoryRecord; randomness: Record<string, unknown> } | null> {
    const r = await this.q.query<Row & { history: HandHistoryRecord; randomness: Record<string, unknown> }>(
      `SELECT id, tournament_id, table_id, table_number, hand_number, started_at, completed_at, level, small_blind, big_blind, ante, total_pot,
              showdown, all_in, player_count, deck_hash, history, randomness FROM hands WHERE id = $1`,
      [handId],
    );
    const row = r.rows[0];
    return row ? { row: toRow(row), history: row.history, randomness: row.randomness } : null;
  }

  async winnersOf(handIds: string[]): Promise<Map<string, Array<{ playerId: string; amount: number }>>> {
    const out = new Map<string, Array<{ playerId: string; amount: number }>>();
    if (!handIds.length) return out;
    const r = await this.q.query<{ hand_id: string; player_id: string; amount: number }>(
      `SELECT hand_id, player_id, sum(amount)::bigint AS amount FROM pot_winners WHERE hand_id = ANY($1) GROUP BY hand_id, player_id`,
      [handIds],
    );
    for (const row of r.rows) {
      const list = out.get(row.hand_id) ?? [];
      list.push({ playerId: row.player_id, amount: row.amount });
      out.set(row.hand_id, list);
    }
    return out;
  }

  async largest(tournamentId: string): Promise<HandRow | null> {
    const r = await this.q.query<Row>(
      `SELECT id, tournament_id, table_id, table_number, hand_number, started_at, completed_at, level, small_blind, big_blind, ante, total_pot,
              showdown, all_in, player_count, deck_hash FROM hands WHERE tournament_id = $1 ORDER BY total_pot DESC LIMIT 1`,
      [tournamentId],
    );
    return r.rows[0] ? toRow(r.rows[0]) : null;
  }

  async stats(tournamentId: string): Promise<{ hands: number; avgDurationMs: number | null }> {
    const r = await this.q.query<{ n: number; avg: number | null }>(
      `SELECT count(*)::int AS n, avg(completed_at - started_at)::float AS avg FROM hands WHERE tournament_id = $1`,
      [tournamentId],
    );
    return { hands: r.rows[0]?.n ?? 0, avgDurationMs: r.rows[0]?.avg ?? null };
  }

  async forPlayer(playerId: string, limit = 50): Promise<HandRow[]> {
    const r = await this.q.query<Row>(
      `SELECT h.id, h.tournament_id, h.table_id, h.table_number, h.hand_number, h.started_at, h.completed_at, h.level, h.small_blind, h.big_blind,
              h.ante, h.total_pot, h.showdown, h.all_in, h.player_count, h.deck_hash
         FROM hands h JOIN hand_players hp ON hp.hand_id = h.id WHERE hp.player_id = $1 ORDER BY h.completed_at DESC LIMIT $2`,
      [playerId, Math.min(limit, 500)],
    );
    return r.rows.map(toRow);
  }
}
