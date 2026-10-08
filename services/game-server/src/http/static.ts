import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';

/**
 * Serves the three built web apps from STATIC_DIR:
 *   /            player app      (STATIC_DIR/player)   — /join/:code, /play, ...
 *   /admin/      control room    (STATIC_DIR/admin)
 *   /display/    broadcast       (STATIC_DIR/display)
 * Unknown GET paths fall back to the owning app's index.html (client routing).
 * Hashed assets are cached for a year; index.html is never cached.
 */
export interface StaticApps {
  register(app: FastifyInstance): Promise<void>;
  fallback(req: FastifyRequest, reply: FastifyReply): Promise<boolean>;
}

const APPS = [
  { prefix: '/admin/', dir: 'admin' },
  { prefix: '/display/', dir: 'display' },
  { prefix: '/', dir: 'player' },
] as const;

export function staticApps(staticDir: string): StaticApps {
  const present = APPS.filter((a) => existsSync(join(staticDir, a.dir, 'index.html')));
  const indexes = new Map<string, Promise<string>>();
  const index = (dir: string) => {
    let p = indexes.get(dir);
    if (!p) {
      p = readFile(join(staticDir, dir, 'index.html'), 'utf8');
      indexes.set(dir, p);
    }
    return p;
  };
  return {
    async register(app) {
      for (const a of present) {
        await app.register(fastifyStatic, {
          root: join(staticDir, a.dir),
          prefix: a.prefix,
          decorateReply: false,
          index: false,
          wildcard: true,
          setHeaders: (res, path) => {
            if (/[.-][A-Za-z0-9_-]{8,}\.(js|css|woff2?|png|svg|webp|jpg)$/.test(path)) res.header('Cache-Control', 'public, max-age=31536000, immutable');
            else res.header('Cache-Control', 'no-cache');
          },
        });
      }
    },
    async fallback(req, reply) {
      const path = req.url.split('?')[0] ?? '/';
      const owner = present.find((a) => path === a.prefix.replace(/\/$/, '') || path.startsWith(a.prefix));
      if (!owner) return false;
      // A missing asset (file extension) is a real 404, not a page.
      if (/\.[a-z0-9]{2,5}$/i.test(path) && !path.endsWith('.html')) return false;
      reply.header('Cache-Control', 'no-cache').type('text/html; charset=utf-8').send(await index(owner.dir));
      return true;
    },
  };
}
