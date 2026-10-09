import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import type { PlayerSort } from '../../api/types';
import { isSort, isStatusFilter } from './model';
import type { StatusFilter } from './model';

/** Longest search the server accepts (strParam(q, 80)). */
export const MAX_SEARCH_LENGTH = 80;

/** Players filters, kept in the URL so a view can be shared and survives Back. */
export interface PlayerFilters {
  q: string;
  status: StatusFilter;
  tableId: string | null;
  /** Shown on the chip without another lookup. */
  tableNumber: number | null;
  /** null = the server default for the tournament state. */
  sort: PlayerSort | null;
}

export function parsePlayerFilters(p: URLSearchParams): PlayerFilters {
  const status = p.get('status') ?? '';
  const sort = p.get('sort') ?? '';
  const tableId = p.get('table');
  const tn = Number(p.get('tn'));
  return {
    q: (p.get('q') ?? '').slice(0, MAX_SEARCH_LENGTH),
    status: isStatusFilter(status) ? status : '',
    tableId: tableId ? tableId : null,
    tableNumber: tableId && Number.isInteger(tn) && tn > 0 ? tn : null,
    sort: isSort(sort) ? sort : null,
  };
}

function toParams(f: PlayerFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.status) p.set('status', f.status);
  if (f.tableId) {
    p.set('table', f.tableId);
    if (f.tableNumber !== null) p.set('tn', String(f.tableNumber));
  }
  if (f.sort) p.set('sort', f.sort);
  return p;
}

export function activePlayerFilters(f: PlayerFilters): number {
  return [f.q !== '', f.status !== '', f.tableId !== null].filter(Boolean).length;
}

export function usePlayerFilters(): [PlayerFilters, (patch: Partial<PlayerFilters>) => void, () => void] {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => parsePlayerFilters(params), [params]);
  const update = useCallback((patch: Partial<PlayerFilters>) => setParams((prev) => toParams({ ...parsePlayerFilters(prev), ...patch }), { replace: true }), [setParams]);
  const reset = useCallback(() => setParams((prev) => toParams({ q: '', status: '', tableId: null, tableNumber: null, sort: parsePlayerFilters(prev).sort }), { replace: true }), [setParams]);
  return [filters, update, reset];
}
