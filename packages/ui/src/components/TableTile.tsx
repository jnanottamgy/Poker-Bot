import { useEffect, useMemo, useRef, useState } from 'react';
import { cx } from '../cx';
import { formatChipsCompact, formatCount } from '../format';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import type { Tone } from './StatusPill';

export type TableTileStatus = 'ACTIVE' | 'IDLE' | 'HELD' | 'BREAKING' | 'STALLED' | 'CLOSED';

export const TABLE_STATUS_META: Readonly<Record<TableTileStatus, { label: string; tone: Tone; icon: IconName }>> = {
  ACTIVE: { label: 'Active', tone: 'positive', icon: 'play' },
  IDLE: { label: 'Idle', tone: 'neutral', icon: 'moon' },
  HELD: { label: 'Held', tone: 'warning', icon: 'pause' },
  BREAKING: { label: 'Breaking', tone: 'info', icon: 'split' },
  STALLED: { label: 'Stalled', tone: 'danger', icon: 'warning' },
  CLOSED: { label: 'Closed', tone: 'neutral', icon: 'lock' },
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
export const TABLE_MAP_GAP = 10;

const HEALTH_LABEL: Readonly<Record<TableHealth, string>> = { ok: 'Healthy', warn: 'Degraded', critical: 'Critical' };

export interface TableTileProps extends TableTileData {
  selected?: boolean;
  onSelect?: (id: string) => void;
}

/** One table in the admin map: number, seats, status (icon + text) and health. */
export function TableTile({ id, tableNumber, players, maxSeats, status, health, healthText, handNumber, averageStack, featured, alerts = 0, selected, onSelect }: TableTileProps) {
  const meta = TABLE_STATUS_META[status];
  const label = `Table ${tableNumber}, ${meta.label}, ${players} of ${maxSeats} players, health ${HEALTH_LABEL[health]}: ${healthText}${alerts ? `, ${alerts} alerts` : ''}`;
  return (
    <button
      type="button"
      className={cx('jpb-ttile', `jpb-ttile--${meta.tone}`, `is-health-${health}`, selected && 'is-selected', featured && 'is-featured')}
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
        {healthText}
        {alerts > 0 && <span className="jpb-ttile__alerts">{alerts} alert{alerts > 1 ? 's' : ''}</span>}
      </span>
    </button>
  );
}

export interface TableMapProps {
  tables: TableTileData[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Height of the scroll viewport; enables windowing. Default 560px. */
  height?: number;
  /** Rows rendered beyond the viewport. */
  overscanRows?: number;
  /** Render everything (no windowing). Default: windowing above 120 tables. */
  virtualize?: boolean;
  className?: string;
}

/** Counts per status for legends/summaries. */
export function countByStatus(tables: TableTileData[]): Record<TableTileStatus, number> {
  const out: Record<TableTileStatus, number> = { ACTIVE: 0, IDLE: 0, HELD: 0, BREAKING: 0, STALLED: 0, CLOSED: 0 };
  for (const t of tables) out[t.status] += 1;
  return out;
}

/** Grid metrics for a container width (pure; used by the windowing logic). */
export function tableMapMetrics(width: number): { columns: number; rowHeight: number } {
  const columns = Math.max(1, Math.floor((width + TABLE_MAP_GAP) / (TABLE_TILE_MIN_WIDTH + TABLE_MAP_GAP)));
  return { columns, rowHeight: TABLE_TILE_HEIGHT + TABLE_MAP_GAP };
}

/**
 * Grid of table tiles with a status legend. Tiles have a fixed height, so the
 * grid windows itself (only visible rows are in the DOM) for thousands of
 * tables; pass `virtualize={false}` to render all.
 */
export function TableMap({ tables, selectedId, onSelect, height = 560, overscanRows = 2, virtualize, className }: TableMapProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const windowed = virtualize ?? tables.length > 120;

  useEffect(() => {
    const el = scroller.current;
    if (!el) return undefined;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver !== 'function') return undefined;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const counts = useMemo(() => countByStatus(tables), [tables]);
  const { columns, rowHeight } = tableMapMetrics(width || 1200);
  const totalRows = Math.ceil(tables.length / columns);
  const first = windowed ? Math.max(0, Math.floor(scrollTop / rowHeight) - overscanRows) : 0;
  const last = windowed ? Math.min(totalRows, Math.ceil((scrollTop + height) / rowHeight) + overscanRows) : totalRows;
  const visible = tables.slice(first * columns, last * columns);

  return (
    <div className={cx('jpb-tmap', className)}>
      <ul className="jpb-tmap__legend" aria-label="Tables by status">
        {(Object.keys(TABLE_STATUS_META) as TableTileStatus[]).map((s) => (
          <li key={s} className={cx('jpb-tmap__legend-item', `is-${TABLE_STATUS_META[s].tone}`, counts[s] === 0 && 'is-zero')}>
            <Icon name={TABLE_STATUS_META[s].icon} />
            {TABLE_STATUS_META[s].label}
            <span className="jpb-num">{formatCount(counts[s])}</span>
          </li>
        ))}
      </ul>
      <div
        ref={scroller}
        className="jpb-tmap__scroll"
        style={{ maxHeight: height }}
        onScroll={windowed ? (e) => setScrollTop(e.currentTarget.scrollTop) : undefined}
        role="region"
        aria-label={`Table map, ${formatCount(tables.length)} tables`}
        tabIndex={0}
      >
        <div style={windowed ? { height: totalRows * rowHeight, position: 'relative' } : undefined}>
          <div
            className="jpb-tmap__grid"
            style={{
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              ...(windowed ? { position: 'absolute', top: first * rowHeight, left: 0, right: 0 } : null),
            }}
          >
            {visible.map((t) => (
              <TableTile key={t.id} {...t} selected={selectedId === t.id} onSelect={onSelect} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
