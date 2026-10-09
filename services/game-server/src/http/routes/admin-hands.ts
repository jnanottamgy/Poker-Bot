import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type {
  HandFairnessRecord,
  LeaderboardDto,
  LeaderboardRowDto,
  PaymentStatus,
  PayoutRowDto,
  PayoutsDto,
  Permission,
  TournamentFairnessDto,
  TournamentReportDto,
} from '@jpb/shared-types';
import { buildVerificationBundle, clientSeedProblem, computePublicEntropy, redactHandFairnessRecord } from '@jpb/fairness-engine';
import type { HandHistoryRecord } from '@jpb/table-engine';
import type { DirectorTable } from '@jpb/tournament-engine';
import { requireAdmin } from '../context';
import { badRequest, conflict, notFound } from '../errors';
import type { HttpContext } from '../context';
import { toCsv } from '../../util/csv';
import type { TournamentRecord } from '../../persistence/repos/tournaments';
import type { GameService } from '../../game/game-service';
import { fairnessRecordOf } from '../../game/table-actor';
import type { GameRouteDeps } from './game-common';
import { adminForTournament, boolParam, intParam, limitAdmin, reasonFor, strParam } from './game-common';
import { handDetail, handListItems } from './hand-dto';

const FAIRNESS_DOC = '/docs/FAIRNESS.md';

/** Leaderboard from the projection: current stacks (active) or finishing positions. Labelled so the two are never confused. */
export async function leaderboardOf(ctx: HttpContext, t: TournamentRecord, mode: 'stack' | 'finish', offset: number, limit: number): Promise<LeaderboardDto> {
  const statuses = mode === 'stack' ? (['SEATED', 'IN_TRANSIT', 'SUSPENDED'] as const) : null;
  const where = mode === 'stack' ? `e.status = ANY($2::text[])` : `e.finish_position IS NOT NULL AND $2::text[] IS NULL`;
  const order = mode === 'stack' ? 'e.stack DESC, e.registration_seq ASC' : 'e.finish_position ASC, e.registration_seq ASC';
  const args = [t.id, statuses ? [...statuses] : null];
  const total = await ctx.store.repos.q.query<{ n: number }>(`SELECT count(*)::int AS n FROM tournament_players e WHERE e.tournament_id = $1 AND ${where}`, args);
  const r = await ctx.store.repos.q.query<{
    player_id: string;
    public_id: string;
    display_name: string;
    stack: number;
    finish_position: number | null;
    tied_count: number;
    prize_minor: number;
    status: LeaderboardRowDto['status'];
    table_number: number | null;
  }>(
    `SELECT e.player_id, p.public_id, p.display_name, e.stack, e.finish_position, e.tied_count, e.prize_minor, e.status, t.table_number
       FROM tournament_players e JOIN players p ON p.id = e.player_id LEFT JOIN tables t ON t.id = e.table_id
      WHERE e.tournament_id = $1 AND ${where} ORDER BY ${order} LIMIT $3 OFFSET $4`,
    [...args, limit, offset],
  );
  const rows: LeaderboardRowDto[] = r.rows.map((x, i) => ({
    rank: mode === 'stack' ? offset + i + 1 : (x.finish_position ?? 0),
    playerId: x.player_id,
    publicId: x.public_id,
    displayName: x.display_name,
    stack: Number(x.stack),
    finishPosition: mode === 'finish' ? x.finish_position : null,
    tiedCount: x.tied_count,
    prizeMinor: Number(x.prize_minor),
    status: x.status,
    tableNumber: mode === 'stack' ? x.table_number : null,
  }));
  return { rows, total: total.rows[0]?.n ?? 0, offset, limit, mode, label: mode === 'stack' ? 'Current stack ranking' : 'Finishing positions' };
}

