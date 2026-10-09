import { useEffect, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { observeElementRect, useVirtualizer } from '@tanstack/react-virtual';
import type { Virtualizer } from '@tanstack/react-virtual';
import { cx } from '@jpb/ui';
import { useWizard } from './context';

/** Viewport used before layout is measured (first paint, jsdom). */
const FALLBACK_RECT = { width: 1100, height: 560 };
const OVERSCAN = 6;

function observeRectWithFallback(instance: Virtualizer<HTMLDivElement, Element>, cb: (rect: { width: number; height: number }) => void) {
  return observeElementRect(instance, (rect) => cb(rect.height > 0 ? rect : FALLBACK_RECT));
}

export interface VirtualRowsProps {
  /** Accessible table name. */
  label: string;
  /** Config path of the array (e.g. "blindSchedule"): issue links scroll its rows into view. */
  arrayPath: string;
  count: number;
  rowHeight: number;
  /** CSS grid tracks shared by the header and every row. */
  columns: string;
  header: ReactNode;
  renderRow: (index: number) => ReactNode;
  /** Height cap of the scroll area (px). */
  maxHeight?: number;
  minWidth?: number;
  empty?: ReactNode;
  className?: string;
}

/**
 * Editable list with ARIA table semantics where only the visible rows exist
 * in the DOM (500 blind levels or 1,000,000 paid places stay responsive).
 * The header is a separate row above the scroll area.
 */
export function VirtualRows({ label, arrayPath, count, rowHeight, columns, header, renderRow, maxHeight = 560, minWidth = 720, empty, className }: VirtualRowsProps) {
  const { registerScroller } = useWizard();
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: OVERSCAN,
    initialRect: FALLBACK_RECT,
    observeElementRect: observeRectWithFallback,
  });

  useEffect(() => registerScroller(arrayPath, (index) => virtualizer.scrollToIndex(Math.max(0, Math.min(count - 1, index)), { align: 'center' })), [registerScroller, arrayPath, virtualizer, count]);

  const style = { '--acr-setup-cols': columns, minWidth } as CSSProperties;
  const height = Math.min(maxHeight, Math.max(rowHeight, count * rowHeight));
  return (
    <div className={cx('acr-setup-vtable', className)} role="table" aria-label={label} aria-rowcount={count + 1}>
      <div className="acr-setup-vtable__hscroll">
        <div role="rowgroup" style={style}>
          <div role="row" aria-rowindex={1} className="acr-setup-vtable__head">
            {header}
          </div>
        </div>
        {count === 0 ? (
          <div className="acr-setup-vtable__empty" style={{ minWidth }}>
            {empty}
          </div>
        ) : (
          <div ref={scrollRef} className="acr-setup-vtable__scroll" style={{ height, minWidth }}>
            <div role="rowgroup" style={{ ...style, height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualizer.getVirtualItems().map((item) => (
                <div
                  key={item.key}
                  role="row"
                  aria-rowindex={item.index + 2}
                  className="acr-setup-vtable__row"
                  data-index={item.index}
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, height: rowHeight, transform: `translateY(${item.start}px)` }}
                >
                  {renderRow(item.index)}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
