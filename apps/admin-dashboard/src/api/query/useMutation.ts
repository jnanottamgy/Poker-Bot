import { useCallback, useRef, useState } from 'react';
import { useToast } from '@jpb/ui';
import { useQueryClient } from '../ApiProvider';
import { friendlyError } from '../errors';
import type { QueryKey } from './QueryClient';

export interface UseMutationOptions<V, R> {
  /** Keys (prefixes) to refresh after success — the server view is re-read, never patched locally. */
  invalidate?: QueryKey[] | ((result: R, vars: V) => QueryKey[]);
  /** Success toast title. */
  success?: string | ((result: R, vars: V) => string);
  /** Show a friendly danger toast on failure (default true). Dialogs that show the error inline pass false. */
  errorToast?: boolean;
  onSuccess?: (result: R, vars: V) => void;
}

export interface UseMutationResult<V, R> {
  /** Resolves with the result; rejects with the original error (for dialogs). */
  mutateAsync: (vars: V) => Promise<R>;
  /** Fire-and-forget variant: errors are toasted, never thrown. */
  mutate: (vars: V) => void;
  pending: boolean;
  error: unknown;
  reset: () => void;
}

/**
 * Mutation helper: pending flag ("Submitting…" — never optimistic), friendly
 * error toast, success toast and query invalidation.
 */
export function useMutation<V, R>(fn: (vars: V) => Promise<R>, opts: UseMutationOptions<V, R> = {}): UseMutationResult<V, R> {
  const client = useQueryClient();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const mutateAsync = useCallback(
    async (vars: V): Promise<R> => {
      const o = optsRef.current;
      setPending(true);
      setError(null);
      try {
        const result = await fnRef.current(vars);
        const keys = typeof o.invalidate === 'function' ? o.invalidate(result, vars) : (o.invalidate ?? []);
        for (const k of keys) client.invalidate(k);
        if (o.success) toast.push({ tone: 'success', title: typeof o.success === 'function' ? o.success(result, vars) : o.success });
        o.onSuccess?.(result, vars);
        return result;
      } catch (err) {
        setError(err);
        client.reportError(err);
        if (o.errorToast !== false) {
          const f = friendlyError(err);
          toast.push({ tone: 'danger', title: f.title, description: f.description });
        }
        throw err;
      } finally {
        setPending(false);
      }
    },
    [client, toast],
  );

  const mutate = useCallback((vars: V) => void mutateAsync(vars).catch(() => undefined), [mutateAsync]);
  const reset = useCallback(() => setError(null), []);
  return { mutateAsync, mutate, pending, error, reset };
}
