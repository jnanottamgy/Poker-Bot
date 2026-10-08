import { useCallback, useEffect, useRef, useState } from 'react';
import { friendlyError } from '../api/errors';
import type { FriendlyError } from '../api/errors';

export interface AsyncState<T> {
  data: T | null;
  error: FriendlyError | null;
  loading: boolean;
  reload: () => void;
}

/** Runs `fn` when `deps` change (aborting the previous run); errors become friendly copy. */
export function useAsync<T>(fn: (signal: AbortSignal) => Promise<T>, deps: readonly unknown[]): AsyncState<T> {
  const [state, setState] = useState<{ data: T | null; error: FriendlyError | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    fnRef.current(ctrl.signal).then(
      (data) => {
        if (!ctrl.signal.aborted) setState({ data, error: null, loading: false });
      },
      (e: unknown) => {
        if (!ctrl.signal.aborted) setState((s) => ({ data: s.data, error: friendlyError(e), loading: false }));
      },
    );
    return () => ctrl.abort();
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}