export async function payoutsOf(ctx: HttpContext, t: TournamentRecord): Promise<PayoutsDto> {
  const currency = t.config.prizeStructure.currency;
  const r = await ctx.store.repos.q.query<{
    entry_id: string;
    player_id: string;
    public_id: string;
    display_name: string;
    finish_position: number;
    tied_count: number;
    prize_minor: number;
    payment_status: PaymentStatus;
    paid_at: Date | null;
    processed_by: string | null;
    payment_reference: string | null;
  }>(
    `SELECT e.entry_id, e.player_id, p.public_id, p.display_name, e.finish_position, e.tied_count, e.prize_minor, e.payment_status, e.paid_at, a.username AS processed_by, e.payment_reference
       FROM tournament_players e JOIN players p ON p.id = e.player_id LEFT JOIN admin_users a ON a.id = e.processed_by
      WHERE e.tournament_id = $1 AND e.prize_minor > 0 AND e.finish_position IS NOT NULL ORDER BY e.finish_position, e.registration_seq`,
    [t.id],
  );
  const rows: PayoutRowDto[] = r.rows.map((x) => ({
    entryId: x.entry_id,
    playerId: x.player_id,
    publicId: x.public_id,
    displayName: x.display_name,
    finishPosition: x.finish_position,
    tiedCount: x.tied_count,
    prizeMinor: Number(x.prize_minor),
    currency,
    paymentStatus: x.payment_status,
    paidAt: x.paid_at?.getTime() ?? null,
    processedBy: x.processed_by,
    paymentReference: x.payment_reference,
  }));
  const configuredMinor = t.config.prizeStructure.places.reduce((a, p) => a + p.amountMinor, 0);
  const awardedMinor = rows.reduce((a, x) => a + x.prizeMinor, 0);
  const paidMinor = rows.filter((x) => x.paymentStatus === 'PAID').reduce((a, x) => a + x.prizeMinor, 0);
  return { currency, rows, totals: { configuredMinor, awardedMinor, paidMinor, outstandingMinor: awardedMinor - paidMinor } };
}

export function fairnessDtoOf(t: TournamentRecord, clientSeedCount: number): TournamentFairnessDto {
  return {
    tournamentId: t.id,
    serverSeedHash: t.serverSeedHash,
    serverSeed: t.serverSeedRevealed,
    seedRevealed: t.serverSeedRevealed !== null,
    publicEntropy: t.publicEntropy,
    entropyInputs: { clientSeedCount, adminEntropy: null },
    method: 'HMAC-SHA256-STREAM+FISHER-YATES',
    documentationUrl: FAIRNESS_DOC,
  };
}

export function handFairness(t: TournamentRecord, h: HandHistoryRecord): HandFairnessRecord {
  return fairnessRecordOf(h, { serverSeedHash: t.serverSeedHash, publicEntropy: t.publicEntropy ?? '' })!;
}

/** Public policy: shown cards always; every hole card once the seed is revealed and the advanced audit feature is on. */
export function publicHandFairness(t: TournamentRecord, h: HandHistoryRecord, viewerPlayerId: string | null = null): HandFairnessRecord {
  const record = handFairness(t, h);
  const revealed = t.serverSeedRevealed !== null;
  if (revealed && t.config.features.advancedFairnessAudit) return redactHandFairnessRecord(record, { revealSeats: 'ALL', includeBurns: true });
  const seats = h.players.filter((p) => p.shownCards !== null || p.playerId === viewerPlayerId).map((p) => p.seat);
  return redactHandFairnessRecord(record, { revealSeats: seats, includeBurns: revealed });
}

export async function clientSeedCount(ctx: HttpContext, tournamentId: string): Promise<number> {
  return (await ctx.store.repos.players.listClientSeeds(tournamentId)).length;
}

