import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import type { TableListStatus, TablesQuery } from '../../api/types';
import type { MapView } from './TableGrid';

export type TableSort = NonNullable<TablesQuery['sort']>;

/** Filters of the table map, kept in the URL so a view can be shared and survives Back. */
export interface TableFilters {
  status: TableListStatus | '';
  minPlayers: number | null;
  maxPlayers: number | null;
  stalled: boolean;
  disconnected: boolean;
  q: string;
  sort: TableSort;
  view: MapView;
}

const STATUSES: readonly TableListStatus[] = ['WAITING', 'BETWEEN_HANDS', 'IN_HAND', 'HELD', 'CLOSED', 'STALLED'];
const SORTS: readonly TableSort[] = ['number', 'players', 'stall', 'chips'];
/** Largest table size the platform supports (seat indexes 0-9). */
export const MAX_SEATS_LIMIT = 10;

export const SORT_LABEL: Readonly<Record<TableSort, string>> = {
  number: 'Table number',
  players: 'Players (most first)',
  stall: 'Stall time (longest first)',
  chips: 'Chips (most first)',
};

function seats(v: string | null): number | null {
  if (v === null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= MAX_SEATS_LIMIT ? n : null;
}

export function parseFilters(p: URLSearchParams): TableFilters {
  const status = p.get('status') ?? '';
  const sort = p.get('sort') ?? 'number';
  return {
    status: (STATUSES as readonly string[]).includes(status) ? (status as TableListStatus) : '',
    minPlayers: seats(p.get('min')),
    maxPlayers: seats(p.get('max')),
    stalled: p.get('stalled') === '1',
    disconnected: p.get('offline') === '1',
    q: (p.get('q') ?? '').replace(/[^0-9]/g, '').slice(0, 7),
    sort: (SORTS as readonly string[]).includes(sort) ? (sort as TableSort) : 'number',
    view: p.get('view') === 'list' ? 'list' : 'grid',
  };
}

function toParams(f: TableFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.status) p.set('status', f.status);
  if (f.minPlayers !== null) p.set('min', String(f.minPlayers));
  if (f.maxPlayers !== null) p.set('max', String(f.maxPlayers));
  if (f.stalled) p.set('stalled', '1');
  if (f.disconnected) p.set('offline', '1');
  if (f.q) p.set('q', f.q);
  if (f.sort !== 'number') p.set('sort', f.sort);
  if (f.view !== 'grid') p.set('view', f.view);
  return p;
}

/** The server query for these filters (view and the client-side "offline" scan excluded). */
export function serverQuery(f: TableFilters): TablesQuery {
  return {
    ...(f.status ? { status: f.status } : {}),
    ...(f.minPlayers !== null ? { minPlayers: f.minPlayers } : {}),
    ...(f.maxPlayers !== null ? { maxPlayers: f.maxPlayers } : {}),
    ...(f.stalled ? { stalled: true } : {}),
    ...(f.q ? { q: f.q } : {}),
    sort: f.sort,
  };
}

export function activeFilterCount(f: TableFilters): number {
  return [f.status !== '', f.minPlayers !== null, f.maxPlayers !== null, f.stalled, f.disconnected, f.q !== ''].filter(Boolean).length;
}

export function useTableFilters(): [TableFilters, (patch: Partial<TableFilters>) => void, () => void] {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => parseFilters(params), [params]);
  const update = useCallback(
    (patch: Partial<TableFilters>) => setParams((prev) => toParams({ ...parseFilters(prev), ...patch }), { replace: true }),
    [setParams],
  );
  const reset = useCallback(() => setParams((prev) => toParams({ ...parseFilters(new URLSearchParams()), view: parseFilters(prev).view, sort: parseFilters(prev).sort }), { replace: true }), [setParams]);
  return [filters, update, reset];
}
