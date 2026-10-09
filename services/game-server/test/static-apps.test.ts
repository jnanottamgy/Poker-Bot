import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { staticApps } from '../src/http/static';

/** The three built apps as the Docker image lays them out under STATIC_DIR. */
describe('static web apps', () => {
  let dir: string;
  let app: FastifyInstance;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'jpb-static-'));
    for (const name of ['player', 'admin', 'display']) {
      mkdirSync(join(dir, name, 'assets'), { recursive: true });
      writeFileSync(join(dir, name, 'index.html'), `<!doctype html><title>${name}</title>`);
      writeFileSync(join(dir, name, 'assets', 'app-abcdef12.js'), `console.log('${name}')`);
    }
    const apps = staticApps(dir);
    app = Fastify();
    await apps.register(app);
    app.setNotFoundHandler(async (req, reply) => {
      if (req.method === 'GET' && (await apps.fallback(req, reply))) return reply;
      return reply.code(404).send({ code: 'NOT_FOUND' });
    });
    await app.ready();
  });
  afterAll(async () => {
    await app?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const get = (url: string) => app.inject({ method: 'GET', url });

  it.each([
    ['/', 'player'],
    ['/admin/', 'admin'],
    ['/admin', 'admin'],
    ['/display/', 'display'],
    ['/display', 'display'],
    ['/join/ABC123', 'player'],
    ['/admin/t/trn_1/overview', 'admin'],
    ['/display/?t=trn_1', 'display'],
    ['/display/ABC123', 'display'],
  ])('%s serves the %s app', async (url, name) => {
    const res = await get(url);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(`<title>${name}</title>`);
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('serves hashed assets with long caching and 404s missing ones', async () => {
    const res = await get('/admin/assets/app-abcdef12.js');
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('immutable');
    expect((await get('/admin/assets/missing-12345678.js')).statusCode).toBe(404);
  });
});