export function registerAdminHandRoutes(app: FastifyInstance, deps: GameRouteDeps): void {
  const { ctx, game } = deps;
  const T = '/api/admin/tournaments/:id';
  type P = { Params: { id: string } };
  type H = { Params: { handId: string } };

  async function handFor(req: FastifyRequest<H>, permission: Permission) {
    const found = await ctx.store.repos.hands.get(req.params.handId);
    if (!found) throw notFound('Hand');
    const principal = await requireAdmin(ctx, req, permission, found.row.tournamentId);
    limitAdmin(deps, req, principal);
    const t = await game.tournament(found.row.tournamentId, 0);
    if (!t) throw notFound('Tournament');
    return { principal, found, tournament: t };
  }

  app.get<P>(`${T}/hands`, async (req) => {
    const { tournament } = await adminForTournament(deps, req, 'HAND_HISTORY_VIEW', req.params.id);
    const q = req.query as Record<string, unknown>;
    const offset = intParam(q.offset, 0);
    const limit = intParam(q.limit, 50, 1, 500);
    const page = await ctx.store.repos.hands.list(tournament.id, {
      ...(strParam(q.tableId) ? { tableId: strParam(q.tableId)! } : {}),
      ...(strParam(q.playerId) ? { playerId: strParam(q.playerId)! } : {}),
      ...(strParam(q.minPot) ? { minPot: intParam(q.minPot, 0) } : {}),
      ...(boolParam(q.showdown) !== undefined ? { showdown: boolParam(q.showdown)! } : {}),
      ...(boolParam(q.allIn) !== undefined ? { allIn: boolParam(q.allIn)! } : {}),
      ...(strParam(q.handNumber) ? { handNumber: intParam(q.handNumber, 0) } : {}),
      offset,
      limit,
    });
    return { rows: await handListItems(ctx.store.repos, page.rows), total: page.total, offset, limit };
  });

  app.get<H>('/api/admin/hands/:handId', async (req) => {
    const { found } = await handFor(req, 'HAND_HISTORY_VIEW');
    return handDetail(found.row, found.history, found.randomness);
  });

  app.get<H>('/api/admin/hands/:handId/fairness', async (req) => {
    const { found, tournament } = await handFor(req, 'FAIRNESS_VIEW');
    return handFairness(tournament, found.history);
  });

  app.get<P>(`${T}/fairness`, async (req) => {
    const { tournament } = await adminForTournament(deps, req, 'FAIRNESS_VIEW', req.params.id);
    return fairnessDtoOf(tournament, await clientSeedCount(ctx, tournament.id));
  });

  app.get<P>(`${T}/fairness/bundle`, async (req) => {
    const { tournament } = await adminForTournament(deps, req, 'FAIRNESS_VIEW', req.params.id);
    const q = req.query as Record<string, unknown>;
    const from = intParam(q.fromHand, 0);
    const to = intParam(q.toHand, from + 49);
    const span = Math.min(500, Math.max(0, to - from + 1));
    const rows = await ctx.store.repos.q.query<{ history: HandHistoryRecord }>(
      `SELECT history FROM hands WHERE tournament_id = $1 ORDER BY completed_at, id OFFSET $2 LIMIT $3`,
      [tournament.id, from, span],
    );
    const publicEntropy = tournament.publicEntropy ?? '';
    // START used the valid client seeds plus the director's optional admin entropy, which is not stored:
    // the inputs are published only when they re-derive the frozen public entropy (null otherwise, never a 500).
    const inputs = { clientSeeds: (await ctx.store.repos.players.listClientSeeds(tournament.id)).filter((s) => clientSeedProblem(s) === null), adminEntropy: null };
    return buildVerificationBundle({
      tournamentId: tournament.id,
      serverSeedHash: tournament.serverSeedHash,
      serverSeed: tournament.serverSeedRevealed,
      publicEntropy,
      entropyInputs: computePublicEntropy(inputs) === publicEntropy ? inputs : null,
      hands: rows.rows.map((r) => handFairness(tournament, r.history)),
    });
  });

  app.post<P>(`${T}/fairness/reveal-seed`, async (req) => {
    const { principal, tournament } = await adminForTournament(deps, req, 'FAIRNESS_REVEAL_SEED', req.params.id);
    const reason = reasonFor(req.body, { level: 2, word: 'REVEAL' });
    if (tournament.status !== 'COMPLETED' && tournament.status !== 'CANCELLED') {
      throw conflict('INVALID_STATE', 'The server seed can only be revealed after the tournament is completed or cancelled.');
    }
    const seed = await game.seeds.reveal(tournament.id);
    if (!seed) throw notFound('Server seed');
    await ctx.store.repos.tournaments.revealSeed(tournament.id, seed);
    game.invalidateTournament(tournament.id);
    await ctx.audit.record({ admin: principal.admin, action: 'REVEAL_SEED', target: `tournament:${tournament.id}`, tournamentId: tournament.id, reason, before: { seedRevealed: false }, after: { seedRevealed: true }, ip: req.ip });
    return { serverSeed: seed };
  });

  // ------------------------------------------------------------------ standings & payouts

  const mode = (q: unknown): 'stack' | 'finish' => ((q as Record<string, unknown>).mode === 'finish' ? 'finish' : 'stack');

  app.get<P>(`${T}/standings`, async (req) => {
    const { tournament } = await adminForTournament(deps, req, 'PLAYER_VIEW', req.params.id);
    const q = req.query as Record<string, unknown>;
    return leaderboardOf(ctx, tournament, mode(q), intParam(q.offset, 0), intParam(q.limit, 50, 1, 500));
  });

  app.get<P>(`${T}/standings.csv`, async (req, reply) => {
    const { tournament } = await adminForTournament(deps, req, 'PLAYER_VIEW', req.params.id);
    const lb = await leaderboardOf(ctx, tournament, mode(req.query), 0, 1_000_000);
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="standings-${tournament.joinCode}.csv"`);
    return toCsv(
      ['rank', 'public_id', 'name', 'stack', 'finish_position', 'tied', 'prize_minor', 'status', 'table'],
      lb.rows.map((r) => [r.rank, r.publicId, r.displayName, r.stack, r.finishPosition, r.tiedCount, r.prizeMinor, r.status, r.tableNumber]),
    );
  });

  app.get<P>(`${T}/payouts`, async (req) => {
    const { tournament } = await adminForTournament(deps, req, 'PAYOUT_VIEW', req.params.id);
    return payoutsOf(ctx, tournament);
  });

  app.get<P>(`${T}/payouts.csv`, async (req, reply) => {
    const { tournament } = await adminForTournament(deps, req, 'PAYOUT_VIEW', req.params.id);
    const p = await payoutsOf(ctx, tournament);
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="payouts-${tournament.joinCode}.csv"`);
    return toCsv(
      ['position', 'tied', 'public_id', 'name', 'prize_minor', 'currency', 'status', 'paid_at', 'processed_by', 'reference'],
      p.rows.map((r) => [r.finishPosition, r.tiedCount, r.publicId, r.displayName, r.prizeMinor, r.currency, r.paymentStatus, r.paidAt ? new Date(r.paidAt).toISOString() : null, r.processedBy, r.paymentReference]),
    );
  });

  app.patch<{ Params: { entryId: string } }>('/api/admin/entries/:entryId/payment', async (req) => {
    const entry = await ctx.store.repos.players.getEntry(req.params.entryId);
    if (!entry) throw notFound('Entry');
    const principal = await requireAdmin(ctx, req, 'PAYOUT_MANAGE', entry.tournamentId);
    limitAdmin(deps, req, principal);
    const reason = reasonFor(req.body, { level: 1 });
    const body = z
      .object({ status: z.enum(['UNPAID', 'PROCESSING', 'PAID']), reference: z.string().trim().max(120).nullable().optional(), note: z.string().trim().max(500).nullable().optional() })
      .safeParse(req.body ?? {});
    if (!body.success) throw badRequest('INVALID_INPUT', 'Choose a payment status.');
    if (entry.prizeMinor <= 0) throw conflict('NO_PRIZE', 'This entry did not win a prize.');
    const before = { status: entry.paymentStatus, reference: entry.paymentReference };
    await ctx.store.repos.players.setPayment(entry.entryId, { status: body.data.status, processedBy: principal.admin.id, reference: body.data.reference ?? null });
    await ctx.audit.record({ admin: principal.admin, action: 'PAYMENT_UPDATED', target: `entry:${entry.entryId}`, tournamentId: entry.tournamentId, reason: reason ?? body.data.note ?? null, before, after: { status: body.data.status, reference: body.data.reference ?? null }, ip: req.ip });
    const t = (await game.tournament(entry.tournamentId, 0))!;
    return { row: (await payoutsOf(ctx, t)).rows.find((r) => r.entryId === entry.entryId) ?? null };
  });

  // ------------------------------------------------------------------ reports

  app.get<P>(`${T}/report`, async (req) => {
    const { tournament } = await adminForTournament(deps, req, 'EXPORT_DATA', req.params.id);
    return reportOf(ctx, game, tournament);
  });

  app.get<P>(`${T}/report.csv`, async (req, reply) => {
    const { tournament } = await adminForTournament(deps, req, 'EXPORT_DATA', req.params.id);
    const r = await reportOf(ctx, game, tournament, 1_000_000);
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="report-${tournament.joinCode}.csv"`);
    const head = [
      ['tournament', r.name],
      ['status', r.status],
      ['players', r.players],
      ['tables_used', r.tablesUsed],
      ['hands_played', r.handsPlayed],
      ['started_at', r.startedAt ? new Date(r.startedAt).toISOString() : ''],
      ['completed_at', r.completedAt ? new Date(r.completedAt).toISOString() : ''],
      ['winner', r.winner?.displayName ?? ''],
      ['largest_pot', r.largestPot?.amount ?? ''],
      ['server_seed_hash', r.serverSeedHash],
      [],
    ];
    const standings = toCsv(['position', 'tied', 'public_id', 'name', 'prize_minor'], r.standings.map((s) => [s.finishPosition, s.tiedCount, s.publicId, s.displayName, s.prizeMinor]));
    return `${toCsv(['field', 'value'], head)}\r\n${standings.replace(/^\uFEFF/, '')}`;
  });
}

export async function reportOf(ctx: HttpContext, game: GameService, t: TournamentRecord, standingsLimit = 100): Promise<TournamentReportDto> {
  const finish = await leaderboardOf(ctx, t, 'finish', 0, standingsLimit);
  const largest = await ctx.store.repos.hands.largest(t.id);
  let largestPot: TournamentReportDto['largestPot'] = null;
  if (largest) {
    const w = (await ctx.store.repos.hands.winnersOf([largest.handId])).get(largest.handId)?.[0];
    const name = w ? (await ctx.store.repos.players.getPlayer(w.playerId))?.displayName : null;
    largestPot = { amount: largest.totalPot, handId: largest.handId, winnerName: name ?? '—' };
  }
  const stats = await ctx.store.repos.hands.stats(t.id);
  const tablesUsed = (await ctx.store.repos.q.query<{ n: number }>(`SELECT count(*)::int AS n FROM tables WHERE tournament_id = $1`, [t.id])).rows[0]?.n ?? 0;
  const entries = (await ctx.store.repos.q.query<{ n: number; players: number }>(
    `SELECT count(*)::int AS n, count(DISTINCT player_id)::int AS players FROM tournament_players WHERE tournament_id = $1 AND status NOT IN ('WITHDRAWN','PENDING_APPROVAL')`,
    [t.id],
  )).rows[0] ?? { n: 0, players: 0 };
  const winner = t.winnerPlayerId ? await ctx.store.repos.players.getPlayer(t.winnerPlayerId) : null;
  const final = (await game.directorQuery<{ director: { finalTable: { formedAt: number | null } } }>(t.id, { q: 'OVERVIEW' }).catch(() => null))?.director.finalTable.formedAt ?? null;
  const completedAt = (t.completedAt ?? t.cancelledAt)?.getTime() ?? null;
  const startedAt = t.startedAt?.getTime() ?? null;
  return {
    tournamentId: t.id,
    name: t.name,
    status: t.status,
    players: entries.players,
    entries: entries.n,
    tablesUsed,
    startedAt,
    completedAt,
    durationMs: startedAt ? (completedAt ?? ctx.now()) - startedAt : null,
    handsPlayed: stats.hands,
    averageHandDurationMs: stats.avgDurationMs === null ? null : Math.round(stats.avgDurationMs),
    finalTableDurationMs: final && completedAt ? completedAt - final : null,
    largestPot,
    winner: winner ? { playerId: winner.id, displayName: winner.displayName, publicId: winner.publicId } : null,
    standings: finish.rows,
    prizeStructure: { currency: t.config.prizeStructure.currency, places: t.config.prizeStructure.places },
    payouts: (await payoutsOf(ctx, t)).totals,
    serverSeedHash: t.serverSeedHash,
    seedRevealed: t.serverSeedRevealed !== null,
    generatedAt: ctx.now(),
  };
}

export type { DirectorTable };
