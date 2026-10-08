import { useEffect, useMemo, useRef, useState } from 'react';
import { cx } from '../cx';
import { formatChipsCompact, formatCount } from '../format';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import type { Tone } from './StatusPill';

export type TableTileStatus = 'ACTIVE' | 'IDLE' | 'HELD' | 'BREAKING' | 'STALLED' | 'CLOSED';

/**
 * Normal states (ACTIVE / IDLE / CLOSED) are neutral: 130 healthy tables must
 * not form a green wall that hides the one STALLED table. Colour is reserved
 * for exceptions.
 */
export const TABLE_STATUS_META: Readonly<Record<TableTileStatus, { label: string; short: string; tone: Tone; icon: IconName }>> = {
  ACTIVE: { label: 'Active', short: 'Active', tone: 'neutral', icon: 'play' },
  IDLE: { label: 'Idle', short: 'Idle', tone: 'neutral', icon: 'moon' },
  HELD: { label: 'Held', short: 'Held', tone: 'warning', icon: 'pause' },
  BREAKING: { label: 'Breaking', short: 'Break', tone: 'info', icon: 'split' },
  STALLED: { label: 'Stalled', short: 'Stall', tone: 'danger', icon: 'warning' },
  CLOSED: { label: 'Closed', short: 'Closed', tone: 'neutral', icon: 'lock' },
};

export type TableHealth = 'ok' | 'warn' | 'critical';

export interface TableTileData {
  id: string;
  tableNumber: number;
  players: number;
  maxSeats: number;
  status: TableTileStatus;
  health: TableHealth;
  /** Short health text, e.g. "Hand 4s ago" / "No progress 92s". */
  healthText: string;
  handNumber?: number;
  averageStack?: number;
  /** Final table / feature table marker. */
  featured?: boolean;
  /** Open alerts on this table. */
  alerts?: number;
}

/** Fixed tile height so a virtualized grid can compute rows without measuring. */
export const TABLE_TILE_HEIGHT = 112;
export const TABLE_TILE_MIN_WIDTH = 168;
/** Compact tiles (map narrower than TABLE_MAP_COMPACT_BELOW): 3-4 per row on a phone. */
export const TABLE_TILE_COMPACT_HEIGHT = 56;
export const TABLE_TILE_COMPACT_MIN_WIDTH = 96;
export const TABLE_MAP_COMPACT_BELOW = 600;
export const TABLE_MAP_GAP = 10;

const HEALTH_LABEL: Readonly<Record<TableHealth, string>> = { ok: 'Healthy', warn: 'Degraded', critical: 'Critical' };

export interface TableTileProps extends TableTileData {
  selected?: boolean;
  onSelect?: (id: string) => void;
  /** Small tile: number, status icon + short text, players. */
  compact?: boolean;
}

