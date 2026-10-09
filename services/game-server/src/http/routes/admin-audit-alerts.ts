import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { HttpContext } from '../context';
import { clientIp, requireAdmin } from '../context';
import { notFound } from '../errors';
import { optionalReason } from '../danger';
import { toCsv } from '../../util/csv';

const auditQuery = z.object({
  tournamentId: z.string().max(80).optional(),
  adminId: z.string().max(80).optional(),
  action: z.string().max(80).optional(),
  target: z.string().max(120).optional(),
  beforeSeq: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});

const alertQuery = z.object({
  tournamentId: z.string().max(80).optional(),
  open: z.enum(['true', 'false']).default('false'),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});

export function registerAuditAndAlertRoutes(app: FastifyInstance, ctx: HttpContext): void {
  app.get('/api/admin/audit', async (req) => {
    const q = auditQuery.parse(req.query);
    await requireAdmin(ctx, req, 'AUDIT_VIEW', q.tournamentId ?? null);
    const entries = await ctx.store.repos.audit.list(q);
    return { entries, nextBeforeSeq: entries.length === q.limit ? entries[entries.length - 1]?.seq ?? null : null };
  });

  app.get('/api/admin/audit/verify', async (req) => {
    await requireAdmin(ctx, req, 'AUDIT_VIEW');
    const result = await ctx.store.repos.audit.verify();
    return { ...result, intact: result.brokenAtSeq === null, verifiedAt: ctx.now() };
  });

  app.get('/api/admin/audit.csv', async (req, reply) => {
    const q = auditQuery.parse({ ...(req.query as object), limit: 1000 });
    // Same permission as the JSON log (docs/API.md): the CSV is the same data, paged through in full.
    await requireAdmin(ctx, req, 'AUDIT_VIEW', q.tournamentId ?? null);
    const rows: unknown[][] = [];
    let beforeSeq = q.beforeSeq;
    // Page through the whole log (bounded to 100k rows per export).
    for (let i = 0; i < 100; i++) {
      const page = await ctx.store.repos.audit.list({ ...q, beforeSeq, limit: 1000 });
      for (const e of page) {
        rows.push([e.seq, new Date(e.at).toISOString(), e.tournamentId, e.adminId, e.adminUsername, e.action, e.target, e.reason, e.beforeState, e.afterState, e.ip, e.prevHash, e.hash]);
      }
      if (page.length < 1000) break;
      beforeSeq = page[page.length - 1]!.seq;
    }
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', 'attachment; filename="audit-log.csv"');
    return toCsv(['seq', 'at', 'tournament', 'admin_id', 'admin', 'action', 'target', 'reason', 'before', 'after', 'ip', 'prev_hash', 'hash'], rows);
  });

  app.get('/api/admin/alerts', async (req) => {
    const q = alertQuery.parse(req.query);
    await requireAdmin(ctx, req, 'METRICS_VIEW', q.tournamentId ?? null);
    return { alerts: await ctx.store.repos.alerts.list({ tournamentId: q.tournamentId ?? null, openOnly: q.open === 'true', limit: q.limit }) };
  });

  app.post<{ Params: { id: string } }>('/api/admin/alerts/:id/ack', async (req) => {
    const p = await requireAdmin(ctx, req, 'ALERTS_MANAGE');
    const alert = await ctx.store.repos.alerts.acknowledge(req.params.id, p.admin.id);
    if (!alert) throw notFound('Unacknowledged alert');
    await ctx.audit.record({
      admin: p.admin,
      action: 'ALERT_ACKNOWLEDGED',
      target: `alert:${alert.id}`,
      tournamentId: alert.tournamentId,
      reason: optionalReason(req.body),
      before: null,
      after: { code: alert.code },
      ip: clientIp(req),
    });
    return { alert };
  });

  app.post<{ Params: { id: string } }>('/api/admin/alerts/:id/resolve', async (req) => {
    const p = await requireAdmin(ctx, req, 'ALERTS_MANAGE');
    await ctx.store.repos.alerts.resolve(req.params.id);
    await ctx.audit.record({
      admin: p.admin,
      action: 'ALERT_RESOLVED',
      target: `alert:${req.params.id}`,
      tournamentId: null,
      reason: optionalReason(req.body),
      before: null,
      after: null,
      ip: clientIp(req),
    });
    return { ok: true };
  });
}
