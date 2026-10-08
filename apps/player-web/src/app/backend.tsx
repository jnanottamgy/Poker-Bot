import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { SocketFactory } from '@jpb/client-sdk';
import type { PlayerApi } from '../api/client';

/**
 * Everything that talks to the outside world. The live backend uses the
 * browser fetch + WebSocket; mock mode (VITE_MOCK=1) injects an in-browser
 * fetch and socket factory behind the very same interfaces.
 */
export interface Backend {
  mode: 'live' | 'mock';
  api: PlayerApi;
  wsUrl: string;
  socketFactory?: SocketFactory;
  /** Mock mode only: the demo join code and the active scenario name. */
  demo?: { joinCode: string; scenario: string };
}

const BackendContext = createContext<Backend | null>(null);

export function BackendProvider({ backend, children }: { backend: Backend; children: ReactNode }) {
  return <BackendContext.Provider value={backend}>{children}</BackendContext.Provider>;
}

export function useBackend(): Backend {
  const b = useContext(BackendContext);
  if (!b) throw new Error('BackendProvider missing');
  return b;
}
