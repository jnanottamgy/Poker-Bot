import { Link } from 'react-router';
import type { SystemDto } from '@jpb/shared-types';
import { EmptyState, Icon, Panel, StatusPill, cx, formatCount, formatPercent } from '@jpb/ui';
import { sectionHref } from '../../app/sections';
import { LineChart } from '../../components/LineChart';
import { formatDuration } from '../../lib/time';
import { TONE_WORD, audienceInfo, errorInfo, formatMs, formatRate, heartbeatAge, latencyTone, nodeHealth, sortedErrors, totalConnections } from './model';
import type { LatencyKind, Percentile, Sample } from './model';

/* ------------------------------------------------------------------ nodes */

export function NodesPanel({ nodes, now }: { nodes: SystemDto['nodes']; now: number }) {
  const tables = nodes.reduce((a, n) => a + n.ownedTables, 0);
  const directors = nodes.reduce((a, n) => a + n.ownedDirectors, 0);
  return (
    <Panel title="Nodes" icon="monitor" flush description={`${formatCount(nodes.length)} ${nodes.length === 1 ? 'node' : 'nodes'} · ${formatCount(tables)} table leases · ${formatCount(directors)} director leases`}>
      {nodes.length === 0 ? (
        <EmptyState compact icon="monitor" title="No nodes reported" description="The cluster membership is empty — the server may be starting." />
      ) : (
        <div className="acr-system-tablewrap" tabIndex={0} role="region" aria-label="Nodes (scrollable)">
          <table className="acr-system-table" aria-label="Nodes">
            <thead>
              <tr>
                <th scope="col">Node</th>
                <th scope="col">Role</th>
                <th scope="col">Health</th>
                <th scope="col" className="is-num">
                  Uptime
                </th>
                <th scope="col" className="is-num">
                  Heartbeat
                </th>
                <th scope="col" className="is-num">
                  Tables
                </th>
                <th scope="col" className="is-num">
                  Directors
                </th>
              </tr>
            </thead>
            <tbody>
              {nodes.map((n) => {
                const h = nodeHealth(n, nodes);
                const share = tables > 0 ? n.ownedTables / tables : 0;
                return (
                  <tr key={n.nodeId}>
                    <th scope="row" className="jpb-mono">
                      {n.nodeId}
                    </th>
                    <td>
                      <span className="acr-system-role">{n.role}</span>
                    </td>
                    <td>
                      <StatusPill size="sm" tone={h.tone} label={h.label} />
                    </td>
                    <td className="is-num jpb-num">{formatDuration(now - n.startedAt)}</td>
                    <td className="is-num jpb-num">{heartbeatAge(n, nodes) < 1_000 ? 'current' : `${formatDuration(heartbeatAge(n, nodes))} behind`}</td>
                    <td className="is-num">
                      <span className="acr-system-lease">
                        <span className="jpb-num">{formatCount(n.ownedTables)}</span>
                        <span className="acr-system-lease__bar" aria-hidden="true">
                          <span style={{ width: `${Math.round(share * 100)}%` }} />
                        </span>
                      </span>
                    </td>
                    <td className="is-num jpb-num">{formatCount(n.ownedDirectors)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ connections */

export function ConnectionsPanel({ connections }: { connections: SystemDto['connections'] }) {
  const total = totalConnections(connections);
  const order = ['PLAYER', 'SPECTATOR', 'DISPLAY', 'ADMIN'];
  const keys = [...order.filter((k) => k in connections), ...Object.keys(connections).filter((k) => !order.includes(k)).sort()];
  return (
    <Panel title="WebSocket connections" icon="wifi" description={`${formatCount(total)} open sockets by audience`}>
      {keys.length === 0 ? (
        <p className="acr-system-dim">No open connections.</p>
      ) : (
        <ul className="acr-system-bars" aria-label="Connections by audience">
          {keys.map((k, i) => {
            const n = connections[k] ?? 0;
            const a = audienceInfo(k);
            const share = total > 0 ? n / total : 0;
            return (
              <li key={k} className={`acr-system-bar is-s${(i % 3) + 1}`}>
                <span className="acr-system-bar__label" title={a.hint}>
                  <Icon name={a.icon} /> {a.label}
                </span>
                <span className="acr-system-bar__track" aria-hidden="true">
                  <span style={{ width: `${Math.max(share > 0 ? 1 : 0, Math.round(share * 100))}%` }} />
                </span>
                <span className="acr-system-bar__value jpb-num">{formatCount(n)}</span>
                <span className="acr-system-bar__pct jpb-num">{formatPercent(share)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ latency */

const PERCENTILES: readonly Percentile[] = ['p50', 'p95', 'p99'];
/** The shared LineChart needs three points for distinct x ticks. */
const MIN_CHART_SAMPLES = 3;

function LatencyRow({ kind, label, data }: { kind: LatencyKind; label: string; data: SystemDto['latency']['actions'] }) {
  return (
    <tr>
      <th scope="row">
        <span className="acr-system-latency__path">
          {label}
          <span className="acr-system-dim acr-system-latency__count">{formatCount(data.count)} samples</span>
        </span>
      </th>
      {PERCENTILES.map((p) => {
        const tone = latencyTone(kind, p, data[p]);
        return (
          <td key={p} className="is-num">
            <span className={cx('acr-system-ms', `is-${tone}`)}>
              <span className="jpb-num">{formatMs(data[p])}</span>
              <span className="acr-system-ms__word">{TONE_WORD[tone]}</span>
            </span>
          </td>
        );
      })}
    </tr>
  );
}

export function LatencyPanel({ latency, samples }: { latency: SystemDto['latency']; samples: Sample[] }) {
  return (
    <Panel title="Latency" icon="activity" description="Server-side processing time over the recent window. Colours follow the alert thresholds (action p99 ≥ 250 ms raises ACTION_LATENCY_HIGH).">
      <table className="acr-system-table acr-system-latency" aria-label="Latency percentiles">
        <thead>
          <tr>
            <th scope="col">Path</th>
            {PERCENTILES.map((p) => (
              <th key={p} scope="col" className="is-num">
                {p}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <LatencyRow kind="actions" label="Player actions" data={latency.actions} />
          <LatencyRow kind="db" label="Database" data={latency.db} />
        </tbody>
      </table>
      <p className="acr-system-dim acr-system-note">
        <Icon name="info" /> Redis latency is not reported by this server version (its health shows up as WebSocket fan-out errors below).
      </p>
      {samples.length >= MIN_CHART_SAMPLES ? (
        <LineChart
          label="Action latency while this page is open"
          x={samples.map((s) => s.at)}
          series={[
            { id: 'p50', label: 'p50', values: samples.map((s) => s.p50), slot: 1, dash: 'solid' },
            { id: 'p95', label: 'p95', values: samples.map((s) => s.p95), slot: 2, dash: 'dashed' },
            { id: 'p99', label: 'p99', values: samples.map((s) => s.p99), slot: 3, dash: 'dotted' },
          ]}
          unit="ms"
          formatValue={(v) => formatMs(v)}
          height={150}
        />
      ) : (
        <p className="acr-system-dim acr-system-chartwait">The trend chart fills in as the page refreshes.</p>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ rates */

export function RatesPanel({ rates }: { rates: SystemDto['rates'] }) {
  const items: Array<{ label: string; value: number; unit: string; hint: string }> = [
    { label: 'Actions', value: rates.actionsPerSecond, unit: '/s', hint: 'Player actions processed per second (10 s window)' },
    { label: 'Hands', value: rates.handsPerMinute, unit: '/min', hint: 'Hands completed per minute (60 s window)' },
    { label: 'Disconnects', value: rates.disconnectsPerSecond, unit: '/s', hint: 'Sockets closing per second' },
    { label: 'Reconnects', value: rates.reconnectsPerSecond, unit: '/s', hint: 'Sockets resuming per second' },
  ];
  const churn = rates.disconnectsPerSecond > 0 ? rates.reconnectsPerSecond / rates.disconnectsPerSecond : 1;
  return (
    <Panel title="Rates" icon="zap" description={rates.disconnectsPerSecond > 0 ? `Reconnects cover ${formatPercent(Math.min(1, churn))} of disconnects` : 'No disconnects in the window'}>
      <dl className="acr-system-rates">
        {items.map((it) => (
          <div key={it.label} title={it.hint}>
            <dt>{it.label}</dt>
            <dd>
              <span className="jpb-num">{formatRate(it.value)}</span>
              <span className="acr-system-dim">{it.unit}</span>
            </dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

/* ------------------------------------------------------------------ errors */

export function ErrorsPanel({ errors }: { errors: SystemDto['errors'] }) {
  const list = sortedErrors(errors);
  const bad = list.filter(([, n]) => n > 0).length;
  return (
    <Panel title="Error counters" icon="warning" tone={bad > 0 ? 'default' : 'default'} description={bad === 0 ? 'Every counter is at zero' : `${formatCount(bad)} non-zero counter${bad === 1 ? '' : 's'} since the node started`}>
      {list.length === 0 ? (
        <p className="acr-system-allclear">
          <Icon name="check-circle" /> No errors recorded.
        </p>
      ) : (
        <ul className="acr-system-errors" aria-label="Error counters">
          {list.map(([k, n]) => {
            const info = errorInfo(k);
            return (
              <li key={k} className={n > 0 ? 'is-bad' : 'is-zero'}>
                <Icon name={n > 0 ? 'warning' : 'check-circle'} />
                <span className="acr-system-errors__text">
                  <span className="acr-system-errors__label">{info.label}</span>
                  <span className="acr-system-dim">
                    {info.hint} · <span className="jpb-mono">{k}</span>
                  </span>
                </span>
                <span className="acr-system-errors__n jpb-num">{formatCount(n)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ stalled tables */

export function StalledPanel({ stalled, tournamentId, now }: { stalled: SystemDto['stalledTables']; tournamentId: string | null; now: number }) {
  return (
    <Panel title="Stalled tables" icon="clock" tone={stalled.length > 0 ? 'danger' : 'default'} description={stalled.length > 0 ? 'Live tables with no progress past the stall threshold' : 'Every live table is progressing'}>
      {stalled.length === 0 ? (
        <p className="acr-system-allclear">
          <Icon name="check-circle" /> No stalled tables.
        </p>
      ) : (
        <ul className="acr-system-stalled" aria-label="Stalled tables">
          {stalled.map((t) => (
            <li key={t.tableId}>
              <Icon name="critical" />
              {tournamentId ? (
                <Link to={sectionHref('table-detail', tournamentId, { tableId: t.tableId })} className="acr-link">
                  Table {t.tableNumber}
                </Link>
              ) : (
                <span>Table {t.tableNumber}</span>
              )}
              <span className="acr-system-dim jpb-num">{t.lastProgressAt ? `no progress for ${formatDuration(now - t.lastProgressAt)}` : 'never progressed'}</span>
              <span className="acr-system-dim jpb-mono acr-system-stalled__id">{t.tableId}</span>
            </li>
          ))}
        </ul>
      )}
      {stalled.length > 0 && !tournamentId && <p className="acr-system-dim">Open a tournament to jump to its tables.</p>}
    </Panel>
  );
}
