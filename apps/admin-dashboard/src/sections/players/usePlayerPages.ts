import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Paginated, PlayerListItemDto } from '@jpb/shared-types';
import { useApi, useQueryClient } from '../../api/ApiProvider';
import { hashKey } from '../../api/query/QueryClient';
import type { QueryKey, QueryState } from '../../api/query/QueryClient';
import { qk } from '../../api/query/keys';
import type { PlayersQuery } from '../../api/types';

/** Rows per server page (the API caps `limit` at 500). */
export const PLAYER_PAGE_SIZE = 100;
/** Live refresh of the pages on screen (tournament events also invalidate them). */
export const PLAYER_POLL_MS = 10_000;

const noop = () => undefined;

/**
 * Several keys of the shared QueryClient at once (the server pages a
 * virtualized list currently shows): de-duplicated, cached, invalidated and
 * polled like `useQuery`. The returned array is stable while nothing changes.
 */
export function useQueries<T>(keys: readonly QueryKey[], fetcherFor: (key: QueryKey, signal: AbortSignal) => Promise<T>, opts: { enabled?: boolean; pollMs?: number; staleMs?: number } = {}): ReadonlyArray<QueryState<T>> {
  const { enabled = true, pollMs, staleMs = 5_000 } = opts;
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
    if (!enabled) return;
    stableKeys.forEach((k, i) => {
      client.register(k, fetchers[i]!);
      if (client.isStale(k, staleMs)) client.fetch(k).catch(noop);
    });
  }, [client, stableKeys, fetchers, enabled, staleMs]);

  useEffect(() => {
    if (!enabled || !pollMs) return undefined;
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      stableKeys.forEach((k, i) => client.fetch(k, fetchers[i]).catch(noop));
    }, pollMs);
    return () => clearInterval(timer);
  }, [client, stableKeys, fetchers, enabled, pollMs]);

  return states;
}

export interface PlayerPages {
  /** Players matching the filters (the server's `total`); null before the first page. */
  total: number | null;
  rowAt: (index: number) => PlayerListItemDto | null;
  /** Every row of the pages currently loaded (on screen ± one page). */
  loaded: PlayerListItemDto[];
  onRangeChange: (start: number, end: number) => void;
  initialLoading: boolean;
  /** No page could be loaded (nothing cached). */
  error: unknown;
  /** A refresh failed: what is shown is not current. */
  stale: boolean;
  /** Client time of the oldest page on screen. */
  updatedAt: number;
  refetch: () => void;
}

/**
 * Server-paginated players behind the virtualized list: only the pages that
 * cover the visible rows are requested (and polled), so 1,000,000 players
 * cost the same as 8.
 */
export function usePlayerPages(tournamentId: string, base: PlayersQuery): PlayerPages {
  const api = useApi();
  const client = useQueryClient();
  const [range, setRange] = useState({ start: 0, end: PLAYER_PAGE_SIZE });
  const baseHash = hashKey([base]);
  useEffect(() => setRange((r) => (r.start === 0 && r.end === PLAYER_PAGE_SIZE ? r : { start: 0, end: PLAYER_PAGE_SIZE })), [baseHash]);
  const onRangeChange = useCallback((start: number, end: number) => {
    setRange((r) => (r.start === start && r.end === end ? r : { start, end }));
  }, []);
  const fetchPage = useCallback((key: QueryKey, signal: AbortSignal) => api.players.list(tournamentId, key[3] as PlayersQuery, signal), [api, tournamentId]);

  const first = Math.floor(range.start / PLAYER_PAGE_SIZE);
  const last = Math.max(first, Math.floor(Math.max(range.start, range.end - 1) / PLAYER_PAGE_SIZE));
  const keys: QueryKey[] = [];
  for (let p = first; p <= last; p++) keys.push(qk.players(tournamentId, { ...base, offset: p * PLAYER_PAGE_SIZE, limit: PLAYER_PAGE_SIZE }));
  const pages = useQueries<Paginated<PlayerListItemDto>>(keys, fetchPage, { pollMs: PLAYER_POLL_MS });

  const byPage = useMemo(() => {
    const m = new Map<number, Paginated<PlayerListItemDto>>();
    pages.forEach((s, i) => {
      if (s.data) m.set(first + i, s.data);
    });
    return m;
  }, [pages, first]);

  // Total from the freshest page on screen (players register and bust while you scroll).
  let total: number | null = null;
  let freshest = -1;
  for (const s of pages) {
    if (s.data && s.updatedAt > freshest) {
      freshest = s.updatedAt;
      total = s.data.total;
    }
  }
  const loaded = pages.filter((s) => s.data !== undefined);
  const loadedRows = useMemo(() => [...byPage.values()].flatMap((p) => p.rows), [byPage]);
  return {
    total,
    rowAt: (i) => byPage.get(Math.floor(i / PLAYER_PAGE_SIZE))?.rows[i % PLAYER_PAGE_SIZE] ?? null,
    loaded: loadedRows,
    onRangeChange,
    initialLoading: loaded.length === 0 && pages.some((s) => s.status !== 'error'),
    error: loaded.length === 0 ? (pages.find((s) => s.status === 'error')?.error ?? null) : null,
    stale: pages.some((s) => s.failedAt > 0 && s.data !== undefined),
    updatedAt: loaded.length ? Math.min(...loaded.map((s) => s.updatedAt)) : 0,
    refetch: () => {
      for (const k of keys) client.fetch(k, (signal) => fetchPage(k, signal)).catch(noop);
    },
  };
}
