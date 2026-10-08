import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { cx } from '../cx';
import { Icon } from './Icon';
import { useAnnouncer } from './LiveAnnouncer';
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
  const announcer = useAnnouncer();
  const spoken = [typeof title === 'string' ? title : null, typeof detail === 'string' ? detail : null].filter(Boolean).join('. ');
  useEffect(() => {
    if (spoken) announcer?.announce(spoken, 'polite');
  }, [announcer, spoken]);
  return (
    <div className={cx('jpb-milestone', `jpb-milestone--${size}`, className)} role={announcer && spoken ? undefined : 'status'}>
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
