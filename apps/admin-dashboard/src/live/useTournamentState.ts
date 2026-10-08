import type { BlindClockState, BlindLevel, TournamentCounters, TournamentOverviewDto, TournamentStatus } from '@jpb/shared-types';
import { useApi } from '../api/ApiProvider';
import { qk } from '../api/query/keys';
import { useQuery } from '../api/query/useQuery';
import type { UseQueryResult } from '../api/query/useQuery';
import { useConnection, useLiveSummary } from './hooks';

export interface TournamentState {
  overview: UseQueryResult<TournamentOverviewDto>;
  status: TournamentStatus | null;
  clock: BlindClockState | null;
  currentLevel: BlindLevel | null;
  nextLevel: BlindLevel | null;
  counters: TournamentCounters | null;
  handForHand: boolean;
  frozen: boolean;
  /** Socket open + synced: the numbers below are live. */
  live: boolean;
  /** Not live (reconnecting, or the last REST refresh failed): show greyed with a banner. */
  stale: boolean;
  offsetMs: number;
}

/** Overview poll interval while the socket is healthy (events also refresh it). */
export const OVERVIEW_POLL_MS = 15_000;

/**
 * The tournament's headline state: the REST overview (complete, polled),
 * overridden by the socket's authoritative summary (status, clock, counters)
 * whenever the socket is live. Never computes anything itself.
 */
export function useTournamentState(tournamentId: string | null): TournamentState {
  const api = useApi();
  const overview = useQuery(qk.overview(tournamentId ?? '-'), (s) => api.tournaments.overview(tournamentId!, s), { enabled: tournamentId !== null, pollMs: OVERVIEW_POLL_MS });
  const conn = useConnection();
  const summary = useLiveSummary();
  const o = overview.data;
  const useLive = conn.live && summary !== null && summary.tournamentId === tournamentId;
  return {
    overview,
    status: useLive ? summary.status : (o?.status ?? null),
    clock: useLive ? summary.clock : (o?.clock ?? null),
    currentLevel: useLive ? summary.currentLevel : (o?.currentLevel ?? null),
    nextLevel: useLive ? summary.nextLevel : (o?.nextLevel ?? null),
    counters: useLive ? summary.counters : (o?.counters ?? null),
    handForHand: useLive ? summary.handForHand : (o?.handForHand ?? false),
    frozen: o?.frozen ?? false,
    live: conn.live,
    stale: !conn.live || overview.isStale,
    offsetMs: conn.offsetMs,
  };
}
