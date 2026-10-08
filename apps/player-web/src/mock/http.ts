/**
 * MOCK REST endpoints (docs/API.md) served from an in-browser `fetch`
 * replacement, so the app's typed API client runs unchanged in mock mode.
 */
import type {
  ApiErrorBody,
  JoinInfoDto,
  PlayerMeDto,
  RegisterRequest,
  RegisterResponse,
  RejoinRequest,
  RejoinResponse,
  TournamentFairnessDto,
} from '@jpb/shared-types';
import {
  MOCK_CURRENCY,
  MOCK_FIELD_SIZE,
  MOCK_SEED_HASH,
  MOCK_STARTING_STACK,
  MOCK_TOURNAMENT_ID,
  MOCK_TOURNAMENT_NAME,
  PRIZE_PLACES,
  REGISTRATION_FIELDS,
} from './data';
import { code, hashSeed, hex, seededRng } from './rng';
import type { MockScenario } from './scenario';
import type { MockIdentity, MockServer } from './server';

export const MOCK_JOIN_CODE = 'SPRING26';
export const MOCK_ACCESS_CODE = 'SPADES';

export interface MockState {
  scenario: MockScenario;
  identity(): MockIdentity | null;
  setIdentity(identity: MockIdentity | null): void;
  server(): MockServer;
  /** Rejoin codes issued in this page session (memory only). */
  issuedCodes: Map<string, string>;
  bootedAt: number;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: unknown = null,
  ) {
    super(message);
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export function mockJoinInfo(state: MockState, joinCode: string): JoinInfoDto {
  const v = state.scenario.join;
  const open = v !== 'closed';
  return {
    tournamentId: MOCK_TOURNAMENT_ID,
    name: MOCK_TOURNAMENT_NAME,
    joinCode,
    status: open ? 'REGISTRATION' : 'REGISTRATION_CLOSED',
    startTime: state.bootedAt + 25 * 60_000,
    serverSeedHash: MOCK_SEED_HASH,
    registration: {
      open,
      fields: REGISTRATION_FIELDS,
      requiresAccessCode: v === 'access',
      requiresApproval: v === 'approval',
      deadline: state.bootedAt + 20 * 60_000,
      lateRegistration: { enabled: true, untilLevel: 4 },
    },
    limits: { minPlayers: 2, maxPlayers: MOCK_FIELD_SIZE },
    startingStack: MOCK_STARTING_STACK,
    counters: { registered: open ? 1_846 : 2_000, active: 0, eliminated: 0, inTransit: 0, tables: 0, handsCompleted: 0, totalChips: 0, largestPot: 0 },
    spectators: { publicWatch: true },
    prizes: { currency: MOCK_CURRENCY, places: [...PRIZE_PLACES], notes: 'Trophy for the champion · Final-table goodie bags' },
  };
}

function register(state: MockState, joinCode: string, body: RegisterRequest): RegisterResponse {
  const info = mockJoinInfo(state, joinCode);
  if (!info.registration.open) throw new HttpError(409, 'REGISTRATION_CLOSED', 'Registration for this tournament is closed.');
  if (info.registration.requiresAccessCode && (body.accessCode ?? '').trim().toUpperCase() !== MOCK_ACCESS_CODE) {
    throw new HttpError(403, 'ACCESS_CODE_INVALID', 'That access code is not right. Ask the organiser for the venue code.');
  }
  const missing = info.registration.fields.filter((f) => f.required && !(body.fields[f.key] ?? '').trim());
  if (missing.length > 0) {
    throw new HttpError(400, 'VALIDATION_FAILED', 'Please fill in the required fields.', { fields: Object.fromEntries(missing.map((f) => [f.key, 'Required'])) });
  }
  if ((body.fields.participantId ?? '').trim() === '0000') {
    throw new HttpError(409, 'ALREADY_REGISTERED', 'This ticket number is already registered. Use “Rejoin” with your code instead.');
  }
  if (!body.clientSeed || !/^[0-9a-f]{64}$/.test(body.clientSeed)) throw new HttpError(400, 'VALIDATION_FAILED', 'Something went wrong. Please try again.');
  const rng = seededRng(hashSeed(`${body.fields.name}:${body.clientSeed}`));
  const publicId = `JPN-${code(rng, 4)}`;
  const rejoinCode = `${code(rng, 4)}-${code(rng, 4)}`;
  const displayName = (body.fields.nickname ?? '').trim() || (body.fields.name ?? 'Player').trim();
  const status = info.registration.requiresApproval ? 'PENDING_APPROVAL' : 'REGISTERED';
  state.issuedCodes.set(publicId, rejoinCode);
  state.setIdentity({ playerId: 'ply_hero', publicId, displayName, status });
  return { player: { playerId: 'ply_hero', publicId, displayName, status }, tournamentId: MOCK_TOURNAMENT_ID, rejoinCode, csrfToken: hex(rng, 32) };
}

function rejoin(state: MockState, body: RejoinRequest): RejoinResponse {
  const publicId = body.publicId.trim().toUpperCase();
  const rejoinCode = body.rejoinCode.trim().toUpperCase();
  const issued = state.issuedCodes.get(publicId);
  const wellFormed = /^JPN-[0-9A-Z]{4}$/.test(publicId) && /^[0-9A-Z]{4}-?[0-9A-Z]{4}$/.test(rejoinCode);
  if (!wellFormed || (issued !== undefined && issued.replace('-', '') !== rejoinCode.replace('-', ''))) {
    throw new HttpError(401, 'REJOIN_INVALID', 'That player ID and rejoin code do not match.');
  }
  const current = state.identity();
  const displayName = current?.publicId === publicId ? current.displayName : 'Johnny Kowalski';
  state.setIdentity({ playerId: 'ply_hero', publicId, displayName, status: 'SEATED' });
  return { player: { playerId: 'ply_hero', publicId, displayName }, tournamentId: MOCK_TOURNAMENT_ID, csrfToken: hex(seededRng(1), 32) };
}

function me(state: MockState): PlayerMeDto {
  if (state.scenario.id === 'expired') throw new HttpError(401, 'UNAUTHORIZED', 'Your session has expired.');
  const server = state.server();
  return { ...server.self, tournamentId: MOCK_TOURNAMENT_ID, joinCode: MOCK_JOIN_CODE, tournamentName: MOCK_TOURNAMENT_NAME };
}

function fairness(state: MockState): TournamentFairnessDto {
  const revealed = state.server().summary.status === 'COMPLETED';
  return {
    tournamentId: MOCK_TOURNAMENT_ID,
    serverSeedHash: MOCK_SEED_HASH,
    serverSeed: revealed ? hex(seededRng(hashSeed('server-seed-plain')), 64) : null,
    seedRevealed: revealed,
    publicEntropy: hex(seededRng(hashSeed('entropy')), 64),
    entropyInputs: { clientSeedCount: 1_846, adminEntropy: null },
    method: 'HMAC-SHA256-STREAM+FISHER-YATES',
    documentationUrl: '/docs/FAIRNESS.md',
  };
}

type Handler = (state: MockState, params: string[], query: URLSearchParams, body: unknown) => unknown;

const ROUTES: Array<{ method: string; pattern: RegExp; handler: Handler }> = [
  { method: 'GET', pattern: /^\/api\/public\/tournaments\/([^/]+)$/, handler: (s, [c]) => mockJoinInfo(s, decodeURIComponent(c ?? '').toUpperCase()) },
  { method: 'POST', pattern: /^\/api\/public\/tournaments\/([^/]+)\/register$/, handler: (s, [c], _q, b) => register(s, c ?? '', b as RegisterRequest) },
  { method: 'POST', pattern: /^\/api\/public\/tournaments\/([^/]+)\/rejoin$/, handler: (s, _p, _q, b) => rejoin(s, b as RejoinRequest) },
  { method: 'GET', pattern: /^\/api\/public\/tournaments\/([^/]+)\/summary$/, handler: (s) => s.server().summary },
  {
    method: 'GET',
    pattern: /^\/api\/public\/tournaments\/([^/]+)\/leaderboard$/,
    handler: (s, _p, q) => s.server().leaderboard(q.get('mode') === 'finish' ? 'finish' : 'stack', Number(q.get('offset') ?? 0), Math.min(100, Number(q.get('limit') ?? 25))),
  },
  { method: 'GET', pattern: /^\/api\/public\/tournaments\/([^/]+)\/fairness$/, handler: (s) => fairness(s) },
  { method: 'GET', pattern: /^\/api\/player\/me$/, handler: (s) => me(s) },
  { method: 'GET', pattern: /^\/api\/player\/history$/, handler: (s) => s.server().history() },
  {
    method: 'POST',
    pattern: /^\/api\/player\/logout$/,
    handler: (s) => {
      s.setIdentity(null);
      return { ok: true };
    },
  },
];

export function createMockFetch(state: MockState, latencyMs = 180): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://mock.local');
    const method = (init?.method ?? 'GET').toUpperCase();
    await new Promise((r) => setTimeout(r, latencyMs));
    const route = ROUTES.find((r) => r.method === method && r.pattern.test(url.pathname));
    if (!route) return json(404, { error: { code: 'NOT_FOUND', message: 'Not found.', details: null } } satisfies ApiErrorBody);
    try {
      const params = (url.pathname.match(route.pattern) ?? []).slice(1);
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
      return json(method === 'POST' && route.pattern.source.includes('register') ? 201 : 200, route.handler(state, params, url.searchParams, body));
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { error: { code: e.code, message: e.message, details: e.details } } satisfies ApiErrorBody);
      return json(500, { error: { code: 'INTERNAL', message: 'Something went wrong on our side.', details: null } } satisfies ApiErrorBody);
    }
  };
}
