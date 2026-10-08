import type { FastifyRequest } from 'fastify';
import type { Permission } from '@jpb/shared-types';
import type { DirectorInput } from '@jpb/tournament-engine';
import type { HttpContext } from '../context';
import { clientIp, rateLimit, requireAdmin } from '../context';
import { HttpError, notFound } from '../errors';
import { optionalReason, requireDangerConfirmation, requireReason } from '../danger';
import type { ConfirmWord } from '../danger';
import { RATE_LIMITS } from '../../security/rate-limit';
import type { AdminPrincipal } from '../../auth/sessions';
import type { GameService } from '../../game/game-service';
import type { TournamentRecord } from '../../persistence/repos/tournaments';
import type { AuditMeta } from '../../game/director-actor';

/** Everything the game route modules share. */
export interface GameRouteDeps {
  ctx: HttpContext;
  game: GameService;
}

/** Danger level of an admin endpoint (docs/ADMIN_CONTROL_ROOM.md §4). */
export type Danger = { level: 0 } | { level: 1; reasonRequired?: boolean } | { level: 2; word: ConfirmWord };

/** Parses the reason according to the danger level. */
export function reasonFor(body: unknown, danger: Danger): string | null {
  if (danger.level === 2) return requireDangerConfirmation(body, danger.word);
  if (danger.level === 1 && danger.reasonRequired) return requireReason(body);
  return optionalReason(body);
}

/** Admin request against a tournament: authenticates, checks permission + scope and the write rate limit. */
export async function adminForTournament(
  deps: GameRouteDeps,
  req: FastifyRequest,
  permission: Permission,
  tournamentId: string,
): Promise<{ principal: AdminPrincipal; tournament: TournamentRecord }> {
  const principal = await requireAdmin(deps.ctx, req, permission, tournamentId);
  limitAdmin(deps, req, principal);
  const tournament = await deps.game.tournament(tournamentId, 0);
  if (!tournament) throw notFound('Tournament');
  return { principal, tournament };
}

export function limitAdmin(deps: GameRouteDeps, req: FastifyRequest, principal: AdminPrincipal): void {
  const write = req.method !== 'GET';
  rateLimit(deps.ctx, write ? 'admin-write' : 'admin-read', write ? RATE_LIMITS.adminWrite : RATE_LIMITS.adminRead, principal.admin.id);
}

export function auditMeta(principal: AdminPrincipal, req: FastifyRequest, action: string, target: string, reason: string | null): AuditMeta {
  return { adminId: principal.admin.id, adminUsername: principal.admin.username, action, target, reason, ip: clientIp(req) };
}

/** Maps a director rejection to an HTTP error with Johnny's friendly message. */
export function ensureOk(reply: { ok: boolean; code: string | null; message: string | null }): void {
  if (reply.ok) return;
  const code = reply.code ?? 'REJECTED';
  const status = code.endsWith('NOT_FOUND') ? 404 : code === 'INVALID' || code === 'INVALID_INPUT' ? 400 : 409;
  throw new HttpError(status, code, reply.message ?? 'The tournament director did not accept this action.');
}

/** Submits an audited admin input to Johnny; the audit row is written in the same transaction as the change. */
export async function directorAdmin(
  deps: GameRouteDeps,
  req: FastifyRequest,
  principal: AdminPrincipal,
  tournamentId: string,
  input: DirectorInput,
  audit: { action: string; target: string; reason: string | null },
): Promise<void> {
  const reply = await deps.game.directorInput(tournamentId, input, auditMeta(principal, req, audit.action, audit.target, audit.reason));
  ensureOk(reply);
}

export const OK = { ok: true } as const;

/** Integer query parameter with bounds (invalid → fallback). */
export function intParam(v: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : typeof v === 'number' ? v : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export function boolParam(v: unknown): boolean | undefined {
  if (v === 'true' || v === true) return true;
  if (v === 'false' || v === false) return false;
  return undefined;
}

export function strParam(v: unknown, max = 200): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : undefined;
}
