import type { NodeDto, SystemDto } from '@jpb/shared-types';
import type { IconName, Tone } from '@jpb/ui';

/**
 * System screen model (§2.17): display thresholds, audience and error-counter
 * names, and the client-side latency history kept while the screen is open.
 */

/** Auto-refresh choices (seconds); 0 = off. */
export const REFRESH_CHOICES = [5, 10, 30, 60] as const;
export const DEFAULT_REFRESH_S = 10;

/** A node whose heartbeat is older than this is shown as late (display only; the cluster decides leases). */
export const HEARTBEAT_LATE_MS = 10_000;

/**
 * Latency colouring (ms). The action p99 critical threshold matches the
 * ACTION_LATENCY_HIGH alert (250 ms); the others are operator guidance.
 */
export const LATENCY_THRESHOLDS = {
  actions: { p50: { warn: 50, crit: 120 }, p95: { warn: 100, crit: 200 }, p99: { warn: 150, crit: 250 } },
  db: { p50: { warn: 10, crit: 40 }, p95: { warn: 25, crit: 80 }, p99: { warn: 50, crit: 150 } },
} as const;

export type LatencyKind = keyof typeof LATENCY_THRESHOLDS;
export type Percentile = 'p50' | 'p95' | 'p99';

export function latencyTone(kind: LatencyKind, p: Percentile, ms: number): Tone {
  const t = LATENCY_THRESHOLDS[kind][p];
  if (ms >= t.crit) return 'danger';
  if (ms >= t.warn) return 'warning';
  return 'positive';
}

export const TONE_WORD: Readonly<Partial<Record<Tone, string>>> = { positive: 'OK', warning: 'Slow', danger: 'Too slow' };

export const AUDIENCES: Readonly<Record<string, { label: string; icon: IconName; hint: string }>> = {
  PLAYER: { label: 'Players', icon: 'users', hint: 'Player phones and laptops' },
  SPECTATOR: { label: 'Spectators', icon: 'eye', hint: 'Delayed public watchers' },
  ADMIN: { label: 'Control room', icon: 'key', hint: 'Admin dashboards (like this one)' },
  DISPLAY: { label: 'Big screens', icon: 'monitor', hint: 'Broadcast displays' },
};

export function audienceInfo(key: string) {
  return AUDIENCES[key] ?? { label: key.charAt(0) + key.slice(1).toLowerCase(), icon: 'wifi' as IconName, hint: 'Other connections' };
}

/** Known error counters; anything else is shown with its raw name. */
export const ERROR_INFO: Readonly<Record<string, { label: string; hint: string }>> = {
  WS_SEND_FAILED: { label: 'WebSocket sends failed', hint: 'Messages that could not be delivered to a client' },
  DB_TIMEOUT: { label: 'Database timeouts', hint: 'Queries that did not finish in time (retried)' },
  DB_ERROR: { label: 'Database errors', hint: 'Failed reads or writes' },
  RATE_LIMITED: { label: 'Rate-limited requests', hint: 'Requests refused because a client sent too many' },
  ACTOR_FAULTED: { label: 'Faulted table/director processes', hint: 'Being rebuilt from their command logs right now' },
  OUTBOX_PENDING: { label: 'Events waiting to publish', hint: 'Committed events not yet fanned out to clients' },
  http: { label: 'HTTP errors', hint: 'Server errors answering API requests' },
  ws: { label: 'WebSocket errors', hint: 'Socket protocol or delivery errors' },
  db: { label: 'Database errors', hint: 'Failed reads or writes' },
  other: { label: 'Other errors', hint: 'Errors without a category' },
};

export function errorInfo(key: string) {
  return ERROR_INFO[key] ?? { label: key.replace(/[_-]+/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()), hint: 'Server error counter' };
}

/** Errors with the non-zero ones first (largest first), then the rest by name. */
export function sortedErrors(errors: SystemDto['errors']): Array<[string, number]> {
  return Object.entries(errors).sort(([ka, a], [kb, b]) => (b > 0 ? 1 : 0) - (a > 0 ? 1 : 0) || b - a || ka.localeCompare(kb));
}

/** Late = its heartbeat lags the newest one in the same snapshot by more than HEARTBEAT_LATE_MS. */
export function nodeHealth(n: NodeDto, nodes: readonly NodeDto[]): { tone: Tone; label: string } {
  return heartbeatAge(n, nodes) > HEARTBEAT_LATE_MS ? { tone: 'warning', label: 'Heartbeat late' } : { tone: 'positive', label: 'Healthy' };
}

/**
 * Server "now" for ages (uptime, heartbeat, stall time) without trusting the
 * browser clock: the newest heartbeat is the server's time at the response
 * (the reporting node stamps itself), plus the time elapsed on this page since.
 */
export function estimateServerNow(s: Pick<SystemDto, 'nodes'>, receivedAt: number, clientNow: number): number {
  const newest = s.nodes.reduce((m, n) => Math.max(m, n.lastHeartbeatAt), 0);
  if (newest === 0 || receivedAt === 0) return clientNow;
  return newest + Math.max(0, clientNow - receivedAt);
}

/** Heartbeat age relative to the newest heartbeat in the same response. */
export function heartbeatAge(n: NodeDto, nodes: readonly NodeDto[]): number {
  const newest = nodes.reduce((m, x) => Math.max(m, x.lastHeartbeatAt), 0);
  return Math.max(0, newest - n.lastHeartbeatAt);
}

export function totalConnections(c: SystemDto['connections']): number {
  return Object.values(c).reduce((a, n) => a + n, 0);
}

/** One reading kept for the in-page latency chart (the API returns only the current window). */
export interface Sample {
  at: number;
  p50: number;
  p95: number;
  p99: number;
  dbP95: number;
  connections: number;
  actionsPerSecond: number;
}

export const MAX_SAMPLES = 120;

export function toSample(s: SystemDto, at: number): Sample {
  return {
    at,
    p50: s.latency.actions.p50,
    p95: s.latency.actions.p95,
    p99: s.latency.actions.p99,
    dbP95: s.latency.db.p95,
    connections: totalConnections(s.connections),
    actionsPerSecond: s.rates.actionsPerSecond,
  };
}

export function pushSample(list: readonly Sample[], s: Sample, max = MAX_SAMPLES): Sample[] {
  if (list.length > 0 && list[list.length - 1]!.at === s.at) return [...list];
  const next = [...list, s];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** "12.3 ms" / "840 ms" / "1.2 s". */
export function formatMs(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms >= 100) return `${Math.round(ms)} ms`;
  return `${Math.round(ms * 10) / 10} ms`;
}

/** Rates arrive rounded to one decimal. */
export function formatRate(n: number): string {
  return Number.isFinite(n) ? (Math.round(n * 10) / 10).toLocaleString('en-US', { maximumFractionDigits: 1 }) : '—';
}
