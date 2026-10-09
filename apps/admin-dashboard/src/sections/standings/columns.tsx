import { Link } from 'react-router';
import type { LeaderboardRowDto } from '@jpb/shared-types';
import { Badge, StatusPill, formatChips, formatCount, formatMoneyMinor, formatOrdinal, formatPercent, initials } from '@jpb/ui';
import { sectionHref } from '../../app/sections';
import type { GridColumn } from './VirtualGrid';
import { STANDING_STATUS_META, chipShare, formatBB, tieRangeText } from './model';

export interface ColumnContext {
  tournamentId: string;
  bigBlind: number | null;
  totalChips: number | null;
  averageStack: number | null;
  /** Chip leader's stack: the share bars are drawn relative to it. */
  leaderStack: number | null;
  currency: string;
}

function PlayerCell({ row, tournamentId }: { row: LeaderboardRowDto; tournamentId: string }) {
  return (
    <span className="acr-standings-who">
      <span className="acr-avatar acr-standings-avatar" aria-hidden="true">
        {initials(row.displayName)}
      </span>
      <span className="acr-standings-who__text">
        <Link to={sectionHref('player-detail', tournamentId, { playerId: row.playerId })} className="acr-standings-name" tabIndex={-1}>
          {row.displayName}
        </Link>
        <span className="jpb-mono acr-standings-pid">{row.publicId}</span>
      </span>
    </span>
  );
}

function StatusCell({ row }: { row: LeaderboardRowDto }) {
  if (row.finishPosition === 1) return <StatusPill size="sm" tone="gold" icon="crown" label="Champion" />;
  const m = STANDING_STATUS_META[row.status];
  return <StatusPill size="sm" tone={m.tone} icon={m.icon} label={m.label} />;
}

/** Current stack ranking: rank, player, status, table, stack (+BB), share of chips, × average. */
export function stackColumns(ctx: ColumnContext): Array<GridColumn<LeaderboardRowDto>> {
  return [
    { key: 'rank', header: 'Rank', track: '58px', num: true, title: 'Current stack rank (live, not a result)', cell: (r) => <span className="acr-standings-rank">#{formatCount(r.rank)}</span> },
    { key: 'player', header: 'Player', track: 'minmax(170px, 2.2fr)', cell: (r) => <PlayerCell row={r} tournamentId={ctx.tournamentId} /> },
    { key: 'status', header: 'Status', track: '118px', cell: (r) => <StatusCell row={r} /> },
    {
      key: 'table',
      header: 'Table',
      track: '58px',
      cell: (r) =>
        r.tableNumber !== null ? (
          <span className="acr-standings-table">T{r.tableNumber}</span>
        ) : (
          <span className="acr-standings-dim" title="Between tables">
            —
          </span>
        ),
    },
    {
      key: 'stack',
      header: 'Stack',
      track: '112px',
      num: true,
      cell: (r) => (
        <span className="acr-standings-stack" title={`${formatChips(r.stack)} chips`}>
          <span className="jpb-num">{formatChips(r.stack)}</span>
          <span className="acr-standings-bb">{formatBB(r.stack, ctx.bigBlind)}</span>
        </span>
      ),
    },
    {
      key: 'share',
      header: 'Share',
      track: 'minmax(104px, 1fr)',
      title: 'Share of all chips in play (the bar is relative to the chip leader)',
      cell: (r) => {
        const s = chipShare(r.stack, ctx.totalChips);
        if (s === null) return <span className="acr-standings-dim">—</span>;
        const bar = ctx.leaderStack && ctx.leaderStack > 0 ? Math.min(1, r.stack / ctx.leaderStack) : s;
        return (
          <span className="acr-standings-share">
            <span className="acr-standings-share__bar" aria-hidden="true">
              <span style={{ width: `${Math.max(2, bar * 100)}%` }} />
            </span>
            <span className="jpb-num">{formatPercent(s)}</span>
          </span>
        );
      },
    },
    {
      key: 'avg',
      header: '× avg',
      track: '58px',
      num: true,
      title: 'Stack ÷ average stack',
      cell: (r) => (ctx.averageStack && ctx.averageStack > 0 ? <span className="jpb-num">{(Math.floor((r.stack / ctx.averageStack) * 10) / 10).toFixed(1)}×</span> : <span className="acr-standings-dim">—</span>),
    },
  ];
}

/** Finishing positions: place (+tie), player, status, positions covered by a tie, prize. */
export function finishColumns(ctx: ColumnContext): Array<GridColumn<LeaderboardRowDto>> {
  return [
    {
      key: 'place',
      header: 'Place',
      track: '108px',
      cell: (r) => (
        <span className="acr-standings-place">
          <span className="jpb-num">{r.finishPosition === null ? '—' : formatOrdinal(r.finishPosition)}</span>
          {r.tiedCount > 1 && (
            <Badge tone="info" srLabel={`Tied with ${r.tiedCount - 1} other ${r.tiedCount === 2 ? 'player' : 'players'}`}>
              T×{r.tiedCount}
            </Badge>
          )}
        </span>
      ),
    },
    { key: 'player', header: 'Player', track: 'minmax(200px, 2.4fr)', cell: (r) => <PlayerCell row={r} tournamentId={ctx.tournamentId} /> },
    { key: 'status', header: 'Status', track: '132px', cell: (r) => <StatusCell row={r} /> },
    {
      key: 'tie',
      header: 'Tie covers',
      track: '128px',
      title: 'Tied players split the prizes of the places they cover',
      cell: (r) => {
        const t = r.finishPosition === null ? null : tieRangeText(r.finishPosition, r.tiedCount);
        return t ? <span className="acr-standings-tie">{t}</span> : <span className="acr-standings-dim">—</span>;
      },
    },
    {
      key: 'prize',
      header: 'Prize',
      track: '140px',
      num: true,
      cell: (r) =>
        r.prizeMinor > 0 ? (
          <span className="acr-standings-prize jpb-num">{formatMoneyMinor(r.prizeMinor, ctx.currency)}</span>
        ) : (
          <span className="acr-standings-dim" title="No prize for this place">
            No prize
          </span>
        ),
    },
  ];
}
