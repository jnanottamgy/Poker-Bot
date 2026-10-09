import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiError } from '@jpb/client-sdk';
import type { TournamentConfig, TournamentListItemDto } from '@jpb/shared-types';
import { createAdminApi } from '../../apps/admin-dashboard/src/api/client';
import type { AdminApi } from '../../apps/admin-dashboard/src/api/client';
import { ENDPOINTS } from '../../apps/admin-dashboard/src/api/endpoints';
import type { EndpointKey } from '../../apps/admin-dashboard/src/api/endpoints';
import type { RebalanceResponse, ReentryResponse, RevokeSessionsResponse, StartResponse } from '../../apps/admin-dashboard/src/api/types';
import { loadEnv } from '../../services/game-server/src/config/env';
import { buildServer } from '../../services/game-server/src/server';
import type { JpbServer } from '../../services/game-server/src/server';
import { createTestDatabase, TEST_DATABASE_URL } from '../../services/game-server/test/helpers/db';
import { Http } from '../../services/game-server/test/helpers/client';
import { fastConfig } from '../../services/game-server/test/helpers/game';
import { PassiveBot } from './admin-api-bots';
import * as S from './admin-api-shapes';
import type { Spec } from './admin-api-shapes';

/**
 * Contract between the admin control room and the real game server: the admin
 * app's own typed client (apps/admin-dashboard/src/api/client.ts — the code
 * the UI runs, previously only exercised against the in-browser mock) calls
 * every endpoint of its registry against a real server, and every response
 * is checked field by field against the client's types.
 *
 * Also proves (without a database) that the registry and docs/API.md list
 * exactly the same endpoints with the same permissions.
 */

const ORIGIN = 'http://127.0.0.1';
const ADMIN = { username: 'contract-admin', password: 'contract admin password 123' };
const REASON = 'admin api contract test';

const START: Spec<StartResponse> = { ok: 'boolean', publicEntropy: 'string' };
const REBALANCE: Spec<RebalanceResponse> = { ok: 'boolean', movesPlanned: 'number' };
const REVOKED: Spec<RevokeSessionsResponse> = { ok: 'boolean', revoked: 'number' };
const REENTERED: Spec<ReentryResponse> = { ok: 'boolean', entryId: 'string', entryNumber: 'number' };

// ------------------------------------------------------------------ registry ↔ docs/API.md

/** Expands the doc's abbreviations: "`/close`" after "`…/registration/open`", "`.csv`", "`/fairness/bundle`" after "`…/fairness`". */
function expandPath(prev: string | null, token: string): string {
  if (token.startsWith('/api/')) return token;
  if (!prev) throw new Error(`Relative path ${token} has no base path in its row`);
  if (token.startsWith('.')) return prev + token;
  const segs = token.slice(1).split('/');
  const base = prev.split('/');
  if (segs[0] === base[base.length - 1]) return [...base, ...segs.slice(1)].join('/');
  return [...base.slice(0, base.length - segs.length), ...segs].join('/');
}

/** "METHOD path" → permission (null for public and auth endpoints) of the Public and Admin sections of docs/API.md. */
function documentedEndpoints(md: string): Map<string, string | null> {
  const out = new Map<string, string | null>();
  const section = (from: string, to: string) => md.slice(md.indexOf(from), md.indexOf(to));
  for (const [text, isPublic] of [
    [section('## Public', '## Player'), true],
    [section('## Admin', '## WebSocket'), false],
  ] as const) {
    for (const line of text.split('\n')) {
      for (const m of line.matchAll(/`(GET|POST|PUT|PATCH|DELETE) (\/api\/[^`\s]+)`/g)) out.set(`${m[1]} ${m[2]}`, null);
      if (!line.startsWith('| ') || line.startsWith('| Method') || line.startsWith('| ---')) continue;
      const cells = line.split(/(?<!\\)\|/).map((c) => c.trim());
      const methods = cells[1]!.split('/');
      const permission = isPublic ? null : cells[3]!;
      let prev: string | null = null;
      for (const m of cells[2]!.matchAll(/(?:\b(GET|POST|PUT|PATCH|DELETE) )?`([^`]+)`/g)) {
        const token = m[2]!;
        if (!token.startsWith('/') && !token.startsWith('.')) continue;
        prev = expandPath(prev, token.split('?')[0]!);
        for (const method of m[1] ? [m[1]] : methods) out.set(`${method} ${prev}`, permission);
      }
    }
  }
  return out;
}

describe('admin API registry ↔ docs/API.md', () => {
  it('lists exactly the documented Public and Admin endpoints with the documented permissions', () => {
    const doc = documentedEndpoints(readFileSync(new URL('../../docs/API.md', import.meta.url), 'utf8'));
    const registry = new Map(Object.values(ENDPOINTS).map((e) => [`${e.method} ${e.path}`, e.permission as string | null]));
    expect([...registry.keys()].filter((k) => !doc.has(k)), 'in the registry but not in docs/API.md').toEqual([]);
    expect([...doc.keys()].filter((k) => !registry.has(k)), 'in docs/API.md but not in the registry').toEqual([]);
    const wrong = [...doc].filter(([k, p]) => p !== null && registry.get(k) !== p).map(([k, p]) => `${k}: doc ${p}, registry ${registry.get(k)}`);
    expect(wrong, 'permission differs').toEqual([]);
  });
});

