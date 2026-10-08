/**
 * A deliberately small query cache (no dependencies): keyed entries, in-flight
 * de-duplication, subscriptions compatible with useSyncExternalStore, prefix
 * invalidation and direct writes. Server data only — never derived game state.
 */
export type QueryKey = readonly unknown[];
export type Fetcher<T> = (signal: AbortSignal) => Promise<T>;
export type QueryStatus = 'idle' | 'loading' | 'success' | 'error';

export interface QueryState<T> {
  data: T | undefined;
  error: unknown;
  status: QueryStatus;
  /** A request is in flight (initial load or background refresh). */
  fetching: boolean;
  /** Client time of the last successful response (0 = never). */
  updatedAt: number;
  /** Client time of the last failed attempt (0 = none since the last success). */
  failedAt: number;
}

interface Entry<T> {
  key: QueryKey;
  state: QueryState<T>;
  promise: Promise<T> | null;
  controller: AbortController | null;
  fetcher: Fetcher<T> | null;
  listeners: Set<() => void>;
  stale: boolean;
}

const EMPTY: QueryState<never> = { data: undefined, error: null, status: 'idle', fetching: false, updatedAt: 0, failedAt: 0 };

export function hashKey(key: QueryKey): string {
  return JSON.stringify(key);
}

function startsWith(key: QueryKey, prefix: QueryKey): boolean {
  if (prefix.length > key.length) return false;
  return prefix.every((p, i) => hashKey([p]) === hashKey([key[i]]));
}

export class QueryClient {
  private readonly entries = new Map<string, Entry<unknown>>();
  private readonly errorListeners = new Set<(err: unknown) => void>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  private entry<T>(key: QueryKey): Entry<T> {
    const h = hashKey(key);
    let e = this.entries.get(h) as Entry<T> | undefined;
    if (!e) {
      e = { key, state: EMPTY, promise: null, controller: null, fetcher: null, listeners: new Set(), stale: true };
      this.entries.set(h, e as Entry<unknown>);
    }
    return e;
  }

  private set<T>(e: Entry<T>, patch: Partial<QueryState<T>>): void {
    e.state = { ...e.state, ...patch };
    for (const l of [...e.listeners]) l();
  }

  getState<T>(key: QueryKey): QueryState<T> {
    return (this.entries.get(hashKey(key))?.state as QueryState<T> | undefined) ?? EMPTY;
  }

  subscribe(key: QueryKey, listener: () => void): () => void {
    const e = this.entry(key);
    e.listeners.add(listener);
    return () => e.listeners.delete(listener);
  }

  /** Remember how to (re)load a key so invalidation can refresh it. */
  register<T>(key: QueryKey, fetcher: Fetcher<T>): void {
    this.entry<T>(key).fetcher = fetcher;
  }

  isStale(key: QueryKey, maxAgeMs: number): boolean {
    const e = this.entries.get(hashKey(key));
    if (!e) return true;
    return e.stale || this.now() - e.state.updatedAt > maxAgeMs;
  }

  /** Loads a key; concurrent callers share one request. Keeps the last good data on failure. */
  fetch<T>(key: QueryKey, fetcher?: Fetcher<T>): Promise<T> {
    const e = this.entry<T>(key);
    if (fetcher) e.fetcher = fetcher;
    if (e.promise) return e.promise;
    const f = e.fetcher;
    if (!f) return Promise.reject(new Error(`No fetcher registered for ${hashKey(key)}`));
    const controller = new AbortController();
    e.controller = controller;
    this.set(e, { fetching: true, status: e.state.status === 'success' ? 'success' : 'loading' });
    const p = f(controller.signal).then(
      (data) => {
        e.promise = null;
        e.controller = null;
        e.stale = false;
        this.set(e, { data, error: null, status: 'success', fetching: false, updatedAt: this.now(), failedAt: 0 });
        return data;
      },
      (error: unknown) => {
        e.promise = null;
        e.controller = null;
        this.set(e, { error, status: e.state.data === undefined ? 'error' : 'success', fetching: false, failedAt: this.now() });
        this.reportError(error);
        throw error;
      },
    );
    e.promise = p;
    return p;
  }

  /** Marks matching keys stale and refreshes the ones on screen. */
  invalidate(prefix: QueryKey = []): void {
    for (const e of this.entries.values()) {
      if (!startsWith(e.key, prefix)) continue;
      e.stale = true;
      if (e.listeners.size > 0 && e.fetcher) this.fetch(e.key).catch(() => undefined);
    }
  }

  /** Write server data received another way (e.g. a mutation response or a live frame). */
  setData<T>(key: QueryKey, updater: T | ((prev: T | undefined) => T)): void {
    const e = this.entry<T>(key);
    const data = typeof updater === 'function' ? (updater as (p: T | undefined) => T)(e.state.data) : updater;
    this.set(e, { data, status: 'success', error: null, updatedAt: this.now(), failedAt: 0 });
  }

  /** Global error hook (e.g. the session provider signs out on 401). */
  onError(listener: (err: unknown) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  reportError(err: unknown): void {
    for (const l of [...this.errorListeners]) l(err);
  }

  /** Drop everything (logout). In-flight requests are aborted. */
  clear(): void {
    for (const e of this.entries.values()) e.controller?.abort();
    this.entries.clear();
  }
}
