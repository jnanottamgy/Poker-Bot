import { cx } from '../cx';
import { formatChips, formatChipsCompact, formatCount, formatMoneyMinor } from '../format';

export type LeaderboardMode = 'stack' | 'finish';

export const LEADERBOARD_MODE_LABEL: Readonly<Record<LeaderboardMode, string>> = {
  stack: 'Current stack ranking',
  finish: 'Finishing positions',
};

export interface LeaderboardRow {
  id: string;
  /** Stack rank (stack mode) or finish position (finish mode). */
  rank: number;
  name: string;
  publicId?: string;
  stack?: number;
  prizeMinor?: number;
  tableNumber?: number | null;
  /** Highlight as the viewer. */
  isYou?: boolean;
  tied?: boolean;
}

export interface LeaderboardProps {
  rows: LeaderboardRow[];
  /** Always shown as an explicit label so a stack ranking is never read as a final result. */
  mode: LeaderboardMode;
  currency?: string;
  /** Compact stacks (default true in stack mode). */
  compactStacks?: boolean;
  /** Optional total for "of N". */
  totalPlayers?: number;
  size?: 'md' | 'broadcast';
  className?: string;
}

export function Leaderboard({ rows, mode, currency = 'INR', compactStacks = true, totalPlayers, size = 'md', className }: LeaderboardProps) {
  const label = LEADERBOARD_MODE_LABEL[mode];
  return (
    <div className={cx('jpb-board-list', `jpb-board-list--${size}`, `is-${mode}`, className)}>
      <div className="jpb-board-list__head">
        <span className="jpb-board-list__mode">{label}</span>
        {totalPlayers !== undefined && <span className="jpb-board-list__total">{formatCount(totalPlayers)} players</span>}
      </div>
      <table className="jpb-board-list__table">
        <caption className="jpb-sr-only">{label}</caption>
        <thead>
          <tr>
            <th scope="col">{mode === 'finish' ? 'Place' : 'Rank'}</th>
            <th scope="col">Player</th>
            <th scope="col" className="is-num">
              {mode === 'finish' ? 'Prize' : 'Stack'}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={cx(r.isYou && 'is-you', mode === 'finish' && r.rank <= 3 && `is-podium is-p${r.rank}`)}>
              <td className="jpb-board-list__rank jpb-num">
                {r.tied && (
                  <>
                    <span aria-hidden="true">T</span>
                    <span className="jpb-sr-only">Tied </span>
                  </>
                )}
                {formatCount(r.rank)}
              </td>
              <td className="jpb-board-list__name">
                <span className="jpb-board-list__namewrap">
                  <span className="jpb-board-list__nametext">{r.name}</span>
                  {r.isYou && <span className="jpb-board-list__you">YOU</span>}
                </span>
                {(r.publicId || (mode === 'stack' && r.tableNumber !== undefined && r.tableNumber !== null)) && (
                  <span className="jpb-board-list__sub">
                    {r.publicId && <span>{r.publicId}</span>}
                    {mode === 'stack' && r.tableNumber !== undefined && r.tableNumber !== null && <span>Table {r.tableNumber}</span>}
                  </span>
                )}
              </td>
              <td className="is-num jpb-num" title={r.stack !== undefined ? `${formatChips(r.stack)} chips` : undefined}>
                {mode === 'finish'
                  ? r.prizeMinor
                    ? formatMoneyMinor(r.prizeMinor, currency)
                    : '—'
                  : r.stack !== undefined
                    ? compactStacks
                      ? formatChipsCompact(r.stack)
                      : formatChips(r.stack)
                    : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
