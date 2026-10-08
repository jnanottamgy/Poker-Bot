import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { cx } from '../cx';
import { formatCount } from '../format';
import { Button } from './Button';
import { EmptyState } from './EmptyState';
import { Icon } from './Icon';
import { IconButton } from './IconButton';
import { Menu } from './Menu';
import type { MenuItem } from './Menu';
import { Skeleton } from './Skeleton';

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** Cell renderer. Defaults to String(row[key]). */
  render?: (row: T) => ReactNode;
  /** Value used for sorting; providing it makes the column sortable. */
  sortValue?: (row: T) => number | string;
  align?: 'left' | 'right' | 'center';
  width?: string;
  /** Use tabular numerals and right-align the cell AND its header. */
  numeric?: boolean;
}

export interface SortState {
  key: string;
  dir: 'asc' | 'desc';
}

export interface PaginationProps {
  page: number; // 0-based
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  /** Offer a page-size picker (e.g. [25, 50, 100, 200]). */
  pageSizeOptions?: number[];
  onPageSizeChange?: (size: number) => void;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Accessible table name. */
  label: string;
  /** Row activation (click / Enter / Space on the row itself). Clicks on controls inside a row never activate it. */
  onRowActivate?: (row: T) => void;
  /** Controlled sort; omit for client-side uncontrolled sorting of `rows`. */
  sort?: SortState | null;
  onSortChange?: (s: SortState) => void;
  /** Server-driven paging footer. */
  pagination?: PaginationProps;
  loading?: boolean;
  empty?: ReactNode;
  /** The row whose detail is open (aria-current). */
  selectedKey?: string | null;
  /** Max height for the scroll area (sticky header). */
  maxHeight?: string;
  density?: 'comfortable' | 'compact';
  /** Checkbox column + bulk bar. Controlled: pass `checkedKeys` + `onCheckedChange`. */
  checkedKeys?: readonly string[];
  onCheckedChange?: (keys: string[]) => void;
  /** Bulk actions for the checked rows, rendered in the sticky bulk bar ("3 selected · Move · Message …"). */
  bulkActions?: (keys: string[]) => ReactNode;
  /** Trailing ⋯ menu per row. */
  rowActions?: (row: T) => Array<MenuItem | 'separator'>;
  /** Human name of a row for checkbox / menu labels (e.g. the player name). Default: the row key. */
  rowLabel?: (row: T) => string;
  /** Keep the first column visible while scrolling horizontally. Default true. */
  stickyFirstColumn?: boolean;
  className?: string;
}

const INTERACTIVE = 'a,button,input,select,textarea,label,[role="button"],[role="switch"],[role="menuitem"],[role="checkbox"]';

