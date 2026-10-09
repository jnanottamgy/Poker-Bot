import { useEffect, useRef } from 'react';
import type { PlayerDetailDto, PublicSeatView, SeatOccupant, TournamentEvent } from '@jpb/shared-types';
import { useApi } from '../../api/ApiProvider';
import { qk } from '../../api/query/keys';
import { useQuery } from '../../api/query/useQuery';
import type { UseQueryResult } from '../../api/query/useQuery';
import { useConnection, useLiveEvents, useWatchedTable } from '../../live/hooks';

/** Background refresh of the REST detail (live table frames and events refresh it sooner). */
export const DETAIL_POLL_MS = 10_000;

export interface LiveSeat {
  occupant: SeatOccupant;
  seat: PublicSeatView | null;
  /** A hand is being played at the player's table (stacks only change between hands). */
  handInProgress: boolean;
  handNumber: number | null;
  tableNumber: number;
}

export interface PlayerDetailState {
  query: UseQueryResult<PlayerDetailDto>;
  /** The player's seat in the live admin table frame (null when not seated, or the socket is not live). */
  live: LiveSeat | null;
}

/** Does this tournament event concern the player (so the REST detail is out of date)? */
export function concernsPlayer(e: TournamentEvent, playerId: string, tableId: string | null): boolean {
  switch (e.kind) {
    case 'TABLE_MOVE':
      return e.movement.playerId === playerId;
    case 'PLAYER_ELIMINATED':
      return e.record.playerId === playerId;
    case 'FINAL_TABLE_FORMED':
      return e.players.some((p) => p.playerId === playerId);
    case 'TABLE_BROKEN':
      return tableId !== null && e.tableId === tableId;
    case 'PLAYER_REGISTERED':
      return e.playerId === playerId;
    case 'TOURNAMENT_COMPLETED':
      return true;
    default:
      return false;
  }
}

/**
 * Player detail = REST record (complete: sessions, movements, actions)
 * + the live seat from the watched table frame (stack, connection,
 * timeouts update in real time). Events about this player refetch the record.
 */
export function usePlayerDetail(playerId: string): PlayerDetailState {
  const api = useApi();
  const query = useQuery(qk.player(playerId), (s) => api.players.detail(playerId, s), { pollMs: DETAIL_POLL_MS });
  const d = query.data;
  const tableId = d?.tableId ?? null;
  const view = useWatchedTable(tableId);
  const conn = useConnection();
  const events = useLiveEvents();
  const seen = useRef<number | null>(null);
  const refetch = query.refetch;

  useEffect(() => {
    const last = events.length ? events[events.length - 1]!.seq : 0;
    if (seen.current === null) {
      seen.current = last;
      return;
    }
    const fresh = events.filter((e) => e.seq > (seen.current ?? 0));
    seen.current = last;
    if (fresh.some((e) => concernsPlayer(e.event, playerId, tableId))) void refetch();
  }, [events, playerId, tableId, refetch]);

  let live: LiveSeat | null = null;
  if (view && conn.live) {
    const occupant = view.seatDetails.find((s) => s?.playerId === playerId) ?? null;
    if (occupant) {
      const seat = view.seats.find((s) => s?.playerId === playerId) ?? null;
      const hand = view.hand;
      live = {
        occupant,
        seat,
        handInProgress: hand !== null && hand.phase !== 'HAND_COMPLETE',
        handNumber: hand?.handNumber ?? null,
        tableNumber: view.tableNumber,
      };
    }
  }
  return { query, live };
}
