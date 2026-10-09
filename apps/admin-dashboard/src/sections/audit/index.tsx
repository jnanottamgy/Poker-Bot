import { useCallback, useId, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { AuditEntryDto } from '@jpb/shared-types';
import { Alert, Badge, Button, EmptyState, ErrorState, Icon, Panel, Skeleton, cx, formatCount } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import { friendlyError } from '../../api/errors';
import { qk } from '../../api/query/keys';
import { useQuery } from '../../api/query/useQuery';
import { useSession } from '../../auth/SessionProvider';
import { usePermission } from '../../auth/permissions';
import { useTournamentId } from '../../auth/scope';
import { PageHeader } from '../../components/PageHeader';
import { useTournamentState } from '../../live/useTournamentState';
import { formatTimeOfDay } from '../../lib/time';
import { describeTarget } from '../alerts/targets';
import { useAdminNames } from '../alerts/useAdminNames';
import { fileSlug } from '../reports/download';
import { VirtualGrid } from '../standings/VirtualGrid';
import type { GridColumn } from '../standings/VirtualGrid';
import { ChainCheck } from './ChainCheck';
import type { ChainState } from './ChainCheck';
import { diffSummary } from './diff';
import { EntryDetail } from './EntryDetail';
import { ExportControls } from './ExportControls';
import { AuditFilterBar } from './FilterBar';
import { actionInfo, activeFilterCount, dateRange, parseFilters, serverQuery, writeFilters } from './model';
import type { AuditFilters } from './model';
import { useAuditPages } from './useAuditPages';
import './audit.css';

const ROW_HEIGHT = 56;
/** Request the next page when the viewport gets this close to the end of the loaded rows. */
const PREFETCH_ROWS = 20;

const pad = (n: number) => String(n).padStart(2, '0');

/** "21:04:17" today, "8 Oct 21:04" otherwise. */
function shortWhen(at: number, now: number): { main: string; sub: string } {
  const d = new Date(at);
  const n = new Date(now);
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  const date = `${d.getDate()} ${d.toLocaleString('en-GB', { month: 'short' })}`;
  return sameDay ? { main: formatTimeOfDay(at), sub: 'today' } : { main: `${pad(d.getHours())}:${pad(d.getMinutes())}`, sub: `${date} ${d.getFullYear() === n.getFullYear() ? '' : d.getFullYear()}`.trim() };
}

function useAuditParams() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => parseFilters(params), [params]);
  const setFilters = useCallback(
    (patch: Partial<AuditFilters>) =>
      setParams(
        (prev) => {
          const next = writeFilters(prev, { ...parseFilters(prev), ...patch });
          // New filters always start from the latest entry.
          next.delete('start');
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );
  const num = (k: string) => {
    const n = Number(params.get(k));
    return Number.isInteger(n) && n > 0 ? n : null;
  };
  const selected = num('entry');
  const start = num('start');
  const setParam = useCallback(
    (patch: { entry?: number | null; start?: number | null }) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined) continue;
            if (v === null) next.delete(k);
            else next.set(k, String(v));
          }
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );
  return { filters, setFilters, selected, start, setParam };
}

