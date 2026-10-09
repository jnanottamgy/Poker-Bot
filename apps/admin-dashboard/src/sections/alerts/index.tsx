import { useCallback, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { AlertDto } from '@jpb/shared-types';
import { Alert, Button, EmptyState, ErrorState, Icon, IconButton, Panel, SearchInput, Select, Skeleton, StatusPill, Tabs, cx, formatCount } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import { friendlyError } from '../../api/errors';
import { qk } from '../../api/query/keys';
import { useQuery } from '../../api/query/useQuery';
import { useSession } from '../../auth/SessionProvider';
import { useGate, usePermission } from '../../auth/permissions';
import { useTournamentId } from '../../auth/scope';
import { PageHeader } from '../../components/PageHeader';
import { useTournamentState } from '../../live/useTournamentState';
import { formatAgo, formatDuration, formatTimeOfDay } from '../../lib/time';
import { VirtualGrid } from '../standings/VirtualGrid';
import type { GridColumn } from '../standings/VirtualGrid';
import { AlertDetail } from './AlertDetail';
import { ALERT_CODE_LIST, MAX_SEARCH, SEVERITIES, SEVERITY_META, SORT_LABELS, TAB_META, alertTab, codeInfo, countAlerts, filterAlerts, mergeAlerts, parseFilters, writeFilters } from './model';
import type { AlertFilters, AlertSort, AlertTab } from './model';
import { describeTarget } from './targets';
import { useAdminNames } from './useAdminNames';
import { useAlertActions } from './useAlertActions';
import { useNow } from './useNow';
import './alerts.css';

/** Alerts also arrive as live INTEGRITY_ALERT events (they invalidate this list); polling is the safety net. */
const POLL_MS = 10_000;
/** The server returns at most 1,000 alerts per request. */
const MAX_LIMIT = 1_000;
const HISTORY_STEP = 200;
const ROW_HEIGHT = 60;
const GRID_HEAD = 38;
const TABS: readonly AlertTab[] = ['open', 'acknowledged', 'resolved'];

function useAlertFilters(): [AlertFilters, (patch: Partial<AlertFilters>) => void, string | null, (id: string | null) => void] {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => parseFilters(params), [params]);
  const update = useCallback((patch: Partial<AlertFilters>) => setParams((prev) => writeFilters(prev, { ...parseFilters(prev), ...patch }), { replace: true }), [setParams]);
  const selected = params.get('alert');
  const select = useCallback(
    (id: string | null) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id) next.set('alert', id);
          else next.delete('alert');
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );
  return [filters, update, selected, select];
}

