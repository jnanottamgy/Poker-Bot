import type { SocketFactory } from '@jpb/client-sdk';
import { websocketUrl } from '@jpb/client-sdk';
import { createAdminApi } from './client';
import type { AdminApi } from './client';

/**
 * Everything that differs between the real server and the in-browser mock.
 * Both implement the same interfaces: a `fetch` for the typed REST client and
 * a `SocketFactory` for JpbClient — the app above this line cannot tell them apart.
 */
export interface Backend {
  kind: 'real' | 'mock';
  api: AdminApi;
  /** WebSocket URL for JpbClient (auth rides on the session cookie). */
  wsUrl: string;
  /** Undefined = the browser WebSocket. */
  socketFactory?: SocketFactory;
  /** Mock only: sign-in hints shown on the login page. */
  demoAccounts?: Array<{ username: string; password: string; role: string }>;
}

export function createRealBackend(): Backend {
  return { kind: 'real', api: createAdminApi(), wsUrl: websocketUrl('/ws') };
}
