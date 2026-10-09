import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import type { TableListItemDto } from '@jpb/shared-types';
import { Alert, Button, EmptyState, ErrorState, Icon, Panel, Skeleton, cx, formatCount } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import { friendlyError } from '../../api/errors';
import { qk } from '../../api/query/keys';
import type { IntegrityCheckResponse } from '../../api/types';
import { sectionHref } from '../../app/sections';
import { usePermission } from '../../auth/permissions';
import { useTournamentId } from '../../auth/scope';
import { PageHeader } from '../../components/PageHeader';
import { useDangerousAction } from '../../danger/DangerProvider';
import { useConnection } from '../../live/hooks';
import { useTournamentState } from '../../live/useTournamentState';
import { formatTimeOfDay } from '../../lib/time';
import { serverQuery, useTableFilters } from './filters';
import { useNow } from './hooks';
import { IntegrityResult } from './IntegrityResult';
import { SummaryBar, useStatusCounts } from './SummaryBar';
import { TableGrid } from './TableGrid';
import { Toolbar } from './Toolbar';
import { MAX_SCAN_TABLES, useTableMap } from './useTableMap';
import './tables.css';

function MapSkeleton() {
  return (
    <div className="acr-tables-skeleton" aria-busy="true" aria-label="Loading tables">
      {Array.from({ length: 18 }, (_, i) => (
        <Skeleton key={i} shape="block" height={132} />
      ))}
    </div>
  );
}

