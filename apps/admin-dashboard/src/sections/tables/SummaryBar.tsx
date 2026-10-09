import type { Paginated, TableListItemDto } from '@jpb/shared-types';
import { Icon, cx, formatCount } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import { qk } from '../../api/query/keys';
import type { QueryKey } from '../../api/query/QueryClient';
import type { TableListStatus, TablesQuery } from '../../api/types';
import { useQueries } from './hooks';
import { DISPLAY_STATUS_META } from './tableStatus';
import type { TableDisplayStatus } from './tableStatus';

/** Statuses the server can filter and count (`status` query of tablesList). */
export const SERVER_STATUSES: readonly TableListStatus[] = ['IN_HAND', 'BETWEEN_HANDS', 'WAITING', 'HELD', 'STALLED', 'CLOSED'];
export const COUNTS_POLL_MS = 10_000;

export interface StatusCounts {
  total: number | null;
  byStatus: Partial<Record<TableListStatus, number>>;
  loading: boolean;
}

/**
 * Exact counts per status straight from the server: one `limit=1` request per
 * status reads its `total` (cheap at any scale, never a client-side count).
 */
export function useStatusCounts(tournamentId: string): StatusCounts {
  const api = useApi();
  const keys: QueryKey[] = SERVER_STATUSES.map((status) => qk.tables(tournamentId, { status, limit: 1 }));
  const states = useQueries<Paginated<TableListItemDto>>(keys, (k, s) => api.tables.list(tournamentId, k[3] as TablesQuery, s), { pollMs: COUNTS_POLL_MS });
  const byStatus: Partial<Record<TableListStatus, number>> = {};
  SERVER_STATUSES.forEach((s, i) => {
    const d = states[i]?.data;
    if (d) byStatus[s] = d.total;
  });
  // The statuses partition the tables, so their sum is the exact total (closed included).
  const complete = SERVER_STATUSES.every((s) => byStatus[s] !== undefined);
  const total = complete ? SERVER_STATUSES.reduce((n, s) => n + (byStatus[s] ?? 0), 0) : null;
  return { total, byStatus, loading: states.every((s) => s.data === undefined) };
}

export interface SummaryBarProps {
  counts: StatusCounts;
  /** FROZEN / BREAKING counts when the overview provides them (not filterable server-side). */
  extra: Partial<Record<'FROZEN' | 'BREAKING', number>>;
  active: TableListStatus | '';
  onSelect: (status: TableListStatus | '') => void;
}

function Chip({ status, n, active, onClick }: { status: TableDisplayStatus; n: number | undefined; active: boolean; onClick?: () => void }) {
  const meta = DISPLAY_STATUS_META[status];
  const body = (
    <>
      <Icon name={active ? 'check' : meta.icon} />
      <span className="acr-tables-sum__label">{meta.label}</span>
      <span className="acr-tables-sum__n jpb-num">{n === undefined ? '—' : formatCount(n)}</span>
    </>
  );
  const cls = cx('acr-tables-sum__chip', `is-${meta.tone}`, n === 0 && 'is-zero', active && 'is-active');
  if (!onClick) {
    return (
      <span className={cls} title={`${meta.description} (not filterable yet)`}>
        {body}
      </span>
    );
  }
  return (
    <button type="button" className={cls} aria-pressed={active} onClick={onClick} title={meta.description} aria-label={`${meta.label}: ${n === undefined ? 'loading' : formatCount(n)} tables${active ? ', filter on' : ''}`}>
      {body}
    </button>
  );
}

/** Counts per status; clicking a server-filterable status filters the map to it (click again to clear). */
export function SummaryBar({ counts, extra, active, onSelect }: SummaryBarProps) {
  const statuses: TableDisplayStatus[] = ['IN_HAND', 'BETWEEN_HANDS', 'WAITING', 'HELD', 'STALLED', 'CLOSED'];
  return (
    <section className="acr-tables-sum" aria-label="Tables per status">
      <span className="acr-tables-sum__total">
        <span className="acr-tables-sum__totaln jpb-num">{counts.total === null ? '—' : formatCount(counts.total)}</span>
        <span className="acr-tables-sum__totall">tables in total</span>
      </span>
      <div className="acr-tables-sum__chips" role="group" aria-label="Filter by status">
        {statuses.map((s) => (
          <Chip key={s} status={s} n={counts.byStatus[s as TableListStatus]} active={active === s} onClick={() => onSelect(active === s ? '' : (s as TableListStatus))} />
        ))}
        {extra.BREAKING !== undefined && <Chip status="BREAKING" n={extra.BREAKING} active={false} />}
        {extra.FROZEN !== undefined && <Chip status="FROZEN" n={extra.FROZEN} active={false} />}
      </div>
    </section>
  );
}
