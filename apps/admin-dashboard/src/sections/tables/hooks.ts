import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '../../api/ApiProvider';
import { hashKey } from '../../api/query/QueryClient';
import type { QueryKey, QueryState } from '../../api/query/QueryClient';

/**
 * Client clock re-read every `intervalMs` (cosmetic "seconds since" counters).
 * Server times are compared with `now + serverOffsetMs`; nothing decides on it.
 */
export function useNow(intervalMs = 1000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled]);
  return now;
}

export interface UseQueriesOptions {
  enabled?: boolean;
  /** Refresh every key on screen at this interval (tab visible only). */
  pollMs?: number;
  /** Cached data younger than this is not refetched on mount. */
  staleMs?: number;
}

const noop = () => undefined;

/**
 * Several keys of the shared QueryClient at once (e.g. the server pages a
 * virtualized grid currently shows). Same semantics as `useQuery` per key:
 * de-duplicated requests, cache, invalidation and polling; the returned
 * array is referentially stable while no state changes.
 */
export function useQueries<T>(keys: readonly QueryKey[], fetcherFor: (key: QueryKey, signal: AbortSignal) => Promise<T>, opts: UseQueriesOptions = {}): ReadonlyArray<QueryState<T>> {
  const { enabled = true, pollMs, staleMs = 5_000 } = opts;
  const client = useQueryClient();
  const signature = keys.map(hashKey).join('\n');
  // Rebuilt every render by the caller; the joined hashes are the identity.
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

/** "42s", "3m 05s", "1h 02m" — compact elapsed time for tiles (never negative). */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}
