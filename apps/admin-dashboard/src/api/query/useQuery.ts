import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useQueryClient } from '../ApiProvider';
import { hashKey } from './QueryClient';
import type { Fetcher, QueryKey, QueryState } from './QueryClient';

export interface UseQueryOptions {
  /** Do nothing until true (e.g. missing permission or id). Default true. */
  enabled?: boolean;
  /** Background refresh interval while mounted and the tab is visible. */
  pollMs?: number;
  /** Cached data younger than this is not refetched on mount. Default 5s. */
  staleMs?: number;
}

export interface UseQueryResult<T> extends QueryState<T> {
  /** First load in progress (no data yet). */
  isLoading: boolean;
  /** The last refresh failed: data (if any) is not current — show it greyed, never as live. */
  isStale: boolean;
  refetch: () => Promise<T | undefined>;
}

/**
 * useQuery-style hook over the shared QueryClient: caching, de-duplication,
 * polling and invalidation. The fetcher receives an AbortSignal; pass it to
 * the API client.
 *
 *   const overview = useQuery(qk.overview(id), (s) => api.tournaments.overview(id, s), { pollMs: 10_000 });
 */
export function useQuery<T>(key: QueryKey, fetcher: Fetcher<T>, opts: UseQueryOptions = {}): UseQueryResult<T> {
  const { enabled = true, pollMs, staleMs = 5_000 } = opts;
  const client = useQueryClient();
  const hash = hashKey(key);
  // The key array is rebuilt every render; its hash is the stable identity.
  const stableKey = useMemo(() => key, [hash]);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const stableFetcher = useCallback<Fetcher<T>>((signal) => fetcherRef.current(signal), []);

  const subscribe = useCallback((l: () => void) => client.subscribe(stableKey, l), [client, stableKey]);
  const getSnapshot = useCallback(() => client.getState<T>(stableKey), [client, stableKey]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!enabled) return;
    client.register(stableKey, stableFetcher);
    if (client.isStale(stableKey, staleMs)) client.fetch(stableKey).catch(() => undefined);
  }, [client, stableKey, stableFetcher, enabled, staleMs]);

  useEffect(() => {
    if (!enabled || !pollMs) return undefined;
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      client.fetch(stableKey, stableFetcher).catch(() => undefined);
    }, pollMs);
    return () => clearInterval(timer);
  }, [client, stableKey, stableFetcher, enabled, pollMs]);

  const refetch = useCallback(() => client.fetch(stableKey, stableFetcher).catch(() => undefined), [client, stableKey, stableFetcher]);

  return {
    ...state,
    isLoading: enabled && state.data === undefined && state.status !== 'error',
    isStale: state.failedAt > 0 && state.data !== undefined,
    refetch,
  };
}
