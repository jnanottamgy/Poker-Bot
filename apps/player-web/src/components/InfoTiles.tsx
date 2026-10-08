import type { ReactNode } from 'react';
import { cx } from '@jpb/ui';

export interface InfoTile {
  label: string;
  value: ReactNode;
  /** Spoken form when the visual value is abbreviated. */
  title?: string;
  emphasis?: boolean;
}

/** "TABLE 47 · SEAT 6 · STARTING STACK 10,000" tiles. */
export function InfoTiles({ tiles, className }: { tiles: InfoTile[]; className?: string }) {
  return (
    <dl className={cx('pw-tiles', className)} data-count={tiles.length}>
      {tiles.map((t) => (
        <div key={t.label} className={cx('pw-tile', t.emphasis && 'is-emphasis')} title={t.title}>
          <dt className="pw-tile__label">{t.label}</dt>
          <dd className="pw-tile__value jpb-num">{t.value}</dd>
        </div>
      ))}
    </dl>
  );
}
