import { useEffect, useState } from 'react';
import { Alert, Button, EmptyState, ErrorState, Skeleton, StatTile, Toggle, cx, formatCount } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import { friendlyError } from '../../api/errors';
import { qk } from '../../api/query/keys';
import { useQuery } from '../../api/query/useQuery';
import { usePermission } from '../../auth/permissions';
import { useCurrentTournamentId } from '../../auth/scope';
import { PageHeader } from '../../components/PageHeader';
import { formatDuration, formatTimeOfDay } from '../../lib/time';
import { useNow } from '../alerts/useNow';
import { IntegrityPanel } from './IntegrityPanel';
import { DEFAULT_REFRESH_S, REFRESH_CHOICES, TONE_WORD, estimateServerNow, formatMs, formatRate, latencyTone, nodeHealth, pushSample, toSample, totalConnections } from './model';
import type { Sample } from './model';
import { ConnectionsPanel, ErrorsPanel, LatencyPanel, NodesPanel, RatesPanel, StalledPanel } from './Panels';
import './system.css';

const PREF_KEY = 'jpb.admin.system.refresh';

/** Remembered auto-refresh interval (per browser, a convenience only). */
function readPref(): number {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    const v = raw === null ? Number.NaN : Number(raw);
    return v === 0 || (REFRESH_CHOICES as readonly number[]).includes(v) ? v : DEFAULT_REFRESH_S;
  } catch {
    return DEFAULT_REFRESH_S;
  }
}

function writePref(v: number): void {
  try {
    localStorage.setItem(PREF_KEY, String(v));
  } catch {
    /* storage unavailable: the choice lasts for this visit only */
  }
}

