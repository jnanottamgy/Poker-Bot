import type { ReactNode } from 'react';
import type { TournamentStatus as TStatus } from '@jpb/shared-types';
import { cx } from '../cx';
import { formatCount } from '../format';
import { TournamentStatusPill } from './TournamentStatus';

export interface PlayerHeaderProps {
  tournamentName: string;
  status: TStatus;
  /** <BlindClock variant="compact" /> — one quiet line (tournament info ranks last). */
  clock?: ReactNode;
  /** Right-side controls (sound / settings icon buttons). */
  end?: ReactNode;
  playersLeft?: number;
  className?: string;
}

/**
 * Phone header: off-white brand tile, tournament name, a QUIET status pill
 * (only the live dot is green — green is reserved for "you / act now") and the
 * blind clock as one 32px line.
 */
export function PlayerHeader({ tournamentName, status, clock, end, playersLeft, className }: PlayerHeaderProps) {
  return (
    <header className={cx('jpb-phead', className)}>
      <div className="jpb-phead__row">
        <span className="jpb-phead__brand">
          <span className="jpb-phead__tile" aria-hidden="true">
            ♠
          </span>
          <span className="jpb-phead__name">{tournamentName}</span>
        </span>
        <TournamentStatusPill status={status} size="sm" quiet />
        {end && <span className="jpb-phead__end">{end}</span>}
      </div>
      {clock && <div className="jpb-phead__clock">{clock}</div>}
      {playersLeft !== undefined && <p className="jpb-sr-only">{formatCount(playersLeft)} players left</p>}
    </header>
  );
}

export interface PlayerLayoutProps {
  header: ReactNode;
  /** Connection banner / notices above the table. */
  banner?: ReactNode;
  /** The table (PokerTable, which includes the hero dock). */
  children: ReactNode;
  /** The ActionPanel: pinned to the bottom of the viewport, above the home indicator. */
  actions: ReactNode;
  className?: string;
}

/**
 * The player screen laid out by HEIGHT, not width: header, then the table
 * filling whatever height is left (up to its natural shape), then the action
 * panel pinned to the bottom with the safe-area inset. FOLD / CALL / RAISE are
 * always on screen when it is your turn, on a 390x664 Safari viewport too.
 */
export function PlayerLayout({ header, banner, children, actions, className }: PlayerLayoutProps) {
  return (
    <div className={cx('jpb-player', className)}>
      {header}
      <main className="jpb-player__main">
        {banner}
        {children}
      </main>
      <div className="jpb-player__actions">{actions}</div>
    </div>
  );
}
