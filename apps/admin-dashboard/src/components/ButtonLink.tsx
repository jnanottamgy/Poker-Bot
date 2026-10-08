import { Link } from 'react-router';
import type { ReactNode } from 'react';
import { Icon, cx } from '@jpb/ui';
import type { IconName } from '@jpb/ui';

/** A router link styled as a @jpb/ui button (never nest a <button> inside a link). */
export function ButtonLink({ to, icon, children, variant = 'secondary', size = 'sm' }: { to: string; icon?: IconName; children: ReactNode; variant?: 'primary' | 'secondary' | 'ghost'; size?: 'sm' | 'md' }) {
  return (
    <Link to={to} className={cx('jpb-btn', `jpb-btn--${variant}`, `jpb-btn--${size}`, 'acr-buttonlink')}>
      {icon && <Icon name={icon} className="jpb-btn__icon" />}
      <span className="jpb-btn__label">{children}</span>
    </Link>
  );
}
