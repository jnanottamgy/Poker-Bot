import { memo } from 'react';
import { Link } from 'react-router';
import type { TableListItemDto } from '@jpb/shared-types';
import { Icon, Skeleton, StatusPill, cx, formatChips, formatChipsCompact, formatCount } from '@jpb/ui';
import { formatElapsed } from './hooks';
import { DISPLAY_STATUS_META, displayStatus, holdPending, holdsText, pillText, rowStatusInput, statusText } from './tableStatus';

/** Fixed sizes so the virtualizer never measures (125,000 tables stay smooth). */
export const TILE_HEIGHT = 132;
export const TILE_MIN_WIDTH = 196;
export const GRID_GAP = 10;
export const LIST_ROW_HEIGHT = 46;

/** Last progress older than this reads as "slow" (amber) before the server calls it STALLED. */
export const SLOW_PROGRESS_MS = 45_000;

export interface TileProps {
  row: TableListItemDto;
  index: number;
  total: number;
  href: string;
  /** Server-time "now" (client clock + offset). */
  serverNow: number;
}

/** Elapsed time since the last progress, or null when unknown / closed. */
function sinceProgress(row: TableListItemDto, serverNow: number): number | null {
  if (row.status === 'CLOSED' || row.lastProgressAt === null) return null;
  return Math.max(0, serverNow - row.lastProgressAt);
}

/** One spoken sentence per table (the tile's visual content is decorative for screen readers). */
export function tileLabel(row: TableListItemDto, serverNow: number): string {
  const since = sinceProgress(row, serverNow);
  return [
    `Table ${row.tableNumber}`,
    row.isFinalTable ? 'final table' : null,
    statusText(rowStatusInput(row)),
    `${row.players} of ${row.maxSeats} players`,
    row.handNumber > 0 ? `hand ${formatCount(row.handNumber)}` : 'no hand yet',
    since !== null ? `last progress ${formatElapsed(since)} ago` : null,
    row.disconnectedPlayers > 0 ? `${row.disconnectedPlayers} disconnected` : 'everyone connected',
    `${formatChips(row.chips)} chips`,
  ]
    .filter(Boolean)
    .join(', ');
}

function ProgressText({ row, serverNow }: { row: TableListItemDto; serverNow: number }) {
  const since = sinceProgress(row, serverNow);
  if (since === null) return <span className="acr-tables-muted">—</span>;
  const s = displayStatus(rowStatusInput(row));
  const level = s === 'STALLED' ? 'is-danger' : since >= SLOW_PROGRESS_MS && s !== 'HELD' && s !== 'FROZEN' && s !== 'WAITING' ? 'is-warning' : '';
  return (
    <span className={cx('acr-tables-since', level)} title="Time since the table last made progress (server time)">
      <Icon name="clock" />
      <span className="jpb-num">{formatElapsed(since)}</span>
    </span>
  );
}

function Offline({ n }: { n: number }) {
  return (
    <span className={cx('acr-tables-offline', n > 0 && 'is-on')} title={n > 0 ? `${n} disconnected player${n === 1 ? '' : 's'}` : 'Everyone connected'}>
      <Icon name={n > 0 ? 'wifi-off' : 'wifi'} />
      <span className="jpb-num">{n > 0 ? `${n} offline` : '0'}</span>
    </span>
  );
}

function StatusBadge({ row, size = 'sm' }: { row: TableListItemDto; size?: 'sm' | 'md' }) {
  const input = rowStatusInput(row);
  const s = displayStatus(input);
  const meta = DISPLAY_STATUS_META[s];
  const holds = holdsText(row.holds);
  const pending = holdPending(input) && s !== 'BREAKING';
  return (
    <span className="acr-tables-status">
      <StatusPill size={size} tone={meta.tone} icon={meta.icon} label={pillText(input)} title={`${statusText(input)} — ${meta.description}`} />
      {pending && (
        <span className="acr-tables-holds is-pending" title={`Holds after this hand: ${holds}`}>
          <Icon name="pause" />
          <span className="acr-tables-holds__txt">after hand</span>
        </span>
      )}
    </span>
  );
}

