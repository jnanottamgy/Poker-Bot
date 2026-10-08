/**
 * Mock backend entry (loaded only when VITE_MOCK=1, via dynamic import, so
 * production bundles never contain it).
 */
import type { SocketFactory } from '@jpb/client-sdk';
import { createMockFetch, MOCK_JOIN_CODE } from './http';
import type { MockState } from './http';
import { parseScenario } from './scenario';
import type { MockScenario } from './scenario';
import { MockServer } from './server';
import type { MockIdentity } from './server';
import { MockSocket } from './socket';

export { MOCK_JOIN_CODE, MOCK_ACCESS_CODE } from './http';
export type { MockScenario } from './scenario';

export interface MockBackend {
  scenario: MockScenario;
  fetchImpl: typeof fetch;
  socketFactory: SocketFactory;
  joinCode: string;
}

const IDENTITY_KEY = 'jpb.mock.identity';
const DEMO: MockIdentity = { playerId: 'ply_hero', publicId: 'JPN-7A42', displayName: 'Johnny Kowalski', status: 'SEATED' };

function loadIdentity(): MockIdentity | null {
  try {
    const raw = sessionStorage.getItem(IDENTITY_KEY);
    return raw ? (JSON.parse(raw) as MockIdentity) : null;
  } catch {
    return null;
  }
}

function saveIdentity(identity: MockIdentity | null): void {
  try {
    if (identity) sessionStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
    else sessionStorage.removeItem(IDENTITY_KEY);
  } catch {
    /* storage unavailable: the mock session lives in memory only */
  }
}

export function createMockBackend(search: string = globalThis.location?.search ?? ''): MockBackend {
  const scenario = parseScenario(search);
  let identity: MockIdentity | null = loadIdentity();
  let server: MockServer | null = null;
  const state: MockState = {
    scenario,
    issuedCodes: new Map(),
    bootedAt: Date.now(),
    identity: () => identity,
    setIdentity: (next) => {
      identity = next;
      saveIdentity(next);
      server?.dispose();
      server = null;
    },
    server: () => {
      if (!server) server = new MockServer(scenario, identity ?? DEMO);
      return server;
    },
  };
  return {
    scenario,
    joinCode: MOCK_JOIN_CODE,
    fetchImpl: createMockFetch(state),
    socketFactory: (url) => new MockSocket(url, state.server),
  };
}
