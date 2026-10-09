import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { observeElementRect, useVirtualizer } from '@tanstack/react-virtual';
import type { Virtualizer } from '@tanstack/react-virtual';
import { Skeleton, cx } from '@jpb/ui';
import './grid.css';

/** Default row height (px); every row has the same height, nothing is measured. */
export const GRID_ROW_HEIGHT = 48;
/** Sticky header height inside the scroll element. */
export const GRID_HEAD_HEIGHT = 38;
const OVERSCAN = 8;
/** Viewport used before layout is measured (first paint, jsdom). */
const FALLBACK_RECT = { width: 1280, height: 640 };

function observeRectWithFallback(instance: Virtualizer<HTMLDivElement, Element>, cb: (rect: { width: number; height: number }) => void) {
  return observeElementRect(instance, (rect) => cb(rect.height > 0 ? rect : FALLBACK_RECT));
}

export interface GridColumn<T> {
  key: string;
  header: ReactNode;
  /** CSS grid track, e.g. '72px' or 'minmax(160px, 2fr)'. */
  track: string;
  /** Right-aligned tabular numbers. */
  num?: boolean;
  cell: (row: T, index: number) => ReactNode;
  /** Header tooltip / longer description. */
  title?: string;
}

export interface VirtualGridProps<T> {
  /** Accessible table name. */
  label: string;
  /** Row count (the server's total); only the rows on screen exist in the DOM. */
  total: number;
  rowAt: (index: number) => T | null;
  columns: ReadonlyArray<GridColumn<T>>;
  /** Visible index window, so the caller can request the matching server pages. */
  onRangeChange?: (start: number, end: number) => void;
  /** Enter / click on a row. */
  onActivate?: (row: T, index: number) => void;
  /** Row shown as selected (aria-selected). */
  isSelected?: (row: T) => boolean;
  rowClassName?: (row: T) => string | undefined | false;
  /** Changing it scrolls back to the top (new mode / filters). */
  resetKey?: string;
  /** Scroll to and focus this row; bump `seq` to repeat the same index. */
  jumpTo?: { index: number; seq: number } | null;
  rowHeight?: number;
  /** Below this width the grid scrolls horizontally. */
  minWidth?: number;
  /** Extra class on the scroll element (sets its height). */
  className?: string;
  describedBy?: string;
}

/**
 * Virtualized table with ARIA table semantics (aria-rowcount / aria-rowindex).
 * One row is in the tab order (roving tabindex): ↑ ↓ PgUp PgDn Home End move,
 * Enter activates. Rows not loaded yet render skeleton cells (aria-busy).
 */
