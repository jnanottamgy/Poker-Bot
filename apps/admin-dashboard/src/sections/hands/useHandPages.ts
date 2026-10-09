import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { HandListItemDto, Paginated } from '@jpb/shared-types';
import { useApi, useQueryClient } from '../../api/ApiProvider';
import { hashKey } from '../../api/query/QueryClient';
import type { QueryKey, QueryState } from '../../api/query/QueryClient';
import { qk } from '../../api/query/keys';
import { useQuery } from '../../api/query/useQuery';
import type { HandsQuery } from '../../api/types';

/** Rows per server page (the API caps `limit` at 500). */
export const HAND_PAGE_SIZE = 100;
/** How often the list asks the server whether new hands completed. */
export const NEW_HANDS_POLL_MS = 10_000;
/**
 * Loaded pages are kept as they are (no background refresh): completed hands
 * never change, and re-polling a newest-first list would shift the rows under
 * the operator. New hands are announced instead ("N new hands — show").
 */
const PAGE_STALE_MS = 10 * 60_000;

const noop = () => undefined;

/** Several keys of the shared QueryClient at once (the pages a virtualized list shows). */
function useQueries<T>(keys: readonly QueryKey[], fetcherFor: (key: QueryKey, signal: AbortSignal) => Promise<T>, staleMs: number): ReadonlyArray<QueryState<T>> {
  const client = useQueryClient();
  const signature = keys.map(hashKey).join('\n');
  // The caller rebuilds the key array each render; the joined hashes are the identity.
  const stableKeys = useMemo(() => keys, [signature]);
  const fetcherRef = useRef(fetcherFor);
  fetcherRef.current = fetcherFor;
  const fetchers = useMemo(() => stableKeys.map((k) => (signal: AbortSignal) => fetcherRef.current(k, signal)), [stableKeys]);

  const cache = useRef<ReadonlyArray<QueryState<T>>>([]);
  const subscribe = useCallback(
    (listener: () => void) => {
      const unsubs = stableKeys.map((k) => client.subscribe(k, listener));
      return () => unsubs.forEach((u) => u());
    },
    [client, stableKeys],
  );
  const getSnapshot = useCallback(() => {
    const next = stableKeys.map((k) => client.getState<T>(k));
    const prev = cache.current;
    if (prev.length === next.length && next.every((s, i) => s === prev[i])) return prev;
    cache.current = next;
    return next;
  }, [client, stableKeys]);
  const states = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    stableKeys.forEach((k, i) => {
      client.register(k, fetchers[i]!);
      if (client.isStale(k, staleMs)) client.fetch(k).catch(noop);
    });
  }, [client, stableKeys, fetchers, staleMs]);

  return states;
}

export interface HandPages {
  /** Hands matching the filters (server `total` when the list was loaded); null before the first page. */
  total: number | null;
  rowAt: (index: number) => HandListItemDto | null;
  onRangeChange: (start: number, end: number) => void;
  initialLoading: boolean;
  /** No page could be loaded (nothing cached). */
  error: unknown;
  /** A refresh failed: what is shown may not be current. */
  stale: boolean;
  /** Hands completed since the list was loaded (from the lightweight probe). */
  newHands: number;
  /** Re-read the list from the newest hand. */
  refresh: () => void;
  /** Client time the oldest page on screen was loaded. */
  updatedAt: number;
}

/**
 * Server-paginated hand history behind the virtualized list: only the pages
 * covering the visible rows are requested, so 10 million hands cost the same
 * as 10. A one-row probe polls the total to announce new hands.
 */
export function useHandPages(tournamentId: string, base: HandsQuery, enabled = true): HandPages {
  const api = useApi();
  const client = useQueryClient();
  const [range, setRange] = useState({ start: 0, end: HAND_PAGE_SIZE });
  const baseHash = hashKey([base]);
  useEffect(() => setRange({ start: 0, end: HAND_PAGE_SIZE }), [baseHash]);
  const onRangeChange = useCallback((start: number, end: number) => {
    setRange((r) => (r.start === start && r.end === end ? r : { start, end }));
  }, []);
  const fetchPage = useCallback((key: QueryKey, signal: AbortSignal) => api.hands.list(tournamentId, key[3] as HandsQuery, signal), [api, tournamentId]);

  const first = Math.floor(range.start / HAND_PAGE_SIZE);
  const last = Math.max(first, Math.floor(Math.max(range.start, range.end - 1) / HAND_PAGE_SIZE));
  const keys: QueryKey[] = [];
  if (enabled) for (let p = first; p <= last; p++) keys.push(qk.hands(tournamentId, { ...base, offset: p * HAND_PAGE_SIZE, limit: HAND_PAGE_SIZE }));
  const pages = useQueries<Paginated<HandListItemDto>>(keys, fetchPage, PAGE_STALE_MS);

  // Lightweight "anything new?" probe: one row, polled.
  const probeQuery: HandsQuery = { ...base, offset: 0, limit: 1 };
  const probe = useQuery(['t', tournamentId, 'hands', 'probe', probeQuery], (s) => api.hands.list(tournamentId, probeQuery, s), { enabled, pollMs: NEW_HANDS_POLL_MS, staleMs: NEW_HANDS_POLL_MS });

  const byPage = useMemo(() => {
    const m = new Map<number, Paginated<HandListItemDto>>();
    pages.forEach((s, i) => {
      if (s.data) m.set(first + i, s.data);
    });
    return m;
  }, [pages, first]);

  // The first page loaded defines the list's total (the probe reports growth separately).
  const firstPage = client.getState<Paginated<HandListItemDto>>(qk.hands(tournamentId, { ...base, offset: 0, limit: HAND_PAGE_SIZE })).data;
  let total: number | null = firstPage?.total ?? null;
  if (total === null) for (const s of pages) if (s.data) total = s.data.total;

  const loaded = pages.filter((s) => s.data !== undefined);
  const probeTotal = probe.data?.total ?? null;
  const newHands = total !== null && probeTotal !== null && probeTotal > total ? probeTotal - total : 0;

  const refresh = useCallback(() => {
    client.invalidate(['t', tournamentId, 'hands']);
  }, [client, tournamentId]);

  return {
    total,
    rowAt: (i) => byPage.get(Math.floor(i / HAND_PAGE_SIZE))?.rows[i % HAND_PAGE_SIZE] ?? null,
    onRangeChange,
    initialLoading: enabled && loaded.length === 0 && pages.some((s) => s.status !== 'error'),
    error: loaded.length === 0 ? (pages.find((s) => s.status === 'error')?.error ?? null) : null,
    stale: pages.some((s) => s.failedAt > 0 && s.data !== undefined),
    newHands,
    refresh,
    updatedAt: loaded.length ? Math.min(...loaded.map((s) => s.updatedAt)) : 0,
  };
}
