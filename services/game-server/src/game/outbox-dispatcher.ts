import type { MessageBus, Unsubscribe } from '../bus/bus';
import type { Store } from '../persistence/store';
import type { OutboxRow } from '../persistence/repos/outbox';
import type { NodeRuntime } from '../runtime/node-runtime';
import type { RuntimeLogger } from '../runtime/actor-host';
import { actorAddress, poolOf } from '../runtime/actor';
import { placeActor, roleServesPool } from '../runtime/placement';
import { isActorError } from '../runtime/errors';
import { OUTBOX_KICK_CHANNEL } from './messages';
import type { MetricsCatalog } from '../observability/catalog';
import type { ToDirector, ToTable } from './messages';

/**
 * Delivers durable inter-actor messages (director → table commands, table →
 * director reports) written to `actor_outbox` in the same transaction as the
 * command that produced them.
 *
 *  - Only the node hosting the SOURCE actor dispatches its rows, so there is
 *    one dispatcher per source. A source with rows that is hosted nowhere is
 *    activated by the node placement assigns it to (sweep).
 *  - Rows are delivered strictly in id order per (source, target); different
 *    targets proceed in parallel. A failed delivery stops that target's chain
 *    until the next attempt, so order is never broken.
 *  - A row is deleted only after the target durably processed it. A crash in
 *    between re-delivers it; receivers drop anything at or below the last
 *    sequence they applied (table: dseq, director: per-table rseq).
 *
 * Triggered by kicks published after commit (at-most-once) and by a periodic
 * sweep (repairs lost kicks, restarts and failed deliveries).
 */
export interface OutboxDispatcherOptions {
  store: Store;
  node: NodeRuntime;
  bus: MessageBus;
  logger?: RuntimeLogger;
  /** Recovery sweep period (default 1 s). */
  sweepMs?: number;
  /** Parallel target chains per source (default 64). */
  concurrency?: number;
  /** Rows fetched per round (default 2,000). */
  pageSize?: number;
  /** Per-delivery deadline (default 15 s). */
  deliveryTimeoutMs?: number;
  metrics?: MetricsCatalog;
}

interface SourceState {
  running: Promise<void> | null;
  again: boolean;
}

export interface OutboxStats {
  delivered: number;
  failures: number;
  lastError: string | null;
  lastErrorAt: number | null;
  activeSources: number;
}

export class OutboxDispatcher {
  private readonly sources = new Map<string, SourceState>();
  private unsub: Unsubscribe | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;
  private sweeping: Promise<void> | null = null;
  private stopped = true;
  private readonly counters: OutboxStats = { delivered: 0, failures: 0, lastError: null, lastErrorAt: null, activeSources: 0 };

  constructor(private readonly opts: OutboxDispatcherOptions) {}

