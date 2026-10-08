/**
 * Minimal, dependency-free metrics registry with Prometheus text exposition
 * (spec §105). Counters, gauges and histograms with labels, plus a sliding
 * window latency tracker that reports exact recent p50/p95/p99 for the admin
 * control room.
 */
type Labels = Record<string, string>;

function labelKey(labels: Labels | undefined): string {
  if (!labels) return '';
  const keys = Object.keys(labels).sort();
  return keys.map((k) => `${k}="${escapeLabel(labels[k] ?? '')}"`).join(',');
}

function escapeLabel(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

interface Metric {
  name: string;
  help: string;
  type: 'counter' | 'gauge' | 'histogram';
  render(): string[];
}

export class Counter implements Metric {
  readonly type = 'counter' as const;
  private readonly values = new Map<string, number>();
  constructor(
    readonly name: string,
    readonly help: string,
  ) {}
  inc(labels?: Labels, by = 1): void {
    if (by < 0) throw new Error('Counter can only increase');
    const k = labelKey(labels);
    this.values.set(k, (this.values.get(k) ?? 0) + by);
  }
  get(labels?: Labels): number {
    return this.values.get(labelKey(labels)) ?? 0;
  }
  render(): string[] {
    return [...this.values].map(([k, v]) => `${this.name}${k ? `{${k}}` : ''} ${v}`);
  }
}

export class Gauge implements Metric {
  readonly type = 'gauge' as const;
  private readonly values = new Map<string, number>();
  constructor(
    readonly name: string,
    readonly help: string,
  ) {}
  set(value: number, labels?: Labels): void {
    this.values.set(labelKey(labels), value);
  }
  inc(labels?: Labels, by = 1): void {
    const k = labelKey(labels);
    this.values.set(k, (this.values.get(k) ?? 0) + by);
  }
  dec(labels?: Labels, by = 1): void {
    this.inc(labels, -by);
  }
  get(labels?: Labels): number {
    return this.values.get(labelKey(labels)) ?? 0;
  }
  render(): string[] {
    return [...this.values].map(([k, v]) => `${this.name}${k ? `{${k}}` : ''} ${v}`);
  }
}

export const DEFAULT_LATENCY_BUCKETS_MS = [1, 2, 5, 10, 25, 50, 100, 200, 500, 1000, 2500, 5000];

export class Histogram implements Metric {
  readonly type = 'histogram' as const;
  private readonly series = new Map<string, { counts: number[]; sum: number; count: number }>();
  constructor(
    readonly name: string,
    readonly help: string,
    readonly buckets: readonly number[] = DEFAULT_LATENCY_BUCKETS_MS,
  ) {}
  observe(value: number, labels?: Labels): void {
    const k = labelKey(labels);
    let s = this.series.get(k);
    if (!s) {
      s = { counts: new Array<number>(this.buckets.length).fill(0), sum: 0, count: 0 };
      this.series.set(k, s);
    }
    for (let i = 0; i < this.buckets.length; i++) if (value <= (this.buckets[i] ?? Infinity)) s.counts[i] = (s.counts[i] ?? 0) + 1;
    s.sum += value;
    s.count += 1;
  }
  render(): string[] {
    const lines: string[] = [];
    for (const [k, s] of this.series) {
      const sep = k ? `${k},` : '';
      this.buckets.forEach((b, i) => lines.push(`${this.name}_bucket{${sep}le="${b}"} ${s.counts[i] ?? 0}`));
      lines.push(`${this.name}_bucket{${sep}le="+Inf"} ${s.count}`);
      lines.push(`${this.name}_sum${k ? `{${k}}` : ''} ${s.sum}`);
      lines.push(`${this.name}_count${k ? `{${k}}` : ''} ${s.count}`);
    }
    return lines;
  }
}

/** Exact percentiles over the most recent `capacity` samples. */
export class LatencyWindow {
  private readonly samples: number[];
  private next = 0;
  private filled = 0;
  constructor(private readonly capacity = 2048) {
    this.samples = new Array<number>(capacity).fill(0);
  }
  record(ms: number): void {
    this.samples[this.next] = ms;
    this.next = (this.next + 1) % this.capacity;
    this.filled = Math.min(this.filled + 1, this.capacity);
  }
  percentiles(): { count: number; p50: number; p95: number; p99: number; max: number } {
    if (this.filled === 0) return { count: 0, p50: 0, p95: 0, p99: 0, max: 0 };
    const sorted = this.samples.slice(0, this.filled).sort((a, b) => a - b);
    const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] ?? 0;
    return { count: this.filled, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted[sorted.length - 1] ?? 0 };
  }
}

/** Events-per-second over a sliding window of 1-second buckets. */
export class RateWindow {
  private readonly buckets: number[];
  private readonly stamps: number[];
  constructor(private readonly seconds = 60) {
    this.buckets = new Array<number>(seconds).fill(0);
    this.stamps = new Array<number>(seconds).fill(-1);
  }
  record(now: number, n = 1): void {
    const sec = Math.floor(now / 1000);
    const i = sec % this.seconds;
    if (this.stamps[i] !== sec) {
      this.stamps[i] = sec;
      this.buckets[i] = 0;
    }
    this.buckets[i] = (this.buckets[i] ?? 0) + n;
  }
  /** Average per second over the last `window` full seconds. */
  perSecond(now: number, window = this.seconds): number {
    const sec = Math.floor(now / 1000);
    let total = 0;
    for (let s = sec - window; s < sec; s++) {
      const i = ((s % this.seconds) + this.seconds) % this.seconds;
      if (this.stamps[i] === s) total += this.buckets[i] ?? 0;
    }
    return total / window;
  }
}

export class MetricsRegistry {
  private readonly metrics = new Map<string, Metric>();

  counter(name: string, help: string): Counter {
    return this.register(new Counter(name, help));
  }
  gauge(name: string, help: string): Gauge {
    return this.register(new Gauge(name, help));
  }
  histogram(name: string, help: string, buckets?: readonly number[]): Histogram {
    return this.register(new Histogram(name, help, buckets));
  }

  private register<M extends Metric>(metric: M): M {
    const existing = this.metrics.get(metric.name);
    if (existing) {
      if (existing.type !== metric.type) throw new Error(`Metric ${metric.name} already registered with another type`);
      return existing as M;
    }
    this.metrics.set(metric.name, metric);
    return metric;
  }

  /** Prometheus text exposition format v0.0.4. */
  render(): string {
    const out: string[] = [];
    for (const m of this.metrics.values()) {
      out.push(`# HELP ${m.name} ${m.help}`);
      out.push(`# TYPE ${m.name} ${m.type}`);
      out.push(...m.render());
    }
    return out.join('\n') + '\n';
  }
}