// ------------------------------------------------------------------ against the real server

const ROUTES = (Object.keys(ENDPOINTS) as EndpointKey[]).map((key) => {
  const def = ENDPOINTS[key];
  const pattern = def.path
    .split('/')
    .map((seg) => (seg.startsWith(':') ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return { key, method: def.method as string, regex: new RegExp(`^${pattern}$`) };
});

/** Registry endpoints that answered 2xx at least once during the run. */
const succeeded = new Set<EndpointKey>();

function record(method: string, url: string): void {
  const path = new URL(url).pathname;
  for (const r of ROUTES) if (r.method === method && r.regex.test(path)) succeeded.add(r.key);
}

/** What a browser does for the admin app: same-origin cookies, Origin header, and the CSRF header from the `jpb_csrf` cookie. */
function browserFetch(http: Http): typeof fetch {
  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = new Headers(init.headers);
    headers.set('origin', http.origin);
    const cookie = http.jar.header();
    if (cookie) headers.set('cookie', cookie);
    const csrf = http.jar.get('jpb_csrf');
    if (csrf && method !== 'GET') headers.set('x-csrf-token', csrf);
    const res = await fetch(url, { ...init, headers });
    http.jar.absorb(res);
    if (res.ok) record(method, url);
    return res;
  }) as typeof fetch;
}

interface Client {
  http: Http;
  api: AdminApi;
  fetch: typeof fetch;
}

async function apiError(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    return err as ApiError;
  }
  throw new Error('Expected the call to be refused');
}

async function waitFor(what: string, check: () => Promise<boolean>, timeoutMs = 60_000, everyMs = 100): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

