import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { NodeDto, SystemDto } from '@jpb/shared-types';
import { requireAdmin } from '../context';
import { badRequest, HttpError, notFound } from '../errors';
import type { MetricsCatalog } from '../../observability/catalog';
import type { DemoRunner } from '../../game/demo';
import { DemoError } from '../../game/demo';
import type { GameRouteDeps } from './game-common';
import { limitAdmin } from './game-common';

export interface SystemRouteDeps extends GameRouteDeps {
  metrics: MetricsCatalog;
  demos: DemoRunner;
  connections: () => Record<string, number>;
  startedAt: number;
  version: string;
}

const demoBody = z.object({
  players: z.coerce.number().int().min(2),
  strategyMix: z.partialRecord(z.enum(['ALWAYS_FOLD', 'RANDOM_LEGAL_ACTION', 'CALL_HEAVY', 'RAISE_HEAVY', 'ALL_IN_RANDOMLY', 'TIMEOUT_ALWAYS', 'FLAKY']), z.number().min(0).max(1000)).default({}),
  speedMode: z.boolean().default(true),
  name: z.string().trim().max(80).optional(),
});

export function registerAdminSystemRoutes(app: FastifyInstance, deps: SystemRouteDeps): void {
  const { ctx, game } = deps;

  app.get('/api/admin/system', async (req) => {
    const p = await requireAdmin(ctx, req, 'METRICS_VIEW');
    limitAdmin(deps, req, p);
    const now = ctx.now();
    const stats = game.node.stats();
    const nodes: NodeDto[] = stats.members.map((m) => ({
      nodeId: m.nodeId,
      role: m.role,
      startedAt: m.startedAt,
      lastHeartbeatAt: now,
      ownedTables: m.nodeId === stats.nodeId ? stats.actors.filter((a) => a.kind === 'table').length : 0,
      ownedDirectors: m.nodeId === stats.nodeId ? stats.actors.filter((a) => a.kind === 'director').length : 0,
    }));
    const w = deps.metrics.windows;
    const stalled: SystemDto['stalledTables'] = [];
    const live = await ctx.store.repos.tournaments.listLive();
    for (const t of live) {
      for (const row of await ctx.store.repos.tableLogs.listStalled(t.id, new Date(now - ctx.env.stallThresholdMs))) {
        stalled.push({ tableId: row.id, tableNumber: row.tableNumber, lastProgressAt: row.lastProgressAt?.getTime() ?? null });
      }
    }
    const errors: Record<string, number> = {};
    for (const [labels, v] of deps.metrics.errors.entries()) errors[labels.replace(/^area="?|"$/g, '') || 'other'] = v;
    const faulted = stats.actors.filter((a) => a.faulted).length;
    if (faulted) errors.ACTOR_FAULTED = faulted;
    const outbox = await ctx.store.repos.outbox.countPending();
    if (outbox) errors.OUTBOX_PENDING = outbox;
    const actions = w.actionLatency.percentiles();
    const db = w.dbLatency.percentiles();
    const dto: SystemDto = {
      nodes,
      connections: deps.connections(),
      latency: {
        actions: { p50: actions.p50, p95: actions.p95, p99: actions.p99, count: actions.count },
        db: { p50: db.p50, p95: db.p95, p99: db.p99, count: db.count },
      },
      rates: {
        actionsPerSecond: round1(w.actionsPerSecond.perSecond(now, 10)),
        handsPerMinute: round1(w.handsPerMinute.perSecond(now, 60) * 60),
        disconnectsPerSecond: round1(w.disconnectsPerSecond.perSecond(now, 10)),
        reconnectsPerSecond: round1(w.reconnectsPerSecond.perSecond(now, 10)),
      },
      errors,
      stalledTables: stalled,
      uptimeMs: now - deps.startedAt,
      version: deps.version,
    };
    return dto;
  });

  // ------------------------------------------------------------------ demo mode

  app.post('/api/admin/demo', async (req) => {
    const p = await requireAdmin(ctx, req, 'SIMULATION_RUN');
    limitAdmin(deps, req, p);
    const body = demoBody.safeParse(req.body ?? {});
    if (!body.success) throw badRequest('INVALID_INPUT', 'Choose the number of bots (at least 2).');
    try {
      const status = await deps.demos.create({ players: body.data.players, strategyMix: body.data.strategyMix, speedMode: body.data.speedMode, ...(body.data.name ? { name: body.data.name } : {}) }, p.admin.id);
      await ctx.audit.record({ admin: p.admin, action: 'DEMO_STARTED', target: `tournament:${status.tournamentId}`, tournamentId: status.tournamentId, reason: null, before: null, after: { players: status.players }, ip: req.ip });
      return status;
    } catch (err) {
      if (err instanceof DemoError) throw new HttpError(err.code === 'INVALID_INPUT' ? 400 : 409, err.code, err.message);
      throw err;
    }
  });

  app.get<{ Params: { id: string } }>('/api/admin/demo/:id', async (req) => {
    const p = await requireAdmin(ctx, req, 'SIMULATION_RUN', req.params.id);
    limitAdmin(deps, req, p);
    const s = await deps.demos.status(req.params.id);
    if (!s) throw notFound('Demo');
    return s;
  });

  app.post<{ Params: { id: string } }>('/api/admin/demo/:id/stop', async (req) => {
    const p = await requireAdmin(ctx, req, 'SIMULATION_RUN', req.params.id);
    limitAdmin(deps, req, p);
    const s = await deps.demos.stop(req.params.id, p.admin.id);
    if (!s) throw notFound('Demo');
    await ctx.audit.record({ admin: p.admin, action: 'DEMO_STOPPED', target: `tournament:${s.tournamentId}`, tournamentId: s.tournamentId, reason: null, before: null, after: null, ip: req.ip });
    return s;
  });
}

const round1 = (n: number) => Math.round(n * 10) / 10;
