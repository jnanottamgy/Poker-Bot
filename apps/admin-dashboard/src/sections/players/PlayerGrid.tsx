import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { observeElementRect, useVirtualizer } from '@tanstack/react-virtual';
import type { Virtualizer } from '@tanstack/react-virtual';
import type { PlayerListItemDto } from '@jpb/shared-types';
import { Icon, Skeleton, cx, formatChips, formatCount, formatOrdinal, initials } from '@jpb/ui';
import type { PlayerSort } from '../../api/types';
import { sectionHref } from '../../app/sections';
import { formatDateTime, formatTimeOfDay } from '../../lib/time';
import { ACTIVE_STATUSES, SORT_META, formatBB } from './model';
import { ConnectionPill, PlayerStatusPill } from './pills';

export const ROW_HEIGHT = 52;
/** Sticky header height (inside the scroll element, above the rows). */
export const HEAD_HEIGHT = 40;
const OVERSCAN = 8;
/** Viewport used before layout is measured (first paint, jsdom). */
const FALLBACK_RECT = { width: 1280, height: 640 };

function observeRectWithFallback(instance: Virtualizer<HTMLDivElement, Element>, cb: (rect: { width: number; height: number }) => void) {
  return observeElementRect(instance, (rect) => cb(rect.height > 0 ? rect : FALLBACK_RECT));
}

export interface PlayerGridProps {
  tournamentId: string;
  total: number;
  rowAt: (index: number) => PlayerListItemDto | null;
  onRangeChange: (start: number, end: number) => void;
  /** Changing it scrolls back to the top (new filters / sort). */
  resetKey: string;
  sort: PlayerSort;
  onSort: (s: PlayerSort) => void;
  bigBlind: number | null;
  awayAfterTimeouts: number | null;
  /** Bulk approval: checkboxes on pending rows. */
  selectable: boolean;
  selected: ReadonlySet<string>;
  onToggle: (row: PlayerListItemDto) => void;
  /** Toggle every pending row currently loaded on screen. */
  onToggleLoaded: (on: boolean) => void;
  loadedPending: number;
  selectedLoaded: number;
  label: string;
  /** Server "today" for registered times (date shown when not today). */
  now: number;
  /** Before the start there are no seats, stacks or connections: those columns are left out. */
  started: boolean;
}

/** Columns that only mean something once players are seated. */
const PLAY_COLUMNS: ReadonlySet<string> = new Set(['rank', 'seat', 'stack', 'conn', 'timeouts', 'finish']);

interface Col {
  key: string;
  header: ReactNode;
  /** CSS grid track. */
  track: string;
  num?: boolean;
  sort?: PlayerSort;
  cell: (r: PlayerListItemDto) => ReactNode;
}

const DAY_MS = 24 * 3600_000;

/**
 * Virtualized players table (ARIA table semantics with aria-rowcount /
 * aria-rowindex): only the rows on screen exist in the DOM, only their
 * server pages are requested. One row is in the tab order (roving
 * tabindex): ↑ ↓ PgUp PgDn Home End move, Enter opens the player, Space
 * selects a pending registration.
 */