function Checkbox({ checked, indeterminate = false, label, onChange }: { checked: boolean; indeterminate?: boolean; label: string; onChange: (v: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <label className="jpb-dt__check">
      <input ref={ref} type="checkbox" checked={checked} aria-label={label} onChange={(e) => onChange(e.target.checked)} />
      <span className="jpb-dt__checkbox" aria-hidden="true">
        {indeterminate ? <Icon name="minus" /> : checked ? <Icon name="check" /> : null}
      </span>
    </label>
  );
}

/**
 * Sortable data table: sticky header, sticky first column, keyboard rows
 * (Tab to a row, Enter/Space opens it, ArrowUp/ArrowDown move), aria-sort,
 * optional checkbox selection with a sticky bulk-action bar, per-row ⋯ menus,
 * pagination with page sizes, empty and loading states.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  label,
  onRowActivate,
  sort: sortProp,
  onSortChange,
  pagination,
  loading = false,
  empty,
  selectedKey,
  maxHeight,
  density = 'comfortable',
  checkedKeys,
  onCheckedChange,
  bulkActions,
  rowActions,
  rowLabel,
  stickyFirstColumn = true,
  className,
}: DataTableProps<T>) {
  const [localSort, setLocalSort] = useState<SortState | null>(null);
  const controlled = sortProp !== undefined;
  const sort = controlled ? sortProp : localSort;
  const selectable = checkedKeys !== undefined && onCheckedChange !== undefined;
  const checked = useMemo(() => new Set(checkedKeys ?? []), [checkedKeys]);
  const nameOf = (row: T): string => rowLabel?.(row) ?? rowKey(row);

  const sorted = useMemo(() => {
    if (controlled || !sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const get = col.sortValue;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      return (va < vb ? -1 : va > vb ? 1 : 0) * dir;
    });
  }, [rows, columns, sort, controlled]);

  const toggleSort = (key: string): void => {
    const nextDir: SortState['dir'] = sort?.key === key && sort.dir === 'desc' ? 'asc' : 'desc';
    const next = { key, dir: nextDir };
    if (!controlled) setLocalSort(next);
    onSortChange?.(next);
  };

  const onRowKey = (e: KeyboardEvent<HTMLTableRowElement>, row: T): void => {
    // Keys from a control inside the row belong to that control.
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onRowActivate?.(row);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const el = e.key === 'ArrowDown' ? e.currentTarget.nextElementSibling : e.currentTarget.previousElementSibling;
      if (el instanceof HTMLElement) el.focus();
    }
  };

  const onRowClick = (e: MouseEvent<HTMLTableRowElement>, row: T): void => {
    if (e.target instanceof Element && e.target.closest(INTERACTIVE)) return;
    onRowActivate?.(row);
  };

  const pageKeys = sorted.map(rowKey);
  const checkedOnPage = pageKeys.filter((k) => checked.has(k)).length;
  const setChecked = (key: string, on: boolean): void => {
    const next = new Set(checked);
    if (on) next.add(key);
    else next.delete(key);
    onCheckedChange?.([...next]);
  };
  const setAllOnPage = (on: boolean): void => {
    const next = new Set(checked);
    for (const k of pageKeys) {
      if (on) next.add(k);
      else next.delete(k);
    }
    onCheckedChange?.([...next]);
  };

  const pages = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize)) : 1;
  const colCount = columns.length + (selectable ? 1 : 0) + (rowActions ? 1 : 0);

  return (
    <div className={cx('jpb-dt', `jpb-dt--${density}`, stickyFirstColumn && 'has-sticky-col', selectable && 'is-selectable', className)}>
      {selectable && checked.size > 0 && (
        <div className="jpb-dt__bulk" role="region" aria-label="Bulk actions">
          <span className="jpb-dt__bulkcount" aria-live="polite">
            <span className="jpb-num">{formatCount(checked.size)}</span> selected
          </span>
          <span className="jpb-dt__bulkactions">{bulkActions?.([...checked])}</span>
          <Button size="sm" variant="ghost" icon="x" onClick={() => onCheckedChange?.([])}>
            Clear
          </Button>
        </div>
      )}
      <div className="jpb-dt__scroll" style={{ maxHeight }} tabIndex={0} role="region" aria-label={`${label} (scrollable)`}>
        <table className="jpb-dt__table" aria-label={label} aria-busy={loading || undefined}>
          <thead>
            <tr>
              {selectable && (
                <th scope="col" className="jpb-dt__selcol">
                  <Checkbox
                    checked={checkedOnPage > 0 && checkedOnPage === pageKeys.length}
                    indeterminate={checkedOnPage > 0 && checkedOnPage < pageKeys.length}
                    label={`Select all ${formatCount(pageKeys.length)} rows on this page`}
                    onChange={setAllOnPage}
                  />
                </th>
              )}
              {columns.map((c, ci) => {
                const active = sort?.key === c.key;
                const ariaSort = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : c.sortValue ? 'none' : undefined;
                const align = c.align ?? (c.numeric ? 'right' : undefined);
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={ariaSort}
                    data-numeric={c.numeric || undefined}
                    style={{ width: c.width, textAlign: align }}
                    className={cx(c.numeric && 'is-num', ci === 0 && 'is-first')}
                  >
                    {c.sortValue ? (
                      <button type="button" className={cx('jpb-dt__sort', active && 'is-active')} onClick={() => toggleSort(c.key)}>
                        {c.header}
                        <Icon name={active && sort.dir === 'asc' ? 'arrow-up' : 'arrow-down'} className="jpb-dt__sorticon" />
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
              {rowActions && (
                <th scope="col" className="jpb-dt__actcol">
                  <span className="jpb-sr-only">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 5 }, (_, i) => (
                <tr key={`sk-${i}`} className="jpb-dt__skeleton">
                  {Array.from({ length: colCount }, (_, ci) => (
                    <td key={ci}>
                      <Skeleton width="70%" />
                    </td>
                  ))}
                </tr>
              ))}
            {!loading &&
              sorted.map((row) => {
                const key = rowKey(row);
                const isChecked = checked.has(key);
                return (
                  <tr
                    key={key}
                    tabIndex={onRowActivate ? 0 : undefined}
                    className={cx(onRowActivate && 'is-interactive', selectedKey === key && 'is-selected', isChecked && 'is-checked')}
                    aria-current={selectedKey === key ? 'true' : undefined}
                    onClick={onRowActivate ? (e) => onRowClick(e, row) : undefined}
                    onKeyDown={onRowActivate ? (e) => onRowKey(e, row) : undefined}
                  >
                    {selectable && (
                      <td className="jpb-dt__selcol">
                        <Checkbox checked={isChecked} label={`Select ${nameOf(row)}`} onChange={(v) => setChecked(key, v)} />
                      </td>
                    )}
                    {columns.map((c, ci) => (
                      <td key={c.key} style={{ textAlign: c.align ?? (c.numeric ? 'right' : undefined) }} className={cx(c.numeric && 'is-num jpb-num', ci === 0 && 'is-first')}>
                        {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? '')}
                      </td>
                    ))}
                    {rowActions && (
                      <td className="jpb-dt__actcol">
                        <Menu label={`Actions for ${nameOf(row)}`} items={rowActions(row)} />
                      </td>
                    )}
                  </tr>
                );
              })}
          </tbody>
        </table>
        {!loading && rows.length === 0 && <div className="jpb-dt__empty">{empty ?? <EmptyState compact title="Nothing here yet" />}</div>}
      </div>
      {pagination && (
        <div className="jpb-dt__foot">
          <span className="jpb-dt__range">
            {pagination.total === 0
              ? 'No results'
              : `${formatCount(pagination.page * pagination.pageSize + 1)}–${formatCount(Math.min(pagination.total, (pagination.page + 1) * pagination.pageSize))} of ${formatCount(pagination.total)}`}
          </span>
          <span className="jpb-dt__pager">
            {pagination.pageSizeOptions && pagination.onPageSizeChange && (
              <label className="jpb-dt__size">
                <span>Rows</span>
                <select className="jpb-input jpb-dt__sizeselect" value={pagination.pageSize} onChange={(e) => pagination.onPageSizeChange?.(Number(e.target.value))}>
                  {pagination.pageSizeOptions.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <IconButton icon="chevron-left" label="Previous page" size="sm" variant="secondary" disabled={pagination.page <= 0} onClick={() => pagination.onPageChange(pagination.page - 1)} />
            <span className="jpb-dt__page" aria-live="polite">
              Page {pagination.page + 1} of {formatCount(pages)}
            </span>
            <IconButton icon="chevron-right" label="Next page" size="sm" variant="secondary" disabled={pagination.page >= pages - 1} onClick={() => pagination.onPageChange(pagination.page + 1)} />
          </span>
        </div>
      )}
    </div>
  );
}