/** One table in the admin map: number, seats, status (icon + text) and health. */
export function TableTile({ id, tableNumber, players, maxSeats, status, health, healthText, handNumber, averageStack, featured, alerts = 0, selected, onSelect, compact = false }: TableTileProps) {
  const meta = TABLE_STATUS_META[status];
  const label = `Table ${tableNumber}, ${meta.label}, ${players} of ${maxSeats} players, health ${HEALTH_LABEL[health]}: ${healthText}${alerts ? `, ${alerts} alerts` : ''}`;
  const exception = meta.tone !== 'neutral' || health !== 'ok' || alerts > 0;
  if (compact) {
    return (
      <button
        type="button"
        className={cx('jpb-ttile', 'jpb-ttile--compact', `jpb-ttile--${meta.tone}`, `is-health-${health}`, selected && 'is-selected', featured && 'is-featured', exception && 'is-exception')}
        style={{ height: TABLE_TILE_COMPACT_HEIGHT }}
        aria-label={label}
        aria-pressed={selected}
        onClick={() => onSelect?.(id)}
      >
        <span className="jpb-ttile__top">
          <span className="jpb-ttile__num jpb-num">
            {featured && <Icon name="crown" />}T{tableNumber}
          </span>
          <span className="jpb-ttile__count jpb-num">
            {players}/{maxSeats}
          </span>
        </span>
        <span className={cx('jpb-ttile__status', `is-${meta.tone}`)}>
          <Icon name={health === 'ok' ? meta.icon : health === 'warn' ? 'warning' : 'critical'} />
          {health === 'ok' ? meta.short : HEALTH_LABEL[health]}
          {alerts > 0 && <span className="jpb-ttile__alerts">{alerts}</span>}
        </span>
      </button>
    );
  }
  return (
    <button
      type="button"
      className={cx('jpb-ttile', `jpb-ttile--${meta.tone}`, `is-health-${health}`, selected && 'is-selected', featured && 'is-featured', exception && 'is-exception')}
      style={{ height: TABLE_TILE_HEIGHT }}
      aria-label={label}
      aria-pressed={selected}
      onClick={() => onSelect?.(id)}
    >
      <span className="jpb-ttile__top">
        <span className="jpb-ttile__num jpb-num">
          {featured && <Icon name="crown" />}T{tableNumber}
        </span>
        <span className={cx('jpb-ttile__status', `is-${meta.tone}`)}>
          <Icon name={meta.icon} />
          {meta.label}
        </span>
      </span>
      <span className="jpb-ttile__seats" aria-hidden="true">
        {Array.from({ length: maxSeats }, (_, i) => (
          <span key={i} className={cx('jpb-ttile__seat', i < players && 'is-filled')} />
        ))}
      </span>
      <span className="jpb-ttile__meta">
        <span className="jpb-num">
          {players}/{maxSeats}
        </span>
        {handNumber !== undefined && <span className="jpb-num">#{formatCount(handNumber)}</span>}
        {averageStack !== undefined && <span className="jpb-num">avg {formatChipsCompact(averageStack)}</span>}
      </span>
      <span className={cx('jpb-ttile__health', `is-${health}`)}>
        <Icon name={health === 'ok' ? 'check-circle' : health === 'warn' ? 'warning' : 'critical'} />
        <span className="jpb-ttile__healthtext">{healthText}</span>
        {alerts > 0 && (
          <span className="jpb-ttile__alerts">
            {alerts} alert{alerts > 1 ? 's' : ''}
          </span>
        )}
      </span>
    </button>
  );
}

export interface TableMapProps {
  tables: TableTileData[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /**
   * Maximum height of the scroll viewport (default 560). Inside a container with
   * a definite height (e.g. <Panel fill>) the map fills it up to this cap and
   * windows to the height it MEASURES, not to this number.
   */
  height?: number;
  /** Rows rendered beyond the viewport. */
  overscanRows?: number;
  /** Render everything (no windowing). Default: windowing above 120 tables. */
  virtualize?: boolean;
  /** Controlled status filter (legend toggles). Omit for internal state. */
  filter?: TableTileStatus | null;
  onFilterChange?: (s: TableTileStatus | null) => void;
  className?: string;
}

/** Counts per status for legends/summaries. */
export function countByStatus(tables: TableTileData[]): Record<TableTileStatus, number> {
  const out: Record<TableTileStatus, number> = { ACTIVE: 0, IDLE: 0, HELD: 0, BREAKING: 0, STALLED: 0, CLOSED: 0 };
  for (const t of tables) out[t.status] += 1;
  return out;
}

/** Grid metrics for a container width (pure; used by the windowing logic). */
export function tableMapMetrics(width: number): { columns: number; rowHeight: number; compact: boolean } {
  const compact = width > 0 && width < TABLE_MAP_COMPACT_BELOW;
  const minW = compact ? TABLE_TILE_COMPACT_MIN_WIDTH : TABLE_TILE_MIN_WIDTH;
  const columns = Math.max(1, Math.floor((width + TABLE_MAP_GAP) / (minW + TABLE_MAP_GAP)));
  return { columns, rowHeight: (compact ? TABLE_TILE_COMPACT_HEIGHT : TABLE_TILE_HEIGHT) + TABLE_MAP_GAP, compact };
}

/**
 * Grid of table tiles with a status legend that doubles as a filter (toggle a
 * status to show only those tables). Tiles have a fixed height, so the grid
 * windows itself (only visible rows are in the DOM) for thousands of tables.
 * Fills its container's height; fades the bottom edge while more is below.
 */
export function TableMap({ tables, selectedId, onSelect, height = 560, overscanRows = 2, virtualize, filter: filterProp, onFilterChange, className }: TableMapProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [scrollTop, setScrollTop] = useState(0);
  const [localFilter, setLocalFilter] = useState<TableTileStatus | null>(null);
  const filter = filterProp !== undefined ? filterProp : localFilter;
  const setFilter = (s: TableTileStatus | null): void => {
    if (filterProp === undefined) setLocalFilter(s);
    onFilterChange?.(s);
  };

  useEffect(() => {
    const el = scroller.current;
    if (!el) return undefined;
    const measure = (): void => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    if (typeof ResizeObserver !== 'function') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const counts = useMemo(() => countByStatus(tables), [tables]);
  const shown = useMemo(() => (filter ? tables.filter((t) => t.status === filter) : tables), [tables, filter]);
  const windowed = virtualize ?? shown.length > 120;
  const { columns, rowHeight, compact } = tableMapMetrics(size.w || 1200);
  const viewport = size.h > 0 ? size.h : height;
  const totalRows = Math.ceil(shown.length / columns);
  const first = windowed ? Math.max(0, Math.floor(scrollTop / rowHeight) - overscanRows) : 0;
  const last = windowed ? Math.min(totalRows, Math.ceil((scrollTop + viewport) / rowHeight) + overscanRows) : totalRows;
  const visible = shown.slice(first * columns, last * columns);
  const contentHeight = totalRows * rowHeight;
  const moreBelow = size.h > 0 && scrollTop + size.h < contentHeight - 4;

  return (
    <div className={cx('jpb-tmap', compact && 'is-compact', className)}>
      <div className="jpb-tmap__legend" role="group" aria-label="Filter tables by status">
        {(Object.keys(TABLE_STATUS_META) as TableTileStatus[]).map((s) => {
          const on = filter === s;
          return (
            <button
              key={s}
              type="button"
              className={cx('jpb-tmap__legend-item', `is-${TABLE_STATUS_META[s].tone}`, counts[s] === 0 && 'is-zero')}
              aria-pressed={on}
              aria-label={`${TABLE_STATUS_META[s].label}: ${formatCount(counts[s])} tables${on ? ', showing only these' : ''}`}
              disabled={counts[s] === 0 && !on}
              onClick={() => setFilter(on ? null : s)}
            >
              <Icon name={on ? 'check' : TABLE_STATUS_META[s].icon} />
              {TABLE_STATUS_META[s].label}
              <span className="jpb-num">{formatCount(counts[s])}</span>
            </button>
          );
        })}
        {filter && (
          <button type="button" className="jpb-tmap__clear" onClick={() => setFilter(null)}>
            Show all
          </button>
        )}
      </div>
      <div
        ref={scroller}
        className={cx('jpb-tmap__scroll', moreBelow && 'has-more')}
        style={{ maxHeight: height }}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        role="region"
        aria-label={`Table map, ${formatCount(shown.length)} tables${filter ? ` (${TABLE_STATUS_META[filter].label} only)` : ''}`}
        tabIndex={0}
      >
        <div style={windowed ? { height: contentHeight, position: 'relative' } : undefined}>
          <div
            className="jpb-tmap__grid"
            style={{
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              ...(windowed ? { position: 'absolute', top: first * rowHeight, left: 0, right: 0 } : null),
            }}
          >
            {visible.map((t) => (
              <TableTile key={t.id} {...t} compact={compact} selected={selectedId === t.id} onSelect={onSelect} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
