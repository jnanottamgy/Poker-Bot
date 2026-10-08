import type { LiveMetricsPoint, SystemDto } from '@jpb/shared-types';
import { Panel, Skeleton, formatCount } from '@jpb/ui';
import { LineChart } from '../../components/LineChart';

const AUDIENCE_ORDER = ['PLAYER', 'SPECTATOR', 'DISPLAY', 'ADMIN'];

function AudienceBars({ system }: { system: SystemDto }) {
  const entries = Object.entries(system.connections).sort((a, b) => AUDIENCE_ORDER.indexOf(a[0]) - AUDIENCE_ORDER.indexOf(b[0]));
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return (
    <div className="acr-audience">
      <p className="acr-audience__title">WebSocket connections by audience</p>
      <ul>
        {entries.map(([k, v]) => (
          <li key={k}>
            <span className="acr-audience__label">{k.charAt(0) + k.slice(1).toLowerCase()}</span>
            <span className="acr-audience__bar" aria-hidden="true">
              <span style={{ width: `${Math.max(2, (v / max) * 100)}%` }} />
            </span>
            <span className="acr-audience__value jpb-num">{formatCount(v)}</span>
          </li>
        ))}
      </ul>
      <p className="acr-audience__rates">
        <span>
          Disconnects <strong className="jpb-num">{system.rates.disconnectsPerSecond.toFixed(2)}/s</strong>
        </span>
        <span>
          Reconnects <strong className="jpb-num">{system.rates.reconnectsPerSecond.toFixed(2)}/s</strong>
        </span>
      </p>
    </div>
  );
}

/** §2.3 charts: players remaining · hands/min · action latency p50/p95/p99 · connections. */
export function ChartsPanel({ points, system, loading }: { points: LiveMetricsPoint[] | undefined; system: SystemDto | undefined; loading: boolean }) {
  if (loading && !points) {
    return (
      <div className="acr-charts">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} shape="block" height={230} />
        ))}
      </div>
    );
  }
  const p = points ?? [];
  const x = p.map((d) => d.at);
  if (p.length < 2) {
    return (
      <Panel title="Trends" icon="activity">
        <p className="acr-muted">Charts appear once the tournament has been running for a couple of minutes.</p>
      </Panel>
    );
  }
  return (
    <div className="acr-charts">
      <Panel title="Players remaining" icon="users" description="Last 2 hours, one point per minute">
        <LineChart label="Players remaining over time" x={x} series={[{ id: 'players', label: 'Players', values: p.map((d) => d.playersRemaining) }]} />
      </Panel>
      <Panel title="Hands per minute" icon="zap" description="Across all tables">
        <LineChart label="Hands per minute" x={x} series={[{ id: 'hpm', label: 'Hands/min', values: p.map((d) => d.handsPerMinute) }]} />
      </Panel>
      <Panel title="Action latency" icon="activity" description="Server time from intent to accepted action">
        <LineChart
          label="Action latency percentiles"
          unit="ms"
          x={x}
          series={[
            { id: 'p50', label: 'p50', slot: 1, dash: 'dotted', values: p.map((d) => d.actionLatencyP50) },
            { id: 'p95', label: 'p95', slot: 2, dash: 'dashed', values: p.map((d) => d.actionLatencyP95) },
            { id: 'p99', label: 'p99', slot: 3, dash: 'solid', values: p.map((d) => d.actionLatencyP99) },
          ]}
        />
      </Panel>
      <Panel title="Connections" icon="wifi" description="Open WebSocket connections">
        <LineChart label="WebSocket connections" x={x} series={[{ id: 'conn', label: 'Connections', values: p.map((d) => d.connections) }]} height={128} />
        {system && <AudienceBars system={system} />}
      </Panel>
    </div>
  );
}
