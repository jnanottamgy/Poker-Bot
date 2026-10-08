import type { AlertCode } from '@jpb/shared-types';
import type { MessageBus } from '../bus/bus';
import { channels } from '../bus/bus';
import type { RuntimeLogger } from '../runtime/actor-host';
import type { MetricsCatalog } from '../observability/catalog';
import { newId } from '../security/ids';
import type { GameService } from './game-service';
import type { TableActorCommand, TableInternals } from './table-actor';

export interface HealthMonitorOptions {
  /** A table in a hand / between hands with no progress for this long is stalled. */
  stallThresholdMs: number;
  /** Action latency p95 above this raises ACTION_LATENCY_HIGH. */
  actionLatencyAlertMs: number;
  everyMs?: number;
  /** Re-fire a timer this long past its deadline (it should have fired by itself). */
  overdueTimerMs?: number;
}

/**
 * Watches the actors hosted on this node (spec §107 stall detection):
 *  - a timer that is overdue (lost wake-up) is re-fired with its own token —
 *    the reducer ignores it if it is stale, so this is always safe;
 *  - an overdue director TICK is re-submitted the same way;
 *  - a table without progress beyond the threshold raises TABLE_STALLED (and
 *    the alert resolves itself once the table progresses again);
 *  - sustained high action latency raises ACTION_LATENCY_HIGH.
 */
export class HealthMonitor {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private readonly stalled = new Set<string>();
  private readonly integrityFailed = new Set<string>();
  private latencyAlerted = false;

  constructor(
    private readonly game: GameService,
    private readonly bus: MessageBus,
    private readonly metrics: MetricsCatalog | null,
    private readonly opts: HealthMonitorOptions,
    private readonly logger?: RuntimeLogger,
  ) {}

  start(): void {
    if (this.timer || this.game.node.role === 'gateway') return;
    this.timer = setInterval(() => {
      if (!this.running) this.running = this.check().catch((err: unknown) => this.logger?.warn({ err: String(err) }, 'health check failed')).finally(() => (this.running = null));
    }, this.opts.everyMs ?? 5000);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running;
  }

  async check(now = Date.now()): Promise<void> {
    const host = this.game.node.host;
    const overdue = this.opts.overdueTimerMs ?? 3000;
    for (const tournamentId of host.hostedIds('director')) {
      if (!host.isActive('director', tournamentId)) continue;
      const h = await this.game.directorQuery<{ nextTickAt: number | null; integrityOk: boolean }>(tournamentId, { q: 'HEALTH' }).catch(() => null);
      if (h && !h.integrityOk && !this.integrityFailed.has(tournamentId)) {
        this.integrityFailed.add(tournamentId);
        this.metrics?.integrityViolations.inc({ code: 'CHIP_CONSERVATION' });
      } else if (h?.integrityOk) this.integrityFailed.delete(tournamentId);
      if (h?.nextTickAt !== null && h?.nextTickAt !== undefined && now - h.nextTickAt > overdue) {
        this.logger?.warn({ tournamentId }, 'director tick overdue: re-submitting');
        await this.game.node.submit('director', tournamentId, { kind: 'TICK' }).catch(() => undefined);
      }
    }
    for (const tableId of host.hostedIds('table')) {
      if (!host.isActive('table', tableId)) continue;
      const t = await this.game.tableQuery<TableInternals>(tableId, { q: 'INTERNALS' }).catch(() => null);
      if (!t) continue;
      for (const timer of t.timers) {
        if (now - timer.at > overdue) {
          this.logger?.warn({ tableId, key: timer.key }, 'table timer overdue: re-firing');
          const cmd: TableActorCommand = { kind: 'TIMER', command: { type: 'TIMER_FIRED', kind: timer.key as 'ACTION_TIMEOUT' | 'NEXT_HAND', token: timer.token } };
          await this.game.node.submit('table', tableId, cmd).catch(() => undefined);
        }
      }
      const active = (t.status === 'IN_HAND' || t.status === 'BETWEEN_HANDS') && !t.frozen && t.holds.length === 0 && t.seated >= 2;
      const isStalled = active && t.lastProgressAt !== null && now - t.lastProgressAt > this.opts.stallThresholdMs;
      const tournamentId = await this.game.tableTournament(tableId);
      if (isStalled && !this.stalled.has(tableId)) {
        this.stalled.add(tableId);
        this.metrics?.integrityViolations.inc({ code: 'TABLE_STALLED' });
        await this.raise(tournamentId, 'TABLE_STALLED', 'WARNING', `Table ${tableId} has made no progress for ${Math.round((now - (t.lastProgressAt ?? now)) / 1000)}s (status ${t.status}).`, `table:${tableId}`);
      } else if (!isStalled && this.stalled.has(tableId)) {
        this.stalled.delete(tableId);
        await this.game.store.repos.alerts.resolveByCode(tournamentId, 'TABLE_STALLED', `table:${tableId}`).catch(() => undefined);
      }
    }
    this.metrics?.tablesStalled.set(this.stalled.size);
    if (this.metrics) {
      const p = this.metrics.windows.actionLatency.percentiles();
      const high = p.count >= 20 && p.p95 > this.opts.actionLatencyAlertMs;
      if (high && !this.latencyAlerted) {
        this.latencyAlerted = true;
        await this.raise(null, 'ACTION_LATENCY_HIGH', 'WARNING', `Action latency p95 is ${p.p95} ms (threshold ${this.opts.actionLatencyAlertMs} ms) on node ${this.game.node.nodeId}.`, `node:${this.game.node.nodeId}`);
      } else if (!high && this.latencyAlerted && p.p95 < this.opts.actionLatencyAlertMs * 0.8) {
        this.latencyAlerted = false;
        await this.game.store.repos.alerts.resolveByCode(null, 'ACTION_LATENCY_HIGH', `node:${this.game.node.nodeId}`).catch(() => undefined);
      }
    }
  }

  private async raise(tournamentId: string | null, code: AlertCode, severity: 'WARNING' | 'CRITICAL', message: string, target: string): Promise<void> {
    const repos = this.game.store.repos;
    if (await repos.alerts.findOpen(tournamentId, code, target)) return;
    const alert = await repos.alerts.create({ id: newId('alt'), tournamentId, severity, code, message, target });
    if (tournamentId) await this.bus.publish(channels.admin(tournamentId), { kind: 'ALERT', alert }).catch(() => undefined);
  }
}
