import type { AlertsQuery, AuditQuery, HandsQuery, PlayersQuery, StandingsQuery, TablesQuery, TournamentListQuery } from '../types';

/**
 * Query key factories. Everything about one tournament lives under
 * `['t', id, …]` so `invalidate(qk.tournament(id))` refreshes the whole
 * control room for it; global resources have their own roots.
 */
export const qk = {
  me: () => ['me'] as const,
  tournaments: (q: TournamentListQuery = {}) => ['tournaments', q] as const,
  tournamentsAll: () => ['tournaments'] as const,

  tournament: (id: string) => ['t', id] as const,
  overview: (id: string) => ['t', id, 'overview'] as const,
  metrics: (id: string) => ['t', id, 'metrics'] as const,
  tables: (id: string, q: TablesQuery = {}) => ['t', id, 'tables', q] as const,
  players: (id: string, q: PlayersQuery = {}) => ['t', id, 'players', q] as const,
  hands: (id: string, q: HandsQuery = {}) => ['t', id, 'hands', q] as const,
  standings: (id: string, q: StandingsQuery) => ['t', id, 'standings', q] as const,
  payouts: (id: string) => ['t', id, 'payouts'] as const,
  fairness: (id: string) => ['t', id, 'fairness'] as const,
  report: (id: string) => ['t', id, 'report'] as const,

  table: (tableId: string) => ['table', tableId] as const,
  player: (playerId: string) => ['player', playerId] as const,
  hand: (handId: string) => ['hand', handId] as const,

  alerts: (q: AlertsQuery = {}) => ['alerts', q] as const,
  alertsAll: () => ['alerts'] as const,
  audit: (q: AuditQuery = {}) => ['audit', q] as const,
  auditAll: () => ['audit'] as const,
  system: () => ['system'] as const,
  users: () => ['users'] as const,
  sessions: () => ['sessions'] as const,
  demo: (id: string) => ['demo', id] as const,
};
