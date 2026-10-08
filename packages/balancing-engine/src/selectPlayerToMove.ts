import { predictBigBlindOrder, stayingPlayers } from '@jpb/seating-engine';
import type { BalancingConfig, PlayerId, SeatSummary, TableSummary } from '@jpb/shared-types';
import { compareIds } from '@jpb/seating-engine';
import type { PlayerToMove } from './types';

export interface MovementScore {
  score: number;
  /** 1 when the player moved within the recent-move window (absolute protection tier), else 0. */
  protectedTier: number;
  breakdown: Record<string, number>;
}

/**
 * movementScore (lower moves first):
 *
 *   W.position   * handsUntilBigBlind(source, seat)                 TDA: the player due the BB next moves
 * + W.recentMove * movesWithinWindow                                 # moves m with handsPlayedTotal - m < window
 * + W.recentMove * (h < window ? (window - h) / window : 0)          h = handsPlayedTotal - most recent move
 */
export function movementScore(player: SeatSummary, handsUntilBigBlind: number, cfg: BalancingConfig): MovementScore {
  const window = cfg.recentMoveWindowHands;
  const now = player.stats.handsPlayedTotal;
  let movesWithinWindow = 0;
  let lastMove: number | null = null;
  for (const m of player.recentMovesAtHand) {
    if (now - m < window) movesWithinWindow += 1;
    if (lastMove === null || m > lastMove) lastMove = m;
  }
  const handsSinceLastMove = lastMove === null ? null : Math.max(0, now - lastMove);
  const recencyFraction = handsSinceLastMove !== null && handsSinceLastMove < window ? (window - handsSinceLastMove) / window : 0;
  const positionTerm = cfg.weights.position * handsUntilBigBlind;
  const recentMoveCountTerm = cfg.weights.recentMove * movesWithinWindow;
  const recencyTerm = cfg.weights.recentMove * recencyFraction;
  const score = positionTerm + recentMoveCountTerm + recencyTerm;
  const protectedTier = movesWithinWindow > 0 ? 1 : 0;
  const breakdown: Record<string, number> = {
    seat: player.seat,
    handsUntilBigBlind,
    positionTerm,
    movesWithinWindow,
    recencyFraction,
    recentMoveCountTerm,
    recencyTerm,
    protected: protectedTier,
    score,
  };
  if (handsSinceLastMove !== null) breakdown.handsSinceLastMove = handsSinceLastMove;
  return { score, protectedTier, breakdown };
}

/**
 * Every movable player of `source` (seated, not movingOut, not in `exclude`)
 * ranked best-first by: protection tier (recently moved players last —
 * protection is absolute while an unprotected candidate exists), then
 * movementScore, then seat index, then playerId.
 */
export function rankPlayersToMove(
  source: TableSummary,
  cfg: BalancingConfig,
  exclude: ReadonlySet<PlayerId> = new Set(),
): Array<PlayerToMove & { protectedTier: number }> {
  const order = predictBigBlindOrder(source);
  const position = new Map(order.map((seat, i) => [seat, i]));
  const ranked = stayingPlayers(source)
    .filter((p) => !exclude.has(p.playerId))
    .map((p) => {
      const m = movementScore(p, position.get(p.seat) as number, cfg);
      return { playerId: p.playerId, seat: p.seat, score: m.score, breakdown: m.breakdown, protectedTier: m.protectedTier };
    });
  return ranked.sort(
    (a, b) => a.protectedTier - b.protectedTier || a.score - b.score || a.seat - b.seat || compareIds(a.playerId, b.playerId),
  );
}

/**
 * The player to move out of `source` for balancing (see rankPlayersToMove).
 * Throws when the table has no movable player (planner precondition).
 */
export function selectPlayerToMove(source: TableSummary, cfg: BalancingConfig, exclude?: ReadonlySet<PlayerId>): PlayerToMove {
  const best = rankPlayersToMove(source, cfg, exclude)[0];
  if (best === undefined) throw new Error(`table ${source.tableId} has no movable player`);
  return { playerId: best.playerId, seat: best.seat, score: best.score, breakdown: best.breakdown };
}
