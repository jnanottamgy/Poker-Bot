import type { FastifyInstance } from 'fastify';
import type { HttpContext } from '../context';
import { header, requireAdmin } from '../context';
import { constantTimeEqual } from '../../security/crypto';

export function registerHealthRoutes(app: FastifyInstance, ctx: HttpContext): void {
  /** Liveness: the process is up. */
  app.get('/healthz', async () => ({ ok: true, node: ctx.env.nodeId, role: ctx.env.role }));

  /** Readiness: dependencies reachable. */
  app.get('/readyz', async (_req, reply) => {
    try {
      await ctx.store.db.query('SELECT 1');
      return { ok: true };
    } catch {
      return reply.status(503).send({ ok: false, error: { code: 'DB_UNAVAILABLE', message: 'Database unavailable' } });
    }
  });

  /** Prometheus scrape endpoint: bearer METRICS_TOKEN or an admin session with METRICS_VIEW. */
  app.get('/metrics', async (req, reply) => {
    const token = process.env.METRICS_TOKEN;
    const auth = header(req, 'authorization');
    const bearerOk = !!token && !!auth && constantTimeEqual(auth, `Bearer ${token}`);
    if (!bearerOk) await requireAdmin(ctx, req, 'METRICS_VIEW');
    reply.header('Content-Type', 'text/plain; version=0.0.4');
    return ctx.metrics.render();
  });
}