/** A table tile: number, status (icon + text), seats, hand, live "since last progress", offline players, chips. */
export const TableTileCard = memo(function TableTileCard({ row, index, total, href, serverNow }: TileProps) {
  const s = displayStatus(rowStatusInput(row));
  const meta = DISPLAY_STATUS_META[s];
  return (
    <div role="listitem" aria-setsize={total} aria-posinset={index + 1} className="acr-tables-cell">
      <Link
        to={href}
        data-index={index}
        className={cx('acr-tables-tile', `is-${meta.tone}`, `is-${s.toLowerCase()}`, row.isFinalTable && 'is-final')}
        aria-label={tileLabel(row, serverNow)}
        style={{ height: TILE_HEIGHT }}
      >
        <span className="acr-tables-tile__top" aria-hidden="true">
          <span className="acr-tables-tile__num jpb-num">
            {row.isFinalTable && <Icon name="crown" />}T{row.tableNumber}
          </span>
          {row.isFinalTable && <span className="acr-tables-final">FINAL</span>}
          <StatusBadge row={row} />
        </span>
        <span className="acr-tables-tile__seats" aria-hidden="true">
          {Array.from({ length: row.maxSeats }, (_, i) => (
            <span key={i} className={cx('acr-tables-seatdot', i < row.players && 'is-filled', i < row.disconnectedPlayers && 'is-offline')} />
          ))}
          <span className="acr-tables-tile__count jpb-num">
            {row.players}/{row.maxSeats}
          </span>
        </span>
        <span className="acr-tables-tile__meta" aria-hidden="true">
          <span title="Hand number">
            <Icon name="layers" /> <span className="jpb-num">#{formatCount(row.handNumber)}</span>
          </span>
          <span title={`${formatChips(row.chips)} chips at the table`}>
            <span className="acr-tables-chipglyph" /> <span className="jpb-num">{formatChipsCompact(row.chips)}</span>
          </span>
        </span>
        <span className="acr-tables-tile__foot" aria-hidden="true">
          <ProgressText row={row} serverNow={serverNow} />
          <Offline n={row.disconnectedPlayers} />
        </span>
      </Link>
    </div>
  );
});

/** Dense list row (same data as a tile). */
export const TableListRow = memo(function TableListRow({ row, index, total, href, serverNow }: TileProps) {
  const s = displayStatus(rowStatusInput(row));
  const meta = DISPLAY_STATUS_META[s];
  return (
    <div role="listitem" aria-setsize={total} aria-posinset={index + 1} className="acr-tables-cell">
      <Link to={href} data-index={index} className={cx('acr-tables-row', `is-${meta.tone}`, `is-${s.toLowerCase()}`)} aria-label={tileLabel(row, serverNow)} style={{ height: LIST_ROW_HEIGHT }}>
        <span className="acr-tables-row__num jpb-num" aria-hidden="true">
          {row.isFinalTable && <Icon name="crown" />}T{row.tableNumber}
          {row.isFinalTable && <span className="acr-tables-final">FINAL</span>}
        </span>
        <span aria-hidden="true">
          <StatusBadge row={row} />
        </span>
        <span className="jpb-num" aria-hidden="true">
          {row.players}/{row.maxSeats}
        </span>
        <span className="jpb-num" aria-hidden="true">
          #{formatCount(row.handNumber)}
        </span>
        <span aria-hidden="true">
          <ProgressText row={row} serverNow={serverNow} />
        </span>
        <span aria-hidden="true">
          <Offline n={row.disconnectedPlayers} />
        </span>
        <span className="jpb-num acr-tables-row__chips" aria-hidden="true" title={`${formatChips(row.chips)} chips`}>
          {formatChips(row.chips)}
        </span>
      </Link>
    </div>
  );
});

/** Placeholder while a server page is loading. */
export function LoadingCell({ view, index, total }: { view: 'grid' | 'list'; index: number; total: number }) {
  return (
    <div role="listitem" aria-setsize={total} aria-posinset={index + 1} className="acr-tables-cell" aria-busy="true">
      <span className="jpb-sr-only">Loading table {index + 1}</span>
      <div className={view === 'grid' ? 'acr-tables-tile is-loading' : 'acr-tables-row is-loading'} style={{ height: view === 'grid' ? TILE_HEIGHT : LIST_ROW_HEIGHT }} aria-hidden="true">
        <Skeleton width="40%" />
        {view === 'grid' && <Skeleton width="80%" />}
        <Skeleton width="60%" />
      </div>
    </div>
  );
}
