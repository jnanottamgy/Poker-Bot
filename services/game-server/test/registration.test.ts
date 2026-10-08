import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL } from './helpers/db';
import { createTestHttp } from './helpers/http';
import { testTournamentConfig } from './helpers/config';
import { RegistrationService } from '../src/services/registration';
import type { RegistrationDirectorPort } from '../src/services/registration';
import { registerPublicRoutes } from '../src/http/routes/public';
import { normalizeRejoinCode } from '../src/services/rejoin';
import { sanitizeRegistration } from '../src/services/registration-fields';
import { joinUrl, qrSvg, rejoinUrl } from '../src/http/qr';

describe('registration field sanitization', () => {
  const cfg = { fields: [{ key: 'name' as const, required: true }, { key: 'email' as const, required: false }, { key: 'phone' as const, required: false }], requireApproval: false, accessCode: null };
  it('normalizes and strips invisible characters', () => {
    const r = sanitizeRegistration(cfg, { name: '  Ra​hul\u0000  Sharma ', email: 'RAHUL@Example.COM' });
    expect(r).toEqual({ ok: true, fields: { name: 'Rahul Sharma', email: 'rahul@example.com' } });
  });
  it('rejects markup, bad formats, missing required and over-long input', () => {
    expect(sanitizeRegistration(cfg, { name: '<img src=x onerror=alert(1)>' }).ok).toBe(false);
    expect(sanitizeRegistration(cfg, { name: 'A', email: 'not-an-email' }).ok).toBe(false);
    expect(sanitizeRegistration(cfg, { name: 'A', phone: 'call me' }).ok).toBe(false);
    expect(sanitizeRegistration(cfg, {}).ok).toBe(false);
    expect(sanitizeRegistration(cfg, { name: 'x'.repeat(41) }).ok).toBe(false);
    expect(sanitizeRegistration(cfg, { name: 'राहुल' })).toEqual({ ok: true, fields: { name: 'राहुल' } });
  });
  it('normalizes rejoin codes typed by humans', () => {
    expect(normalizeRejoinCode('ab1c-d2ef')).toBe('AB1C-D2EF');
    expect(normalizeRejoinCode('abo1cdlI')).toBe('AB01-CD11');
    expect(normalizeRejoinCode('short')).toBeNull();
  });
  it('builds QR join urls and SVGs', async () => {
    expect(joinUrl('https://poker.example', 'ABC123')).toBe('https://poker.example/join/ABC123');
    expect(rejoinUrl('https://poker.example', 'ABC123', 'JPN-7A42', 'AB1C-D2EF')).toBe('https://poker.example/join/ABC123#rejoin=JPN-7A42:AB1C-D2EF');
    const svg = await qrSvg('https://poker.example/join/ABC123');
    expect(svg.startsWith('<svg')).toBe(true);
  });
});