/** §2.17 System — nodes, connections, latency, rates, errors, stalled tables and the integrity check. */
export default function SystemSection() {
  const api = useApi();
  const canView = usePermission('METRICS_VIEW', null);
  const tournamentId = useCurrentTournamentId();
  const [refreshS, setRefreshS] = useState(readPref);
  const [lastOn, setLastOn] = useState(refreshS || DEFAULT_REFRESH_S);
  const system = useQuery(qk.system(), (s) => api.system.get(s), { enabled: canView, pollMs: refreshS > 0 ? refreshS * 1000 : undefined, staleMs: 2_000 });
  const [samples, setSamples] = useState<Sample[]>([]);
  const now = useNow(1_000);

  useEffect(() => {
    if (system.data && system.updatedAt) setSamples((list) => pushSample(list, toSample(system.data!, system.updatedAt)));
  }, [system.data, system.updatedAt]);

  const setRefresh = (v: number) => {
    setRefreshS(v);
    if (v > 0) setLastOn(v);
    writePref(v);
  };

  const header = (
    <PageHeader
      title="System"
      icon="monitor"
      description="Health of the game-server cluster right now: nodes and their leases, live connections, latency, error counters and stalled tables."
      actions={
        canView ? (
          <div className="acr-system-refresh">
            <Toggle checked={refreshS > 0} onChange={(on) => setRefresh(on ? lastOn : 0)} label="Auto-refresh" />
            <label className="acr-system-refresh__every">
              <span className="jpb-sr-only">Refresh every</span>
              <span className="jpb-select-wrap">
                <select className="jpb-input jpb-select" value={refreshS || lastOn} disabled={refreshS === 0} onChange={(e) => setRefresh(Number(e.target.value))} aria-label="Refresh interval">
                  {REFRESH_CHOICES.map((s) => (
                    <option key={s} value={s}>
                      every {s} s
                    </option>
                  ))}
                </select>
              </span>
            </label>
            <Button size="sm" variant="secondary" icon="refresh" loading={system.fetching && !system.isLoading} loadingLabel="Refreshing…" onClick={() => void system.refetch()}>
              Refresh now
            </Button>
          </div>
        ) : undefined
      }
    />
  );

  if (!canView) {
    return (
      <div className="acr-page acr-system">
        {header}
        <EmptyState icon="lock" title="System metrics are restricted" description="Viewing system health requires the METRICS_VIEW permission." />
      </div>
    );
  }
  if (system.isLoading) {
    return (
      <div className="acr-page acr-system" aria-busy="true" aria-label="Loading system health">
        {header}
        <div className="acr-skeleton-grid">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} shape="block" height={104} />
          ))}
        </div>
        <Skeleton shape="block" height={320} />
      </div>
    );
  }
  if (!system.data) {
    return (
      <div className="acr-page acr-system">
        {header}
        <ErrorState title="Could not load system health" description={friendlyError(system.error).description} onRetry={() => void system.refetch()} />
      </div>
    );
  }

  const s = system.data;
  const stale = system.isStale;
  const serverNow = estimateServerNow(s, system.updatedAt, now);
  const late = s.nodes.filter((n) => nodeHealth(n, s.nodes).tone !== 'positive').length;
  const conns = totalConnections(s.connections);
  const actionTone = latencyTone('actions', 'p99', s.latency.actions.p99);
  const age = system.updatedAt ? now - system.updatedAt : 0;
  return (
    <div className="acr-page acr-system">
      {header}
      <p className={cx('acr-system-status', stale && 'is-stale')} aria-live="polite">
        {stale ? 'Not current — the last refresh failed. ' : refreshS > 0 ? `Live · refreshing every ${refreshS} s. ` : 'Auto-refresh is off. '}
        Updated {formatTimeOfDay(system.updatedAt)} ({formatDuration(age)} ago) · server version <span className="jpb-mono">{s.version}</span>
      </p>
      {stale && (
        <Alert severity="WARNING" title="Could not refresh system health" actions={<Button size="sm" variant="secondary" icon="refresh" onClick={() => void system.refetch()}>Retry</Button>}>
          {friendlyError(system.error).description} Figures below are greyed: they are the last data received.
        </Alert>
      )}
      <div className={cx('acr-system-body', stale && 'jpb-stale')}>
        <section className="acr-system-kpis" aria-label="Key figures">
          <StatTile label="Uptime" icon="clock" value={formatDuration(s.uptimeMs)} hint={`version ${s.version}`} />
          <StatTile label="Nodes" icon="monitor" value={formatCount(s.nodes.length)} tone={late > 0 ? 'warning' : 'default'} hint={late > 0 ? `${late} heartbeat late` : 'all heartbeating'} />
          <StatTile label="Connections" icon="wifi" value={formatCount(conns)} hint="open WebSockets" />
          <StatTile label="Actions / sec" icon="zap" value={formatRate(s.rates.actionsPerSecond)} hint={`${formatRate(s.rates.handsPerMinute)} hands / min`} />
          <StatTile label="Action p99" icon="activity" value={formatMs(s.latency.actions.p99)} tone={actionTone === 'danger' ? 'danger' : actionTone === 'warning' ? 'warning' : 'default'} hint={TONE_WORD[actionTone] === 'OK' ? 'within target' : TONE_WORD[actionTone]?.toLowerCase()} />
          <StatTile label="Stalled tables" icon="grid" value={formatCount(s.stalledTables.length)} tone={s.stalledTables.length > 0 ? 'danger' : 'positive'} hint={s.stalledTables.length > 0 ? 'need attention' : 'all progressing'} />
        </section>
        <div className="acr-system-grid">
          <div className="acr-system-col">
            <NodesPanel nodes={s.nodes} now={serverNow} />
            <LatencyPanel latency={s.latency} samples={samples} />
            <IntegrityPanel tournamentId={tournamentId} />
          </div>
          <div className="acr-system-col">
            <StalledPanel stalled={s.stalledTables} tournamentId={tournamentId} now={serverNow} />
            <ConnectionsPanel connections={s.connections} />
            <RatesPanel rates={s.rates} />
            <ErrorsPanel errors={s.errors} />
          </div>
        </div>
      </div>
    </div>
  );
}
