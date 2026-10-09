import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { PaymentStatus, PayoutRowDto } from '@jpb/shared-types';
import { Alert, Badge, Button, EmptyState, ErrorState, Icon, IconButton, Panel, SearchInput, Skeleton, StatusPill, cx, formatCount, formatMoneyMinor, formatOrdinal, initials } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import { friendlyError } from '../../api/errors';
import { qk } from '../../api/query/keys';
import { useQuery } from '../../api/query/useQuery';
import { sectionHref } from '../../app/sections';
import { usePermission } from '../../auth/permissions';
import { useTournamentId } from '../../auth/scope';
import { ButtonLink } from '../../components/ButtonLink';
import { PageHeader } from '../../components/PageHeader';
import { useTournamentState } from '../../live/useTournamentState';
import { formatDateTime, formatTimeOfDay } from '../../lib/time';
import { DownloadButton } from '../reports/DownloadButton';
import { fileSlug } from '../reports/download';
import { VirtualGrid } from '../standings/VirtualGrid';
import type { GridColumn } from '../standings/VirtualGrid';
import { MAX_SEARCH, PAYMENT_META, PAYMENT_STATUSES, filterPayouts, nextStatus, parseFilters, tallyByStatus } from './model';
import type { PayoutFilters, StatusFilter } from './model';
import { PaymentPanel } from './PaymentPanel';
import { Totals } from './Totals';
import './payouts.css';

/** Payouts change on eliminations and payment updates (both invalidate the cache); this is the safety net. */
const POLL_MS = 15_000;
const SEARCH_DEBOUNCE_MS = 200;
const ROW_HEIGHT = 52;
/** Below this width the payment panel sits under the list (payouts.css): bring it into view on selection. */
const STACKED_LAYOUT_QUERY = '(max-width: 1200px)';

