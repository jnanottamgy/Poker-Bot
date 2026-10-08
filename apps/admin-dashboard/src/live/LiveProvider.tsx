import { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { JpbClient } from '@jpb/client-sdk';
import { useClientLifecycle, useGameState } from '@jpb/client-sdk/react';
import type { GameState } from '@jpb/client-sdk';
import { useBackend, useQueryClient } from '../api/ApiProvider';
import { liveInvalidations } from './invalidation';

const LiveContext = createContext<JpbClient | null>(null);

const INVALIDATE_THROTTLE_MS = 2_000;

/**
 * One admin WebSocket (JpbClient, audience ADMIN) per open tournament. The
 * client store mirrors server frames only; the latest frame always wins.
 * Tournament events also refresh the REST queries they affect (throttled),
 * so screens built on `useQuery` stay current without polling hard.
 */
export function LiveProvider({ tournamentId, children }: { tournamentId: string; children: ReactNode }) {
  const backend = useBackend();
  const client = useMemo(
    () => new JpbClient({ url: backend.wsUrl, audience: 'ADMIN', tournamentId, ...(backend.socketFactory ? { socketFactory: backend.socketFactory } : {}) }),
    [backend, tournamentId],
  );
  useClientLifecycle(client);
  useLiveInvalidation(client, tournamentId);
  return <LiveContext.Provider value={client}>{children}</LiveContext.Provider>;
}

function useLiveInvalidation(client: JpbClient, tournamentId: string): void {
  const queryClient = useQueryClient();
  const seen = useRef(0);
  useEffect(() => {
    const pending = new Map<string, readonly unknown[]>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      for (const k of pending.values()) queryClient.invalidate(k);
      pending.clear();
    };
    const unsub = client.store.subscribe(() => {
      const { tournamentEvents, lastTournamentSeq } = client.store.getState();
      if (lastTournamentSeq <= seen.current) return;
      for (const env of tournamentEvents) {
        if (env.seq <= seen.current) continue;
        for (const key of liveInvalidations(env.event, tournamentId)) pending.set(JSON.stringify(key), key);
      }
      seen.current = lastTournamentSeq;
      if (pending.size && !timer) timer = setTimeout(flush, INVALIDATE_THROTTLE_MS);
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, [client, queryClient, tournamentId]);
}

export function useLiveClient(): JpbClient {
  const c = useContext(LiveContext);
  if (!c) throw new Error('LiveProvider is missing (live data is only available inside a tournament route)');
  return c;
}

/** Subscribe to a slice of the live store. */
export function useLive<T>(selector: (s: GameState) => T): T {
  return useGameState(useLiveClient(), selector);
}

/** Nullable variant for components that also render outside a tournament (top bar). */
export function useOptionalLiveClient(): JpbClient | null {
  return useContext(LiveContext);
}
