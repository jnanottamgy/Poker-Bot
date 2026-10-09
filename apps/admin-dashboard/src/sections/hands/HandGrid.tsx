import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { observeElementRect, useVirtualizer } from '@tanstack/react-virtual';
import type { Virtualizer } from '@tanstack/react-virtual';
import type { HandListItemDto } from '@jpb/shared-types';
import { Badge, Icon, Skeleton, cx, formatChips, formatCount } from '@jpb/ui';
import { sectionHref } from '../../app/sections';
import { formatDateTime, formatDuration, formatTimeOfDay } from '../../lib/time';
import { bbText, handDurationMs, totalWon, winnersText } from './model';

export const ROW_HEIGHT = 52;
/** Sticky header height (inside the scroll element, above the rows). */
export const HEAD_HEIGHT = 40;
const OVERSCAN = 10;
/** Viewport used before layout is measured (first paint, jsdom). */
const FALLBACK_RECT = { width: 1280, height: 640 };
const DAY_MS = 24 * 3600_000;

function observeRectWithFallback(instance: Virtualizer<HTMLDivElement, Element>, cb: (rect: { width: number; height: number }) => void) {
  return observeElementRect(instance, (rect) => cb(rect.height > 0 ? rect : FALLBACK_RECT));
}

export interface HandGridProps {
  tournamentId: string;
  total: number;
  rowAt: (index: number) => HandListItemDto | null;
  onRangeChange: (start: number, end: number) => void;
  /** Changing it scrolls back to the top (new filters, refresh). */
  resetKey: string;
  label: string;
  /** Server "now" for times (the date is shown when not today). */
  now: number;
}

interface Col {
  key: string;
  header: ReactNode;
  num?: boolean;
  cell: (h: HandListItemDto) => ReactNode;
}

function timeCell(h: HandListItemDto, now: number): ReactNode {
  const at = h.completedAt ?? h.startedAt;
  const duration = handDurationMs(h);
  const sameDay = Math.abs(now - at) < DAY_MS && new Date(now).getDate() === new Date(at).getDate();
  return (
    <span className="acr-hands-time" title={formatDateTime(at)}>
      <span className="jpb-num">{sameDay ? formatTimeOfDay(at) : formatDateTime(at)}</span>
      <span className="acr-hands-sub">{duration === null ? 'in progress' : formatDuration(duration)}</span>
    </span>
  );
}

/**
 * Virtualized hand history (ARIA table semantics with aria-rowcount /
 * aria-rowindex): only the rows on screen exist in the DOM and only their
 * server pages are requested. One row is in the tab order (roving
 * tabindex): ↑ ↓ PgUp PgDn Home End move, Enter opens the hand.
 */
