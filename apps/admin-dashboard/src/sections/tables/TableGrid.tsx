import { useCallback, useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { observeElementRect, useVirtualizer } from '@tanstack/react-virtual';
import type { Virtualizer } from '@tanstack/react-virtual';
import type { TableListItemDto } from '@jpb/shared-types';
import { cx, formatCount } from '@jpb/ui';
import { useElementWidth } from '../../components/useElementWidth';
import { GRID_GAP, LIST_ROW_HEIGHT, LoadingCell, TILE_HEIGHT, TILE_MIN_WIDTH, TableListRow, TableTileCard } from './TableTileCard';

export type MapView = 'grid' | 'list';

export interface TableGridProps {
  view: MapView;
  /** Number of tables matching the filters (the server's `total`). */
  count: number;
  /** Row at an absolute index, or null while its page is loading. */
  rowAt: (index: number) => TableListItemDto | null;
  /** Visible absolute index range [start, end) — the parent loads those server pages. */
  onRangeChange: (start: number, end: number) => void;
  hrefFor: (row: TableListItemDto) => string;
  serverNow: number;
  /** Changing it scrolls back to the top (new filters / sort). */
  resetKey: string;
  label: string;
}

/** Viewport used before the scroll element is measured (first paint, jsdom). */
const FALLBACK_RECT = { width: 1200, height: 640 };
const OVERSCAN_ROWS = 3;
/** Frames to wait for a scrolled-in tile to render before giving up on moving focus. */
const FOCUS_RETRY_FRAMES = 30;

/** Like the default observer, but never reports an empty rect (keeps rows rendered where layout is unavailable). */
function observeRectWithFallback(instance: Virtualizer<HTMLDivElement, Element>, cb: (rect: { width: number; height: number }) => void) {
  return observeElementRect(instance, (rect) => cb(rect.height > 0 ? rect : FALLBACK_RECT));
}

export function gridColumns(view: MapView, width: number): number {
  if (view === 'list') return 1;
  return Math.max(1, Math.floor((width + GRID_GAP) / (TILE_MIN_WIDTH + GRID_GAP)));
}

const NAV_KEYS = new Set(['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp']);

/**
 * Virtualized grid (or list) over a server-paginated result: only the rows on
 * screen are in the DOM and only their server pages are requested. Arrow
 * keys / Home / End / PageUp / PageDown move between tiles (scrolling as
 * needed); Enter opens the focused table.
 */
export function TableGrid({ view, count, rowAt, onRangeChange, hrefFor, serverNow, resetKey, label }: TableGridProps) {
  const [wrapRef, width] = useElementWidth<HTMLDivElement>(FALLBACK_RECT.width);
  const scrollRef = useRef<HTMLDivElement>(null);
  const columns = gridColumns(view, width);
  const rowHeight = view === 'list' ? LIST_ROW_HEIGHT : TILE_HEIGHT + GRID_GAP;
  const rowCount = Math.ceil(count / columns);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: OVERSCAN_ROWS,
    initialRect: FALLBACK_RECT,
    observeElementRect: observeRectWithFallback,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, rowHeight, columns]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [resetKey, view]);

  const items = virtualizer.getVirtualItems();
  const firstRow = items[0]?.index ?? 0;
  const lastRow = items[items.length - 1]?.index ?? 0;
  const start = firstRow * columns;
  const end = Math.min(count, (lastRow + 1) * columns);
  useEffect(() => {
    onRangeChange(start, Math.max(start, end));
  }, [onRangeChange, start, end]);

  const focusIndex = useCallback(
    (index: number) => {
      const find = () => scrollRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`) ?? null;
      const now = find();
      if (now) {
        now.focus();
        now.scrollIntoView?.({ block: 'nearest' });
        return;
      }
      // Off screen: scroll its row in, then focus once the virtualizer has rendered it.
      virtualizer.scrollToIndex(Math.floor(index / columns), { align: 'auto' });
      const tryFocus = (attempt: number) => {
        const el = find();
        if (el) el.focus();
        else if (attempt < FOCUS_RETRY_FRAMES) requestAnimationFrame(() => tryFocus(attempt + 1));
      };
      requestAnimationFrame(() => tryFocus(0));
    },
    [virtualizer, columns],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!NAV_KEYS.has(e.key) || count === 0) return;
    const target = e.target as HTMLElement;
    const current = Number(target.getAttribute('data-index'));
    if (!Number.isInteger(current)) return;
    const pageRows = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? FALLBACK_RECT.height) / rowHeight));
    const moves: Record<string, number> = {
      ArrowRight: current + 1,
      ArrowLeft: current - 1,
      ArrowDown: current + columns,
      ArrowUp: current - columns,
      Home: 0,
      End: count - 1,
      PageDown: current + pageRows * columns,
      PageUp: current - pageRows * columns,
    };
    const next = Math.min(count - 1, Math.max(0, moves[e.key] ?? current));
    e.preventDefault();
    if (next !== current) focusIndex(next);
  };

  return (
    <div ref={wrapRef} className={cx('acr-tables-map', `is-${view}`)}>
      {view === 'list' && (
        <div className="acr-tables-listhead" aria-hidden="true">
          <span>Table</span>
          <span>Status</span>
          <span>Players</span>
          <span>Hand</span>
          <span>Since progress</span>
          <span>Connections</span>
          <span className="acr-tables-row__chips">Chips</span>
        </div>
      )}
      <div ref={scrollRef} className="acr-tables-scroll" onKeyDown={onKeyDown}>
        <div role="list" aria-label={`${label}: ${formatCount(count)} tables. Use arrow keys to move between tables.`} style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {items.map((vr) => (
            <div
              key={vr.key}
              role="presentation"
              className="acr-tables-vrow"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: rowHeight,
                transform: `translateY(${vr.start}px)`,
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              }}
            >
              {Array.from({ length: columns }, (_, c) => {
                const index = vr.index * columns + c;
                if (index >= count) return null;
                const row = rowAt(index);
                if (!row) return <LoadingCell key={`l${index}`} view={view} index={index} total={count} />;
                const Cell = view === 'grid' ? TableTileCard : TableListRow;
                return <Cell key={row.tableId} row={row} index={index} total={count} href={hrefFor(row)} serverNow={serverNow} />;
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
