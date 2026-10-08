import type { ReactNode } from 'react';
import { cx } from '../cx';
import { Icon } from './Icon';
import type { IconName } from './Icon';

export interface MilestoneBannerProps {
  /** Main text, e.g. "500 PLAYERS REMAIN". */
  title: ReactNode;
  detail?: ReactNode;
  icon?: IconName;
  size?: 'md' | 'lg' | 'broadcast';
  className?: string;
}

/** Gold tournament milestone. Gold is reserved for these moments. Announced politely. */
export function MilestoneBanner({ title, detail, icon = 'flame', size = 'md', className }: MilestoneBannerProps) {
  return (
    <div className={cx('jpb-milestone', `jpb-milestone--${size}`, className)} role="status">
      <span className="jpb-milestone__icon">
        <Icon name={icon} />
      </span>
      <div className="jpb-milestone__text">
        <p className="jpb-milestone__title">{title}</p>
        {detail && <p className="jpb-milestone__detail">{detail}</p>}
      </div>
    </div>
  );
}
