import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Paginated } from '@jpb/shared-types';
import { useQueryClient } from '../../api/ApiProvider';
import { hashKey } from '../../api/query/QueryClient';
import type { Fetcher, QueryKey, QueryState } from '../../api/query/QueryClient';

const noop = () => undefined;

export interface QueryEntry<T> {
  key: QueryKey;
  fetch: Fetcher<T>;
}

/**
 * Several keys of the shared QueryClient at once (the server pages a
 * virtualized list currently shows): de-duplicated, cached, invalidated and
 * polled exactly like `useQuery`. The returned array is stable while nothing
 * changes, so it can feed memoised renders.
 */
export function useQueries<T>(entries: ReadonlyArray<QueryEntry<T>>, opts: { enabled?: boolean; pollMs?: number; staleMs?: number } = {}): ReadonlyArray<QueryState<T>> {
  const { enabled = true, pollMs, staleMs = 5_000 } = opts;
  const client = useQueryClient();
  // The latest fetcher per key (a key always means the same request; the closure may be newer).
  const latest = useRef(new Map<string, Fetcher<T>>());
  for (const e of entries) latest.current.set(hashKey(e.key), e.fetch);
  const signature = entries.map((e) => hashKey(e.key)).join('\n');
  // The caller rebuilds the array every render; the joined hashes are its identity.
  const keys = useMemo(() => entries.map((e) => e.key), [signature]);
  const fetchers = useMemo(
    () =>
      keys.map((k) => {
        const h = hashKey(k);
        return (signal: AbortSignal) => latest.current.get(h)!(signal);
      }),
    [keys],
  );

  const cache = useRef<ReadonlyArray<QueryState<T>>>([]);
  const subscribe = useCallback(
    (listener: () => void) => {
      const unsubs = keys.map((k) => client.subscribe(k, listener));
      return () => unsubs.forEach((u) => u());
    },
    [client, keys],
  );
  const getSnapshot = useCallback(() => {
    const next = keys.map((k) => client.getState<T>(k));
    const prev = cache.current;
    if (prev.length === next.length && next.every((s, i) => s === prev[i])) return prev;
    cache.current = next;
    return next;
  }, [client, keys]);
  const states = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!enabled) return;
    keys.forEach((k, i) => {
      client.register(k, fetchers[i]!);
      if (client.isStale(k, staleMs)) client.fetch(k).catch(noop);
    });
  }, [client, keys, fetchers, enabled, staleMs]);

  useEffect(() => {
    if (!enabled || !pollMs) return undefined;
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      keys.forEach((k, i) => client.fetch(k, fetchers[i]).catch(noop));
    }, pollMs);
    return () => clearInterval(timer);
  }, [client, keys, fetchers, enabled, pollMs]);

  return states;
}

export interface PagedRows<T, P extends Paginated<T> = Paginated<T>> {
  /** Rows matching the query (the server's `total`); null before the first page. */
  total: number | null;
  rowAt: (index: number) => T | null;
  /** The freshest page received (for metadata such as the server's label). */
  latest: P | null;
  onRangeChange: (start: number, end: number) => void;
  initialLoading: boolean;
  /** No page could be loaded (nothing cached). */
  error: unknown;
  /** A refresh failed: what is shown is not current (show greyed, never as live). */
  stale: boolean;
  /** A request is in flight for a page on screen. */
  fetching: boolean;
  /** Client time of the oldest page on screen (0 = nothing yet). */
  updatedAt: number;
  refetch: () => void;
}

export interface PagedRowsOptions<P> {
  /** Query key of one page; must start with a prefix that live invalidation refreshes. */
  keyFor: (offset: number, limit: number) => QueryKey;
  fetchPage: (offset: number, limit: number, signal: AbortSignal) => Promise<P>;
  pageSize: number;
  /** Changing it starts again from the first page (new mode / filters). */
  resetKey: string;
  pollMs?: number;
  enabled?: boolean;
}

/**
 * Server-paginated rows behind a virtualized list: only the pages covering
 * the rows on screen are requested (and polled), so a list of 1,000,000 rows
 * costs the same as a list of 8.
 */
export function usePagedRows<T, P extends Paginated<T> = Paginated<T>>(opts: PagedRowsOptions<P>): PagedRows<T, P> {
  const { keyFor, fetchPage, pageSize, resetKey, pollMs, enabled = true } = opts;
  const client = useQueryClient();
  const [range, setRange] = useState({ start: 0, end: pageSize });
  useEffect(() => setRange((r) => (r.start === 0 && r.end === pageSize ? r : { start: 0, end: pageSize })), [resetKey, pageSize]);
  const onRangeChange = useCallback((start: number, end: number) => {
    setRange((r) => (r.start === start && r.end === end ? r : { start, end }));
  }, []);

  const first = Math.floor(range.start / pageSize);
  const last = Math.max(first, Math.floor(Math.max(range.start, range.end - 1) / pageSize));
  const entries: Array<QueryEntry<P>> = [];
  for (let p = first; p <= last; p++) {
    const offset = p * pageSize;
    entries.push({ key: keyFor(offset, pageSize), fetch: (signal) => fetchPage(offset, pageSize, signal) });
  }
  const pages = useQueries<P>(entries, { enabled, pollMs });

  const byPage = useMemo(() => {
    const m = new Map<number, P>();
    pages.forEach((s, i) => {
      if (s.data) m.set(first + i, s.data);
    });
    return m;
  }, [pages, first]);

  // Total from the freshest page on screen (players bust while the list scrolls).
  let latest: P | null = null;
  let freshest = -1;
  for (const s of pages) {
    if (s.data && s.updatedAt > freshest) {
      freshest = s.updatedAt;
      latest = s.data;
    }
  }
  // A jump (scrollbar drag, "go to rank") can put only unloaded pages on screen: keep the
  // last known total so the list stays mounted (skeleton rows) instead of starting over.
  const known = useRef<{ resetKey: string; latest: P | null }>({ resetKey, latest: null });
  if (known.current.resetKey !== resetKey) known.current = { resetKey, latest: null };
  if (latest) known.current.latest = latest;
  const shown = latest ?? known.current.latest;
  const loaded = pages.filter((s) => s.data !== undefined);
  return {
    total: shown ? shown.total : null,
    latest: shown,
    rowAt: (i) => byPage.get(Math.floor(i / pageSize))?.rows[i % pageSize] ?? null,
    onRangeChange,
    initialLoading: enabled && shown === null && pages.some((s) => s.status !== 'error'),
    error: shown === null ? (pages.find((s) => s.status === 'error')?.error ?? null) : null,
    stale: pages.some((s) => s.failedAt > 0 && s.data !== undefined),
    fetching: pages.some((s) => s.fetching),
    updatedAt: loaded.length ? Math.min(...loaded.map((s) => s.updatedAt)) : 0,
    refetch: () => {
      for (const e of entries) client.fetch(e.key, e.fetch).catch(noop);
    },
  };
}
