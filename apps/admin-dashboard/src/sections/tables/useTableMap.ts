import { useCallback, useMemo, useState } from 'react';
import type { Paginated, TableListItemDto } from '@jpb/shared-types';
import { useApi, useQueryClient } from '../../api/ApiProvider';
import { qk } from '../../api/query/keys';
import type { QueryKey, QueryState } from '../../api/query/QueryClient';
import type { TablesQuery } from '../../api/types';
import { useQueries } from './hooks';

/** Tables per server page in the map (divisible by every likely column count). */
export const MAP_PAGE_SIZE = 120;
/** Live refresh of the pages on screen. */
export const MAP_POLL_MS = 5_000;
/** "Has disconnected players" is filtered here (see Contract notes): pages of this size … */
export const SCAN_PAGE_SIZE = 500;
/** … up to this many tables in the current sort order. */
export const MAX_SCAN_TABLES = 5_000;
export const SCAN_POLL_MS = 15_000;

export interface TableMapData {
  /** Number of tables the grid shows. */
  count: number;
  rowAt: (index: number) => TableListItemDto | null;
  onRangeChange: (start: number, end: number) => void;
  /** First page not loaded yet. */
  initialLoading: boolean;
  /** No page could be loaded (and none is cached). */
  error: unknown;
  /** A refresh failed: what is shown is not current. */
  stale: boolean;
  /** Client time of the oldest page on screen. */
  updatedAt: number;
  /** Scan mode only: how many tables were checked and how many exist. */
  scan: { checked: number; total: number; capped: boolean } | null;
  refetch: () => void;
}

function pageQuery(key: QueryKey): TablesQuery {
  return key[3] as TablesQuery;
}

function summarize<T>(states: ReadonlyArray<QueryState<T>>) {
  const loaded = states.filter((s) => s.data !== undefined);
  return {
    initialLoading: loaded.length === 0 && states.some((s) => s.status !== 'error'),
    error: loaded.length === 0 ? (states.find((s) => s.status === 'error')?.error ?? null) : null,
    stale: states.some((s) => s.failedAt > 0 && s.data !== undefined),
    updatedAt: loaded.length ? Math.min(...loaded.map((s) => s.updatedAt)) : 0,
  };
}

/**
 * Server-paginated data behind the virtualized map: only the pages covering
 * the visible range are requested (and polled), so 125,000 tables cost the
 * same as 100. `disconnectedOnly` switches to a bounded scan (the API has no
 * server-side filter for it yet).
 */
export function useTableMap(tournamentId: string, base: TablesQuery, disconnectedOnly: boolean): TableMapData {
  const api = useApi();
  const client = useQueryClient();
  const [range, setRange] = useState({ start: 0, end: MAP_PAGE_SIZE });
  const onRangeChange = useCallback((start: number, end: number) => {
    setRange((r) => (r.start === start && r.end === end ? r : { start, end }));
  }, []);
  const fetchPage = useCallback((key: QueryKey, signal: AbortSignal) => api.tables.list(tournamentId, pageQuery(key), signal), [api, tournamentId]);

  // ---------------------------------------------------------------- paged mode
  const firstPage = Math.floor(range.start / MAP_PAGE_SIZE);
  const lastPage = Math.max(firstPage, Math.floor(Math.max(range.start, range.end - 1) / MAP_PAGE_SIZE));
  const pageKeys: QueryKey[] = [];
  if (!disconnectedOnly) for (let p = firstPage; p <= lastPage; p++) pageKeys.push(qk.tables(tournamentId, { ...base, offset: p * MAP_PAGE_SIZE, limit: MAP_PAGE_SIZE }));
  const pages = useQueries<Paginated<TableListItemDto>>(pageKeys, fetchPage, { pollMs: MAP_POLL_MS, enabled: !disconnectedOnly });

  // ---------------------------------------------------------------- scan mode
  const scanFirstKey = qk.tables(tournamentId, { ...base, offset: 0, limit: SCAN_PAGE_SIZE });
  const [scanFirst] = useQueries<Paginated<TableListItemDto>>(disconnectedOnly ? [scanFirstKey] : [], fetchPage, { pollMs: SCAN_POLL_MS, enabled: disconnectedOnly });
  const scanTotal = scanFirst?.data?.total ?? 0;
  const scanPages = Math.ceil(Math.min(scanTotal, MAX_SCAN_TABLES) / SCAN_PAGE_SIZE);
  const restKeys: QueryKey[] = [];
  for (let p = 1; p < scanPages; p++) restKeys.push(qk.tables(tournamentId, { ...base, offset: p * SCAN_PAGE_SIZE, limit: SCAN_PAGE_SIZE }));
  const scanRest = useQueries<Paginated<TableListItemDto>>(restKeys, fetchPage, { pollMs: SCAN_POLL_MS, enabled: disconnectedOnly });

  const scanned = useMemo(() => {
    if (!disconnectedOnly) return null;
    const all = [scanFirst, ...scanRest].filter((s): s is QueryState<Paginated<TableListItemDto>> => s !== undefined);
    const rows: TableListItemDto[] = [];
    let checked = 0;
    for (const s of all) {
      if (!s.data) continue;
      checked += s.data.rows.length;
      for (const r of s.data.rows) if (r.disconnectedPlayers > 0) rows.push(r);
    }
    return { rows, checked, states: all };
  }, [disconnectedOnly, scanFirst, scanRest]);

  const pageByIndex = useMemo(() => {
    const m = new Map<number, Paginated<TableListItemDto>>();
    pages.forEach((s, i) => {
      if (s.data) m.set(firstPage + i, s.data);
    });
    return m;
  }, [pages, firstPage]);

  const activeKeys = disconnectedOnly ? [scanFirstKey, ...restKeys] : pageKeys;
  const refetch = () => {
    for (const k of activeKeys) client.fetch(k, (signal) => fetchPage(k, signal)).catch(() => undefined);
  };

  if (scanned) {
    const sum = summarize(scanned.states);
    return {
      count: scanned.rows.length,
      rowAt: (i) => scanned.rows[i] ?? null,
      onRangeChange,
      ...sum,
      scan: { checked: scanned.checked, total: scanTotal, capped: scanTotal > MAX_SCAN_TABLES },
      refetch,
    };
  }

  const sum = summarize(pages);
  // Latest total from the freshest page on screen (tables open and close while you scroll).
  let total = 0;
  let freshest = -1;
  for (const s of pages) {
    if (s.data && s.updatedAt > freshest) {
      freshest = s.updatedAt;
      total = s.data.total;
    }
  }
  return {
    count: total,
    rowAt: (i) => pageByIndex.get(Math.floor(i / MAP_PAGE_SIZE))?.rows[i % MAP_PAGE_SIZE] ?? null,
    onRangeChange,
    ...sum,
    scan: null,
    refetch,
  };
}