/** §2.5 Live table map — every table, server-filtered, virtualized; click a table for its live detail. */
export default function TablesSection() {
  const tournamentId = useTournamentId();
  const api = useApi();
  const navigate = useNavigate();
  const danger = useDangerousAction();
  const conn = useConnection();
  const state = useTournamentState(tournamentId);
  const canControl = usePermission('TABLE_CONTROL');
  const [filters, update, reset] = useTableFilters();
  const [check, setCheck] = useState<IntegrityCheckResponse | null>(null);
  const now = useNow(1000);
  const serverNow = now + conn.offsetMs;

  const base = useMemo(() => serverQuery(filters), [filters]);
  const map = useTableMap(tournamentId, base, filters.disconnected);
  const counts = useStatusCounts(tournamentId);
  const byStatus = state.overview.data?.tablesByStatus ?? {};
  const extra = {
    ...(byStatus.FROZEN !== undefined ? { FROZEN: byStatus.FROZEN } : {}),
    ...(byStatus.BREAKING !== undefined ? { BREAKING: byStatus.BREAKING } : {}),
  };

  const hrefFor = useCallback((row: TableListItemDto) => sectionHref('table-detail', tournamentId, { tableId: row.tableId }), [tournamentId]);
  const resetKey = JSON.stringify([base, filters.disconnected]);
  const invalidate = [qk.tournament(tournamentId)];

  const rebalance = () =>
    void danger({
      level: 1,
      endpoint: 'tournamentRebalance',
      title: 'Rebalance tables now',
      summary: 'Johnny plans balancing moves immediately instead of waiting for the next hand result.',
      consequences: [
        'Players move from the largest tables to the smallest by the seat-fairness formula',
        'Each move happens when the player’s current hand ends — never mid-hand',
        'Every move is audit-logged and appears in the live feed',
      ],
      reason: 'optional',
      confirmLabel: 'Rebalance now',
      run: ({ reason }) => api.tables.rebalance(tournamentId, reason ? { reason } : {}),
      success: (r) => (r.movesPlanned > 0 ? `Rebalance planned ${formatCount(r.movesPlanned)} move${r.movesPlanned === 1 ? '' : 's'}` : 'Tables are already balanced — no moves needed'),
      invalidate,
    });

  const integrity = () =>
    void danger({
      level: 0,
      endpoint: 'tournamentIntegrityCheck',
      title: 'Run integrity check',
      run: () => api.tables.integrityCheck(tournamentId),
      onSuccess: setCheck,
      success: (r) => (r.ok ? `Integrity check passed on ${formatCount(r.checkedTables)} tables` : `Integrity check found ${formatCount(r.violations.length)} problem(s)`),
      invalidate: [qk.overview(tournamentId)],
    });

  const openExact = (q: string) => {
    const n = Number(q);
    if (!q || !Number.isInteger(n)) return;
    for (let i = 0; i < Math.min(map.count, 3); i++) {
      const row = map.rowAt(i);
      if (row?.tableNumber === n) {
        navigate(hrefFor(row));
        return;
      }
    }
  };

  const resultText = map.initialLoading ? 'Loading tables' : `${formatCount(map.count)} tables match`;
  const hasError = map.error !== null && map.error !== undefined;

  return (
    <div className="acr-page acr-tables">
      <PageHeader
        title="Live table map"
        icon="grid"
        eyebrow={state.overview.data?.name}
        description="Every table, live. Filters, sort and paging run on the server, so the map behaves the same at 8 or 125,000 tables."
        actions={
          canControl ? (
            <>
              <Button size="sm" icon="refresh" onClick={rebalance}>
                Rebalance now
              </Button>
              <Button size="sm" icon="shield" onClick={integrity}>
                Run integrity check
              </Button>
            </>
          ) : undefined
        }
      />

      <SummaryBar counts={counts} extra={extra} active={filters.status} onSelect={(status) => update({ status })} />

      <Toolbar filters={filters} onChange={update} onReset={reset} onSubmitSearch={openExact} resultText={resultText} />

      {check && <IntegrityResult tournamentId={tournamentId} result={check} onDismiss={() => setCheck(null)} />}

      {map.scan && (
        <p className="acr-tables-note" role="status">
          <Icon name="info" />
          {map.scan.capped
            ? `Showing tables with disconnected players among the first ${formatCount(MAX_SCAN_TABLES)} of ${formatCount(map.scan.total)} tables (current sort). Narrow the filters to scan the rest.`
            : `Checked ${formatCount(map.scan.checked)} of ${formatCount(map.scan.total)} tables for disconnected players.`}
        </p>
      )}

      <Panel
        className={cx('acr-tables-panel', map.stale && 'is-stale')}
        flush
        title={
          <>
            {map.initialLoading ? 'Tables' : `${formatCount(map.count)} table${map.count === 1 ? '' : 's'}`}
            {map.stale && <span className="acr-tables-stalepill">Not current</span>}
          </>
        }
        description={
          map.stale
            ? `Refresh failed — showing data from ${formatTimeOfDay(map.updatedAt)}. Retrying automatically.`
            : conn.live
              ? 'Live: tiles refresh every few seconds; “since progress” ticks on the server clock.'
              : 'Live updates paused — tiles keep refreshing from the server.'
        }
        actions={
          <Button size="sm" variant="ghost" icon="refresh" onClick={map.refetch} aria-label="Refresh the tables now">
            Refresh
          </Button>
        }
      >
        {map.stale && (
          <div className="acr-tables-stalebar">
            <Alert severity="WARNING" title="These tables may be out of date" meta="The last refresh failed. Figures are greyed until the server answers again." />
          </div>
        )}
        {map.initialLoading ? (
          <MapSkeleton />
        ) : hasError ? (
          <ErrorState title="Could not load the tables" description={friendlyError(map.error).description} onRetry={map.refetch} />
        ) : map.count === 0 ? (
          <EmptyState
            icon={filters.disconnected ? 'wifi' : 'grid'}
            title={filters.q ? `No table number starts with “${filters.q}”` : filters.disconnected ? 'No table has a disconnected player' : 'No tables match these filters'}
            description={filters.status || filters.stalled || filters.q || filters.minPlayers !== null || filters.maxPlayers !== null ? 'Clear or change the filters to see more tables.' : 'Tables appear here once the tournament starts and players are seated.'}
            action={
              <Button size="sm" variant="secondary" icon="x" onClick={reset}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <div className={cx('acr-tables-body', map.stale && 'jpb-stale')}>
            <TableGrid
              view={filters.view}
              count={map.count}
              rowAt={map.rowAt}
              onRangeChange={map.onRangeChange}
              hrefFor={hrefFor}
              serverNow={serverNow}
              resetKey={resetKey}
              label="Tables"
            />
          </div>
        )}
      </Panel>
    </div>
  );
}
