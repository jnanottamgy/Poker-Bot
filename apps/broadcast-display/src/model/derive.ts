import type { LeaderboardRowDto, TournamentPublicSummary } from '@jpb/shared-types';
import type { DisplayState, TournamentInfo } from './types';

/** Pure view-model helpers (no clocks: `serverNow` is passed in). */

export type ClockMode = 'LEVEL' | 'PAUSED' | 'BREAK' | 'IDLE';

export interface ClockView {
  mode: ClockMode;
  remainingMs: number;
  /** Length of the running period (level or break), when known. */
  totalMs: number | null;
  /** 0..1 elapsed fraction of the period (null when unknown). */
  progress: number | null;
}

export function clockView(t: TournamentPublicSummary | null, serverNow: number): ClockView {
  if (!t) return { mode: 'IDLE', remainingMs: 0, totalMs: null, progress: null };
  const c = t.clock;
  const levelMs = t.currentLevel ? t.currentLevel.durationSeconds * 1000 : null;
  if (t.status === 'BREAK' && c.breakEndsAt !== null) {
    const remaining = Math.max(0, c.breakEndsAt - serverNow);
    return { mode: 'BREAK', remainingMs: remaining, totalMs: null, progress: null };
  }
  if (c.levelEndsAt === null && c.pausedRemainingMs !== null) {
    return { mode: 'PAUSED', remainingMs: Math.max(0, c.pausedRemainingMs), totalMs: levelMs, progress: fraction(levelMs, c.pausedRemainingMs) };
  }
  if (c.levelEndsAt !== null) {
    const remaining = Math.max(0, c.levelEndsAt - serverNow);
    const total = c.levelStartedAt !== null ? c.levelEndsAt - c.levelStartedAt : levelMs;
    return { mode: 'LEVEL', remainingMs: remaining, totalMs: total, progress: fraction(total, remaining) };
  }
  return { mode: 'IDLE', remainingMs: levelMs ?? 0, totalMs: levelMs, progress: null };
}

function fraction(total: number | null, remaining: number): number | null {
  if (total === null || total <= 0) return null;
  return Math.min(1, Math.max(0, 1 - remaining / total));
}

export interface TournamentStats {
  remaining: number;
  registered: number;
  tables: number;
  averageStack: number | null;
  averageBB: number | null;
  totalChips: number;
  chipLeader: LeaderboardRowDto | null;
  prizePoolMinor: number | null;
  paidPlaces: number;
}

export function tournamentStats(s: DisplayState): TournamentStats {
  const t = s.tournament;
  const counters = t?.counters;
  const remaining = counters?.active ?? 0;
  const avg = counters && remaining > 0 ? Math.round(counters.totalChips / remaining) : null;
  const bb = t?.currentLevel?.bigBlind ?? 0;
  return {
    remaining,
    registered: counters?.registered ?? 0,
    tables: counters?.tables ?? 0,
    averageStack: avg,
    averageBB: avg !== null && bb > 0 ? avg / bb : null,
    totalChips: counters?.totalChips ?? 0,
    chipLeader: s.leaderboard?.rows.find((r) => r.rank === 1) ?? null,
    prizePoolMinor: prizePool(s.info),
    paidPlaces: s.info?.places.length ?? 0,
  };
}

export function prizePool(info: TournamentInfo | null): number | null {
  if (!info || info.places.length === 0) return null;
  return info.places.reduce((sum, p) => sum + p.amountMinor, 0);
}

/** Big blinds with one decimal under 10 BB, whole numbers above ("12.5 BB", "48 BB"). */
export function formatBB(bb: number | null): string {
  if (bb === null || !Number.isFinite(bb)) return '—';
  return bb < 10 ? `${(Math.round(bb * 10) / 10).toFixed(1)} BB` : `${Math.round(bb)} BB`;
}

export interface SeatPoint {
  /** Percent of the table box (0..100), seat centre. */
  x: number;
  y: number;
}

/**
 * Seat centres around the oval, clockwise from the bottom centre (seat 0),
 * as percentages of the table box. The ellipse is slightly larger than the
 * felt so seat plates sit on the rail.
 */
export function seatPositions(maxSeats: number, rx = 42, ry = 41): SeatPoint[] {
  const n = Math.max(2, Math.floor(maxSeats));
  return Array.from({ length: n }, (_, i) => {
    const angle = Math.PI / 2 + (2 * Math.PI * i) / n;
    return { x: round2(50 + rx * Math.cos(angle)), y: round2(50 + ry * Math.sin(angle)) };
  });
}

/** Where a seat's bet sits: 38% of the way from the seat toward the centre. */
export function betPosition(p: SeatPoint, pull = 0.38): SeatPoint {
  return { x: round2(p.x + (50 - p.x) * pull), y: round2(p.y + (50 - p.y) * pull) };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