/** §2.15 Alerts — open / acknowledged / resolved, with what each code means and what to do. */
export default function AlertsSection() {
  const tournamentId = useTournamentId();
  const api = useApi();
  const { me } = useSession();
  const canView = usePermission('METRICS_VIEW');
  const manage = useGate('ALERTS_MANAGE');
  const state = useTournamentState(tournamentId);
  const actions = useAlertActions(tournamentId);
  const adminName = useAdminNames();
  const now = useNow();
  const [filters, update, selectedId, select] = useAlertFilters();
  const [historyLimit, setHistoryLimit] = useState(HISTORY_STEP);

  // Scoped admins only ever see their tournaments' alerts.
  const unscoped = me?.admin.tournamentScope === null;
  const scope = unscoped ? filters.scope : 'tournament';
  const base = scope === 'all' ? {} : { tournamentId };
  const openQ = { ...base, open: true, limit: MAX_LIMIT };
  const histQ = { ...base, open: false, limit: historyLimit };
  const open = useQuery(qk.alerts(openQ), (s) => api.alerts.list(openQ, s), { enabled: canView, pollMs: POLL_MS });
  const history = useQuery(qk.alerts(histQ), (s) => api.alerts.list(histQ, s), { enabled: canView, pollMs: POLL_MS * 3 });

  const all = useMemo(() => mergeAlerts(open.data?.alerts ?? [], history.data?.alerts ?? []), [open.data, history.data]);
  const shown = useMemo(() => filterAlerts(all, filters), [all, filters]);
  const counts = useMemo(() => countAlerts(all, filters.tab), [all, filters.tab]);
  const selected = selectedId ? (all.find((a) => a.id === selectedId) ?? null) : null;
  const historyFull = (history.data?.alerts.length ?? 0) >= historyLimit;
  const stale = open.isStale || history.isStale;
  const updatedAt = Math.min(open.updatedAt || Infinity, history.updatedAt || Infinity);
  const name = state.overview.data?.name;

  const openAll = all.filter((a) => alertTab(a) === 'open');
  const oldestOpen = openAll.reduce<AlertDto | null>((o, a) => (!o || a.at < o.at ? a : o), null);
  const bulk = filters.tab === 'open' ? shown : [];

  const refetch = () => {
    void open.refetch();
    void history.refetch();
  };

  const sevCol: GridColumn<AlertDto> = {
    key: 'sev',
    header: 'Severity',
    track: '112px',
    cell: (a) => {
      const m = SEVERITY_META[a.severity];
      return <StatusPill size="sm" tone={m.tone} icon={m.icon} label={m.label} />;
    },
  };
  const alertCol: GridColumn<AlertDto> = {
    key: 'alert',
    header: 'Alert',
    track: 'minmax(200px, 3fr)',
    cell: (a) => (
      <span className="acr-alerts-cellmain">
        <span className="acr-alerts-cellmain__title">
          {codeInfo(a.code).title}
          <span className="jpb-mono acr-alerts-cellmain__code">{a.code}</span>
        </span>
        <span className="acr-alerts-cellmain__msg" title={a.message}>
          {a.message}
        </span>
      </span>
    ),
  };
  const targetCol: GridColumn<AlertDto> = {
    key: 'target',
    header: 'Target',
    track: 'minmax(96px, 1fr)',
    cell: (a) => {
      const t = describeTarget(a.target, a.tournamentId ?? tournamentId, a.message);
      if (!t) return <span className="acr-alerts-dim">{a.tournamentId === null ? 'System' : '—'}</span>;
      return t.href ? (
        <Link to={t.href} className="acr-link acr-alerts-target" tabIndex={-1} title={a.target ?? undefined}>
          <Icon name={t.icon} /> {t.label}
        </Link>
      ) : (
        <span className="acr-alerts-target" title={a.target ?? undefined}>
          <Icon name={t.icon} /> {t.label}
        </span>
      );
    },
  };
  const raisedCol: GridColumn<AlertDto> = {
    key: 'raised',
    header: 'Raised',
    track: '92px',
    cell: (a) => (
      <span className="acr-alerts-when">
        <span className="jpb-num">{formatAgo(now - a.at)}</span>
        <span className="acr-alerts-dim jpb-num">{formatTimeOfDay(a.at)}</span>
      </span>
    ),
  };
  const ackCol: GridColumn<AlertDto> = {
    key: 'ack',
    header: 'Acknowledged',
    track: 'minmax(120px, 1fr)',
    cell: (a) => (
      <span className="acr-alerts-when" title={adminName(a.acknowledgedBy)}>
        <span className="acr-alerts-state is-ack">
          <Icon name="eye" /> {adminName(a.acknowledgedBy).split(' (')[0]}
        </span>
        <span className="acr-alerts-dim jpb-num">{a.acknowledgedAt ? formatAgo(now - a.acknowledgedAt) : ''}</span>
      </span>
    ),
  };
  const resolvedCol: GridColumn<AlertDto> = {
    key: 'resolved',
    header: 'Resolved',
    track: 'minmax(120px, 1fr)',
    cell: (a) => (
      <span className="acr-alerts-when">
        <span className="acr-alerts-state is-resolved">
          <Icon name="check-circle" /> {a.resolvedAt ? formatAgo(now - a.resolvedAt) : '—'}
        </span>
        <span className="acr-alerts-dim jpb-num">{a.resolvedAt ? `open ${formatDuration(a.resolvedAt - a.at)}` : ''}</span>
      </span>
    ),
  };
  const quickCol: GridColumn<AlertDto> = {
    key: 'act',
    header: <span className="jpb-sr-only">Quick actions</span>,
    track: filters.tab === 'open' ? '80px' : '44px',
    cell: (a) => (
      <span className="acr-alerts-quick">
        {alertTab(a) === 'open' && <IconButton size="sm" variant="secondary" icon="check" label={`Acknowledge ${codeInfo(a.code).title}: ${a.message}`} tabIndex={-1} onClick={() => void actions.acknowledge(a)} />}
        <IconButton size="sm" variant="secondary" icon="check-circle" label={`Resolve ${codeInfo(a.code).title}: ${a.message}`} tabIndex={-1} onClick={() => void actions.resolve(a)} />
      </span>
    ),
  };
  const columns: Array<GridColumn<AlertDto>> =
    filters.tab === 'resolved'
      ? [sevCol, alertCol, targetCol, raisedCol, resolvedCol]
      : [sevCol, alertCol, targetCol, raisedCol, ...(filters.tab === 'acknowledged' ? [ackCol] : []), ...(manage.allowed ? [quickCol] : [])];

  const header = (
    <PageHeader
      title="Alerts"
      icon="bell"
      eyebrow={name ?? 'Tournament'}
      description="Integrity, timing and infrastructure alerts raised by the server. Acknowledge to show you are on it; resolve once fixed. Every action is audit-logged."
      actions={
        <>
          {unscoped && (
            <div className="acr-alerts-scope" role="group" aria-label="Which alerts">
              <button type="button" className={cx('acr-alerts-seg', scope === 'tournament' && 'is-on')} aria-pressed={scope === 'tournament'} onClick={() => update({ scope: 'tournament' })}>
                This tournament
              </button>
              <button type="button" className={cx('acr-alerts-seg', scope === 'all' && 'is-on')} aria-pressed={scope === 'all'} onClick={() => update({ scope: 'all' })}>
                All + system
              </button>
            </div>
          )}
          <Button size="sm" variant="ghost" icon="refresh" onClick={refetch} loading={open.fetching && !open.isLoading} loadingLabel="Refreshing…">
            Refresh
          </Button>
        </>
      }
    />
  );

  if (!canView) {
    return (
      <div className="acr-page acr-alerts">
        {header}
        <EmptyState icon="lock" title="Alerts are restricted" description="Viewing alerts requires the METRICS_VIEW permission. Ask a super admin if you need access." />
      </div>
    );
  }
  if (open.isLoading) {
    return (
      <div className="acr-page acr-alerts" aria-busy="true" aria-label="Loading alerts">
        {header}
        <Skeleton shape="block" height={88} />
        <Skeleton shape="block" height={420} />
      </div>
    );
  }
  if (!open.data) {
    return (
      <div className="acr-page acr-alerts">
        {header}
        <ErrorState title="Could not load the alerts" description={friendlyError(open.error).description} onRetry={refetch} />
      </div>
    );
  }

  const sevChip = (value: AlertFilters['severity'], label: string, count: number) => {
    const m = value ? SEVERITY_META[value] : null;
    return (
      <button key={value || 'all'} type="button" className={cx('acr-alerts-chip', filters.severity === value && 'is-on', m && `is-${m.tone}`)} aria-pressed={filters.severity === value} onClick={() => update({ severity: value })}>
        <Icon name={m ? m.icon : 'list'} />
        {label}
        <span className="acr-alerts-chip__n jpb-num">{formatCount(count)}</span>
      </button>
    );
  };
  const tabTotal = counts.tabs[filters.tab];
  const gridHeight = { ['--acr-alerts-rows' as string]: `${Math.max(3, shown.length) * ROW_HEIGHT + GRID_HEAD + 2}px` } as CSSProperties;

  return (
    <div className="acr-page acr-alerts">
      {header}

      <section className="acr-alerts-summary" aria-label="Alert summary">
        {SEVERITIES.map((s) => {
          const m = SEVERITY_META[s];
          const n = openAll.filter((a) => a.severity === s).length;
          return (
            <button key={s} type="button" className={cx('acr-alerts-sum', `is-${m.tone}`, n > 0 && 'has-some')} onClick={() => update({ tab: 'open', severity: s })}>
              <span className="acr-alerts-sum__label">
                <Icon name={m.icon} /> Open {m.label.toLowerCase()}
              </span>
              <span className="acr-alerts-sum__value jpb-num">{formatCount(n)}</span>
            </button>
          );
        })}
        <button type="button" className="acr-alerts-sum is-info" onClick={() => update({ tab: 'acknowledged', severity: '' })}>
          <span className="acr-alerts-sum__label">
            <Icon name="eye" /> Acknowledged
          </span>
          <span className="acr-alerts-sum__value jpb-num">{formatCount(counts.tabs.acknowledged)}</span>
        </button>
        <div className="acr-alerts-sum is-static">
          <span className="acr-alerts-sum__label">
            <Icon name="clock" /> Oldest unacknowledged
          </span>
          <span className="acr-alerts-sum__value jpb-num">{oldestOpen ? formatAgo(now - oldestOpen.at).replace(' ago', '') : '—'}</span>
        </div>
      </section>

      {!manage.allowed && (
        <Alert severity="INFO" title="Read-only">
          You can see alerts but not acknowledge or resolve them: that requires ALERTS_MANAGE.
        </Alert>
      )}

      <div className="acr-alerts-layout">
        <Panel
          flush
          className={cx('acr-alerts-main', stale && 'jpb-stale')}
          title={scope === 'all' ? 'All tournaments and system' : 'This tournament'}
          description={`${formatCount(counts.tabs.open + counts.tabs.acknowledged)} open · ${formatCount(counts.tabs.resolved)} resolved in the loaded history`}
          actions={
            Number.isFinite(updatedAt) ? (
              <span className={cx('acr-alerts-updated', stale && 'is-stale')}>
                {stale ? 'Not current · ' : 'Updated '}
                {formatTimeOfDay(updatedAt)}
              </span>
            ) : null
          }
        >
          <Tabs
            label="Alert state"
            value={filters.tab}
            onChange={(v) => update({ tab: v as AlertTab })}
            tabs={TABS.map((t) => ({ id: t, label: TAB_META[t].label, count: counts.tabs[t] }))}
            className="acr-alerts-tabs"
          >
            <div className="acr-alerts-toolbar">
              <div className="acr-alerts-chips" role="group" aria-label="Filter by severity">
                {sevChip('', 'All', tabTotal)}
                {SEVERITIES.map((s) => sevChip(s, SEVERITY_META[s].label, counts.severity[s]))}
              </div>
              <Select
                label="Alert code"
                hideLabel
                className="acr-alerts-code"
                value={filters.code}
                onChange={(e) => update({ code: e.target.value as AlertFilters['code'] })}
                options={[{ value: '', label: 'All alert codes' }, ...ALERT_CODE_LIST.map((c) => ({ value: c, label: `${codeInfo(c).title} (${c})` }))]}
              />
              <Select
                label="Sort alerts"
                hideLabel
                className="acr-alerts-sort"
                value={filters.sort}
                onChange={(e) => update({ sort: e.target.value as AlertSort })}
                options={(Object.keys(SORT_LABELS) as AlertSort[]).map((s) => ({ value: s, label: SORT_LABELS[s] }))}
              />
              <SearchInput
                className="acr-alerts-search"
                value={filters.q}
                onChange={(v) => update({ q: v.slice(0, MAX_SEARCH) })}
                label="Search alerts"
                placeholder="Message, code or target"
                resultSummary={`${formatCount(shown.length)} alerts`}
              />
              {manage.allowed && bulk.length > 1 && (
                <Button size="sm" variant="secondary" icon="check" onClick={() => void actions.acknowledgeMany(bulk)}>
                  Acknowledge all {formatCount(bulk.length)}
                </Button>
              )}
            </div>
            {stale && (
              <div className="acr-alerts-alert">
                <Alert severity="WARNING" title="Could not refresh the alerts" actions={<Button size="sm" variant="secondary" icon="refresh" onClick={refetch}>Retry</Button>}>
                  The list is greyed: it is the last data received, not current.
                </Alert>
              </div>
            )}
            {shown.length === 0 ? (
              <EmptyState
                compact
                icon={filters.tab === 'open' && tabTotal === 0 ? 'check-circle' : 'search'}
                title={tabTotal === 0 ? TAB_META[filters.tab].empty : 'No alert matches these filters'}
                description={tabTotal === 0 ? (filters.tab === 'open' ? 'Integrity and timing alerts appear here the moment the server raises them.' : undefined) : 'Try another severity, code or search, or clear the filters.'}
                action={
                  tabTotal > 0 ? (
                    <Button variant="secondary" icon="x" onClick={() => update({ severity: '', code: '', q: '' })}>
                      Clear filters
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <div className="acr-alerts-gridwrap" style={gridHeight}>
                <VirtualGrid
                  label={`${TAB_META[filters.tab].label} alerts`}
                  total={shown.length}
                  rowAt={(i) => shown[i] ?? null}
                  columns={columns}
                  rowHeight={ROW_HEIGHT}
                  minWidth={filters.tab === 'acknowledged' ? 720 : 640}
                  resetKey={`${filters.tab}|${filters.severity}|${filters.code}|${filters.q}|${filters.sort}|${scope}`}
                  onActivate={(a) => select(a.id)}
                  isSelected={(a) => a.id === selectedId}
                  rowClassName={(a) => `acr-alerts-row--${a.severity.toLowerCase()}`}
                  className="acr-alerts-grid"
                />
              </div>
            )}
            {filters.tab === 'resolved' && (
              <p className="acr-alerts-foot">
                <Icon name="info" />
                {historyFull && historyLimit < MAX_LIMIT ? (
                  <>
                    Showing the {formatCount(historyLimit)} most recent alerts.{' '}
                    <button type="button" className="acr-alerts-more" onClick={() => setHistoryLimit((n) => Math.min(MAX_LIMIT, n + HISTORY_STEP * 2))}>
                      Load older alerts
                    </button>
                  </>
                ) : historyFull ? (
                  `Showing the ${formatCount(MAX_LIMIT)} most recent alerts (the server limit). Older alerts are in the audit log.`
                ) : (
                  'Showing every resolved alert.'
                )}
              </p>
            )}
          </Tabs>
        </Panel>
        <aside className="acr-alerts-side" aria-label="Selected alert">
          <AlertDetail alert={selected} tournamentId={tournamentId} now={now} manage={manage} actions={actions} adminName={adminName} onClose={() => select(null)} />
        </aside>
      </div>

      <details className="acr-alerts-codes">
        <summary>
          <Icon name="info" /> Alert codes — what each one means
        </summary>
        <ul className="acr-alerts-codes__list">
          {ALERT_CODE_LIST.map((c) => {
            const info = codeInfo(c);
            const n = openAll.filter((a) => a.code === c).length;
            return (
              <li key={c}>
                <div>
                  <p className="acr-alerts-codes__title">
                    {info.title} <span className="jpb-mono">{c}</span>
                  </p>
                  <p className="acr-alerts-codes__desc">{info.description}</p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => update({ code: c, tab: 'open' })} aria-label={`Show open ${info.title} alerts (${n})`}>
                  {formatCount(n)} open
                </Button>
              </li>
            );
          })}
        </ul>
      </details>
    </div>
  );
}