describe.skipIf(!TEST_DATABASE_URL)('admin app client ↔ real game server', () => {
  let server: JpbServer;
  let base: string;
  let wsUrl: string;
  let admin: Client;
  const bots: PassiveBot[] = [];

  const client = (): Client => {
    const http = new Http(base, ORIGIN);
    const f = browserFetch(http);
    return { http, fetch: f, api: createAdminApi({ fetchImpl: f, baseUrl: base }) };
  };

  /** GET a CSV/SVG link exactly as the UI builds it, returning its content type and body. */
  const download = async (c: Client, url: string) => {
    const res = await c.fetch(url, { method: 'GET', credentials: 'same-origin' });
    expect(res.status, url).toBe(200);
    return { type: res.headers.get('content-type') ?? '', body: await res.text() };
  };

  // tournaments of the run
  let main: TournamentListItemDto;
  let approval: TournamentListItemDto;
  let demoId: string;
  let victimId: string;

  beforeAll(async () => {
    const db = await createTestDatabase('admin_api_contract');
    const env = loadEnv({
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: '0',
      PUBLIC_BASE_URL: ORIGIN,
      COOKIE_SECURE: 'false',
      SEED_ENCRYPTION_KEY: 'c'.repeat(64),
      BOOTSTRAP_ADMIN_USERNAME: ADMIN.username,
      BOOTSTRAP_ADMIN_PASSWORD: ADMIN.password,
      RATE_LIMIT_SCALE: '100',
      NODE_ID: 'contract-node',
    });
    server = await buildServer(env, { db, monitorEveryMs: 1000, logger: { level: 'error' } });
    base = await server.listen();
    wsUrl = `${base.replace('http', 'ws')}/ws`;
    const close = server.close.bind(server);
    server.close = async () => {
      await close();
      await db.close();
    };
    admin = client();
  });

  afterAll(async () => {
    for (const b of bots) b.close();
    await server?.close();
  });

  it('serves every endpoint of the admin registry', () => {
    const missing = Object.values(ENDPOINTS).filter((e) => !server.app.hasRoute({ method: e.method, url: e.path }));
    expect(missing.map((e) => `${e.method} ${e.path}`)).toEqual([]);
  });

  it('auth: login, me, and the documented error bodies', async () => {
    const anonymous = client();
    const unauth = await apiError(anonymous.api.auth.me());
    expect([unauth.status, unauth.code]).toEqual([401, 'UNAUTHORIZED']);
    const bad = await apiError(anonymous.api.auth.login({ username: ADMIN.username, password: 'wrong password!!' }));
    expect([bad.status, bad.code]).toEqual([401, 'INVALID_CREDENTIALS']);

    const login = S.check('login', await admin.api.auth.login(ADMIN), S.LOGIN);
    expect(login.permissions).toContain('ADMIN_USERS_MANAGE');
    expect(admin.http.jar.get('jpb_csrf')).toBe(login.csrfToken);
    const me = S.check('me', await admin.api.auth.me(), S.ME);
    S.check('me.admin', me.admin, S.ME_ADMIN);
    expect(me.admin.username).toBe(ADMIN.username);
  });

  it('tournaments: create, list, overview, edit config, clone, delete, demo', async () => {
    // The demo runs to completion in the background while the rest of the contract is checked.
    const demo = S.check('demo.create', await admin.api.demo.create({ players: 6, strategyMix: { ALL_IN_RANDOMLY: 2, RAISE_HEAVY: 1 }, speedMode: true, name: 'Contract demo' }), S.DEMO);
    demoId = demo.tournamentId;
    S.check('demo.status', await admin.api.demo.status(demoId), S.DEMO);

    const mainConfig: TournamentConfig = fastConfig(12, {
      name: 'Contract Main',
      joinCode: 'CONTRACTA',
      tables: { targetSize: 4, maxSize: 9, minSize: 2, finalTableSize: 2 },
      reentry: { enabled: true, maxEntriesPerPlayer: 3, untilLevel: 30 },
      handForHand: { autoAtBubble: false },
    });
    main = S.check('create', (await admin.api.tournaments.create(mainConfig)).tournament, S.TOURNAMENT_ITEM);
    expect(main.status).toBe('DRAFT');
    S.check('putConfig', await admin.api.tournaments.putConfig(main.id, { config: { ...mainConfig, name: 'Contract Main Event' }, reason: REASON }), S.OK);

    const base10 = fastConfig(10);
    const approvalConfig: TournamentConfig = { ...base10, name: 'Contract Approval', joinCode: 'CONTRACTC', registration: { ...base10.registration, requireApproval: true } };
    approval = (await admin.api.tournaments.create(approvalConfig)).tournament;

    const clone = S.check('clone', (await admin.api.tournaments.clone(approval.id)).tournament, S.TOURNAMENT_ITEM);
    expect(clone.name).toBe('Contract Approval (copy)');
    S.check('delete', await admin.api.tournaments.remove(clone.id, { reason: REASON }), S.OK);

    const list = await admin.api.tournaments.list();
    S.checkAll('list.tournaments', list.tournaments, S.TOURNAMENT_ITEM);
    expect(list.tournaments.map((t) => t.id).sort()).toEqual([main.id, approval.id].sort());
    const withSims = await admin.api.tournaments.list({ simulations: true });
    expect(withSims.tournaments.map((t) => t.id)).toContain(demoId);
    expect((await admin.api.tournaments.list({ status: 'DRAFT' })).tournaments).toHaveLength(2);

    const overview = S.check('overview', await admin.api.tournaments.overview(main.id), S.OVERVIEW);
    expect(overview.name).toBe('Contract Main Event');
    S.check('overview.stats', overview.stats, S.STATS);
  });

  it('registration with approval: open, register, approve, reject, manual, rejoin, close, reopen, QR', async () => {
    const id = approval.id;
    const code = approval.joinCode;
    S.check('open', await admin.api.lifecycle.openRegistration(id, { reason: REASON }), S.OK);
    const pub = client();
    const join = S.check('joinInfo', await pub.api.public.joinInfo(code), S.JOIN_INFO);
    expect(join.registration).toMatchObject({ open: true, requiresApproval: true });

    const a = S.check('register', await client().api.public.register(code, { fields: { name: 'Approve Me' }, clientSeed: 'a1'.repeat(32) }), S.REGISTERED);
    const b = await client().api.public.register(code, { fields: { name: 'Reject Me' }, clientSeed: 'b2'.repeat(32) });
    expect(a.player.status).toBe('PENDING_APPROVAL');
    S.check('approve', await admin.api.players.approve(a.player.playerId, { reason: REASON }), S.OK);
    S.check('reject', await admin.api.players.reject(b.player.playerId, { reason: REASON }), S.OK);
    await waitFor('approval visible', async () => (await admin.api.players.detail(a.player.playerId)).status === 'REGISTERED', 10_000);

    const manual = S.check('manual', await admin.api.registration.manual(id, { fields: { name: 'Walk-in Player' } }), S.MANUAL_REGISTRATION);
    S.check('manual.player', manual.player, S.PLAYER_ITEM);
    expect(manual.rejoinUrl).toBe(`${ORIGIN}/join/${code}#rejoin=${manual.player.publicId}:${manual.rejoinCode}`);
    S.check('rejoin', await client().api.public.rejoin(code, { publicId: manual.player.publicId, rejoinCode: manual.rejoinCode }), S.REJOINED);

    const pending = S.checkPage('players?status', await admin.api.players.list(id, { status: 'PENDING_APPROVAL' }), S.PLAYER_ITEM);
    expect(pending.total).toBe(0);

    S.check('close', await admin.api.lifecycle.closeRegistration(id, { reason: REASON }), S.OK);
    S.check('reopen', await admin.api.lifecycle.reopenRegistration(id, { reason: REASON }), S.OK);

    const svg = await download(admin, admin.api.registration.qrSvgUrl(id, 256));
    expect(svg.type).toContain('image/svg+xml');
    expect(svg.body).toContain('<svg');
    expect(await admin.api.registration.qrSvg(id)).toContain('<svg');
  });

  it('main event: registration through the public API, start, hand-for-hand and an ad-hoc break', async () => {
    const id = main.id;
    S.check('open', await admin.api.lifecycle.openRegistration(id), S.OK);
    for (let i = 0; i < 12; i++) {
      const player = client();
      const r = await player.api.public.register(main.joinCode, { fields: { name: `Contract Player ${i + 1}` }, clientSeed: (i + 1).toString(16).padStart(64, '0') });
      expect(r.player.status).toBe('REGISTERED');
      bots.push(new PassiveBot(player.http, wsUrl, id));
    }
    await Promise.all(bots.map((b) => b.connect()));
    const pub = client().api.public;
    S.check('summary', await pub.summary(main.joinCode), S.SUMMARY);
    S.check('public fairness', await pub.fairness(main.joinCode), S.TOURNAMENT_FAIRNESS);

    S.check('close', await admin.api.lifecycle.closeRegistration(id), S.OK);
    const started = S.check('start', await admin.api.lifecycle.start(id, { adminEntropy: 'contract dice 3-5-1', reason: REASON }), START);
    expect(started.publicEntropy).toMatch(/^[0-9a-f]{64}$/);
    await waitFor('RUNNING', async () => (await admin.api.tournaments.overview(id)).status === 'RUNNING', 20_000);

    S.check('hand-for-hand on', await admin.api.clock.handForHand(id, { enabled: true, reason: REASON }), S.OK);
    expect((await admin.api.tournaments.overview(id)).handForHand).toBe(true);
    S.check('hand-for-hand off', await admin.api.clock.handForHand(id, { enabled: false }), S.OK);

    S.check('break start', await admin.api.clock.startBreak(id, { durationSeconds: 60, reason: REASON }), S.OK);
    expect((await admin.api.tournaments.overview(id)).status).toBe('BREAK');
    S.check('break end', await admin.api.clock.endBreak(id), S.OK);
    expect((await admin.api.tournaments.overview(id)).status).toBe('RUNNING');

    // A few (passive) hands, then pause so every table is quiet for the controls.
    await waitFor('three hands', async () => (await admin.api.tournaments.overview(id)).counters.handsCompleted >= 3, 60_000);
    S.check('pause', await admin.api.lifecycle.pause(id, { reason: REASON }), S.OK);
    await waitFor('tables held', async () => (await admin.api.tables.list(id)).rows.every((t) => t.status === 'HELD'), 30_000);
    expect((await admin.api.tournaments.list({ status: 'PAUSED' })).tournaments.map((t) => t.id)).toEqual([id]);
  });

  it('main event (paused): every read endpoint answers the client types', async () => {
    const id = main.id;
    const overview = S.check('overview', await admin.api.tournaments.overview(id), S.OVERVIEW);
    S.check('overview.stats', overview.stats, S.STATS);
    S.check('overview.chipConservation', overview.chipConservation, S.CHIP_CONSERVATION);
    S.check('overview.summary', overview.summary, S.SUMMARY);
    expect(overview.tablesByStatus).toEqual({ HELD: overview.counters.tables });

    const tables = S.checkPage('tables', await admin.api.tables.list(id), S.TABLE_ITEM);
    expect(tables.total).toBeGreaterThanOrEqual(2);
    const first = tables.rows[0]!;
    S.checkPage('tables?sort&q', await admin.api.tables.list(id, { sort: 'players', q: `T${first.tableNumber}`, limit: 5 }), S.TABLE_ITEM);
    expect((await admin.api.tables.list(id, { status: 'HELD', minPlayers: 1, maxPlayers: 9, stalled: false, offset: 0, limit: 1 })).limit).toBe(1);

    const detail = S.check('table detail', await admin.api.tables.detail(first.tableId), S.TABLE_DETAIL);
    S.check('table internals', detail.internals, S.TABLE_INTERNALS);
    S.checkAll('table recentHands', detail.recentHands, S.HAND_ITEM);
    expect(detail.holeCards).toBeNull();
    const events = await admin.api.tables.events(first.tableId, { after: 0, limit: 5 });
    S.check('table events', events, { events: 'array', nextAfter: 'number|null' });
    S.checkAll('table events.events', events.events, S.TABLE_EVENT);

    const players = S.checkPage('players', await admin.api.players.list(id, { limit: 100 }), S.PLAYER_ITEM);
    expect(players.total).toBe(12);
    S.checkPage('players?q', await admin.api.players.list(id, { q: 'Contract Player 1' }), S.PLAYER_ITEM);
    S.checkPage('players?status&table&sort', await admin.api.players.list(id, { status: 'SEATED', tableId: first.tableId, sort: 'name', offset: 0, limit: 3 }), S.PLAYER_ITEM);
    S.checkPage('players?CONNECTED', await admin.api.players.list(id, { status: 'CONNECTED' }), S.PLAYER_ITEM);
    const seated = players.rows.find((p) => p.status === 'SEATED')!;
    const detailP = S.check('player detail', await admin.api.players.detail(seated.playerId), S.PLAYER_DETAIL);
    S.checkAll('player sessions', detailP.sessions, S.PLAYER_SESSION);
    S.checkAll('player movements', detailP.movements, S.MOVEMENT);
    S.check('pii', await admin.api.players.pii(seated.playerId), S.PII);

    const other = tables.rows.find((t) => t.tableId !== seated.tableId && t.players < t.maxSeats)!;
    const scores = await admin.api.tables.seatScores(other.tableId, seated.playerId);
    S.check('seat scores', scores, { seats: 'array' });
    S.checkAll('seat scores.seats', scores.seats, S.SEAT_SCORE);
    expect(scores.seats.filter((s) => s.best)).toHaveLength(1);
    const noPlayer = await apiError(admin.api.tables.seatScores(other.tableId, ''));
    expect([noPlayer.status, noPlayer.code]).toEqual([400, 'INVALID_INPUT']);

    const hands = S.checkPage('hands', await admin.api.hands.list(id, { limit: 50 }), S.HAND_ITEM);
    expect(hands.total).toBeGreaterThan(0);
    const h = hands.rows[0]!;
    S.checkPage('hands?filters', await admin.api.hands.list(id, { tableId: h.tableId, handNumber: h.handNumber, minPot: 0, showdown: h.showdown, allIn: h.allIn }), S.HAND_ITEM);
    S.checkPage('hands?player', await admin.api.hands.list(id, { playerId: h.winners[0]?.playerId ?? seated.playerId, offset: 0, limit: 5 }), S.HAND_ITEM);
    const hand = S.check('hand detail', await admin.api.hands.detail(h.handId), S.HAND_DETAIL);
    expect(hand.seats.every((s) => s.holeCards !== null)).toBe(true);
    S.check('hand fairness', await admin.api.hands.fairness(h.handId), S.HAND_FAIRNESS);
    S.check('public hand fairness', await client().api.public.handFairness(h.handId), S.HAND_FAIRNESS);
    S.check('fairness', await admin.api.fairness.tournament(id), S.TOURNAMENT_FAIRNESS);
    const bundle = S.check('fairness bundle', await admin.api.fairness.bundle(id, { fromHand: 0, toHand: 4 }), S.FAIRNESS_EXPORT);
    S.checkAll('bundle hands', bundle.hands, S.HAND_FAIRNESS);

    const standings = S.check('standings', await admin.api.standings.get(id, { mode: 'stack', limit: 5 }), S.LEADERBOARD);
    S.checkAll('standings rows', standings.rows, S.LEADERBOARD_ROW);
    expect(standings.label).toBe('Current stack ranking');
    const lb = S.check('public leaderboard', await client().api.public.leaderboard(main.joinCode, { mode: 'stack', offset: 0, limit: 5 }), S.LEADERBOARD);
    S.checkAll('public leaderboard rows', lb.rows, S.LEADERBOARD_ROW);
    const standingsCsv = await download(admin, admin.api.standings.csvUrl(id, 'stack'));
    expect(standingsCsv.type).toContain('text/csv');

    const payouts = S.check('payouts', await admin.api.payouts.get(id), S.PAYOUTS);
    S.check('payouts.totals', payouts.totals, S.PAYOUT_TOTALS);
    expect((await download(admin, admin.api.payouts.csvUrl(id))).type).toContain('text/csv');
    S.check('report', await admin.api.reports.get(id), S.REPORT);
    expect((await download(admin, admin.api.reports.csvUrl(id))).type).toContain('text/csv');

    const integrity = S.check('integrity', await admin.api.tables.integrityCheck(id), S.INTEGRITY);
    expect(integrity.ok).toBe(true);

    const system = S.check('system', await admin.api.system.get(), S.SYSTEM);
    S.checkAll('system.nodes', system.nodes, S.NODE);
    expect(system.nodes[0]!.nodeId).toBe('contract-node');
    const metrics = await admin.api.system.liveMetrics(id);
    S.check('metrics', metrics, { points: 'array' });
    S.checkAll('metrics.points', metrics.points, S.METRICS_POINT);
  });

  it('main event (paused): table, player, clock and broadcast controls', async () => {
    const id = main.id;
    const tables = (await admin.api.tables.list(id, { sort: 'players' })).rows;
    const x = tables[0]!;
    const atX = (await admin.api.players.list(id, { tableId: x.tableId, status: 'SEATED', sort: 'registration' })).rows;
    expect(atX.length).toBeGreaterThanOrEqual(4);
    const [p, q, d, v] = atX as [typeof atX[number], typeof atX[number], typeof atX[number], typeof atX[number]];
    victimId = v.playerId;
    const y = tables.find((t) => t.tableId !== x.tableId && t.players < t.maxSeats)!;

    // tables
    for (const op of ['hold', 'release', 'freeze'] as const) S.check(op, await admin.api.tables[op](x.tableId, { reason: REASON }), S.OK);
    await waitFor('frozen table counted', async () => (await admin.api.tournaments.overview(id)).tablesByStatus.FROZEN === 1, 10_000);
    S.check('unfreeze', await admin.api.tables.unfreeze(x.tableId, { reason: REASON }), S.OK);
    const view = (await admin.api.tables.detail(x.tableId)).view;
    S.check('force-timeout', await admin.api.tables.forceTimeout(x.tableId, { reason: REASON, turnVersion: view.turn?.turnVersion ?? 0 }), S.OK);
    const noReason = await apiError(admin.api.tables.forceTimeout(x.tableId, { reason: '' }));
    expect([noReason.status, noReason.code]).toEqual([400, 'REASON_REQUIRED']);
    S.check('table add-time', await admin.api.tables.addTime(x.tableId, { ms: 15_000, reason: REASON }), S.OK);
    const revealed = await admin.api.tables.revealHoleCards(x.tableId, { reason: REASON, confirm: 'REVEAL' });
    S.check('reveal hole cards', revealed, { holeCards: 'object' });
    expect((await admin.api.tables.detail(x.tableId)).holeCards).not.toBeNull();

    // players
    S.check('notice', await admin.api.players.notice(p.playerId, { text: 'Contract test notice' }), S.OK);
    const rejoin = S.check('rejoin code', await admin.api.players.newRejoinCode(p.playerId, { reason: REASON }), S.REJOIN_CODE);
    expect(rejoin.rejoinUrl).toBe(`${ORIGIN}/join/${main.joinCode}#rejoin=${rejoin.publicId}:${rejoin.rejoinCode}`);
    S.check('disqualify', await admin.api.players.disqualify(d.playerId, { reason: REASON, confirm: 'DISQUALIFY' }), S.OK);
    const wrongWord = await apiError(admin.api.players.adjustStack(p.playerId, { newStack: p.stack + 100, reason: REASON, confirm: 'ADJUSTED' as 'ADJUST' }));
    expect([wrongWord.status, wrongWord.code, wrongWord.details]).toEqual([400, 'CONFIRMATION_REQUIRED', { confirmWord: 'ADJUST' }]);
    // One chip left: the victim is all-in in their next hand (busts in the next test, then re-enters).
    S.check('adjust stack', await admin.api.players.adjustStack(v.playerId, { newStack: 1, reason: REASON, confirm: 'ADJUST' }), S.OK);
    S.check('suspend', await admin.api.players.suspend(p.playerId, { reason: REASON }), S.OK);
    S.check('restore', await admin.api.players.restore(p.playerId, { reason: REASON, confirm: 'RESTORE' }), S.OK);
    S.check('move', await admin.api.players.move(q.playerId, { toTableId: y.tableId, reason: REASON }), S.OK);
    const notBusted = await apiError(admin.api.players.reenter(p.playerId));
    expect([notBusted.status, notBusted.code]).toEqual([409, 'NOT_ELIMINATED']);

    // clock & structure
    S.check('advance', await admin.api.clock.advance(id, { reason: REASON }), S.OK);
    S.check('set level', await admin.api.clock.setLevel(id, { level: 3, reason: REASON, confirm: 'LEVEL' }), S.OK);
    S.check('add time', await admin.api.clock.addTime(id, { ms: 60_000, reason: REASON }), S.OK);
    S.check('running config', await admin.api.tournaments.patchRunningConfig(id, { changes: { features: { soundEffects: false } }, reason: REASON, confirm: 'EDIT' }), S.OK);
    expect((await admin.api.tournaments.overview(id)).currentLevel?.level).toBe(3);

    // balancing
    await waitFor('moves settled', async () => (await admin.api.players.list(id, { status: 'IN_TRANSIT' })).total === 0, 15_000);
    const rebalance = S.check('rebalance', await admin.api.tables.rebalance(id, { reason: REASON }), REBALANCE);
    expect(rebalance.movesPlanned).toBeGreaterThanOrEqual(0);
    await waitFor('moves settled', async () => (await admin.api.players.list(id, { status: 'IN_TRANSIT' })).total === 0, 15_000);
    const open = (await admin.api.tables.list(id, { sort: 'players' })).rows.filter((t) => !t.breaking);
    expect(open.length).toBeGreaterThanOrEqual(2);
    const victim = open[open.length - 1]!;
    S.check('break table', await admin.api.tables.breakTable(victim.tableId, { reason: REASON, confirm: 'BREAK' }), S.OK);
    // Its players leave as their moves complete; the table closes once empty.
    await waitFor('table breaking', async () => (await admin.api.tables.list(id)).rows.every((t) => t.tableId !== victim.tableId || t.breaking === true), 15_000);

    // broadcast
    for (const [scope, targetId] of [
      ['ALL', null],
      ['TABLE', x.tableId],
      ['PLAYER', p.playerId],
      ['DISPLAY', null],
    ] as const) {
      S.check(`announce ${scope}`, await admin.api.broadcast.announce(id, { text: `Contract ${scope}`, scope, targetId, reason: REASON }), S.OK);
    }
    S.check('display', await admin.api.broadcast.display(id, { scene: 'LEADERBOARD', featuredTableId: null }), S.OK);
    const featured = (await admin.api.tables.list(id)).rows[0]!.tableId;
    S.check('display featured', await admin.api.broadcast.display(id, { scene: 'FEATURED_TABLE', featuredTableId: featured }), S.OK);
    const badScene = await apiError(admin.api.broadcast.display(id, { scene: 'FIREWORKS' as 'OVERVIEW' }));
    expect([badScene.status, badScene.code]).toEqual([400, 'INVALID_INPUT']);

    // last: revoking the player's sessions closes their socket
    const revoked = S.check('revoke sessions', await admin.api.players.revokeSessions(p.playerId, { reason: REASON, confirm: 'REVOKE' }), REVOKED);
    expect(revoked.revoked).toBeGreaterThanOrEqual(1);
  });

  it('main event: the one-chip player busts and re-enters through staff', async () => {
    const id = main.id;
    expect((await admin.api.players.detail(victimId)).stack).toBe(1);
    S.check('resume', await admin.api.lifecycle.resume(id, { reason: REASON }), S.OK);
    await waitFor('victim busted', async () => (await admin.api.players.detail(victimId)).status === 'ELIMINATED', 90_000, 100);
    S.check('pause', await admin.api.lifecycle.pause(id), S.OK);
    const reentry = S.check('reenter', await admin.api.players.reenter(victimId, { reason: REASON }), REENTERED);
    expect(reentry.entryNumber).toBe(2);
    await waitFor('re-entered player seated', async () => ['SEATED', 'IN_TRANSIT'].includes((await admin.api.players.detail(victimId)).status), 15_000);
  });

  it('main event: resume, emergency freeze, cancel; then the finished-tournament reads', async () => {
    const id = main.id;
    S.check('resume', await admin.api.lifecycle.resume(id, { reason: REASON }), S.OK);
    S.check('freeze', await admin.api.lifecycle.freeze(id, { reason: REASON, confirm: 'FREEZE' }), S.OK);
    expect((await admin.api.tournaments.overview(id)).frozen).toBe(true);
    S.check('unfreeze', await admin.api.lifecycle.unfreeze(id, { reason: REASON, confirm: 'FREEZE' }), S.OK);
    const noWord = await apiError(admin.api.lifecycle.cancel(id, { reason: REASON, confirm: 'STOP' as 'CANCEL' }));
    expect([noWord.status, noWord.code]).toEqual([400, 'CONFIRMATION_REQUIRED']);
    S.check('cancel', await admin.api.lifecycle.cancel(id, { reason: REASON, confirm: 'CANCEL' }), S.OK);
    expect((await admin.api.tournaments.overview(id)).status).toBe('CANCELLED');
    await waitFor('tables closed', async () => (await admin.api.tables.list(id)).total === 0, 15_000);
    const closed = S.checkPage('tables?status=CLOSED', await admin.api.tables.list(id, { status: 'CLOSED', limit: 2 }), S.TABLE_ITEM);
    expect(closed.total).toBeGreaterThanOrEqual(2);
    expect(closed.rows.every((t) => t.status === 'CLOSED')).toBe(true);
    expect((await admin.api.tournaments.overview(id)).tablesByStatus.CLOSED).toBe(closed.total);
    const finish = S.check('standings finish', await admin.api.standings.get(id, { mode: 'finish' }), S.LEADERBOARD);
    expect(finish.label).toBe('Finishing positions');
    expect((await admin.api.reports.get(id)).status).toBe('CANCELLED');
  });

  it('demo: completes, pays out, reveals the seed, stops', async () => {
    await waitFor('demo completed', async () => (await admin.api.demo.status(demoId)).status === 'COMPLETED', 240_000, 250);
    const payouts = S.check('demo payouts', await admin.api.payouts.get(demoId), S.PAYOUTS);
    const rows = S.checkAll('demo payout rows', payouts.rows, S.PAYOUT_ROW);
    expect(rows.length).toBeGreaterThan(0);
    const paid = await admin.api.payouts.updatePayment(rows[0]!.entryId, { status: 'PAID', reference: 'UPI-CONTRACT', note: null, reason: REASON });
    S.check('payment', paid, { row: 'object|null' });
    S.check('payment.row', paid.row, S.PAYOUT_ROW);
    expect(paid.row?.paymentStatus).toBe('PAID');

    const report = S.check('demo report', await admin.api.reports.get(demoId), S.REPORT);
    expect(report.winner).not.toBeNull();
    const finish = await admin.api.standings.get(demoId, { mode: 'finish', limit: 10 });
    expect(finish.rows[0]?.finishPosition).toBe(1);

    const seed = S.check('reveal seed', await admin.api.fairness.revealSeed(demoId, { reason: REASON, confirm: 'REVEAL' }), { serverSeed: 'string' });
    const fairness = await admin.api.fairness.tournament(demoId);
    expect([fairness.seedRevealed, fairness.serverSeed]).toEqual([true, seed.serverSeed]);

    const stopped = S.check('demo stop', await admin.api.demo.stop(demoId), S.DEMO);
    expect(stopped.running).toBe(false);
  });

  it('alerts: list, acknowledge, resolve', async () => {
    await server.store.repos.alerts.create({ id: 'alr_contract_1', tournamentId: main.id, severity: 'WARNING', code: 'TABLE_STALLED', message: 'Contract test alert', target: null });
    const open = await admin.api.alerts.list({ tournamentId: main.id, open: true, limit: 50 });
    S.check('alerts', open, { alerts: 'array' });
    S.checkAll('alerts.alerts', open.alerts, S.ALERT);
    expect(open.alerts.map((a) => a.id)).toContain('alr_contract_1');
    const acked = await admin.api.alerts.ack('alr_contract_1', { reason: REASON });
    S.check('ack', acked, { alert: 'object' });
    S.check('ack.alert', acked.alert, S.ALERT);
    expect(acked.alert.acknowledgedAt).not.toBeNull();
    S.check('resolve', await admin.api.alerts.resolve('alr_contract_1', { reason: REASON }), S.OK);
    expect((await admin.api.alerts.list({ tournamentId: main.id, open: true })).alerts.map((a) => a.id)).not.toContain('alr_contract_1');
  });

  it('users and sessions: list, create, sign-in, forbidden, revoke, update, reset password', async () => {
    const users = await admin.api.users.list();
    S.check('users', users, { users: 'array', rolePermissions: 'object' });
    S.checkAll('users.users', users.users, S.ADMIN_USER);
    expect(Object.keys(users.rolePermissions).sort()).toEqual(['STAFF', 'SUPER_ADMIN', 'TOURNAMENT_DIRECTOR', 'VIEWER']);

    const viewerLogin = { username: 'contract.viewer', password: 'contract viewer password 1' };
    const created = await admin.api.users.create({ ...viewerLogin, displayName: 'Viewer', role: 'VIEWER', tournamentScope: null });
    S.check('user create', created, { user: 'object|null' });
    const viewerUser = S.check('user', created.user, S.ADMIN_USER);

    const viewer = client();
    S.check('viewer login', await viewer.api.auth.login(viewerLogin), S.LOGIN);
    const forbidden = await apiError(viewer.api.tournaments.create(fastConfig(4, { joinCode: 'NOPE01' })));
    expect([forbidden.status, forbidden.code]).toEqual([403, 'FORBIDDEN']);

    const sessions = await admin.api.users.sessions();
    S.check('sessions', sessions, { sessions: 'array' });
    S.checkAll('sessions.sessions', sessions.sessions, S.ADMIN_SESSION);
    const viewerSession = sessions.sessions.find((s) => s.adminId === viewerUser.id)!;
    S.check('revoke session', await admin.api.users.revokeSession(viewerSession.id, { reason: REASON }), S.OK);
    expect((await apiError(viewer.api.auth.me())).status).toBe(401);

    const updated = await admin.api.users.update(viewerUser.id, { displayName: 'Contract Viewer', reason: REASON, confirm: 'USER' });
    expect(S.check('user update', updated.user, S.ADMIN_USER).displayName).toBe('Contract Viewer');
    S.check('reset password', await admin.api.users.resetPassword(viewerUser.id, { password: 'another viewer password 2', reason: REASON, confirm: 'USER' }), S.OK);
    S.check('viewer login again', await client().api.auth.login({ username: viewerLogin.username, password: 'another viewer password 2' }), S.LOGIN);
  });

  it('audit: list, page, CSV, verify', async () => {
    const page1 = await admin.api.audit.list({ tournamentId: main.id, limit: 5 });
    S.check('audit', page1, { entries: 'array', nextBeforeSeq: 'number|null' });
    S.checkAll('audit.entries', page1.entries, S.AUDIT_ENTRY);
    expect(page1.nextBeforeSeq).not.toBeNull();
    const page2 = await admin.api.audit.list({ tournamentId: main.id, beforeSeq: page1.nextBeforeSeq!, action: undefined, limit: 5 });
    expect(page2.entries[0]!.seq).toBeLessThan(page1.entries[4]!.seq);
    S.checkAll('audit?filters', (await admin.api.audit.list({ adminId: page1.entries[0]!.adminId ?? undefined, action: 'REVEAL_HOLE_CARDS', target: 'table:' })).entries, S.AUDIT_ENTRY);
    const csv = await download(admin, admin.api.audit.csvUrl({ tournamentId: main.id }));
    expect(csv.type).toContain('text/csv');
    expect(csv.body).toContain('REVEAL_HOLE_CARDS');
    const verify = S.check('verify', await admin.api.audit.verify(), { checked: 'number', brokenAtSeq: 'number|null', intact: 'boolean', verifiedAt: 'number' });
    expect(verify.intact).toBe(true);
  });

  it('auth: logout ends the session; every registry endpoint answered 2xx during the run', async () => {
    S.check('logout', await admin.api.auth.logout(), S.OK);
    expect((await apiError(admin.api.auth.me())).code).toBe('UNAUTHORIZED');
    const never = (Object.keys(ENDPOINTS) as EndpointKey[]).filter((k) => !succeeded.has(k));
    expect(never, 'endpoints never called successfully').toEqual([]);
  });
});
