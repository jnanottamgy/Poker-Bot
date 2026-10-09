import type { LeaderboardDto } from '@jpb/shared-types';
import type { DisplayAction, TournamentInfo } from '../model/types';

/**
 * Where frames come from: the live server (WebSocket + REST) or the
 * deterministic demo generator. Both feed the same reducer.
 */
export interface DisplaySource {
  kind: 'live' | 'demo';
  start(dispatch: (a: DisplayAction) => void): void;
  /** Reconnect now (browser back online / tab visible). */
  nudge(): void;
  stop(): void;
}

/** REST side of a source (leaderboard + prize info). */
export interface DisplayData {
  leaderboard(mode: 'stack' | 'finish', limit: number): Promise<LeaderboardDto>;
  info(): Promise<TournamentInfo>;
}
