import type { LiveMetricsPoint } from '@jpb/shared-types';
import type { MetricsCatalog } from '../observability/catalog';
import type { GameService } from './game-service';

/**
 * Time series for the admin control room charts (players remaining, tables,
 * hands/min, actions/s, action latency percentiles, connections). Sampled
 * every `everyMs` for every live tournament; kept in memory (last hour by
 * default) — the database stays the record of truth, these are gauges.
 */
export class LiveMetricsSampler {
  private readonly series = new Map<string, LiveMetricsPoint[]>();
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;

  constructor(
    private readonly game: GameService,
    private readonly metrics: MetricsCatalog,
    private readonly connections: () => number,
    private readonly opts: { everyMs?: number; keep?: number } = {},
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (!this.running) this.running = this.sample().catch(() => undefined).finally(() => (this.running = null));
    }, this.opts.everyMs ?? 5000);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running;
  }

  points(tournamentId: string): LiveMetricsPoint[] {
    return this.series.get(tournamentId) ?? [];
  }

  /** Hands per minute over the last minute of samples (0 when unknown). */
  handsPerMinute(tournamentId: string): number {
    return this.points(tournamentId).at(-1)?.handsPerMinute ?? 0;
  }

  async sample(now = Date.now()): Promise<void> {
    const live = await this.game.store.repos.tournaments.listLive();
    const lat = this.metrics.windows.actionLatency.percentiles();
    const aps = this.metrics.windows.actionsPerSecond.perSecond(now, 10);
    const connections = this.connections();
    const liveIds = new Set(live.map((t) => t.id));
    for (const id of [...this.series.keys()]) if (!liveIds.has(id)) this.series.delete(id);
    for (const t of live) {
      const summary = await this.game.tournamentSummary(t.id).catch(() => null);
      if (!summary) continue;
      this.metrics.activePlayers.set(summary.counters.active, { tournament: t.id });
      this.metrics.activeTables.set(summary.counters.tables, { tournament: t.id });
      const list = this.series.get(t.id) ?? [];
      const hands = summary.counters.handsCompleted;
      // Hands/min from the sample about a minute ago.
      const ref = [...list].reverse().find((p) => now - p.at >= 55_000) ?? list[0];
      const refHands = ref ? (this.handsAt.get(`${t.id}:${ref.at}`) ?? hands) : hands;
      const minutes = ref ? Math.max(1 / 60, (now - ref.at) / 60_000) : 1;
      const point: LiveMetricsPoint = {
        at: now,
        playersRemaining: summary.counters.active,
        tables: summary.counters.tables,
        handsPerMinute: ref ? Math.round(((hands - refHands) / minutes) * 10) / 10 : 0,
        actionsPerSecond: Math.round(aps * 10) / 10,
        actionLatencyP50: lat.p50,
        actionLatencyP95: lat.p95,
        actionLatencyP99: lat.p99,
        connections,
      };
      this.handsAt.set(`${t.id}:${now}`, hands);
      list.push(point);
      const keep = this.opts.keep ?? 720;
      while (list.length > keep) {
        const dropped = list.shift()!;
        this.handsAt.delete(`${t.id}:${dropped.at}`);
      }
      this.series.set(t.id, list);
    }
  }

  private readonly handsAt = new Map<string, number>();
}
