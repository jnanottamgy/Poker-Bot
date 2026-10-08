import type { TournamentEvent } from '@jpb/shared-types';
import { qk } from '../api/query/keys';
import type { QueryKey } from '../api/query/QueryClient';

/** Which cached REST resources a live tournament event makes out of date. */
export function liveInvalidations(event: TournamentEvent, tournamentId: string): QueryKey[] {
  switch (event.kind) {
    case 'TOURNAMENT_STATUS_CHANGED':
    case 'TOURNAMENT_PAUSED':
    case 'TOURNAMENT_RESUMED':
    case 'BREAK_STARTED':
    case 'BREAK_ENDED':
    case 'BLIND_LEVEL_CHANGED':
    case 'HAND_FOR_HAND':
    case 'TOURNAMENT_COMPLETED':
      return [qk.overview(tournamentId), qk.tournamentsAll()];
    case 'PLAYER_ELIMINATED':
    case 'TABLE_MOVE':
    case 'TABLE_BROKEN':
    case 'TABLE_CREATED':
    case 'FINAL_TABLE_FORMED':
    case 'PLAYER_REGISTERED':
      return [qk.overview(tournamentId), ['t', tournamentId, 'tables'], ['t', tournamentId, 'players'], ['t', tournamentId, 'standings']];
    case 'INTEGRITY_ALERT':
      return [qk.overview(tournamentId), qk.alertsAll()];
    default:
      return [];
  }
}
