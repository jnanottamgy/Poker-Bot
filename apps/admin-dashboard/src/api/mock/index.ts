import { createAdminApi } from '../client';
import type { Backend } from '../backend';
import { createMockFetch } from './http';
import type { MockFetchOptions } from './http';
import { MockServer } from './server';
import { MockSocketHub } from './socket';
import { MOCK_PASSWORD } from './world';

export { MockServer } from './server';
export { MOCK_PASSWORD } from './world';

export interface MockBackendOptions {
  /** Simulated network latency (default 60–220 ms in the browser; pass [0, 0] in tests). */
  latencyMs?: MockFetchOptions['latencyMs'];
  /** Run the scripted live simulation every `tickMs` (default 1200; 0 = manual `server.tick()`). */
  tickMs?: number;
  /** Server clock (default Date.now). */
  now?: () => number;
  /** Keep the signed-in mock admin across page reloads (sessionStorage). Default true in the browser. */
  persistSession?: boolean;
  /** Sign in as this mock username immediately (tests, screenshots). */
  signedInAs?: string;
}

export interface MockBackend {
  backend: Backend;
  server: MockServer;
  hub: MockSocketHub;
  stop: () => void;
}

const STORAGE_KEY = 'jpb.mock.admin';

function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function signIn(server: MockServer, username: string): void {
  const admin = server.world.admins.find((a) => a.username === username && !a.disabled);
  if (!admin) return;
  const now = server.now();
  const id = server.nextId('ses');
  server.world.sessions.push({ id, adminId: admin.id, createdAt: now, lastSeenAt: now, expiresAt: now + 12 * 3600_000, ip: '127.0.0.1', userAgent: null, revokedAt: null });
  server.world.currentSessionId = id;
}

/**
 * Deterministic in-browser backend: the same typed REST client over a mock
 * `fetch`, and JpbClient over mock sockets. 11 tournaments (the main one has
 * 2,000 players on 136 tables), ~19k hands, audit chain, alerts, payouts,
 * admin users and demos; admin actions mutate the state and stream events.
 */
export function createMockBackend(opts: MockBackendOptions = {}): MockBackend {
  const server = new MockServer(opts.now);
  const persist = opts.persistSession ?? true;
  const store = persist ? storage() : null;
  const remembered = opts.signedInAs ?? (() => {
    try {
      return store?.getItem(STORAGE_KEY) ?? null;
    } catch {
      return null;
    }
  })();
  if (remembered) signIn(server, remembered);

  const inner = createMockFetch(server, { latencyMs: opts.latencyMs ?? [60, 220] });
  const fetchImpl: typeof fetch = async (input, init) => {
    const res = await inner(input, init);
    try {
      const who = server.currentAdmin()?.username;
      if (store) {
        if (who) store.setItem(STORAGE_KEY, who);
        else store.removeItem(STORAGE_KEY);
      }
    } catch {
      /* storage unavailable: the session simply does not survive a reload */
    }
    return res;
  };

  const hub = new MockSocketHub(server);
  const tickMs = opts.tickMs ?? 1200;
  const timer = tickMs > 0 ? setInterval(() => server.tick(), tickMs) : null;

  return {
    server,
    hub,
    stop: () => {
      if (timer) clearInterval(timer);
    },
    backend: {
      kind: 'mock',
      api: createAdminApi({ fetchImpl }),
      wsUrl: 'ws://mock.local/ws',
      socketFactory: hub.factory,
      demoAccounts: [
        { username: 'director', password: MOCK_PASSWORD, role: 'Tournament director' },
        { username: 'super', password: MOCK_PASSWORD, role: 'Super admin' },
        { username: 'staff', password: MOCK_PASSWORD, role: 'Staff' },
        { username: 'viewer', password: MOCK_PASSWORD, role: 'Viewer (read-only)' },
        { username: 'campus.td', password: MOCK_PASSWORD, role: 'Director, scoped to Campus Cup' },
        { username: 'locked.user', password: MOCK_PASSWORD, role: 'Locked account (lockout demo)' },
      ],
    },
  };
}
