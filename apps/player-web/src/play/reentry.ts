import type { JoinInfoDto, PlayerSelfSummary, ReentryConfig, TournamentPublicSummary } from '@jpb/shared-types';

/** Tournament states in which Johnny accepts a re-entry (tournament-engine `reentryOpen`). */
const REENTRY_STATES: ReadonlySet<string> = new Set(['RUNNING', 'BREAK', 'PAUSED']);

export interface ReentryOffer {
  /** Last blind level that still accepts re-entries, when known. */
  untilLevel: number | null;
  /** Entries this player may still use, when the server says so. */
  entriesLeft: number | null;
}

type Probe = Record<string, unknown>;
const asObject = (v: unknown): Probe | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Probe) : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function configOf(v: unknown): ReentryConfig | null {
  const o = asObject(v);
  if (!o || typeof o.enabled !== 'boolean') return null;
  return { enabled: o.enabled, maxEntriesPerPlayer: num(o.maxEntriesPerPlayer) ?? 1, untilLevel: num(o.untilLevel) ?? 0 };
}

/**
 * Whether to offer "Re-enter" to an eliminated player. Only a hint for the
 * button: POST /api/player/reenter re-checks every rule (level, entries,
 * final table) and its answer wins.
 *
 * The shared DTOs carry no re-entry data yet, so this reads, in order:
 * 1. an explicit server decision on the self summary (`reentry.available`,
 *    `reentry.open` or `canReenter`);
 * 2. the re-entry config on the join info (`reentry` or
 *    `registration.reentry`, a ReentryConfig) checked against the live
 *    tournament state, like the engine does;
 * and offers nothing when neither is present.
 */
export function reentryOffer(self: PlayerSelfSummary | null, tournament: TournamentPublicSummary | null, joinInfo: JoinInfoDto | null): ReentryOffer | null {
  if (!self || self.status !== 'ELIMINATED' || !tournament) return null;
  const s = self as unknown as Probe;
  const fromSelf = asObject(s.reentry);
  const decided = typeof fromSelf?.available === 'boolean' ? fromSelf.available : typeof fromSelf?.open === 'boolean' ? fromSelf.open : typeof s.canReenter === 'boolean' ? s.canReenter : null;
  if (decided !== null) {
    if (!decided) return null;
    const max = num(fromSelf?.maxEntries) ?? num(fromSelf?.maxEntriesPerPlayer);
    const used = num(fromSelf?.entriesUsed) ?? num(fromSelf?.entries);
    return { untilLevel: num(fromSelf?.untilLevel), entriesLeft: num(fromSelf?.entriesLeft) ?? (max !== null && used !== null ? Math.max(0, max - used) : null) };
  }
  const info = joinInfo as unknown as Probe | null;
  const cfg = configOf(info?.reentry) ?? configOf(asObject(info?.registration)?.reentry);
  if (!cfg?.enabled || !REENTRY_STATES.has(tournament.status)) return null;
  if ((tournament.currentLevel?.level ?? 1) > cfg.untilLevel) return null;
  return { untilLevel: cfg.untilLevel, entriesLeft: null };
}