export function PlayerGrid(props: PlayerGridProps) {
  const { tournamentId, total, rowAt, onRangeChange, resetKey, sort, onSort, bigBlind, awayAfterTimeouts, selectable, selected, onToggle, onToggleLoaded, loadedPending, selectedLoaded, label, now, started } = props;
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
    // The sticky header sits inside the scroll element, above the first row.
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

  const hrefOf = useCallback((r: PlayerListItemDto) => sectionHref('player-detail', tournamentId, { playerId: r.playerId }), [tournamentId]);

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

  const onRowKey = (e: KeyboardEvent<HTMLDivElement>, index: number, row: PlayerListItemDto | null) => {
    if (e.target !== e.currentTarget) return;
    const page = Math.max(1, Math.floor(((scrollRef.current?.clientHeight ?? FALLBACK_RECT.height) - HEAD_HEIGHT) / ROW_HEIGHT) - 1);
    const moves: Record<string, number> = { ArrowDown: index + 1, ArrowUp: index - 1, PageDown: index + page, PageUp: index - page, Home: 0, End: total - 1 };
    if (e.key in moves) {
      e.preventDefault();
      const next = Math.min(total - 1, Math.max(0, moves[e.key]!));
      if (next !== index) focusRow(next);
      return;
    }
    if (!row) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      navigate(hrefOf(row));
    } else if (e.key === ' ' && selectable && row.status === 'PENDING_APPROVAL') {
      e.preventDefault();
      onToggle(row);
    }
  };

  const allCols: Col[] = [
    {
      key: 'rank',
      header: 'Rank',
      track: '60px',
      num: true,
      sort: 'stack',
      cell: (r) =>
        r.stackRank !== null ? (
          <span title="Current stack rank">#{formatCount(r.stackRank)}</span>
        ) : (
          <span className="acr-players-dim">—</span>
        ),
    },
    {
      key: 'name',
      header: 'Player',
      track: 'minmax(170px, 2.2fr)',
      sort: 'name',
      cell: (r) => (
        <span className="acr-players-who">
          <span className="acr-avatar acr-players-avatar" aria-hidden="true">
            {initials(r.displayName)}
          </span>
          <span className="acr-players-who__text">
            <Link to={hrefOf(r)} className="acr-players-name" tabIndex={-1}>
              {r.displayName}
            </Link>
            {r.nickname && <span className="acr-players-nick">“{r.nickname}”</span>}
          </span>
        </span>
      ),
    },
    { key: 'pid', header: 'Public ID', track: '96px', cell: (r) => <span className="jpb-mono acr-players-pid">{r.publicId}</span> },
    { key: 'status', header: 'Status', track: '136px', cell: (r) => <PlayerStatusPill status={r.status} short /> },
    {
      key: 'seat',
      header: 'Table / seat',
      track: '96px',
      cell: (r) =>
        r.tableId && r.tableNumber !== null ? (
          <Link to={sectionHref('table-detail', tournamentId, { tableId: r.tableId })} className="acr-link acr-players-seat" tabIndex={-1} aria-label={`Table ${r.tableNumber}${r.seat !== null ? `, seat ${r.seat + 1}` : ''}`}>
            T{r.tableNumber}
            {r.seat !== null && <span className="acr-players-seatno"> · S{r.seat + 1}</span>}
          </Link>
        ) : (
          <span className="acr-players-dim">—</span>
        ),
    },
    {
      key: 'stack',
      header: 'Stack',
      track: '120px',
      num: true,
      sort: 'stack',
      cell: (r) =>
        ACTIVE_STATUSES.has(r.status) ? (
          <span className="acr-players-stack" title={`${formatChips(r.stack)} chips`}>
            <span className="jpb-num">{formatChips(r.stack)}</span>
            <span className="acr-players-bb">{bigBlind ? formatBB(r.stack, bigBlind) : r.stackBB ? `${r.stackBB} BB` : ''}</span>
          </span>
        ) : (
          <span className="acr-players-dim">—</span>
        ),
    },
    { key: 'conn', header: 'Connection', track: '108px', cell: (r) => <ConnectionPill player={r} awayAfterTimeouts={awayAfterTimeouts} /> },
    {
      key: 'timeouts',
      header: 'Timeouts',
      track: '78px',
      num: true,
      cell: (r) =>
        r.consecutiveTimeouts > 0 ? (
          <span className={cx('acr-players-to', awayAfterTimeouts !== null && r.consecutiveTimeouts >= awayAfterTimeouts && 'is-away')} title={`${r.consecutiveTimeouts} consecutive timeouts`}>
            <Icon name="clock" /> {formatCount(r.consecutiveTimeouts)}
          </span>
        ) : (
          <span className="acr-players-dim">0</span>
        ),
    },
    {
      key: 'finish',
      header: 'Finish',
      track: '70px',
      num: true,
      sort: 'finish',
      cell: (r) => (r.finishPosition !== null ? <span>{formatOrdinal(r.finishPosition)}</span> : <span className="acr-players-dim">—</span>),
    },
    {
      key: 'reg',
      header: 'Registered',
      track: '104px',
      num: true,
      sort: 'registration',
      cell: (r) => (
        <span className="acr-players-reg" title={formatDateTime(r.registeredAt)}>
          <span className="jpb-num">#{formatCount(r.registrationSeq)}</span>
          <span className="acr-players-dim">{now - r.registeredAt < DAY_MS ? formatTimeOfDay(r.registeredAt, false) : formatDateTime(r.registeredAt).split(',')[0]}</span>
        </span>
      ),
    },
  ];

  const cols = started ? allCols : allCols.filter((c) => !PLAY_COLUMNS.has(c.key));
  const tracks = `${selectable ? '40px ' : ''}${cols.map((c) => c.track).join(' ')}`;
  const allLoadedChecked = loadedPending > 0 && selectedLoaded === loadedPending;

  return (
    <div ref={scrollRef} className="acr-players-scroll" tabIndex={-1}>
      <div role="table" aria-label={label} aria-rowcount={total + 1} aria-colcount={cols.length + (selectable ? 1 : 0)} className="acr-players-table" style={{ ['--acr-players-tracks' as string]: tracks }}>
        <div role="rowgroup" className="acr-players-head">
          <div role="row" aria-rowindex={1} className="acr-players-row acr-players-row--head">
            {selectable && (
              <div role="columnheader" className="acr-players-cell acr-players-cell--check">
                <label className="acr-players-check" title={loadedPending ? 'Select every pending registration loaded on screen' : 'No pending registrations on screen'}>
                  <input type="checkbox" checked={allLoadedChecked} disabled={loadedPending === 0} onChange={(e) => onToggleLoaded(e.target.checked)} aria-label="Select every pending registration loaded on screen" />
                  <span className="acr-players-checkbox" aria-hidden="true">
                    {allLoadedChecked ? <Icon name="check" /> : selectedLoaded > 0 ? <Icon name="minus" /> : null}
                  </span>
                </label>
              </div>
            )}
            {cols.map((c) => {
              const activeSort = c.sort !== undefined && c.sort === sort;
              return (
                <div key={c.key} role="columnheader" aria-sort={activeSort ? SORT_META[sort].dir : c.sort ? 'none' : undefined} className={cx('acr-players-cell', c.num && 'is-num')}>
                  {c.sort ? (
                    <button type="button" className={cx('acr-players-sort', activeSort && 'is-active')} onClick={() => onSort(c.sort!)} title={`Sort by ${SORT_META[c.sort].label.toLowerCase()}`}>
                      {c.header}
                      <Icon name={activeSort && SORT_META[sort].dir === 'ascending' ? 'arrow-up' : 'arrow-down'} className="acr-players-sorticon" />
                    </button>
                  ) : (
                    c.header
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div role="rowgroup" className="acr-players-body" style={{ height: virtualizer.getTotalSize() }}>
          {items.map((vr) => {
            const row = rowAt(vr.index);
            const isPending = row?.status === 'PENDING_APPROVAL';
            const checked = row ? selected.has(row.playerId) : false;
            return (
              <div
                key={vr.key}
                role="row"
                data-row={vr.index}
                aria-rowindex={vr.index + 2}
                aria-busy={row ? undefined : true}
                tabIndex={vr.index === focusIndex ? 0 : -1}
                className={cx('acr-players-row', row && 'is-interactive', checked && 'is-checked', row && `is-${row.status.toLowerCase()}`)}
                style={{ transform: `translateY(${vr.start - HEAD_HEIGHT}px)` }}
                onFocus={() => setFocusIndex(vr.index)}
                onKeyDown={(e) => onRowKey(e, vr.index, row)}
                onClick={(e) => {
                  if (!row || (e.target instanceof Element && e.target.closest('a,button,input,label'))) return;
                  navigate(hrefOf(row));
                }}
              >
                {selectable && (
                  <div role="cell" className="acr-players-cell acr-players-cell--check">
                    {row && isPending ? (
                      <label className="acr-players-check">
                        <input type="checkbox" tabIndex={-1} checked={checked} onChange={() => onToggle(row)} aria-label={`Select ${row.displayName} for approval`} />
                        <span className="acr-players-checkbox" aria-hidden="true">
                          {checked && <Icon name="check" />}
                        </span>
                      </label>
                    ) : null}
                  </div>
                )}
                {cols.map((c) => (
                  <div key={c.key} role="cell" className={cx('acr-players-cell', c.num && 'is-num')}>
                    {row ? c.cell(row) : <Skeleton width={c.key === 'name' ? '70%' : '55%'} />}
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