export function HandGrid({ tournamentId, total, rowAt, onRangeChange, resetKey, label, now }: HandGridProps) {
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [focusIndex, setFocusIndex] = useState(0);

  const virtualizer = useVirtualizer({
    count: total,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    initialRect: FALLBACK_RECT,
    observeElementRect: observeRectWithFallback,
    scrollMargin: HEAD_HEIGHT,
    scrollPaddingStart: HEAD_HEIGHT,
  });

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setFocusIndex(0);
  }, [resetKey]);

  const items = virtualizer.getVirtualItems();
  const start = items[0]?.index ?? 0;
  const end = items.length ? items[items.length - 1]!.index + 1 : 0;
  useEffect(() => {
    onRangeChange(start, Math.max(start, end));
  }, [onRangeChange, start, end]);

  const hrefOf = useCallback((h: HandListItemDto) => sectionHref('hand-detail', tournamentId, { handId: h.handId }), [tournamentId]);

  const focusRow = useCallback(
    (index: number) => {
      setFocusIndex(index);
      virtualizer.scrollToIndex(index, { align: 'auto' });
      const tryFocus = (attempt: number) => {
        const el = scrollRef.current?.querySelector<HTMLElement>(`[data-row="${index}"]`);
        if (el) el.focus();
        else if (attempt < 5) requestAnimationFrame(() => tryFocus(attempt + 1));
      };
      requestAnimationFrame(() => tryFocus(0));
    },
    [virtualizer],
  );

  const onRowKey = (e: KeyboardEvent<HTMLDivElement>, index: number, row: HandListItemDto | null) => {
    if (e.target !== e.currentTarget) return;
    const page = Math.max(1, Math.floor(((scrollRef.current?.clientHeight ?? FALLBACK_RECT.height) - HEAD_HEIGHT) / ROW_HEIGHT) - 1);
    const moves: Record<string, number> = { ArrowDown: index + 1, ArrowUp: index - 1, PageDown: index + page, PageUp: index - page, Home: 0, End: total - 1 };
    if (e.key in moves) {
      e.preventDefault();
      const next = Math.min(total - 1, Math.max(0, moves[e.key]!));
      if (next !== index) focusRow(next);
      return;
    }
    if (row && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      navigate(hrefOf(row));
    }
  };

  const cols: Col[] = [
    {
      key: 'hand',
      header: 'Hand',
      cell: (h) => (
        <Link to={hrefOf(h)} className="acr-hands-no" tabIndex={-1}>
          #{formatCount(h.handNumber)}
        </Link>
      ),
    },
    {
      key: 'table',
      header: 'Table',
      cell: (h) => (
        <Link to={sectionHref('table-detail', tournamentId, { tableId: h.tableId })} className="acr-link acr-hands-table" tabIndex={-1} aria-label={`Table ${h.tableNumber}`}>
          T{h.tableNumber}
        </Link>
      ),
    },
    {
      key: 'level',
      header: 'Level · blinds',
      cell: (h) => (
        <span className="acr-hands-stack">
          <span className="acr-hands-level">L{h.level}</span>
          <span className="acr-hands-sub jpb-num">
            {formatChips(h.smallBlind)}/{formatChips(h.bigBlind)}
          </span>
        </span>
      ),
    },
    {
      key: 'pot',
      header: 'Pot',
      num: true,
      cell: (h) => (
        <span className="acr-hands-stack acr-hands-stack--end" title={`${formatChips(h.totalPot)} chips`}>
          <span className="jpb-num acr-hands-pot">{formatChips(h.totalPot)}</span>
          <span className="acr-hands-sub jpb-num">{bbText(h.totalPot, h.bigBlind)}</span>
        </span>
      ),
    },
    {
      key: 'players',
      header: 'Players',
      num: true,
      cell: (h) => <span className="jpb-num">{h.players}</span>,
    },
    {
      key: 'winners',
      header: 'Winner(s)',
      cell: (h) =>
        h.winners.length === 0 ? (
          <span className="acr-hands-dim">—</span>
        ) : (
          <span className="acr-hands-stack" title={h.winners.map((w) => `${w.displayName} +${formatChips(w.amount)}`).join(', ')}>
            <span className="acr-hands-winner">
              <Icon name="trophy" />
              <span className="acr-hands-winner__name">{winnersText(h.winners)}</span>
            </span>
            <span className="acr-hands-sub jpb-num">+{formatChips(totalWon(h.winners))}</span>
          </span>
        ),
    },
    {
      key: 'flags',
      header: 'Showdown · all-in',
      cell: (h) => (
        <span className="acr-hands-flags">
          {h.showdown && (
            <Badge tone="info" srLabel="Went to showdown">
              <Icon name="eye" /> SHOWDOWN
            </Badge>
          )}
          {h.allIn && (
            <Badge tone="warning" srLabel="A player was all-in">
              <Icon name="flame" /> ALL-IN
            </Badge>
          )}
          {!h.showdown && !h.allIn && <span className="acr-hands-dim">—</span>}
        </span>
      ),
    },
    { key: 'time', header: 'Completed', cell: (h) => timeCell(h, now) },
  ];

  const rowLabel = (h: HandListItemDto): string =>
    `Hand ${h.handNumber}, table ${h.tableNumber}, level ${h.level}, pot ${formatChips(h.totalPot)} chips, ${h.players} players, won by ${winnersText(h.winners)}${h.showdown ? ', showdown' : ''}${h.allIn ? ', all-in' : ''}. Open the hand.`;

  return (
    <div className="acr-hands-grid" role="table" aria-label={label} aria-rowcount={total + 1}>
      <div ref={scrollRef} className="acr-hands-grid__scroll" tabIndex={-1}>
        <div className="acr-hands-row acr-hands-row--head" role="row" aria-rowindex={1}>
          {cols.map((c) => (
            <div key={c.key} role="columnheader" className={cx('acr-hands-cell', `acr-hands-col--${c.key}`, c.num && 'is-num')}>
              {c.header}
            </div>
          ))}
          <div className="acr-hands-cell acr-hands-col--go" aria-hidden="true" />
        </div>
        <div className="acr-hands-grid__body" style={{ height: virtualizer.getTotalSize() }}>
          {items.map((v) => {
            const h = rowAt(v.index);
            const focusable = v.index === focusIndex;
            return (
              <div
                key={v.key}
                data-row={v.index}
                role="row"
                aria-rowindex={v.index + 2}
                tabIndex={focusable ? 0 : -1}
                aria-label={h ? rowLabel(h) : `Loading hand ${v.index + 1}`}
                className={cx('acr-hands-row', !h && 'is-loading', h?.showdown && 'is-showdown')}
                style={{ transform: `translateY(${v.start - HEAD_HEIGHT}px)` }}
                onClick={(e) => {
                  setFocusIndex(v.index);
                  if (h && !(e.target as HTMLElement).closest('a')) navigate(hrefOf(h));
                }}
                onFocus={() => setFocusIndex(v.index)}
                onKeyDown={(e) => onRowKey(e, v.index, h)}
              >
                {h
                  ? cols.map((c) => (
                      <div key={c.key} role="cell" className={cx('acr-hands-cell', `acr-hands-col--${c.key}`, c.num && 'is-num')}>
                        {c.cell(h)}
                      </div>
                    ))
                  : cols.map((c) => (
                      <div key={c.key} role="cell" className={cx('acr-hands-cell', `acr-hands-col--${c.key}`)}>
                        <Skeleton width="70%" />
                      </div>
                    ))}
                <div className="acr-hands-cell acr-hands-col--go" aria-hidden="true">
                  <Icon name="chevron-right" />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
