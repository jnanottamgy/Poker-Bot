import type { FastifyInstance } from 'fastify';
import { loadEnv } from '../../src/config/env';
import { Store } from '../../src/persistence/store';
import { SessionService } from '../../src/auth/sessions';
import { AdminAuthService } from '../../src/auth/admin-auth';
import { AuditService } from '../../src/audit/audit-service';
import { MetricsRegistry } from '../../src/observability/metrics';
import { buildHttpApp } from '../../src/http/app';
import type { BuildHttpOptions } from '../../src/http/app';
import type { HttpContext } from '../../src/http/context';
import { createTestDatabase } from './db';

export async function createTestHttp(name: string, opts: BuildHttpOptions = {}): Promise<{ app: FastifyInstance; ctx: HttpContext; close: () => Promise<void> }> {
  const store = new Store(await createTestDatabase(name));
  const env = loadEnv({ NODE_ENV: 'test', COOKIE_SECURE: 'false' });
  const audit = new AuditService(store);
  const ctx: HttpContext = {
    env,
    store,
    sessions: new SessionService(store, { playerMs: env.sessionTtlMs, adminMs: env.adminSessionTtlMs }),
    adminAuth: new AdminAuthService(store, audit),
    audit,
    metrics: new MetricsRegistry(),
    limiters: new Map(),
    now: Date.now,
  };
  const app = await buildHttpApp(ctx, opts);
  return {
    app,
    ctx,
    close: async () => {
      await app.close();
      await store.close();
    },
  };
}

/** Extracts cookies from a light-my-request response into a Cookie header and returns the CSRF token. */
export function cookieJar(res: { cookies: Array<{ name: string; value: string }> }): { cookie: string; csrf: string } {
  const jar = res.cookies.filter((c) => c.value !== '');
  return { cookie: jar.map((c) => `${c.name}=${c.value}`).join('; '), csrf: jar.find((c) => c.name === 'jpb_csrf')?.value ?? '' };
}