/** §2.16 Audit log — every override, who/when/why, before → after, and the tamper-evident hash chain. */
export default function AuditSection() {
  const tournamentId = useTournamentId();
  const api = useApi();
  const { me } = useSession();
  const canView = usePermission('AUDIT_VIEW');
  const canExport = usePermission('EXPORT_DATA');
  const canUsers = usePermission('ADMIN_USERS_MANAGE', null);
  const state = useTournamentState(tournamentId);
  const adminName = useAdminNames();
  const users = useQuery(qk.users(), (s) => api.users.list(s), { enabled: canUsers, staleMs: 60_000 });
  const { filters, setFilters, selected, start, setParam } = useAuditParams();
  const unscoped = me?.admin.tournamentScope === null;
  const effective = unscoped ? filters : { ...filters, scope: 'tournament' as const };
  const query = useMemo(() => serverQuery(effective, tournamentId), [effective.adminId, effective.action, effective.target, effective.scope, tournamentId]);
  const range = useMemo(() => dateRange(effective), [effective.from, effective.to]);
  const pages = useAuditPages(query, range, start === null ? null : start + 1, canView);
  const [chain, setChain] = useState<ChainState>({ running: false, result: null, error: null });
  const now = Date.now();
  const descId = useId();

  const verify = useCallback(async () => {
    setChain({ running: true, result: null, error: null });
    try {
      setChain({ running: false, result: await api.audit.verify(), error: null });
    } catch (err) {
      setChain({ running: false, result: null, error: err });
    }
  }, [api]);

  const jumpTo = useCallback(
    (seq: number) => {
      // Clear the filters so the entry is guaranteed to be in the list, then start at it.
      setFilters({ adminId: '', action: '', target: '', from: '', to: '' });
      setParam({ start: seq, entry: seq });
    },
    [setFilters, setParam],
  );

  const rows = pages.rows;
  const total = rows.length + (pages.hasMore ? 1 : 0);
  const onRange = useCallback(
    (_s: number, end: number) => {
      if (pages.hasMore && !pages.loading && !pages.error && end >= rows.length - PREFETCH_ROWS) pages.loadMore();
    },
    [pages, rows.length],
  );
  const entry = selected === null ? null : (rows.find((e) => e.seq === selected) ?? null);
  const brokenSeq = chain.result && !chain.result.intact ? chain.result.brokenAtSeq : null;

  const adminOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of users.data?.users ?? []) m.set(u.id, `${u.displayName} (${u.username})`);
    for (const e of rows) if (e.adminId && !m.has(e.adminId)) m.set(e.adminId, e.adminUsername);
    if (me && !m.has(me.admin.id)) m.set(me.admin.id, `${me.admin.displayName} (${me.admin.username})`);
    if (filters.adminId && !m.has(filters.adminId)) m.set(filters.adminId, filters.adminId);
    return [...m.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [users.data, rows, me, filters.adminId]);
  const seenActions = useMemo(() => [...new Set(rows.map((e) => e.action))], [rows]);

  const columns: Array<GridColumn<AuditEntryDto>> = [
    {
      key: 'when',
      header: 'When',
      track: '104px',
      cell: (e) => {
        const w = shortWhen(e.at, now);
        return (
          <span className="acr-audit-when">
            <span className="jpb-num">{w.main}</span>
            <span className="acr-audit-dim">
              <span className="jpb-num">#{e.seq}</span> · {w.sub}
            </span>
          </span>
        );
      },
    },
    {
      key: 'admin',
      header: 'Admin',
      track: 'minmax(96px, 0.7fr)',
      cell: (e) => (
        <span className={cx('acr-audit-admin', !e.adminId && 'is-system')} title={e.adminId ? adminName(e.adminId) : 'Automatic (system)'}>
          {e.adminUsername}
        </span>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      track: 'minmax(180px, 1.6fr)',
      cell: (e) => {
        const info = actionInfo(e.action);
        const sum = diffSummary(e.beforeState, e.afterState);
        return (
          <span className="acr-audit-action">
            <span className="acr-audit-action__label">
              {info.label}
              {info.danger && (
                <Badge tone="danger" srLabel="Danger level 2 action">
                  L2
                </Badge>
              )}
              {e.seq === brokenSeq && (
                <Badge tone="danger" variant="solid" srLabel="Hash chain breaks here">
                  CHAIN BREAK
                </Badge>
              )}
            </span>
            <span className="acr-audit-action__sub" title={sum ?? undefined}>
              <span className="jpb-mono">{e.action}</span>
              {sum && <span> · {sum}</span>}
            </span>
          </span>
        );
      },
    },
    {
      key: 'target',
      header: 'Target',
      track: 'minmax(104px, 0.9fr)',
      cell: (e) => {
        const t = describeTarget(e.target, e.tournamentId ?? tournamentId);
        return t?.href ? (
          <Link to={t.href} className="acr-link acr-audit-target" tabIndex={-1} title={e.target}>
            <Icon name={t.icon} /> {t.label}
          </Link>
        ) : (
          <span className="acr-audit-target jpb-mono" title={e.target}>
            {e.target}
          </span>
        );
      },
    },
    {
      key: 'reason',
      header: 'Reason',
      track: 'minmax(120px, 1.2fr)',
      cell: (e) =>
        e.reason ? (
          <span className="acr-audit-reason" title={e.reason}>
            “{e.reason}”
          </span>
        ) : (
          <span className="acr-audit-dim">—</span>
        ),
    },
  ];

  const header = (
    <PageHeader
      title="Audit log"
      icon="file"
      eyebrow={state.overview.data?.name ?? 'Tournament'}
      description="Append-only record of every administrative action: who, when, what, target, reason and the state before and after — chained by hashes so tampering is detectable."
      actions={
        canView ? (
          <>
            {unscoped && (
              <div className="acr-audit-scope" role="group" aria-label="Which entries">
                <button type="button" className={cx('acr-audit-seg', effective.scope === 'tournament' && 'is-on')} aria-pressed={effective.scope === 'tournament'} onClick={() => setFilters({ scope: 'tournament' })}>
                  This tournament
                </button>
                <button type="button" className={cx('acr-audit-seg', effective.scope === 'all' && 'is-on')} aria-pressed={effective.scope === 'all'} onClick={() => setFilters({ scope: 'all' })}>
                  Whole log
                </button>
              </div>
            )}
            <Button size="sm" variant="secondary" icon="shield" loading={chain.running} loadingLabel="Verifying…" onClick={() => void verify()}>
              Verify chain
            </Button>
            {canExport && <ExportControls query={query} range={range} filters={effective} slug={fileSlug(state.overview.data?.joinCode ?? tournamentId)} />}
          </>
        ) : undefined
      }
    />
  );

  if (!canView) {
    return (
      <div className="acr-page acr-audit">
        {header}
        <EmptyState icon="lock" title="The audit log is restricted" description="Viewing the audit log requires the AUDIT_VIEW permission. Ask a super admin if you need access." />
      </div>
    );
  }

  const firstLoad = pages.loading && pages.scanned === 0;
  const dated = range.from !== null || range.to !== null;
  return (
    <div className="acr-page acr-audit">
      {header}
      <ChainCheck state={chain} onJump={jumpTo} onRetry={() => void verify()} onDismiss={() => setChain({ running: false, result: null, error: null })} />
      <AuditFilterBar filters={effective} onChange={setFilters} adminOptions={adminOptions} seenActions={seenActions} />

      <div className="acr-audit-layout">
        <Panel
          flush
          className={cx('acr-audit-main', pages.error !== null && rows.length > 0 && 'jpb-stale')}
          title={
            <span>
              {formatCount(rows.length)}
              {pages.hasMore ? '+' : ''} {rows.length === 1 ? 'entry' : 'entries'}
            </span>
          }
          description={
            <span id={descId}>
              {effective.scope === 'all' ? 'Whole log' : 'This tournament'}
              {activeFilterCount(effective) > 0 ? ` · ${activeFilterCount(effective)} filter${activeFilterCount(effective) > 1 ? 's' : ''}` : ''}
              {dated ? ` · ${formatCount(pages.scanned)} scanned for the date range` : ' · newest first'}
            </span>
          }
          actions={
            <Button size="sm" variant="ghost" icon="refresh" onClick={pages.reload}>
              Refresh
            </Button>
          }
        >
          {start !== null && (
            <div className="acr-audit-banner">
              <Alert severity="INFO" title={`Showing the log from entry #${start} down`} actions={<Button size="sm" variant="secondary" icon="arrow-up" onClick={() => setParam({ start: null })}>Back to latest</Button>}>
                Newer entries are hidden while you look at this point of the log.
              </Alert>
            </div>
          )}
          {pages.newer > 0 && start === null && (
            <div className="acr-audit-banner">
              <Alert severity="INFO" title={`${pages.newer >= 50 ? '50+' : formatCount(pages.newer)} new ${pages.newer === 1 ? 'entry' : 'entries'}`} actions={<Button size="sm" variant="secondary" icon="refresh" onClick={pages.reload}>Show</Button>}>
                Recorded since this list was loaded.
              </Alert>
            </div>
          )}
          {pages.error !== null && (
            <div className="acr-audit-banner">
              <Alert severity="WARNING" title="Could not load more of the audit log" actions={<Button size="sm" variant="secondary" icon="refresh" onClick={rows.length ? pages.loadMore : pages.reload}>Retry</Button>}>
                {friendlyError(pages.error).description}
              </Alert>
            </div>
          )}
          {firstLoad ? (
            <div className="acr-audit-loading" aria-busy="true" aria-label="Loading audit entries">
              <Skeleton lines={8} />
            </div>
          ) : rows.length === 0 && pages.error !== null ? (
            <ErrorState title="Could not load the audit log" description={friendlyError(pages.error).description} onRetry={pages.reload} />
          ) : rows.length === 0 && !pages.hasMore ? (
            <EmptyState
              compact
              icon={activeFilterCount(effective) ? 'search' : 'file'}
              title={activeFilterCount(effective) ? 'No entry matches these filters' : 'No audit entries yet'}
              description={activeFilterCount(effective) ? `Scanned ${formatCount(pages.scanned)} entries. Try a wider date range or clear the filters.` : 'Every administrative action on this tournament will be recorded here.'}
              action={
                activeFilterCount(effective) ? (
                  <Button variant="secondary" icon="x" onClick={() => setFilters({ adminId: '', action: '', target: '', from: '', to: '' })}>
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div style={{ ['--acr-audit-rows' as string]: `${Math.max(4, total) * ROW_HEIGHT + 40}px` }}>
            <VirtualGrid
              label="Audit entries"
              describedBy={descId}
              total={total}
              rowAt={(i) => rows[i] ?? null}
              columns={columns}
              rowHeight={ROW_HEIGHT}
              minWidth={700}
              resetKey={`${JSON.stringify(query)}|${start ?? ''}`}
              onRangeChange={onRange}
              onActivate={(e) => setParam({ entry: e.seq })}
              isSelected={(e) => e.seq === selected}
              rowClassName={(e) => cx(actionInfo(e.action).danger && 'acr-audit-row--danger', e.seq === brokenSeq && 'acr-audit-row--broken')}
              className="acr-audit-grid"
            />
            </div>
          )}
          <p className="acr-audit-foot">
            <Icon name="info" />
            {pages.loading && !firstLoad ? (
              <span>Loading older entries… ({formatCount(pages.scanned)} scanned)</span>
            ) : pages.hasMore ? (
              <span>
                Scroll to load older entries, or{' '}
                <button type="button" className="acr-audit-textbtn" onClick={pages.loadMore}>
                  load more now
                </button>
                .
              </span>
            ) : (
              <span>End of the log for these filters · {formatCount(pages.scanned)} {pages.scanned === 1 ? 'entry' : 'entries'} scanned.</span>
            )}
          </p>
        </Panel>
        <aside className="acr-audit-side" aria-label="Selected entry">
          {selected !== null && entry === null && !pages.loading ? (
            <section className="acr-audit-detail is-empty" aria-label="Audit entry">
              <EmptyState
                compact
                icon="search"
                title={`Entry #${selected} is not in the loaded list`}
                description="It may be filtered out or further down the log."
                action={
                  <Button variant="secondary" icon="arrow-right" onClick={() => jumpTo(selected)}>
                    Jump to entry #{selected}
                  </Button>
                }
              />
            </section>
          ) : (
            <EntryDetail entry={entry} tournamentId={tournamentId} adminName={adminName} broken={entry !== null && entry.seq === brokenSeq} onFilter={setFilters} onClose={() => setParam({ entry: null })} />
          )}
        </aside>
      </div>
    </div>
  );
}