  async start(): Promise<void> {
    if (this.opts.node.role === 'gateway') return;
    this.stopped = false;
    this.unsub = await this.opts.bus.subscribe(OUTBOX_KICK_CHANNEL, (msg) => {
      const m = msg as { sourceKind?: unknown; sourceId?: unknown };
      if (typeof m?.sourceKind === 'string' && typeof m.sourceId === 'string') this.kick(m.sourceKind, m.sourceId);
    });
    this.scheduleSweep(0);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.sweepTimer) clearTimeout(this.sweepTimer);
    this.sweepTimer = null;
    await this.unsub?.();
    this.unsub = null;
    await this.sweeping?.catch(() => undefined);
    await Promise.allSettled([...this.sources.values()].map((s) => s.running));
  }

  stats(): OutboxStats {
    return { ...this.counters, activeSources: [...this.sources.values()].filter((s) => s.running).length };
  }

  /** Dispatches the source's pending rows if this node hosts the source actor. */
  kick(sourceKind: string, sourceId: string): void {
    if (this.stopped) return;
    if (!this.opts.node.host.isActive(sourceKind, sourceId)) return;
    this.run(sourceKind, sourceId);
  }

  /** Resolves once nothing is being dispatched (tests). */
  async idle(): Promise<void> {
    for (;;) {
      const busy = [...this.sources.values()].filter((s) => s.running).map((s) => s.running);
      if (!busy.length) return;
      await Promise.allSettled(busy);
    }
  }

  private run(kind: string, id: string): void {
    const key = actorAddress(kind, id);
    let s = this.sources.get(key);
    if (!s) {
      s = { running: null, again: false };
      this.sources.set(key, s);
    }
    if (s.running) {
      s.again = true;
      return;
    }
    const state = s;
    state.running = (async () => {
      do {
        state.again = false;
        await this.dispatchSource(kind, id).catch((err: unknown) => this.noteError(err, `dispatch ${key}`));
      } while (state.again && !this.stopped);
    })().finally(() => {
      state.running = null;
      this.sources.delete(key);
    });
  }

  private async dispatchSource(kind: string, id: string): Promise<void> {
    const pageSize = this.opts.pageSize ?? 2000;
    for (;;) {
      if (this.stopped || !this.opts.node.host.isActive(kind, id)) return;
      const rows = await this.opts.store.repos.outbox.pendingFor(kind, id, pageSize);
      if (!rows.length) return;
      const chains = new Map<string, OutboxRow[]>();
      for (const r of rows) {
        const k = actorAddress(r.targetKind, r.targetId);
        let list = chains.get(k);
        if (!list) {
          list = [];
          chains.set(k, list);
        }
        list.push(r);
      }
      const results = await runLimited([...chains.values()], this.opts.concurrency ?? 64, (chain) => this.deliverChain(chain));
      if (results.some((ok) => !ok)) return; // retried by the sweep, order preserved
      if (rows.length < pageSize) return;
    }
  }

  /** Delivers one target's rows in order; returns false at the first failure. */
  private async deliverChain(chain: OutboxRow[]): Promise<boolean> {
    const delivered: number[] = [];
    let ok = true;
    for (const row of chain) {
      try {
        await this.deliver(row);
        delivered.push(row.id);
      } catch (err) {
        ok = false;
        this.noteError(err, `deliver ${row.sourceKind}:${row.sourceId} → ${row.targetKind}:${row.targetId} #${row.id}`);
        await this.opts.store.repos.outbox.recordFailure(row.id, String((err as Error)?.message ?? err)).catch(() => undefined);
        break;
      }
    }
    if (delivered.length) {
      await this.opts.store.repos.outbox.remove(delivered);
      this.counters.delivered += delivered.length;
    }
    return ok;
  }

  private async deliver(row: OutboxRow): Promise<void> {
    const timeoutMs = this.opts.deliveryTimeoutMs ?? 15_000;
    if (row.targetKind === 'table') {
      const p = row.payload as ToTable;
      await this.opts.node.submit('table', row.targetId, { kind: 'DIRECTOR', dseq: p.dseq, command: p.command }, { timeoutMs });
    } else if (row.targetKind === 'director') {
      const p = row.payload as ToDirector;
      await this.opts.node.submit('director', row.targetId, { kind: 'REPORT', tableId: p.tableId, rseq: p.rseq, input: p.input }, { timeoutMs });
      if (p.input.type === 'TABLE_HAND_RESULT' && this.opts.metrics) {
        this.opts.metrics.handsCompleted.inc();
        this.opts.metrics.windows.handsPerMinute.record(Date.now());
      }
    } else {
      throw new Error(`Unknown outbox target kind ${row.targetKind}`);
    }
  }

  private noteError(err: unknown, what: string): void {
    this.counters.failures++;
    this.counters.lastError = `${what}: ${String((err as Error)?.message ?? err)}`;
    this.counters.lastErrorAt = Date.now();
    const level = isActorError(err) && err.retryable ? 'info' : 'warn';
    this.opts.logger?.[level]({ err: String((err as Error)?.message ?? err) }, `outbox ${what} failed`);
  }

  private scheduleSweep(delayMs: number): void {
    if (this.stopped) return;
    this.sweepTimer = setTimeout(() => {
      this.sweeping = this.sweep()
        .catch((err: unknown) => this.noteError(err, 'sweep'))
        .finally(() => {
          this.sweeping = null;
          this.scheduleSweep(this.opts.sweepMs ?? 1000);
        });
    }, delayMs);
    this.sweepTimer.unref?.();
  }

  /** Dispatches every source hosted here; activates unhosted sources placed on this node. */
  async sweep(): Promise<void> {
    const node = this.opts.node;
    const sources = await this.opts.store.repos.outbox.sources();
    const members = node.membership.members();
    for (const s of sources) {
      if (this.stopped) return;
      if (node.host.isActive(s.sourceKind, s.sourceId)) {
        this.run(s.sourceKind, s.sourceId);
        continue;
      }
      if (node.host.isHosted(s.sourceKind, s.sourceId)) continue; // activating / draining / faulted
      const reg = node.host.registration(s.sourceKind);
      if (!reg) continue;
      const pool = poolOf(reg.definition);
      if (!roleServesPool(node.role, pool)) continue;
      if (placeActor(actorAddress(s.sourceKind, s.sourceId), pool, members) !== node.nodeId) continue;
      try {
        await node.host.activate(s.sourceKind, s.sourceId);
        this.run(s.sourceKind, s.sourceId);
      } catch (err) {
        this.noteError(err, `activate ${s.sourceKind}:${s.sourceId}`);
      }
    }
  }
}

async function runLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}
