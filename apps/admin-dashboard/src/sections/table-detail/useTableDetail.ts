import { useMemo } from 'react';
import type { AdminTableView, Paginated, TableDetailDto, TableEvent, TableListItemDto } from '@jpb/shared-types';
import { useApi } from '../../api/ApiProvider';
import { qk } from '../../api/query/keys';
import { useQuery } from '../../api/query/useQuery';
import type { UseQueryResult } from '../../api/query/useQuery';
import { useLive } from '../../live/LiveProvider';
import { useConnection, useWatchedTable } from '../../live/hooks';

/** REST refresh of the detail (internals, recent hands) while the socket streams the live view … */
export const DETAIL_POLL_LIVE_MS = 8_000;
/** … and while it does not (the REST view is then the only source). */
export const DETAIL_POLL_FALLBACK_MS = 3_000;
export const ROW_POLL_MS = 10_000;

export interface TableDetailData {
  detail: UseQueryResult<TableDetailDto>;
  /** Newest view: the watched socket view or the REST one, whichever has the higher version. */
  view: AdminTableView | null;
  /** The view on screen arrived over a live, synced socket. */
  live: boolean;
  /** Director's row (status incl. STALLED, final-table flag, chips the director expects). */
  row: TableListItemDto | null;
  /** Live table events received for this table since it was opened (bounded). */
  events: readonly TableEvent[];
  serverOffsetMs: number;
}

/**
 * Everything the table detail shows. The admin socket `watch`es this table
 * (live `table_update` frames); REST fills in internals, recent hands and
 * hole cards after an audited reveal, and stands in when the socket is down.
 */
export function useTableDetail(tournamentId: string, tableId: string): TableDetailData {
  const api = useApi();
  const conn = useConnection();
  const liveView = useWatchedTable(tableId);
  const liveOk = conn.live && liveView !== null;
  const detail = useQuery(qk.table(tableId), (s) => api.tables.detail(tableId, s), { pollMs: liveOk ? DETAIL_POLL_LIVE_MS : DETAIL_POLL_FALLBACK_MS });
  const rest = detail.data?.view ?? null;
  const useLiveView = liveView !== null && (rest === null || liveView.version >= rest.version);
  const view = useLiveView ? liveView : rest;

  const tableNumber = view?.tableNumber ?? null;
  // tablesList searches by number prefix; sorted by number, the exact table is the first row.
  const rowQuery = { q: String(tableNumber ?? ''), sort: 'number' as const, offset: 0, limit: 1 };
  const rowRes = useQuery<Paginated<TableListItemDto>>(qk.tables(tournamentId, rowQuery), (s) => api.tables.list(tournamentId, rowQuery, s), { enabled: tableNumber !== null, pollMs: ROW_POLL_MS });
  const row = rowRes.data?.rows.find((r) => r.tableId === tableId) ?? null;

  const allEvents = useLive((s) => s.tableEvents);
  const events = useMemo(() => allEvents.filter((e) => e.tableId === tableId), [allEvents, tableId]);

  return { detail, view, live: useLiveView && liveOk, row, events, serverOffsetMs: conn.offsetMs };
}