export function VirtualGrid<T>(props: VirtualGridProps<T>) {
  const { label, total, rowAt, columns, onRangeChange, onActivate, isSelected, rowClassName, resetKey, jumpTo, rowHeight = GRID_ROW_HEIGHT, minWidth = 860, className, describedBy } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [focusIndex, setFocusIndex] = useState(0);

  const virtualizer = useVirtualizer({
    count: total,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: OVERSCAN,
    initialRect: FALLBACK_RECT,
    observeElementRect: observeRectWithFallback,
    // The sticky header sits inside the scroll element, above the first row.
    scrollMargin: GRID_HEAD_HEIGHT,
    scrollPaddingStart: GRID_HEAD_HEIGHT,
  });

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setFocusIndex(0);
  }, [resetKey]);

  const items = virtualizer.getVirtualItems();
  const start = items[0]?.index ?? 0;
  const end = items.length ? items[items.length - 1]!.index + 1 : 0;
  useEffect(() => {
    onRangeChange?.(start, Math.max(start, end));
  }, [onRangeChange, start, end]);

  const focusRow = useCallback(
    (index: number) => {
      setFocusIndex(index);
      virtualizer.scrollToIndex(index, { align: 'auto' });
      const tryFocus = (attempt: number) => {
        const el = scrollRef.current?.querySelector<HTMLElement>(`[data-row="${index}"]`);
        if (el) el.focus();
        else if (attempt < 6) requestAnimationFrame(() => tryFocus(attempt + 1));
      };
      requestAnimationFrame(() => tryFocus(0));
    },
    [virtualizer],
  );

  useEffect(() => {
    if (!jumpTo || total === 0) return;
    const index = Math.min(total - 1, Math.max(0, jumpTo.index));
    setFocusIndex(index);
    virtualizer.scrollToIndex(index, { align: 'start' });
    // The sequence number is the trigger: the same index can be requested twice.
  }, [jumpTo?.seq]);

  const onRowKey = (e: KeyboardEvent<HTMLDivElement>, index: number, row: T | null) => {
    if (e.target !== e.currentTarget) return;
    const page = Math.max(1, Math.floor(((scrollRef.current?.clientHeight ?? FALLBACK_RECT.height) - GRID_HEAD_HEIGHT) / rowHeight) - 1);
    const moves: Record<string, number> = { ArrowDown: index + 1, ArrowUp: index - 1, PageDown: index + page, PageUp: index - page, Home: 0, End: total - 1 };
    if (e.key in moves) {
      e.preventDefault();
      const next = Math.min(total - 1, Math.max(0, moves[e.key]!));
      if (next !== index) focusRow(next);
      return;
    }
    if (row && onActivate && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onActivate(row, index);
    }
  };

  const onRowClick = (e: MouseEvent<HTMLDivElement>, index: number, row: T | null) => {
    if (!row || !onActivate) return;
    if (e.target instanceof Element && e.target.closest('a,button,input,select,textarea,label')) return;
    onActivate(row, index);
  };

  const tracks = columns.map((c) => c.track).join(' ');
  return (
    <div ref={scrollRef} className={cx('acr-standings-vg', className)} tabIndex={-1}>
      <div
        role="table"
        aria-label={label}
        aria-describedby={describedBy}
        aria-rowcount={total + 1}
        aria-colcount={columns.length}
        className="acr-standings-vg__table"
        style={{ minWidth, ['--acr-vg-tracks' as string]: tracks, ['--acr-vg-row' as string]: `${rowHeight}px` }}
      >
        <div role="rowgroup" className="acr-standings-vg__head">
          <div role="row" aria-rowindex={1} className="acr-standings-vg__row acr-standings-vg__row--head">
            {columns.map((c) => (
              <div key={c.key} role="columnheader" title={c.title} className={cx('acr-standings-vg__cell', c.num && 'is-num')}>
                {c.header}
              </div>
            ))}
          </div>
        </div>
        <div role="rowgroup" className="acr-standings-vg__body" style={{ height: virtualizer.getTotalSize() }}>
          {items.map((vr) => {
            const row = rowAt(vr.index);
            const selected = row && isSelected ? isSelected(row) : false;
            return (
              <div
                key={vr.key}
                role="row"
                data-row={vr.index}
                aria-rowindex={vr.index + 2}
                aria-busy={row ? undefined : true}
                aria-selected={isSelected ? selected : undefined}
                tabIndex={vr.index === focusIndex ? 0 : -1}
                className={cx('acr-standings-vg__row', row && onActivate && 'is-interactive', selected && 'is-selected', row && rowClassName?.(row))}
                style={{ transform: `translateY(${vr.start - GRID_HEAD_HEIGHT}px)` }}
                onFocus={() => setFocusIndex(vr.index)}
                onKeyDown={(e) => onRowKey(e, vr.index, row)}
                onClick={(e) => onRowClick(e, vr.index, row)}
              >
                {columns.map((c, ci) => (
                  <div key={c.key} role="cell" className={cx('acr-standings-vg__cell', c.num && 'is-num')}>
                    {row ? c.cell(row, vr.index) : <Skeleton width={ci === 1 ? '70%' : '50%'} />}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