describe.skipIf(!TEST_DATABASE_URL)('join, register and rejoin over HTTP', () => {
  let t: Awaited<ReturnType<typeof createTestHttp>>;
  const calls: unknown[] = [];
  let reject = false;
  const director: RegistrationDirectorPort = {
    async registerPlayer(_tid, input) {
      calls.push(input);
      return reject ? { ok: false, code: 'TOURNAMENT_FULL', message: 'The tournament is full.' } : { ok: true, code: null, message: null };
    },
    async publicSummary() {
      return null;
    },
    async reenterPlayer() {
      return { ok: true, code: null, message: null };
    },
  };

  beforeAll(async () => {
    t = await createTestHttp('registration', {
      modules: [(app, ctx) => registerPublicRoutes(app, ctx, new RegistrationService(ctx.store, director))],
    });
    const repos = t.ctx.store.repos;
    await repos.tournaments.create({ id: 'trn_open', joinCode: 'OPEN01', config: testTournamentConfig({ joinCode: 'OPEN01' }), serverSeedHash: 'abc', serverSeedEnc: 'x', isSimulation: false, createdBy: null });
    await repos.tournaments.updateStatus('trn_open', 'REGISTRATION');
    await repos.tournaments.create({
      id: 'trn_code',
      joinCode: 'CODE01',
      config: testTournamentConfig({ joinCode: 'CODE01', registration: { fields: [{ key: 'name', required: true }, { key: 'collegeId', required: true }], requireApproval: true, accessCode: 'VENUE7' } }),
      serverSeedHash: 'def',
      serverSeedEnc: 'x',
      isSimulation: false,
      createdBy: null,
    });
    await repos.tournaments.updateStatus('trn_code', 'REGISTRATION');
    await repos.tournaments.create({ id: 'trn_draft', joinCode: 'DRAFT1', config: testTournamentConfig({ joinCode: 'DRAFT1' }), serverSeedHash: 'g', serverSeedEnc: 'x', isSimulation: false, createdBy: null });
  });
  afterAll(() => t.close());

  it('serves join info with the fairness commitment', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/public/tournaments/open01' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: 'Repo Test', serverSeedHash: 'abc', registration: { open: true, requiresAccessCode: false } });
    expect((await t.app.inject({ method: 'GET', url: '/api/public/tournaments/NOPE99' })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: '/api/public/tournaments/DRAFT1' })).json().registration.open).toBe(false);
  });

  it('registers a player, sets a session cookie and returns a one-time rejoin code', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/public/tournaments/OPEN01/register', payload: { fields: { name: 'Rahul' }, clientSeed: 'ab'.repeat(32) } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.player.publicId).toMatch(/^JPN-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(body.rejoinCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(res.cookies.find((c) => c.name === 'jpb_ps')?.httpOnly).toBe(true);
    expect(calls.at(-1)).toMatchObject({ displayName: 'Rahul', approved: true, registrationSeq: 1, clientSeed: 'ab'.repeat(32) });

    const rejoinBad = await t.app.inject({ method: 'POST', url: '/api/public/tournaments/OPEN01/rejoin', payload: { publicId: body.player.publicId, rejoinCode: 'AAAA-AAAA' } });
    expect(rejoinBad.statusCode).toBe(401);
    const rejoin = await t.app.inject({ method: 'POST', url: '/api/public/tournaments/OPEN01/rejoin', payload: { publicId: body.player.publicId.toLowerCase(), rejoinCode: body.rejoinCode.replace('-', '').toLowerCase() } });
    expect(rejoin.statusCode).toBe(200);
    expect(rejoin.json().player.playerId).toBe(body.player.playerId);
  });

  it('enforces access codes, required fields and approval', async () => {
    const wrong = await t.app.inject({ method: 'POST', url: '/api/public/tournaments/CODE01/register', payload: { fields: { name: 'A', collegeId: 'MSRIT-1' }, accessCode: 'nope' } });
    expect(wrong.statusCode).toBe(403);
    const missing = await t.app.inject({ method: 'POST', url: '/api/public/tournaments/CODE01/register', payload: { fields: { name: 'A' }, accessCode: 'venue7' } });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.details[0].field).toBe('collegeId');
    const ok = await t.app.inject({ method: 'POST', url: '/api/public/tournaments/CODE01/register', payload: { fields: { name: 'A', collegeId: 'MSRIT-1' }, accessCode: 'venue7' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().player.status).toBe('PENDING_APPROVAL');
  });

  it('rejects registration when closed and rolls back when the director refuses', async () => {
    expect((await t.app.inject({ method: 'POST', url: '/api/public/tournaments/DRAFT1/register', payload: { fields: { name: 'A' } }, remoteAddress: '10.1.1.1' })).statusCode).toBe(409);
    reject = true;
    const res = await t.app.inject({ method: 'POST', url: '/api/public/tournaments/OPEN01/register', payload: { fields: { name: 'Late' } }, remoteAddress: '10.1.1.2' });
    reject = false;
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toBe('The tournament is full.');
    const entries = await t.ctx.store.repos.players.listEntries('trn_open', { statuses: ['WITHDRAWN'] });
    expect(entries.total).toBe(1);
  });

  it('rate limits registration spam from one address', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) {
      codes.push((await t.app.inject({ method: 'POST', url: '/api/public/tournaments/OPEN01/register', payload: { fields: { name: `Spam${i}` } }, remoteAddress: '10.9.9.9' })).statusCode);
    }
    expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0);
  });
});