function usePayoutFilters(): [PayoutFilters, (patch: Partial<PayoutFilters>) => void, string | null, (entryId: string | null) => void] {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => parseFilters(params), [params]);
  const update = useCallback(
    (patch: Partial<PayoutFilters>) =>
      setParams(
        (prev) => {
          const f = { ...parseFilters(prev), ...patch };
          const next = new URLSearchParams(prev);
          if (f.status) next.set('status', f.status);
          else next.delete('status');
          if (f.q) next.set('q', f.q);
          else next.delete('q');
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );
  const entry = params.get('entry');
  const setEntry = useCallback(
    (entryId: string | null) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (entryId) next.set('entry', entryId);
          else next.delete('entry');
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );
  return [filters, update, entry, setEntry];
}

/** §2.13 Payouts — prizes won, payment workflow and totals for accounting. */
export default function PayoutsSection() {
  const tournamentId = useTournamentId();
  const api = useApi();
  const state = useTournamentState(tournamentId);
  const overview = state.overview.data;
  const canView = usePermission('PAYOUT_VIEW');
  const canManage = usePermission('PAYOUT_MANAGE');
  const payouts = useQuery(qk.payouts(tournamentId), (s) => api.payouts.get(tournamentId, s), { pollMs: POLL_MS, enabled: canView });
  const [filters, update, entryId, setEntry] = usePayoutFilters();
  const [text, setText] = useState(filters.q);
  const [preset, setPreset] = useState<{ entryId: string; status: PaymentStatus; seq: number } | null>(null);

  useEffect(() => {
    if (text === filters.q) return undefined;
    const t = setTimeout(() => update({ q: text }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text, filters.q, update]);
  useEffect(() => setText(filters.q), [filters.q]);

  const data = payouts.data;
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const shown = useMemo(() => filterPayouts(rows, filters), [rows, filters]);
  const tally = useMemo(() => tallyByStatus(rows), [rows]);
  const selected = entryId ? (rows.find((r) => r.entryId === entryId) ?? null) : null;
  const currency = data?.currency ?? overview?.config.prizeStructure.currency ?? 'INR';
  const paidPlaces = overview?.config.prizeStructure.places.length ?? 0;
  const resetKey = `${filters.status}|${filters.q}`;

  const sideRef = useRef<HTMLElement>(null);
  const [reveal, setReveal] = useState(0);
  const select = useCallback((r: PayoutRowDto, status?: PaymentStatus) => {
    setEntry(r.entryId);
    if (status) setPreset((p) => ({ entryId: r.entryId, status, seq: (p?.seq ?? 0) + 1 }));
    setReveal((n) => n + 1);
  }, [setEntry]);
  useEffect(() => {
    if (reveal === 0 || typeof window === 'undefined' || !window.matchMedia?.(STACKED_LAYOUT_QUERY).matches) return;
    sideRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [reveal]);

  const columns: Array<GridColumn<PayoutRowDto>> = [
    {
      key: 'place',
      header: 'Place',
      track: '84px',
      cell: (r) => (
        <span className="acr-payouts-place">
          <span className="jpb-num">{formatOrdinal(r.finishPosition)}</span>
          {r.tiedCount > 1 && (
            <Badge tone="info" srLabel={`Tied with ${r.tiedCount - 1} other ${r.tiedCount === 2 ? 'player' : 'players'}`}>
              T×{r.tiedCount}
            </Badge>
          )}
        </span>
      ),
    },
    {
      key: 'player',
      header: 'Player',
      track: 'minmax(150px, 1.8fr)',
      cell: (r) => (
        <span className="acr-payouts-who">
          <span className="acr-avatar acr-payouts-avatar" aria-hidden="true">
            {initials(r.displayName)}
          </span>
          <span className="acr-payouts-who__text">
            <Link to={sectionHref('player-detail', tournamentId, { playerId: r.playerId })} className="acr-payouts-name" tabIndex={-1}>
              {r.displayName}
            </Link>
            <span className="jpb-mono acr-payouts-pid">{r.publicId}</span>
          </span>
        </span>
      ),
    },
    { key: 'prize', header: 'Prize', track: '112px', num: true, cell: (r) => <span className="acr-payouts-prize jpb-num">{formatMoneyMinor(r.prizeMinor, r.currency)}</span> },
    {
      key: 'status',
      header: 'Status',
      track: '136px',
      cell: (r) => {
        const m = PAYMENT_META[r.paymentStatus];
        return <StatusPill size="sm" tone={m.tone} icon={m.icon} label={m.label} title={m.hint} />;
      },
    },
    {
      key: 'by',
      header: 'Processed',
      track: 'minmax(120px, 1fr)',
      cell: (r) =>
        r.processedBy ? (
          <span className="acr-payouts-by">
            <span>{r.processedBy}</span>
            <span className="acr-payouts-dim">{r.paidAt ? formatDateTime(r.paidAt) : 'time not recorded'}</span>
          </span>
        ) : (
          <span className="acr-payouts-dim">—</span>
        ),
    },
    { key: 'ref', header: 'Reference', track: 'minmax(88px, 0.9fr)', cell: (r) => (r.paymentReference ? <span className="jpb-mono acr-payouts-ref" title={r.paymentReference}>{r.paymentReference}</span> : <span className="acr-payouts-dim">—</span>) },
    {
      key: 'action',
      header: <span className="jpb-sr-only">Next step</span>,
      track: '52px',
      cell: (r) => {
        if (!canManage) return null;
        const next = nextStatus(r.paymentStatus);
        const label = next ? `${next === 'PAID' ? 'Mark paid' : 'Start processing'} — ${r.displayName}` : `Edit payment — ${r.displayName}`;
        return <IconButton size="sm" variant="secondary" icon={next ? PAYMENT_META[next].icon : 'sliders'} label={label} tabIndex={-1} className={cx('acr-payouts-quick', next && `is-${PAYMENT_META[next].tone}`)} onClick={() => select(r, next ?? undefined)} />;
      },
    },
  ];

  const slug = fileSlug(overview?.joinCode ?? overview?.name ?? tournamentId);
  const header = (
    <PageHeader
      title="Payouts"
      icon="trophy"
      eyebrow={overview?.name ?? 'Tournament'}
      description="Prizes won so far with their payment status. Payment details are for staff only — players see their prize, never references or notes."
      actions={
        <>
          {canView && (
            <DownloadButton load={() => api.text('payoutsCsv', { id: tournamentId })} filename={`payouts-${slug}.csv`} what="payouts CSV">
              Export CSV for accounting
            </DownloadButton>
          )}
          <ButtonLink to={sectionHref('standings', tournamentId)} icon="award">
            Standings
          </ButtonLink>
          <ButtonLink to={sectionHref('reports', tournamentId)} icon="download">
            Report
          </ButtonLink>
        </>
      }
    />
  );

  if (!canView) {
    return (
      <div className="acr-page acr-payouts">
        {header}
        <EmptyState icon="lock" title="Payouts are restricted" description="Viewing payouts requires the PAYOUT_VIEW permission. Ask a super admin if you need access." />
      </div>
    );
  }
  if (payouts.isLoading) {
    return (
      <div className="acr-page acr-payouts" aria-busy="true" aria-label="Loading payouts">
        {header}
        <Skeleton shape="block" height={140} />
        <Skeleton shape="block" height={420} />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="acr-page acr-payouts">
        {header}
        <ErrorState title="Could not load the payouts" description={friendlyError(payouts.error).description} onRetry={() => void payouts.refetch()} />
      </div>
    );
  }

  const chip = (value: StatusFilter, label: string, count: number, icon: 'list' | 'clock' | 'refresh' | 'check-circle') => (
    <button key={value || 'all'} type="button" className={cx('acr-payouts-chip', filters.status === value && 'is-on', value && `is-${PAYMENT_META[value as PaymentStatus].tone}`)} aria-pressed={filters.status === value} onClick={() => update({ status: value })}>
      <Icon name={icon} />
      {label}
      <span className="acr-payouts-chip__n jpb-num">{formatCount(count)}</span>
    </button>
  );

  return (
    <div className="acr-page acr-payouts">
      {header}
      <Totals data={data} tally={tally} paidPlaces={paidPlaces} />

      {!canManage && (
        <Alert severity="INFO" title="Read-only">
          You can see payouts but not change them: updating a payment status requires PAYOUT_MANAGE.
        </Alert>
      )}

      <div className="acr-payouts-layout">
        <Panel
          flush
          className={cx('acr-payouts-main', payouts.isStale && 'jpb-stale')}
          title={
            <span>
              {formatCount(shown.length)} {shown.length === 1 ? 'prize' : 'prizes'}
              {shown.length !== rows.length && <span className="acr-payouts-dim"> of {formatCount(rows.length)}</span>}
            </span>
          }
          description={filters.status || filters.q ? `Filtered${filters.status ? ` · ${PAYMENT_META[filters.status].label.toLowerCase()}` : ''}${filters.q ? ` · “${filters.q}”` : ''}` : 'Every prize won so far, best place first. ↑ ↓ move · Enter opens the payment.'}
          actions={
            <span className="acr-payouts-panelactions">
              {payouts.updatedAt > 0 && (
                <span className={cx('acr-payouts-updated', payouts.isStale && 'is-stale')}>
                  {payouts.isStale ? 'Not current · ' : 'Updated '}
                  {formatTimeOfDay(payouts.updatedAt)}
                </span>
              )}
              <Button size="sm" variant="ghost" icon="refresh" onClick={() => void payouts.refetch()}>
                Refresh
              </Button>
            </span>
          }
        >
          <div className="acr-payouts-toolbar">
            <div className="acr-payouts-chips" role="group" aria-label="Filter by payment status">
              {chip('', 'All', rows.length, 'list')}
              {PAYMENT_STATUSES.map((s) => chip(s, PAYMENT_META[s].label, tally[s].count, PAYMENT_META[s].icon as 'clock' | 'refresh' | 'check-circle'))}
            </div>
            <SearchInput
              className="acr-payouts-search"
              value={text}
              onChange={(v) => setText(v.slice(0, MAX_SEARCH))}
              label="Search payouts"
              placeholder="Name, public id, reference or place"
              resultSummary={`${formatCount(shown.length)} prizes`}
            />
          </div>
          {payouts.isStale && (
            <div className="acr-payouts-alert">
              <Alert severity="WARNING" title="Could not refresh the payouts" actions={<Button size="sm" variant="secondary" icon="refresh" onClick={() => void payouts.refetch()}>Retry</Button>}>
                The list is greyed: it is the last data received, not current.
              </Alert>
            </div>
          )}
          {rows.length === 0 ? (
            <EmptyState
              icon="trophy"
              title="No prizes awarded yet"
              description={paidPlaces > 0 ? `Prizes appear here as players finish in the top ${formatCount(paidPlaces)} places.` : 'This tournament has no configured prizes.'}
            />
          ) : shown.length === 0 ? (
            <EmptyState
              compact
              icon="search"
              title="No prize matches these filters"
              description="Try another name, public id or reference, or clear the filters."
              action={
                <Button variant="secondary" icon="x" onClick={() => { setText(''); update({ status: '', q: '' }); }}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <VirtualGrid
              label="Payouts"
              total={shown.length}
              rowAt={(i) => shown[i] ?? null}
              columns={columns}
              rowHeight={ROW_HEIGHT}
              minWidth={740}
              resetKey={resetKey}
              onActivate={(r) => select(r)}
              isSelected={(r) => r.entryId === entryId}
              rowClassName={(r) => `acr-payouts-row--${r.paymentStatus.toLowerCase()}`}
              className="acr-payouts-grid"
            />
          )}
          <p className="acr-payouts-foot">
            <Icon name="info" /> Totals: configured {formatMoneyMinor(data.totals.configuredMinor, currency)} · awarded {formatMoneyMinor(data.totals.awardedMinor, currency)} · paid {formatMoneyMinor(data.totals.paidMinor, currency)} · outstanding {formatMoneyMinor(data.totals.outstandingMinor, currency)} ({currency}).
          </p>
        </Panel>
        <aside ref={sideRef} className="acr-payouts-side" aria-label="Payment details">
          <PaymentPanel tournamentId={tournamentId} row={selected} preset={preset} onClose={() => setEntry(null)} />
        </aside>
      </div>
    </div>
  );
}
