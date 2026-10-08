import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { AdminMeDto } from '@jpb/shared-types';
import { useApi, useQueryClient } from '../api/ApiProvider';
import { isUnauthorized } from '../api/errors';

export type SessionStatus = 'loading' | 'signedOut' | 'signedIn' | 'unavailable';

export interface SessionValue {
  status: SessionStatus;
  me: AdminMeDto | null;
  /** Why the operator is on the login page (e.g. "Your session ended"). */
  notice: string | null;
  /** Throws the API error (the login page turns it into friendly copy). */
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Re-run the bootstrap (after "server unavailable"). */
  retry: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

/**
 * Session bootstrap via GET /api/admin/auth/me. The cookie is HttpOnly, so
 * the server is the only source of truth: a 401 anywhere (query or mutation)
 * returns the operator to the login page with a friendly notice.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [me, setMe] = useState<AdminMeDto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    api.auth
      .me()
      .then((m) => {
        if (cancelled) return;
        setMe(m);
        setStatus('signedIn');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setMe(null);
        setStatus(isUnauthorized(err) ? 'signedOut' : 'unavailable');
      });
    return () => {
      cancelled = true;
    };
  }, [api, attempt]);

  useEffect(
    () =>
      queryClient.onError((err) => {
        if (!isUnauthorized(err)) return;
        queryClient.clear();
        setMe(null);
        setNotice('Your session ended. Please sign in again.');
        setStatus('signedOut');
      }),
    [queryClient],
  );

  const login = useCallback(
    async (username: string, password: string) => {
      await api.auth.login({ username, password });
      const m = await api.auth.me();
      queryClient.clear();
      setMe(m);
      setNotice(null);
      setStatus('signedIn');
    },
    [api, queryClient],
  );

  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
    } catch {
      /* the session is gone either way */
    }
    queryClient.clear();
    setMe(null);
    setNotice('You signed out.');
    setStatus('signedOut');
  }, [api, queryClient]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const value = useMemo(() => ({ status, me, notice, login, logout, retry }), [status, me, notice, login, logout, retry]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('SessionProvider is missing');
  return ctx;
}

/** The signed-in admin (only call below <RequireAuth>). */
export function useMe(): AdminMeDto {
  const { me } = useSession();
  if (!me) throw new Error('useMe() used outside an authenticated route');
  return me;
}
