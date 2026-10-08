import type { ReactNode } from 'react';
import { PlayerLayout, cx } from '@jpb/ui';

export interface GameFrameProps {
  desktop: boolean;
  header: ReactNode;
  banner: ReactNode;
  children: ReactNode;
  actions: ReactNode;
  aside: ReactNode;
  /** The main content is a centred state card (lobby, break…) rather than the table. */
  centered: boolean;
}

/**
 * Phone: the ui PlayerLayout (header, table filling the height, actions
 * pinned in thumb reach). Desktop: header, a wide virtual table with a
 * console under it, and a side panel (hand log / tournament).
 */
export function GameFrame({ desktop, header, banner, children, actions, aside, centered }: GameFrameProps) {
  if (!desktop) {
    return (
      <PlayerLayout header={header} banner={banner} actions={actions} className={cx('pw-phone', centered && 'is-centered')}>
        {children}
      </PlayerLayout>
    );
  }
  return (
    <div className="pw-desk">
      <div className="pw-desk__head">{header}</div>
      <div className="pw-desk__body">
        <main className={cx('pw-desk__main', centered && 'is-centered')}>
          {banner}
          {children}
          {actions && <div className="pw-desk__console">{actions}</div>}
        </main>
        <aside className="pw-desk__side" aria-label="Hand log and tournament">
          {aside}
        </aside>
      </div>
    </div>
  );
}
