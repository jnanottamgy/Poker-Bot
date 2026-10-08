import { useEffect, useSyncExternalStore } from 'react';
import type { JpbClient } from './client';
import type { GameState } from './store';

/** Subscribe a component to a slice of the server-state store. */
export function useGameState<T>(client: JpbClient, selector: (s: GameState) => T): T {
  return useSyncExternalStore(client.store.subscribe, () => selector(client.store.getState()), () => selector(client.store.getState()));
}

/** Connects on mount, reconnects immediately when the browser comes back online or the tab becomes visible. */
export function useClientLifecycle(client: JpbClient): void {
  useEffect(() => {
    client.connect();
    const nudge = () => client.nudge();
    const onVisible = () => {
      if (document.visibilityState === 'visible') client.nudge();
    };
    window.addEventListener('online', nudge);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', nudge);
      document.removeEventListener('visibilitychange', onVisible);
      client.close();
    };
  }, [client]);
}
