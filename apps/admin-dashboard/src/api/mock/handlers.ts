import type {
  AdminRole,
  AdminUserDto,
  LeaderboardDto,
  LeaderboardRowDto,
  Paginated,
  PayoutRowDto,
  PayoutsDto,
  TournamentReportDto,
  TournamentStatus,
} from '@jpb/shared-types';
import type { EndpointKey } from '../endpoints';
import { buildTournament } from './generate';
import { findHand, handDetail, handFairnessRecord } from './hands';
import { Rng, fakeHash } from './rng';
import { MockHttpError } from './server';
import type { MockServer } from './server';
import type { MockAdmin, MockPlayer, MockTournament } from './state';
import { counters, isActivePlayer, openTables, overview, playerDetail, playerListItem, summary, tableDetail, tableListItem, tableListStatus, tournamentListItem } from './views';
import { MOCK_PASSWORD } from './world';

export interface HandlerCtx {
  server: MockServer;
  params: Record<string, string>;
  query: URLSearchParams;
  body: Record<string, unknown>;
  /** Signed-in admin (the router already enforced authentication and the permission). */
  admin: MockAdmin | null;
}

/** JSON body, or a text payload for CSV/SVG endpoints. */
export type HandlerResult = unknown | { __text: string; contentType: string };
export type Handler = (ctx: HandlerCtx) => HandlerResult;

const text = (body: string, contentType: string) => ({ __text: body, contentType });
const ok = { ok: true };

function num(q: URLSearchParams, key: string, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  const raw = q.get(key);
  const v = raw === null || raw === '' ? fallback : Number(raw);
  return Number.isFinite(v) ? Math.min(max, Math.max(0, Math.floor(v))) : fallback;
}

function page<T>(rows: T[], q: URLSearchParams, defaultLimit = 50): Paginated<T> {
  const offset = num(q, 'offset', 0);
  const limit = Math.max(1, num(q, 'limit', defaultLimit, 500));
  return { rows: rows.slice(offset, offset + limit), total: rows.length, offset, limit };
}

function reasonOf(ctx: HandlerCtx): string | null {
  const r = ctx.body.reason;
  return typeof r === 'string' && r.trim() ? r.trim() : null;
}

function requireScope(ctx: HandlerCtx, t: MockTournament): MockTournament {
  const scope = ctx.admin?.tournamentScope;
  if (scope && !scope.includes(t.id)) throw new MockHttpError(403, 'OUT_OF_SCOPE', 'You are not assigned to this tournament.');
  return t;
}

const tour = (ctx: HandlerCtx) => requireScope(ctx, ctx.server.tournament(ctx.params.id ?? ''));
const table = (ctx: HandlerCtx) => {
  const r = ctx.server.findTable(ctx.params.tableId ?? '');
  requireScope(ctx, r.t);
  return r;
};
const player = (ctx: HandlerCtx) => {
  const r = ctx.server.findPlayer(ctx.params.playerId ?? ctx.params.entryId ?? '');
  requireScope(ctx, r.t);
  return r;
};
const byJoinCode = (ctx: HandlerCtx) => {
  const t = ctx.server.world.tournaments.find((x) => x.joinCode.toUpperCase() === (ctx.params.joinCode ?? '').toUpperCase());
  if (!t || t.status === 'DRAFT') throw new MockHttpError(404, 'NOT_FOUND', 'No tournament uses this join code.');
  return t;
};

function stackRanks(t: MockTournament): Map<string, number> {
  const active = t.players.filter(isActivePlayer).sort((a, b) => b.stack - a.stack);
  return new Map(active.map((p, i) => [p.playerId, i + 1]));
}

function audited(ctx: HandlerCtx, t: MockTournament | null, action: string, target: string, before: unknown = null, after: unknown = null): void {
  ctx.server.audit(ctx.admin, action, target, t?.id ?? null, reasonOf(ctx), before, after);
}

function adminDto(a: MockAdmin, now: number): AdminUserDto {
  return {
    id: a.id,
    username: a.username,
    displayName: a.displayName,
    role: a.role,
    tournamentScope: a.tournamentScope,
    createdAt: a.createdAt,
    createdBy: a.createdBy,
    disabled: a.disabled,
    lastLoginAt: a.lastLoginAt,
    locked: a.lockedUntil !== null && a.lockedUntil > now,
    failedLogins: a.failedLogins,
  };
}

function leaderboard(t: MockTournament, mode: 'stack' | 'finish', q: URLSearchParams): LeaderboardDto {
  const rows: LeaderboardRowDto[] =
    mode === 'stack'
      ? t.players
          .filter(isActivePlayer)
          .sort((a, b) => b.stack - a.stack)
          .map((p, i) => ({ rank: i + 1, playerId: p.playerId, publicId: p.publicId, displayName: p.displayName, stack: p.stack, finishPosition: null, tiedCount: 1, prizeMinor: 0, status: p.status, tableNumber: t.tables.find((x) => x.tableId === p.tableId)?.tableNumber ?? null }))
      : t.players
          .filter((p) => p.finishPosition !== null)
          .sort((a, b) => (a.finishPosition ?? 0) - (b.finishPosition ?? 0))
          .map((p) => ({ rank: p.finishPosition!, playerId: p.playerId, publicId: p.publicId, displayName: p.displayName, stack: p.stack, finishPosition: p.finishPosition, tiedCount: p.tiedCount, prizeMinor: p.prizeMinor, status: p.status, tableNumber: null }));
  return { ...page(rows, q), mode, label: mode === 'stack' ? 'Current stack ranking' : 'Finishing positions' };
}

function payouts(t: MockTournament): PayoutsDto {
  const currency = t.config.prizeStructure.currency;
  const rows: PayoutRowDto[] = t.players
    .filter((p) => p.prizeMinor > 0 && p.finishPosition !== null)
    .sort((a, b) => a.finishPosition! - b.finishPosition!)
    .map((p) => ({
      entryId: p.entryId,
      playerId: p.playerId,
      publicId: p.publicId,
      displayName: p.displayName,
      finishPosition: p.finishPosition!,
      tiedCount: p.tiedCount,
      prizeMinor: p.prizeMinor,
      currency,
      paymentStatus: p.payment.status,
      paidAt: p.payment.paidAt,
      processedBy: p.payment.processedBy,
      paymentReference: p.payment.reference,
    }));
  const configuredMinor = t.config.prizeStructure.places.reduce((a, p) => a + p.amountMinor, 0);
  const awardedMinor = rows.reduce((a, r) => a + r.prizeMinor, 0);
  const paidMinor = rows.filter((r) => r.paymentStatus === 'PAID').reduce((a, r) => a + r.prizeMinor, 0);
  return { currency, rows, totals: { configuredMinor, awardedMinor, paidMinor, outstandingMinor: awardedMinor - paidMinor } };
}

function csv(header: string[], rows: unknown[][]): string {
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\n');
}

