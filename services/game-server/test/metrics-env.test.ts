import { describe, expect, it } from 'vitest';
import { LatencyWindow, MetricsRegistry, RateWindow } from '../src/observability/metrics';
import { EnvError, loadEnv } from '../src/config/env';

describe('metrics', () => {
  it('renders prometheus text', () => {
    const r = new MetricsRegistry();
    const c = r.counter('jpb_actions_total', 'Player actions');
    c.inc({ result: 'ok' });
    c.inc({ result: 'ok' });
    c.inc({ result: 'rejected' });
    const h = r.histogram('jpb_action_latency_ms', 'Latency', [10, 100]);
    h.observe(5);
    h.observe(50);
    h.observe(500);
    const g = r.gauge('jpb_active_tables', 'Tables');
    g.set(125);
    const text = r.render();
    expect(text).toContain('# TYPE jpb_actions_total counter');
    expect(text).toContain('jpb_actions_total{result="ok"} 2');
    expect(text).toContain('jpb_action_latency_ms_bucket{le="10"} 1');
    expect(text).toContain('jpb_action_latency_ms_bucket{le="100"} 2');
    expect(text).toContain('jpb_action_latency_ms_bucket{le="+Inf"} 3');
    expect(text).toContain('jpb_active_tables 125');
  });
  it('computes exact recent percentiles', () => {
    const w = new LatencyWindow(100);
    for (let i = 1; i <= 100; i++) w.record(i);
    expect(w.percentiles()).toEqual({ count: 100, p50: 50, p95: 95, p99: 99, max: 100 });
  });
  it('computes rates over a sliding window', () => {
    const w = new RateWindow(10);
    for (let s = 0; s < 10; s++) w.record(s * 1000, 5);
    expect(w.perSecond(10_000, 10)).toBe(5);
    expect(w.perSecond(30_000, 10)).toBe(0);
  });
});

describe('env', () => {
  it('has safe development defaults', () => {
    const env = loadEnv({});
    expect(env.nodeEnv).toBe('development');
    expect(env.databaseUrl).toBeNull();
    expect(env.seedKeyIsEphemeral).toBe(true);
    expect(env.speedModeAllowed).toBe(true);
  });
  it('refuses unsafe production configuration', () => {
    expect(() => loadEnv({ NODE_ENV: 'production' })).toThrow(EnvError);
    const ok = loadEnv({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x', SEED_ENCRYPTION_KEY: 'ab'.repeat(32) });
    expect(ok.cookieSecure).toBe(true);
    expect(ok.speedModeAllowed).toBe(false);
    expect(ok.simulationAllowed).toBe(false);
  });
  it('requires redis for split roles', () => {
    expect(() => loadEnv({ NODE_ROLE: 'gateway' })).toThrow(EnvError);
  });
});
