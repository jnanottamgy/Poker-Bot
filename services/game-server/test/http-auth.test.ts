import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL } from './helpers/db';
import { cookieJar, createTestHttp } from './helpers/http';

describe.skipIf(!TEST_DATABASE_URL)('admin authentication over HTTP', () => {
  let t: Awaited<ReturnType<typeof createTestHttp>>;
  beforeAll(async () => {
    t = await createTestHttp('httpauth');
    await t.ctx.adminAuth.bootstrap({ username: 'root', password: 'a-very-long-password' });
  });
  afterAll(() => t.close());

  it('bootstrap only runs once', async () => {
    expect(await t.ctx.adminAuth.bootstrap({ username: 'root2', password: 'a-very-long-password' })).toBeNull();
  });

  it('logs in, exposes permissions, requires CSRF for logout', async () => {
    const login = await t.app.inject({ method: 'POST', url: '/api/admin/auth/login', payload: { username: 'ROOT', password: 'a-very-long-password' } });
    expect(login.statusCode).toBe(200);
    const sessionCookie = login.cookies.find((c) => c.name === 'jpb_as');
    expect(sessionCookie?.httpOnly).toBe(true);
    expect(sessionCookie?.sameSite).toBe('Lax');
    const { cookie, csrf } = cookieJar(login);
    const me = await t.app.inject({ method: 'GET', url: '/api/admin/auth/me', headers: { cookie } });
    expect(me.json().admin.role).toBe('SUPER_ADMIN');
    expect(me.json().permissions).toContain('STACK_ADJUST');

    const noCsrf = await t.app.inject({ method: 'POST', url: '/api/admin/auth/logout', headers: { cookie } });
    expect(noCsrf.statusCode).toBe(403);
    const ok = await t.app.inject({ method: 'POST', url: '/api/admin/auth/logout', headers: { cookie, 'x-csrf-token': csrf } });
    expect(ok.statusCode).toBe(200);
    const after = await t.app.inject({ method: 'GET', url: '/api/admin/auth/me', headers: { cookie } });
    expect(after.statusCode).toBe(401);
    expect(after.json().error.message).toMatch(/session expired/i);
  });

  it('rejects bad credentials with a generic message and audits failures', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/admin/auth/login', payload: { username: 'nobody', password: 'whatever-123456' } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_CREDENTIALS');
    const audit = await t.ctx.store.repos.audit.list({ action: 'ADMIN_LOGIN_FAILED' });
    expect(audit.length).toBeGreaterThan(0);
  });

  it('rate limits brute force attempts', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) {
      const r = await t.app.inject({ method: 'POST', url: '/api/admin/auth/login', payload: { username: 'root', password: `wrong-password-${i}` }, remoteAddress: '10.0.0.9' });
      codes.push(r.statusCode);
    }
    expect(codes).toContain(429);
  });

  it('protects /metrics and returns friendly 404/400 bodies', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/metrics' })).statusCode).toBe(401);
    const nf = await t.app.inject({ method: 'GET', url: '/nope' });
    expect(nf.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
    const bad = await t.app.inject({ method: 'POST', url: '/api/admin/auth/login', payload: { username: '' } });
    expect(bad.statusCode).toBe(400);
    expect(JSON.stringify(bad.json())).not.toMatch(/stack|at Object/);
    expect((await t.app.inject({ method: 'GET', url: '/healthz' })).json().ok).toBe(true);
    expect((await t.app.inject({ method: 'GET', url: '/readyz' })).json().ok).toBe(true);
  });

  it('sends security headers', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/healthz' });
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