/** Decorative QR-style SVG (mock only — not a scannable code). */
function qrSvg(seed: string, size: number): string {
  const rng = new Rng(seed);
  const n = 29;
  const cell = size / n;
  let rects = '';
  const finder = (x: number, y: number) => (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const fx = x % (n - 7);
      const fy = y % (n - 7);
      const on = finder(x, y) ? (fx === 0 || fx === 6 || fy === 0 || fy === 6 || (fx >= 2 && fx <= 4 && fy >= 2 && fy <= 4)) : rng.chance(0.48);
      if (on) rects += `<rect x="${(x * cell).toFixed(2)}" y="${(y * cell).toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
}

function rejoinCode(rng: Rng): string {
  return `${rng.code(4)}-${rng.code(4)}`;
}

function requireStatus(t: MockTournament, allowed: TournamentStatus[], message: string): void {
  if (!allowed.includes(t.status)) throw new MockHttpError(409, 'INVALID_STATE', message);
}

// ----------------------------------------------------------------------------------------------------

export const HANDLERS: Record<EndpointKey, Handler> = {
  // ------------------------------------------------------------ public
  publicJoinInfo: (ctx) => {
    const t = byJoinCode(ctx);
    return {
      tournamentId: t.id,
      name: t.name,
      joinCode: t.joinCode,
      status: t.status,
      startTime: t.config.startTime,
      serverSeedHash: t.serverSeedHash,
      registration: { open: t.status === 'REGISTRATION', fields: t.config.registration.fields, requiresAccessCode: t.config.registration.accessCode !== null, requiresApproval: t.config.registration.requireApproval, deadline: t.config.registrationDeadline, lateRegistration: t.config.lateRegistration },
      limits: { minPlayers: t.config.minPlayers, maxPlayers: t.config.maxPlayers },
      startingStack: t.config.startingStack,
      counters: counters(t),
      spectators: { publicWatch: t.config.spectators.publicWatch },
      prizes: { currency: t.config.prizeStructure.currency, places: t.config.prizeStructure.places, notes: t.config.prizeStructure.notes ?? null },
    };
  },
  publicRegister: (ctx) => {
    const t = byJoinCode(ctx);
    if (t.status !== 'REGISTRATION') throw new MockHttpError(409, 'REGISTRATION_CLOSED', 'Registration is closed.');
    const fields = (ctx.body.fields ?? {}) as Record<string, string>;
    const name = (fields.name ?? '').trim();
    if (!name) throw new MockHttpError(400, 'INVALID_INPUT', 'Please enter your name.');
    const p = newPlayer(ctx.server, t, name, fields);
    p.status = t.config.registration.requireApproval ? 'PENDING_APPROVAL' : 'REGISTERED';
    return { player: { playerId: p.playerId, publicId: p.publicId, displayName: p.displayName, status: p.status }, tournamentId: t.id, rejoinCode: rejoinCode(new Rng(p.playerId)), csrfToken: 'mock-csrf' };
  },
  publicRejoin: (ctx) => {
    const t = byJoinCode(ctx);
    const p = t.players.find((x) => x.publicId === ctx.body.publicId);
    if (!p) throw new MockHttpError(401, 'INVALID_REJOIN', 'That public id and rejoin code do not match.');
    return { player: { playerId: p.playerId, publicId: p.publicId, displayName: p.displayName }, tournamentId: t.id, csrfToken: 'mock-csrf' };
  },
  publicSummary: (ctx) => summary(byJoinCode(ctx)),
  publicLeaderboard: (ctx) => leaderboard(byJoinCode(ctx), ctx.query.get('mode') === 'finish' ? 'finish' : 'stack', ctx.query),
  publicFairness: (ctx) => fairnessDto(byJoinCode(ctx)),
  publicHandFairness: (ctx) => {
    const found = findHand(ctx.server.world.tournaments, ctx.params.handId ?? '');
    if (!found) throw new MockHttpError(404, 'NOT_FOUND', 'Hand not found.');
    return handFairnessRecord(found.t, found.idx, found.t.seedRevealed);
  },

  // ------------------------------------------------------------ auth
  authLogin: (ctx) => login(ctx),
  authLogout: (ctx) => {
    const s = ctx.server.world.sessions.find((x) => x.id === ctx.server.world.currentSessionId);
    if (s) s.revokedAt = ctx.server.now();
    ctx.server.world.currentSessionId = null;
    return ok;
  },
  authMe: (ctx) => {
    const a = ctx.admin!;
    const s = ctx.server.world.sessions.find((x) => x.id === ctx.server.world.currentSessionId)!;
    return { admin: { id: a.id, username: a.username, displayName: a.displayName, role: a.role, tournamentScope: a.tournamentScope }, permissions: ctx.server.permissionsOf(a), sessionExpiresAt: s.expiresAt };
  },

  // ------------------------------------------------------------ tournaments & lifecycle
  tournamentsList: (ctx) => {
    const status = ctx.query.get('status');
    const sims = ctx.query.get('simulations') === 'true';
    const scope = ctx.admin?.tournamentScope;
    const rows = ctx.server.world.tournaments
      .filter((t) => (!status || t.status === status) && (sims || !t.isSimulation) && (!scope || scope.includes(t.id)))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(tournamentListItem);
    return { tournaments: rows };
  },
  tournamentCreate: (ctx) => {
    const config = ctx.body.config as MockTournament['config'] | undefined;
    if (!config?.name) throw new MockHttpError(400, 'INVALID_CONFIG', 'The configuration needs a name.');
    const t = createDraft(ctx.server, config.name, config.joinCode || `NEW${ctx.server.world.idCounter}`);
    t.config = { ...t.config, ...config };
    audited(ctx, t, 'TOURNAMENT_CREATED', 'tournament', null, { name: t.name });
    return { tournament: tournamentListItem(t) };
  },
  tournamentOverview: (ctx) => overview(ctx.server.world, tour(ctx), ctx.server.now()),
  tournamentPutConfig: (ctx) => {
    const t = tour(ctx);
    requireStatus(t, ['DRAFT', 'REGISTRATION'], 'The configuration is locked once registration closes.');
    const before = t.config;
    t.config = { ...t.config, ...(ctx.body.config as object) };
    t.name = t.config.name;
    audited(ctx, t, 'CONFIG_UPDATED', 'tournament', { name: before.name }, { name: t.config.name });
    return ok;
  },
  tournamentPatchRunningConfig: (ctx) => {
    const t = tour(ctx);
    const changes = (ctx.body.changes ?? {}) as Record<string, unknown>;
    const allowed = ['blindSchedule', 'breaks', 'timing', 'spectators', 'features'];
    const bad = Object.keys(changes).filter((k) => !allowed.includes(k));
    if (bad.length) throw new MockHttpError(400, 'NOT_MUTABLE', `These settings cannot change while the tournament runs: ${bad.join(', ')}.`);
    const schedule = changes.blindSchedule as MockTournament['config']['blindSchedule'] | undefined;
    if (schedule) {
      const cur = t.clock.levelIndex;
      const changedPast = t.config.blindSchedule.slice(0, cur + 1).some((l, i) => JSON.stringify(l) !== JSON.stringify(schedule[i]));
      if (changedPast) throw new MockHttpError(409, 'LEVEL_NOT_EDITABLE', 'Only future levels can be edited; the current and past levels are fixed.');
      const invalid = schedule.find((l) => l.smallBlind <= 0 || l.bigBlind < l.smallBlind || l.durationSeconds < 60 || l.ante < 0);
      if (invalid) throw new MockHttpError(400, 'INVALID_LEVEL', `Level ${invalid.level} is invalid: big blind must be ≥ small blind and the duration at least one minute.`);
    }
    const before = Object.fromEntries(Object.keys(changes).map((k) => [k, (t.config as unknown as Record<string, unknown>)[k]]));
    t.config = {
      ...t.config,
      ...(schedule ? { blindSchedule: schedule } : {}),
      ...(changes.breaks ? { breaks: changes.breaks as MockTournament['config']['breaks'] } : {}),
      ...(changes.timing ? { timing: { ...t.config.timing, ...(changes.timing as object) } } : {}),
      ...(changes.spectators ? { spectators: { ...t.config.spectators, ...(changes.spectators as object) } } : {}),
      ...(changes.features ? { features: { ...t.config.features, ...(changes.features as object) } } : {}),
    };
    audited(ctx, t, 'CONFIG_EDITED_RUNNING', 'tournament', before, changes);
    return ok;
  },
  tournamentClone: (ctx) => {
    const src = tour(ctx);
    const t = createDraft(ctx.server, `${src.name} (copy)`, `${src.joinCode.slice(0, 6)}${ctx.server.world.idCounter % 100}`);
    t.config = { ...src.config, name: t.name, joinCode: t.joinCode };
    audited(ctx, t, 'TOURNAMENT_CLONED', 'tournament', { from: src.id }, { id: t.id });
    return { tournament: tournamentListItem(t) };
  },
  tournamentDelete: (ctx) => {
    const t = tour(ctx);
    requireStatus(t, ['DRAFT'], 'Only draft tournaments can be deleted.');
    ctx.server.world.tournaments = ctx.server.world.tournaments.filter((x) => x !== t);
    audited(ctx, null, 'TOURNAMENT_DELETED', `tournament:${t.id}`, { name: t.name }, null);
    return ok;
  },
  registrationOpen: (ctx) => lifecycle(ctx, (t) => ctx.server.transition(t, 'REGISTRATION', reasonOf(ctx)), 'REGISTRATION_OPENED'),
  registrationClose: (ctx) => lifecycle(ctx, (t) => ctx.server.transition(t, 'REGISTRATION_CLOSED', reasonOf(ctx)), 'REGISTRATION_CLOSED'),
  registrationReopen: (ctx) => lifecycle(ctx, (t) => ctx.server.transition(t, 'REGISTRATION', reasonOf(ctx)), 'REGISTRATION_REOPENED'),
  tournamentStart: (ctx) => lifecycle(ctx, (t) => ctx.server.start(t), 'TOURNAMENT_STARTED'),
  tournamentPause: (ctx) => lifecycle(ctx, (t) => ctx.server.pause(t, reasonOf(ctx)), 'TOURNAMENT_PAUSED'),
  tournamentResume: (ctx) => lifecycle(ctx, (t) => ctx.server.resume(t), 'TOURNAMENT_RESUMED'),
  tournamentFreeze: (ctx) => lifecycle(ctx, (t) => ctx.server.freeze(t, reasonOf(ctx) ?? ''), 'EMERGENCY_FREEZE'),
  tournamentUnfreeze: (ctx) => lifecycle(ctx, (t) => ctx.server.unfreeze(t), 'EMERGENCY_UNFREEZE'),
  tournamentCancel: (ctx) => lifecycle(ctx, (t) => ctx.server.cancel(t, reasonOf(ctx) ?? ''), 'CANCEL_TOURNAMENT'),

  // ------------------------------------------------------------ clock
  clockAdvance: (ctx) => clockOp(ctx, 'CLOCK_ADVANCE', (t) => {
    if (t.clock.levelIndex >= t.config.blindSchedule.length - 1) throw new MockHttpError(409, 'LAST_LEVEL', 'This is already the last level of the schedule.');
    ctx.server.setLevel(t, t.clock.levelIndex + 1);
  }),
  clockSetLevel: (ctx) => clockOp(ctx, 'SET_BLIND_LEVEL', (t) => ctx.server.setLevel(t, Number(ctx.body.level) - 1)),
  clockAddTime: (ctx) => clockOp(ctx, 'CLOCK_ADD_TIME', (t) => {
    const ms = Number(ctx.body.ms);
    if (!Number.isInteger(ms) || ms === 0 || Math.abs(ms) > 60 * 60_000) throw new MockHttpError(400, 'INVALID_INPUT', 'Add or remove between 1 second and 60 minutes.');
    ctx.server.addTime(t, ms);
  }),
  breakStart: (ctx) => clockOp(ctx, 'BREAK_STARTED', (t) => {
    const s = Number(ctx.body.durationSeconds);
    if (!Number.isInteger(s) || s < 60 || s > 3 * 3600) throw new MockHttpError(400, 'INVALID_INPUT', 'A break lasts between 1 minute and 3 hours.');
    ctx.server.startBreak(t, s, reasonOf(ctx));
  }),
  breakEnd: (ctx) => clockOp(ctx, 'BREAK_ENDED', (t) => ctx.server.endBreak(t)),
  handForHand: (ctx) => clockOp(ctx, 'HAND_FOR_HAND', (t) => {
    t.handForHand = Boolean(ctx.body.enabled);
    ctx.server.emit(t, { kind: 'HAND_FOR_HAND', enabled: t.handForHand });
  }),

  // ------------------------------------------------------------ tables
  tablesList: (ctx) => {
    const t = tour(ctx);
    const now = ctx.server.now();
    const q = ctx.query;
    const status = q.get('status');
    const min = q.get('minPlayers');
    const max = q.get('maxPlayers');
    const search = (q.get('q') ?? '').replace(/^t/i, '').trim();
    let rows = t.tables.map((tb) => tableListItem(t, tb, now)).filter((r) => (status ? r.status === status : r.status !== 'CLOSED'));
    if (min) rows = rows.filter((r) => r.players >= Number(min));
    if (max) rows = rows.filter((r) => r.players <= Number(max));
    if (q.get('stalled') === 'true') rows = rows.filter((r) => r.status === 'STALLED');
    if (search) rows = rows.filter((r) => String(r.tableNumber).startsWith(search));
    const sort = q.get('sort') ?? 'number';
    const by: Record<string, (a: typeof rows[number], b: typeof rows[number]) => number> = {
      number: (a, b) => a.tableNumber - b.tableNumber,
      players: (a, b) => b.players - a.players || a.tableNumber - b.tableNumber,
      stall: (a, b) => (a.lastProgressAt ?? 0) - (b.lastProgressAt ?? 0),
      chips: (a, b) => b.chips - a.chips,
    };
    rows.sort(by[sort] ?? by.number);
    return page(rows, q);
  },
  tableDetail: (ctx) => {
    const { t, table: tb } = table(ctx);
    ctx.server.hands(t);
    return tableDetail(t, tb, ctx.server.now(), ctx.admin?.id ?? '');
  },
  tableEvents: (ctx) => {
    const { t, table: tb } = table(ctx);
    const after = num(ctx.query, 'after', 0);
    const limit = Math.max(1, num(ctx.query, 'limit', 50, 500));
    const last = tb.handNumber * 24 + tb.handStep * 3;
    const events = [];
    for (let seq = after + 1; seq <= Math.min(last, after + limit); seq++) {
      events.push({ tableId: tb.tableId, tournamentId: t.id, seq, version: Math.floor(seq / 3), at: ctx.server.now() - (last - seq) * 4000, visibility: 'PUBLIC' as const, privateTo: null, event: { kind: 'TABLE_STATUS_CHANGED' as const, status: tb.status, holds: tb.holds, frozen: tb.frozen } });
    }
    return { events, nextAfter: after + limit < last ? after + limit : null };
  },
  tableHold: (ctx) => tableOp(ctx, 'TABLE_HOLD', (tb) => {
    if (!tb.holds.includes('ADMIN')) tb.holds = [...tb.holds, 'ADMIN'];
    tb.status = 'HELD';
  }),
  tableRelease: (ctx) => tableOp(ctx, 'TABLE_RELEASE', (tb, now) => {
    tb.holds = tb.holds.filter((h) => h !== 'ADMIN');
    if (tb.holds.length === 0) tb.status = 'BETWEEN_HANDS';
    tb.stalled = false;
    tb.lastProgressAt = now;
  }),
  tableFreeze: (ctx) => tableOp(ctx, 'TABLE_FREEZE', (tb) => void (tb.frozen = true)),
  tableUnfreeze: (ctx) => tableOp(ctx, 'TABLE_UNFREEZE', (tb, now) => {
    tb.frozen = false;
    tb.lastProgressAt = now;
  }),
  tableForceTimeout: (ctx) => {
    if (!reasonOf(ctx)) throw new MockHttpError(400, 'REASON_REQUIRED', 'Please enter a reason (at least 3 characters).');
    return tableOp(ctx, 'FORCE_TIMEOUT', (tb, now) => {
      if (tb.status !== 'IN_HAND') throw new MockHttpError(409, 'NO_ACTIVE_HAND', 'Nobody is acting at this table right now.');
      tb.stalled = false;
      tb.handStep += 1;
      tb.lastProgressAt = now;
    });
  },
  tableBreak: (ctx) => {
    const { t, table: tb } = table(ctx);
    if (tb.status === 'CLOSED') throw new MockHttpError(409, 'TABLE_CLOSED', 'This table is already closed.');
    if (openTables(t).length < 2) throw new MockHttpError(409, 'LAST_TABLE', 'The last table cannot be broken.');
    const before = { status: tb.status, players: tb.seats.filter(Boolean).length };
    ctx.server.breakTable(t, tb, ctx.server.now());
    audited(ctx, t, 'BREAK_TABLE', `table:${tb.tableNumber}`, before, { status: 'CLOSED' });
    return ok;
  },
  tableRevealHoleCards: (ctx) => {
    const { t, table: tb } = table(ctx);
    if (!tb.revealedTo.includes(ctx.admin!.id)) tb.revealedTo.push(ctx.admin!.id);
    audited(ctx, t, 'REVEAL_HOLE_CARDS', `table:${tb.tableNumber}`);
    return { holeCards: tableDetail(t, tb, ctx.server.now(), ctx.admin!.id).holeCards ?? {} };
  },
  tournamentRebalance: (ctx) => {
    const t = tour(ctx);
    const sizes = openTables(t).map((tb) => tb.seats.filter(Boolean).length);
    const moves = sizes.length ? Math.max(0, Math.floor((Math.max(...sizes) - Math.min(...sizes) - 1) / 2) * 2) : 0;
    audited(ctx, t, 'REBALANCE', 'tournament', null, { movesPlanned: moves });
    return { ok: true, movesPlanned: moves };
  },
  tournamentIntegrityCheck: (ctx) => {
    const t = tour(ctx);
    const c = counters(t);
    const actual = t.players.reduce((a, p) => a + p.stack, 0);
    const now = ctx.server.now();
    const violations = t.tables.filter((tb) => tableListStatus(tb, now) === 'STALLED').map((tb) => ({ tableId: tb.tableId, tableNumber: tb.tableNumber, code: 'TABLE_STALLED', detail: `No progress for ${Math.round((now - tb.lastProgressAt) / 1000)}s` }));
    audited(ctx, t, 'INTEGRITY_CHECK', 'tournament', null, { violations: violations.length });
    return { ok: violations.length === 0 && actual === c.totalChips, checkedTables: openTables(t).length, checkedAt: now, violations, chipConservation: { expectedTotal: c.totalChips, actualTotal: actual, ok: actual === c.totalChips } };
  },

  // ------------------------------------------------------------ players & registration
  playersList: (ctx) => {
    const t = tour(ctx);
    const q = ctx.query;
    const needle = (q.get('q') ?? '').trim().toLowerCase();
    const status = q.get('status');
    const tableId = q.get('tableId');
    let rows = t.players;
    if (needle) rows = rows.filter((p) => p.displayName.toLowerCase().includes(needle) || p.publicId.toLowerCase().includes(needle) || (p.nickname ?? '').toLowerCase().includes(needle));
    if (status === 'CONNECTED') rows = rows.filter((p) => p.connected === true);
    else if (status === 'DISCONNECTED') rows = rows.filter((p) => p.connected === false && isActivePlayer(p));
    else if (status === 'AWAY') rows = rows.filter((p) => p.consecutiveTimeouts >= t.config.timing.awayAfterTimeouts);
    else if (status) rows = rows.filter((p) => p.status === status);
    if (tableId) rows = rows.filter((p) => p.tableId === tableId);
    const ranks = stackRanks(t);
    const sort = q.get('sort') ?? (t.startedAt ? 'stack' : 'registration');
    const cmp: Record<string, (a: MockPlayer, b: MockPlayer) => number> = {
      stack: (a, b) => b.stack - a.stack || a.registrationSeq - b.registrationSeq,
      finish: (a, b) => (a.finishPosition ?? 1e9) - (b.finishPosition ?? 1e9),
      name: (a, b) => a.displayName.localeCompare(b.displayName),
      registration: (a, b) => a.registrationSeq - b.registrationSeq,
    };
    const sorted = rows.slice().sort(cmp[sort] ?? cmp.stack);
    const p = page(sorted, q);
    return { ...p, rows: p.rows.map((x) => playerListItem(t, x, ranks.get(x.playerId) ?? null)) };
  },
  playerDetail: (ctx) => {
    const { t, p } = player(ctx);
    const perms = ctx.admin ? ctx.server.permissionsOf(ctx.admin) : [];
    return playerDetail(t, p, stackRanks(t).get(p.playerId) ?? null, ctx.server.now(), perms.includes('PLAYER_VIEW_PII'));
  },
  playerPii: (ctx) => {
    const { t, p } = player(ctx);
    audited(ctx, t, 'VIEW_PII', `player:${p.publicId}`);
    return { playerId: p.playerId, name: p.displayName, nickname: p.nickname, ...p.pii };
  },
  playerMove: (ctx) => playerOp(ctx, 'PLAYER_MOVED', (t, p) => {
    if (!reasonOf(ctx)) throw new MockHttpError(400, 'REASON_REQUIRED', 'Please enter a reason (at least 3 characters).');
    const dest = t.tables.find((x) => x.tableId === ctx.body.toTableId);
    if (!dest || dest.status === 'CLOSED') throw new MockHttpError(400, 'INVALID_TABLE', 'Choose an open destination table.');
    const seat = typeof ctx.body.toSeat === 'number' ? ctx.body.toSeat : dest.seats.findIndex((s) => s === null);
    if (seat < 0 || dest.seats[seat] !== null) throw new MockHttpError(409, 'SEAT_UNAVAILABLE', 'That seat is taken. Pick another one.');
    const from = t.tables.find((x) => x.tableId === p.tableId);
    if (from && p.seat !== null) from.seats[p.seat] = null;
    dest.seats[seat] = p.playerId;
    const before = { table: from?.tableNumber ?? null, seat: p.seat };
    Object.assign(p, { tableId: dest.tableId, seat, status: 'SEATED' });
    return [before, { table: dest.tableNumber, seat }];
  }),
  playerSuspend: (ctx) => playerOp(ctx, 'PLAYER_SUSPENDED', (_t, p) => statusChange(p, ['SEATED', 'IN_TRANSIT'], 'SUSPENDED')),
  playerRestore: (ctx) => playerOp(ctx, 'RESTORE_PLAYER', (_t, p) => statusChange(p, ['SUSPENDED'], p.tableId ? 'SEATED' : 'IN_TRANSIT')),
  playerDisqualify: (ctx) => playerOp(ctx, 'DISQUALIFY_PLAYER', (t, p) => {
    const before = { status: p.status, stack: p.stack };
    const tb = t.tables.find((x) => x.tableId === p.tableId);
    if (tb && p.seat !== null) tb.seats[p.seat] = null;
    Object.assign(p, { status: 'DISQUALIFIED', stack: 0, tableId: null, seat: null });
    return [before, { status: p.status, stack: 0 }];
  }),
  playerAdjustStack: (ctx) => playerOp(ctx, 'ADJUST_STACK', (_t, p) => {
    const next = Number(ctx.body.newStack);
    if (!Number.isInteger(next) || next < 0) throw new MockHttpError(400, 'INVALID_INPUT', 'The new stack must be a whole number of chips (0 or more).');
    const before = { stack: p.stack };
    p.stack = next;
    return [before, { stack: next }];
  }),
  playerRevokeSessions: (ctx) => playerOp(ctx, 'REVOKE_SESSIONS', (_t, p) => {
    const now = ctx.server.now();
    for (const s of p.sessions) if (s.revokedAt === null) Object.assign(s, { revokedAt: now, revokedReason: 'REVOKED_BY_ADMIN' });
    p.connected = false;
    return [null, { revoked: p.sessions.length }];
  }),
  playerRejoinCode: (ctx) => {
    const { t, p } = player(ctx);
    const code = rejoinCode(new Rng(`${p.playerId}:${ctx.server.now()}`));
    audited(ctx, t, 'NEW_REJOIN_CODE', `player:${p.publicId}`);
    return { publicId: p.publicId, rejoinCode: code, rejoinUrl: `${typeof location === 'undefined' ? 'https://poker.example' : location.origin}/rejoin?code=${encodeURIComponent(code)}&id=${p.publicId}` };
  },
  playerNotice: (ctx) => {
    const { t, p } = player(ctx);
    if (typeof ctx.body.text !== 'string' || !ctx.body.text.trim()) throw new MockHttpError(400, 'INVALID_INPUT', 'Write a message first.');
    audited(ctx, t, 'PRIVATE_NOTICE', `player:${p.publicId}`, null, { text: ctx.body.text });
    return ok;
  },
  playerApprove: (ctx) => playerOp(ctx, 'PLAYER_APPROVED', (_t, p) => statusChange(p, ['PENDING_APPROVAL'], 'REGISTERED')),
  playerReject: (ctx) => playerOp(ctx, 'PLAYER_REJECTED', (_t, p) => statusChange(p, ['PENDING_APPROVAL'], 'WITHDRAWN')),
  registrationManual: (ctx) => {
    const t = tour(ctx);
    requireStatus(t, ['REGISTRATION', 'REGISTRATION_CLOSED', 'RUNNING', 'BREAK', 'PAUSED'], 'Registration is not possible in this state.');
    const fields = (ctx.body.fields ?? {}) as Record<string, string>;
    if (!fields.name?.trim()) throw new MockHttpError(400, 'INVALID_INPUT', 'A name is required.');
    const p = newPlayer(ctx.server, t, fields.name.trim(), fields);
    audited(ctx, t, 'MANUAL_REGISTRATION', `player:${p.publicId}`);
    return { player: playerListItem(t, p, null), rejoinCode: rejoinCode(new Rng(p.playerId)) };
  },
  tournamentQrSvg: (ctx) => text(qrSvg(tour(ctx).joinCode, num(ctx.query, 'size', 256, 2048) || 256), 'image/svg+xml'),

  // ------------------------------------------------------------ hands, fairness, standings, payouts
  handsList: (ctx) => {
    const t = tour(ctx);
    const q = ctx.query;
    const tableId = q.get('tableId');
    const playerId = q.get('playerId');
    const handNumber = q.get('handNumber');
    const minPot = num(q, 'minPot', 0);
    const showdown = q.get('showdown');
    const allIn = q.get('allIn');
    const playerTable = playerId ? t.players.find((p) => p.playerId === playerId)?.tableId : null;
    const all = ctx.server.hands(t);
    const rows = [];
    for (let i = all.length - 1; i >= 0; i--) {
      const h = all[i]!;
      if (tableId && h.tableId !== tableId) continue;
      if (playerId && h.tableId !== playerTable && !h.winners.some((w) => w.playerId === playerId)) continue;
      if (handNumber && h.handNumber !== Number(handNumber)) continue;
      if (minPot && h.totalPot < minPot) continue;
      if (showdown !== null && showdown !== '' && h.showdown !== (showdown === 'true')) continue;
      if (allIn !== null && allIn !== '' && h.allIn !== (allIn === 'true')) continue;
      rows.push(h);
    }
    return page(rows, q);
  },
  handDetail: (ctx) => {
    const found = findHand(ctx.server.world.tournaments, ctx.params.handId ?? '');
    if (!found) throw new MockHttpError(404, 'NOT_FOUND', 'Hand not found.');
    requireScope(ctx, found.t);
    return handDetail(found.t, found.idx);
  },
  handFairness: (ctx) => {
    const found = findHand(ctx.server.world.tournaments, ctx.params.handId ?? '');
    if (!found) throw new MockHttpError(404, 'NOT_FOUND', 'Hand not found.');
    requireScope(ctx, found.t);
    return handFairnessRecord(found.t, found.idx, true);
  },
  tournamentFairness: (ctx) => fairnessDto(tour(ctx)),
  tournamentFairnessBundle: (ctx) => {
    const t = tour(ctx);
    const all = ctx.server.hands(t);
    const from = num(ctx.query, 'fromHand', 0);
    const to = num(ctx.query, 'toHand', Math.min(all.length - 1, from + 49));
    const idx = Array.from({ length: Math.max(0, Math.min(to, all.length - 1) - from + 1) }, (_, i) => from + i).slice(0, 500);
    return {
      format: 'JPB-FAIRNESS-EXPORT',
      formatVersion: 1,
      scheme: 'JPB/v1',
      method: { commitment: 'SHA-256(serverSeed)', publicEntropy: 'SHA-256 of sorted client seeds and admin entropy', deckLabel: 'JPB/v1|tournament|table|hand', drawLabel: 'deck label + draw index', stream: 'HMAC-SHA256(serverSeed, label || counter)', uniformInt: 'rejection sampling', shuffle: 'Fisher–Yates from the top', canonicalDeck: '2c..Ac,2d..Ad,2h..Ah,2s..As', deckHash: 'SHA-256 of the 104-char deck string', dealing: 'one card per seat clockwise from the small blind, twice; burn before flop, turn and river' },
      tournamentId: t.id,
      serverSeedHash: t.serverSeedHash,
      serverSeed: t.seedRevealed ? t.serverSeed : null,
      publicEntropy: t.publicEntropy ?? '',
      entropyInputs: { clientSeeds: [], adminEntropy: null },
      hands: idx.map((i) => handFairnessRecord(t, i, t.seedRevealed)),
    };
  },
  tournamentRevealSeed: (ctx) => {
    const t = tour(ctx);
    requireStatus(t, ['COMPLETED', 'CANCELLED'], 'The server seed can only be revealed after the tournament is completed or cancelled.');
    t.seedRevealed = true;
    audited(ctx, t, 'REVEAL_SEED', 'tournament', { seedRevealed: false }, { seedRevealed: true });
    return { serverSeed: t.serverSeed };
  },
  standings: (ctx) => leaderboard(tour(ctx), ctx.query.get('mode') === 'finish' ? 'finish' : 'stack', ctx.query),
  standingsCsv: (ctx) => {
    const t = tour(ctx);
    const lb = leaderboard(t, ctx.query.get('mode') === 'finish' ? 'finish' : 'stack', new URLSearchParams({ limit: '100000' }));
    return text(csv(['rank', 'public_id', 'name', 'stack', 'finish_position', 'tied', 'prize_minor', 'status'], lb.rows.map((r) => [r.rank, r.publicId, r.displayName, r.stack, r.finishPosition, r.tiedCount, r.prizeMinor, r.status])), 'text/csv');
  },
  payouts: (ctx) => payouts(tour(ctx)),
  payoutsCsv: (ctx) => {
    const p = payouts(tour(ctx));
    return text(csv(['position', 'public_id', 'name', 'prize_minor', 'currency', 'status', 'paid_at', 'processed_by', 'reference'], p.rows.map((r) => [r.finishPosition, r.publicId, r.displayName, r.prizeMinor, r.currency, r.paymentStatus, r.paidAt, r.processedBy, r.paymentReference])), 'text/csv');
  },
  entryPayment: (ctx) => {
    const { t, p } = player(ctx);
    if (p.prizeMinor <= 0) throw new MockHttpError(409, 'NO_PRIZE', 'This entry did not win a prize.');
    const status = ctx.body.status as MockPlayer['payment']['status'];
    if (!['UNPAID', 'PROCESSING', 'PAID'].includes(status)) throw new MockHttpError(400, 'INVALID_INPUT', 'Choose a payment status.');
    const before = { ...p.payment };
    p.payment = { status, paidAt: status === 'PAID' ? ctx.server.now() : null, processedBy: ctx.admin?.username ?? null, reference: (ctx.body.reference as string | null) ?? null, note: (ctx.body.note as string | null) ?? null };
    audited(ctx, t, 'PAYMENT_UPDATED', `entry:${p.entryId}`, before, p.payment);
    return { row: payouts(t).rows.find((r) => r.entryId === p.entryId) };
  },

  // ------------------------------------------------------------ broadcast, alerts, audit, system, reports, users, demo
  announce: (ctx) => {
    const t = tour(ctx);
    const textBody = String(ctx.body.text ?? '').trim();
    if (!textBody) throw new MockHttpError(400, 'INVALID_INPUT', 'Write the announcement first.');
    ctx.server.emit(t, { kind: 'ANNOUNCEMENT', text: textBody, from: 'ADMIN' });
    audited(ctx, t, 'ANNOUNCE', `scope:${String(ctx.body.scope ?? 'ALL')}`, null, { text: textBody });
    return ok;
  },
  display: (ctx) => {
    const t = tour(ctx);
    t.display = { scene: String(ctx.body.scene ?? 'OVERVIEW'), featuredTableId: (ctx.body.featuredTableId as string | null) ?? null };
    audited(ctx, t, 'DISPLAY_SCENE', 'display', null, t.display);
    return ok;
  },
  alertsList: (ctx) => {
    const tid = ctx.query.get('tournamentId');
    const open = ctx.query.get('open') === 'true';
    const limit = Math.max(1, num(ctx.query, 'limit', 100, 1000));
    const alerts = ctx.server.world.alerts
      .filter((a) => (!tid || a.tournamentId === tid) && (!open || a.resolvedAt === null))
      .sort((a, b) => b.at - a.at)
      .slice(0, limit);
    return { alerts };
  },
  alertAck: (ctx) => {
    const a = ctx.server.world.alerts.find((x) => x.id === ctx.params.id && x.acknowledgedAt === null);
    if (!a) throw new MockHttpError(404, 'NOT_FOUND', 'Unacknowledged alert not found.');
    Object.assign(a, { acknowledgedAt: ctx.server.now(), acknowledgedBy: ctx.admin?.id ?? null });
    ctx.server.audit(ctx.admin, 'ALERT_ACKNOWLEDGED', `alert:${a.id}`, a.tournamentId, reasonOf(ctx), null, { code: a.code });
    return { alert: a };
  },
  alertResolve: (ctx) => {
    const a = ctx.server.world.alerts.find((x) => x.id === ctx.params.id);
    if (!a) throw new MockHttpError(404, 'NOT_FOUND', 'Alert not found.');
    a.resolvedAt = ctx.server.now();
    if (a.code === 'TABLE_STALLED' && a.target?.startsWith('table:')) {
      const found = ctx.server.findTable(a.target.slice(6));
      Object.assign(found.table, { stalled: false, lastProgressAt: ctx.server.now() });
    }
    ctx.server.audit(ctx.admin, 'ALERT_RESOLVED', `alert:${a.id}`, a.tournamentId, reasonOf(ctx), null, null);
    return ok;
  },
  auditList: (ctx) => {
    const q = ctx.query;
    const limit = Math.max(1, num(q, 'limit', 100, 1000));
    const beforeSeq = q.get('beforeSeq') ? Number(q.get('beforeSeq')) : Infinity;
    const f = (k: string) => q.get(k) ?? '';
    const entries = [];
    const all = ctx.server.world.audit;
    for (let i = all.length - 1; i >= 0 && entries.length < limit; i--) {
      const e = all[i]!;
      if (e.seq >= beforeSeq) continue;
      if (f('tournamentId') && e.tournamentId !== f('tournamentId')) continue;
      if (f('adminId') && e.adminId !== f('adminId')) continue;
      if (f('action') && e.action !== f('action')) continue;
      if (f('target') && !e.target.includes(f('target'))) continue;
      entries.push(e);
    }
    return { entries, nextBeforeSeq: entries.length === limit ? (entries[entries.length - 1]?.seq ?? null) : null };
  },
  auditCsv: (ctx) => {
    const rows = ctx.server.world.audit.filter((e) => !ctx.query.get('tournamentId') || e.tournamentId === ctx.query.get('tournamentId'));
    return text(csv(['seq', 'at', 'tournament', 'admin_id', 'admin', 'action', 'target', 'reason', 'before', 'after', 'ip', 'prev_hash', 'hash'], rows.map((e) => [e.seq, new Date(e.at).toISOString(), e.tournamentId, e.adminId, e.adminUsername, e.action, e.target, e.reason, e.beforeState, e.afterState, e.ip, e.prevHash, e.hash])), 'text/csv');
  },
  auditVerify: (ctx) => {
    const all = ctx.server.world.audit;
    let prev = '0'.repeat(64);
    let brokenAtSeq: number | null = null;
    for (const e of all) {
      if (e.prevHash !== prev) {
        brokenAtSeq = e.seq;
        break;
      }
      prev = e.hash;
    }
    return { checked: all.length, brokenAtSeq, intact: brokenAtSeq === null, verifiedAt: ctx.server.now() };
  },
  system: (ctx) => {
    const now = ctx.server.now();
    const spring = ctx.server.world.tournaments.find((t) => t.seedKey === 'spring');
    const last = spring?.metrics[spring.metrics.length - 1];
    const players = ctx.server.world.tournaments.reduce((a, t) => a + (t.startedAt && !t.completedAt ? counters(t).active : 0), 0);
    const stalled = ctx.server.world.tournaments.flatMap((t) => t.tables.filter((tb) => tableListStatus(tb, now) === 'STALLED').map((tb) => ({ tableId: tb.tableId, tableNumber: tb.tableNumber, lastProgressAt: tb.lastProgressAt })));
    return {
      nodes: [
        { nodeId: 'gateway-1', role: 'gateway', startedAt: now - 9 * 3600_000, lastHeartbeatAt: now - 1200, ownedTables: 0, ownedDirectors: 0 },
        { nodeId: 'gateway-2', role: 'gateway', startedAt: now - 9 * 3600_000, lastHeartbeatAt: now - 800, ownedTables: 0, ownedDirectors: 0 },
        { nodeId: 'worker-1', role: 'worker', startedAt: now - 9 * 3600_000, lastHeartbeatAt: now - 400, ownedTables: 108, ownedDirectors: 3 },
        { nodeId: 'worker-2', role: 'worker', startedAt: now - 2 * 3600_000, lastHeartbeatAt: now - 1600, ownedTables: 113, ownedDirectors: 2 },
      ],
      connections: { PLAYER: Math.round(players * 0.985), SPECTATOR: Math.round(players * 0.21), ADMIN: 4, DISPLAY: 2 },
      latency: { actions: { p50: last?.actionLatencyP50 ?? 16, p95: last?.actionLatencyP95 ?? 42, p99: last?.actionLatencyP99 ?? 88, count: 412_903 }, db: { p50: 3, p95: 9, p99: 21, count: 1_203_331 } },
      rates: { actionsPerSecond: last?.actionsPerSecond ?? 0, handsPerMinute: last?.handsPerMinute ?? 0, disconnectsPerSecond: 0.4, reconnectsPerSecond: 0.38 },
      errors: { WS_SEND_FAILED: 3, DB_TIMEOUT: 0, RATE_LIMITED: 41 },
      stalledTables: stalled,
      uptimeMs: 9 * 3600_000,
      version: '0.1.0-mock',
    };
  },
  metricsLive: (ctx) => ({ points: tour(ctx).metrics }),
  report: (ctx) => {
    const t = tour(ctx);
    const finish = leaderboard(t, 'finish', new URLSearchParams({ limit: '50' }));
    const champ = t.players.find((p) => p.finishPosition === 1);
    const biggest = ctx.server.hands(t).reduce<(typeof t.hands)[number] | null>((best, h) => (!best || h.totalPot > best.totalPot ? h : best), null);
    const report: TournamentReportDto = {
      tournamentId: t.id,
      name: t.name,
      status: t.status,
      players: counters(t).registered,
      entries: counters(t).registered,
      tablesUsed: t.tables.length,
      startedAt: t.startedAt,
      completedAt: t.completedAt,
      durationMs: t.startedAt ? (t.completedAt ?? ctx.server.now()) - t.startedAt : null,
      handsPlayed: t.handsCompleted,
      averageHandDurationMs: t.startedAt ? 94_000 : null,
      finalTableDurationMs: t.status === 'COMPLETED' ? 74 * 60_000 : null,
      largestPot: biggest ? { amount: biggest.totalPot, handId: biggest.handId, winnerName: biggest.winners[0]?.displayName ?? '—' } : null,
      winner: champ ? { playerId: champ.playerId, displayName: champ.displayName, publicId: champ.publicId } : null,
      standings: finish.rows,
      prizeStructure: { currency: t.config.prizeStructure.currency, places: t.config.prizeStructure.places },
      payouts: payouts(t).totals,
      serverSeedHash: t.serverSeedHash,
      seedRevealed: t.seedRevealed,
      generatedAt: ctx.server.now(),
    };
    return report;
  },
  reportCsv: (ctx) => {
    const t = tour(ctx);
    const lb = leaderboard(t, 'finish', new URLSearchParams({ limit: '100000' }));
    return text(csv(['position', 'public_id', 'name', 'prize_minor'], lb.rows.map((r) => [r.finishPosition, r.publicId, r.displayName, r.prizeMinor])), 'text/csv');
  },
  usersList: (ctx) => ({
    users: ctx.server.world.admins.map((a) => adminDto(a, ctx.server.now())),
    rolePermissions: Object.fromEntries((['SUPER_ADMIN', 'TOURNAMENT_DIRECTOR', 'STAFF', 'VIEWER'] as AdminRole[]).map((r) => [r, ctx.server.permissionsOf({ role: r } as MockAdmin)])),
  }),
  userCreate: (ctx) => {
    const b = ctx.body as { username?: string; displayName?: string; role?: AdminRole; password?: string; tournamentScope?: string[] | null };
    if (!b.username || !/^[a-zA-Z0-9._-]{3,64}$/.test(b.username)) throw new MockHttpError(400, 'INVALID_INPUT', 'Use 3–64 letters, digits, dot, dash or underscore for the username.');
    if (ctx.server.world.admins.some((a) => a.username === b.username)) throw new MockHttpError(409, 'USERNAME_TAKEN', 'That username is already in use.');
    if (!b.password || b.password.length < 12) throw new MockHttpError(400, 'WEAK_PASSWORD', 'Password must be at least 12 characters.');
    const a: MockAdmin = { id: ctx.server.nextId('adm'), username: b.username, displayName: b.displayName ?? b.username, role: b.role ?? 'VIEWER', tournamentScope: b.tournamentScope ?? null, password: b.password, createdAt: ctx.server.now(), createdBy: ctx.admin?.id ?? null, disabled: false, lastLoginAt: null, lockedUntil: null, failedLogins: 0 };
    ctx.server.world.admins.push(a);
    ctx.server.audit(ctx.admin, 'ADMIN_USER_CREATED', `admin:${a.username}`, null, null, null, { role: a.role });
    return { user: adminDto(a, ctx.server.now()) };
  },
  userUpdate: (ctx) => {
    const target = ctx.server.world.admins.find((a) => a.id === ctx.params.id);
    if (!target) throw new MockHttpError(404, 'NOT_FOUND', 'Admin user not found.');
    const b = ctx.body as { displayName?: string; role?: AdminRole; tournamentScope?: string[] | null; disabled?: boolean };
    if (target.id === ctx.admin?.id && (b.disabled || (b.role && b.role !== target.role))) throw new MockHttpError(403, 'FORBIDDEN', 'You cannot disable yourself or change your own role.');
    if ((b.role === 'SUPER_ADMIN' || target.role === 'SUPER_ADMIN') && ctx.admin?.role !== 'SUPER_ADMIN') throw new MockHttpError(403, 'FORBIDDEN', 'Only a SUPER_ADMIN can change SUPER_ADMIN accounts.');
    const before = adminDto(target, ctx.server.now());
    Object.assign(target, Object.fromEntries(Object.entries(b).filter(([k, v]) => v !== undefined && ['displayName', 'role', 'tournamentScope', 'disabled'].includes(k))));
    ctx.server.audit(ctx.admin, 'ADMIN_USER_UPDATED', `admin:${target.username}`, null, reasonOf(ctx), before, adminDto(target, ctx.server.now()));
    return { user: adminDto(target, ctx.server.now()) };
  },
  userResetPassword: (ctx) => {
    const target = ctx.server.world.admins.find((a) => a.id === ctx.params.id);
    if (!target) throw new MockHttpError(404, 'NOT_FOUND', 'Admin user not found.');
    const pw = String(ctx.body.password ?? '');
    if (pw.length < 12) throw new MockHttpError(400, 'WEAK_PASSWORD', 'Password must be at least 12 characters.');
    target.password = pw;
    for (const s of ctx.server.world.sessions) if (s.adminId === target.id && s.id !== ctx.server.world.currentSessionId) s.revokedAt = ctx.server.now();
    ctx.server.audit(ctx.admin, 'ADMIN_PASSWORD_RESET', `admin:${target.username}`, null, reasonOf(ctx), null, null);
    return ok;
  },
  sessionsList: (ctx) => ({
    sessions: ctx.server.world.sessions.filter((s) => s.revokedAt === null && s.expiresAt > ctx.server.now()).map((s) => ({ id: s.id, adminId: s.adminId, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, expiresAt: s.expiresAt, ip: s.ip, userAgent: s.userAgent })),
  }),
  sessionRevoke: (ctx) => {
    if (!reasonOf(ctx)) throw new MockHttpError(400, 'REASON_REQUIRED', 'Please enter a reason (at least 3 characters).');
    const s = ctx.server.world.sessions.find((x) => x.id === ctx.params.id && x.revokedAt === null);
    if (!s) throw new MockHttpError(404, 'NOT_FOUND', 'Session not found.');
    s.revokedAt = ctx.server.now();
    ctx.server.audit(ctx.admin, 'ADMIN_SESSION_REVOKED', `session:${s.id}`, null, reasonOf(ctx), { adminId: s.adminId }, null);
    return ok;
  },
  demoCreate: (ctx) => {
    const n = Number(ctx.body.players);
    if (!Number.isInteger(n) || n < 2 || n > 100_000) throw new MockHttpError(400, 'INVALID_INPUT', 'Choose between 2 and 100,000 bots.');
    const key = `demo${ctx.server.nextId('x').split('_')[1]}`;
    const t = buildTournament({ key, name: String(ctx.body.name ?? `Demo · ${n.toLocaleString('en-US')} bots`), joinCode: key.toUpperCase().slice(0, 12), status: 'RUNNING', registered: Math.min(n, 5000), active: Math.min(n, 5000), activeTables: Math.ceil(Math.min(n, 5000) / 8), closedTables: 0, startedAgoMin: 0.2, simulation: true, createdAgoDays: 0, maxPlayers: n }, ctx.server.now());
    ctx.server.world.tournaments.unshift(t);
    const status = { tournamentId: t.id, joinCode: t.joinCode, players: n, running: true, status: t.status, startedAt: ctx.server.now(), handsCompleted: 0, actionsSubmitted: 0, playersRemaining: n };
    ctx.server.world.demos.unshift(status);
    ctx.server.audit(ctx.admin, 'DEMO_STARTED', `tournament:${t.id}`, t.id, null, null, { players: n });
    return status;
  },
  demoStatus: (ctx) => demoStatus(ctx),
  demoStop: (ctx) => {
    const d = demoStatus(ctx);
    const t = ctx.server.tournament(d.tournamentId);
    if (t.status !== 'COMPLETED' && t.status !== 'CANCELLED') ctx.server.cancel(t, 'Demo stopped');
    const s = ctx.server.world.demos.find((x) => x.tournamentId === d.tournamentId)!;
    s.running = false;
    return demoStatus(ctx);
  },
};

// ----------------------------------------------------------------------------------------------------

function demoStatus(ctx: HandlerCtx) {
  const d = ctx.server.world.demos.find((x) => x.tournamentId === ctx.params.id);
  if (!d) throw new MockHttpError(404, 'NOT_FOUND', 'Demo not found.');
  const t = ctx.server.tournament(d.tournamentId);
  const c = counters(t);
  return { ...d, status: t.status, running: d.running && t.status !== 'COMPLETED' && t.status !== 'CANCELLED', handsCompleted: t.handsCompleted, actionsSubmitted: t.handsCompleted * 11, playersRemaining: c.active };
}

function fairnessDto(t: MockTournament) {
  return {
    tournamentId: t.id,
    serverSeedHash: t.serverSeedHash,
    serverSeed: t.seedRevealed ? t.serverSeed : null,
    seedRevealed: t.seedRevealed,
    publicEntropy: t.publicEntropy,
    entropyInputs: { clientSeedCount: t.clientSeedCount, adminEntropy: null },
    method: 'HMAC-SHA256-STREAM+FISHER-YATES',
    documentationUrl: '/docs/FAIRNESS.md',
  };
}

function login(ctx: HandlerCtx) {
  const { username, password } = ctx.body as { username?: string; password?: string };
  if (!username?.trim() || !password) throw new MockHttpError(400, 'INVALID_INPUT', 'Enter a username and password.');
  const now = ctx.server.now();
  const a = ctx.server.world.admins.find((x) => x.username.toLowerCase() === username.trim().toLowerCase());
  if (a?.lockedUntil && a.lockedUntil > now) throw new MockHttpError(423, 'ACCOUNT_LOCKED', 'Too many failed attempts. Try again in 15 minutes.');
  if (!a || a.disabled || a.password !== password) {
    if (a) {
      a.failedLogins += 1;
      if (a.failedLogins >= 5) a.lockedUntil = now + 15 * 60_000;
    }
    throw new MockHttpError(401, 'INVALID_CREDENTIALS', 'Invalid username or password.');
  }
  a.failedLogins = 0;
  a.lastLoginAt = now;
  const session = { id: ctx.server.nextId('ses'), adminId: a.id, createdAt: now, lastSeenAt: now, expiresAt: now + 12 * 3600_000, ip: '127.0.0.1', userAgent: typeof navigator === 'undefined' ? null : navigator.userAgent, revokedAt: null };
  ctx.server.world.sessions.push(session);
  ctx.server.world.currentSessionId = session.id;
  ctx.server.audit(a, 'ADMIN_LOGIN', `admin:${a.username}`, null, null, null, { sessionId: session.id });
  return { admin: { id: a.id, username: a.username, displayName: a.displayName, role: a.role }, permissions: ctx.server.permissionsOf(a), csrfToken: 'mock-csrf' };
}

function lifecycle(ctx: HandlerCtx, op: (t: MockTournament) => void, action: string) {
  const t = tour(ctx);
  const before = { status: t.status, frozen: t.frozen };
  op(t);
  audited(ctx, t, action, 'tournament', before, { status: t.status, frozen: t.frozen });
  return ok;
}

function clockOp(ctx: HandlerCtx, action: string, op: (t: MockTournament) => void) {
  const t = tour(ctx);
  if (t.startedAt === null || t.status === 'COMPLETED' || t.status === 'CANCELLED') throw new MockHttpError(409, 'CLOCK_NOT_RUNNING', 'The blind clock only runs while the tournament is in play.');
  const level = (i: number) => t.config.blindSchedule[i]?.level ?? null;
  const before = { level: level(t.clock.levelIndex), levelEndsAt: t.clock.levelEndsAt, breakEndsAt: t.clock.breakEndsAt, handForHand: t.handForHand };
  op(t);
  audited(ctx, t, action, 'clock', before, { level: level(t.clock.levelIndex), levelEndsAt: t.clock.levelEndsAt, breakEndsAt: t.clock.breakEndsAt, handForHand: t.handForHand });
  return ok;
}

function tableOp(ctx: HandlerCtx, action: string, op: (tb: MockTournament['tables'][number], now: number) => void) {
  const { t, table: tb } = table(ctx);
  if (tb.status === 'CLOSED') throw new MockHttpError(409, 'TABLE_CLOSED', 'This table is closed.');
  const before = { status: tb.status, holds: tb.holds, frozen: tb.frozen };
  op(tb, ctx.server.now());
  ctx.server.tableChanged(t, tb);
  audited(ctx, t, action, `table:${tb.tableNumber}`, before, { status: tb.status, holds: tb.holds, frozen: tb.frozen });
  return ok;
}

function playerOp(ctx: HandlerCtx, action: string, op: (t: MockTournament, p: MockPlayer) => [unknown, unknown] | void) {
  const { t, p } = player(ctx);
  const before = { status: p.status };
  const res = op(t, p);
  audited(ctx, t, action, `player:${p.publicId}`, res ? res[0] : before, res ? res[1] : { status: p.status });
  return ok;
}

function statusChange(p: MockPlayer, from: MockPlayer['status'][], to: MockPlayer['status']): [unknown, unknown] {
  if (!from.includes(p.status)) throw new MockHttpError(409, 'INVALID_STATE', `This player is ${p.status.replace(/_/g, ' ').toLowerCase()}; the action is not possible.`);
  const before = { status: p.status };
  p.status = to;
  return [before, { status: to }];
}

function newPlayer(server: MockServer, t: MockTournament, name: string, fields: Record<string, string>): MockPlayer {
  const rng = new Rng(`${t.id}:${server.world.idCounter}`);
  const seq = t.players.length + 1;
  const p: MockPlayer = {
    playerId: server.nextId('ply'),
    entryId: server.nextId('ent'),
    publicId: `JPN-${rng.code(4)}`,
    displayName: name,
    nickname: fields.nickname || null,
    status: 'REGISTERED',
    tableId: null,
    seat: null,
    stack: t.config.startingStack,
    finishPosition: null,
    tiedCount: 1,
    connected: null,
    consecutiveTimeouts: 0,
    registrationSeq: seq,
    registeredAt: server.now(),
    pii: { email: fields.email ?? '', phone: fields.phone ?? '', participantId: fields.participantId || null, collegeId: fields.collegeId || null },
    handsPlayed: 0,
    largestPotWon: 0,
    prizeMinor: 0,
    payment: { status: 'UNPAID', paidAt: null, processedBy: null, reference: null, note: null },
    elimination: null,
    movements: [],
    sessions: [],
  };
  t.players.push(p);
  return p;
}

function createDraft(server: MockServer, name: string, joinCode: string): MockTournament {
  const key = `draft${server.nextId('x').split('_')[1]}`;
  const t = buildTournament({ key, name, joinCode: joinCode.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || key.toUpperCase(), status: 'DRAFT', registered: 0, active: 0, activeTables: 0, closedTables: 0, createdAgoDays: 0, maxPlayers: 500 }, server.now());
  t.serverSeedHash = fakeHash(`seed:${t.serverSeed}`);
  server.world.tournaments.unshift(t);
  return t;
}

export { MOCK_PASSWORD };
