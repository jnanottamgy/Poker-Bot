import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL } from './helpers/db';
import { cookieJar, createTestHttp } from './helpers/http';
import { csvCell, toCsv } from '../src/util/csv';

async function login(t: Awaited<ReturnType<typeof createTestHttp>>, username: string, password: string) {
  const res = await t.app.inject({ method: 'POST', url: '/api/admin/auth/login', payload: { username, password } });
  expect(res.statusCode).toBe(200);
  const jar = cookieJar(res);
  return { cookie: jar.cookie, 'x-csrf-token': jar.csrf };
}

describe('csv export safety', () => {
  it('neutralizes spreadsheet formulas and quotes properly', () => {
    expect(csvCell('=HYPERLINK("evil")')).toBe(`"'=HYPERLINK(""evil"")"`);
    expect(csvCell('@SUM(A1)')).toBe(`'@SUM(A1)`);
    expect(csvCell('-25')).toBe('-25');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(toCsv(['a'], [['x']]).startsWith('﻿a\r\nx')).toBe(true);
  });
});

describe.skipIf(!TEST_DATABASE_URL)('admin users, sessions, audit and alerts', () => {
  let t: Awaited<ReturnType<typeof createTestHttp>>;
  let root: Record<string, string>;
  beforeAll(async () => {
    t = await createTestHttp('httpusers');
    await t.ctx.adminAuth.bootstrap({ username: 'root', password: 'root-password-123' });
    root = await login(t, 'root', 'root-password-123');
  });
  afterAll(() => t.close());

  it('creates a STAFF user who cannot manage users', async () => {
    const created = await t.app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: root,
      payload: { username: 'staff1', displayName: 'Staff One', role: 'STAFF', password: 'staff-password-123' },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().user).not.toHaveProperty('passwordHash');
    const dup = await t.app.inject({ method: 'POST', url: '/api/admin/users', headers: root, payload: { username: 'STAFF1', displayName: 'x', role: 'STAFF', password: 'staff-password-123' } });
    expect(dup.statusCode).toBe(409);
    const staff = await login(t, 'staff1', 'staff-password-123');
    expect((await t.app.inject({ method: 'GET', url: '/api/admin/users', headers: staff })).statusCode).toBe(403);
    expect((await t.app.inject({ method: 'GET', url: '/api/admin/audit', headers: staff })).statusCode).toBe(403);
  });

  it('requires double confirmation to change a user and revokes sessions on disable', async () => {
    const list = await t.app.inject({ method: 'GET', url: '/api/admin/users', headers: root });
    const staff = list.json().users.find((u: { username: string }) => u.username === 'staff1');
    const staffHeaders = await login(t, 'staff1', 'staff-password-123');
    const noConfirm = await t.app.inject({ method: 'PATCH', url: `/api/admin/users/${staff.id}`, headers: root, payload: { disabled: true, reason: 'left the team' } });
    expect(noConfirm.statusCode).toBe(400);
    expect(noConfirm.json().error.code).toBe('CONFIRMATION_REQUIRED');
    const ok = await t.app.inject({ method: 'PATCH', url: `/api/admin/users/${staff.id}`, headers: root, payload: { disabled: true, reason: 'left the team', confirm: 'USER' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.disabled).toBe(true);
    expect((await t.app.inject({ method: 'GET', url: '/api/admin/auth/me', headers: staffHeaders })).statusCode).toBe(401);
  });

  it('prevents self-demotion', async () => {
    const me = await t.app.inject({ method: 'GET', url: '/api/admin/auth/me', headers: root });
    const res = await t.app.inject({ method: 'PATCH', url: `/api/admin/users/${me.json().admin.id}`, headers: root, payload: { role: 'VIEWER', reason: 'oops', confirm: 'USER' } });
    expect(res.statusCode).toBe(403);
  });

  it('exposes a verifiable audit trail and CSV export', async () => {
    const audit = await t.app.inject({ method: 'GET', url: '/api/admin/audit?limit=50', headers: root });
    const actions = audit.json().entries.map((e: { action: string }) => e.action);
    expect(actions).toContain('ADMIN_USER_CREATED');
    expect(actions).toContain('ADMIN_USER_UPDATED');
    const verify = await t.app.inject({ method: 'GET', url: '/api/admin/audit/verify', headers: root });
    expect(verify.json().intact).toBe(true);
    const csv = await t.app.inject({ method: 'GET', url: '/api/admin/audit.csv', headers: root });
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain('ADMIN_USER_UPDATED');
  });

  it('acknowledges and resolves alerts with audit entries', async () => {
    await t.ctx.store.repos.alerts.create({ id: 'al_x', tournamentId: null, severity: 'CRITICAL', code: 'TABLE_CRASHED', message: 'Table 9 crashed', target: 'table:9' });
    const open = await t.app.inject({ method: 'GET', url: '/api/admin/alerts?open=true', headers: root });
    expect(open.json().alerts.map((a: { id: string }) => a.id)).toContain('al_x');
    expect((await t.app.inject({ method: 'POST', url: '/api/admin/alerts/al_x/ack', headers: root, payload: {} })).statusCode).toBe(200);
    expect((await t.app.inject({ method: 'POST', url: '/api/admin/alerts/al_x/ack', headers: root, payload: {} })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'POST', url: '/api/admin/alerts/al_x/resolve', headers: root, payload: {} })).statusCode).toBe(200);
    const after = await t.app.inject({ method: 'GET', url: '/api/admin/alerts?open=true', headers: root });
    expect(after.json().alerts.map((a: { id: string }) => a.id)).not.toContain('al_x');
  });
});
