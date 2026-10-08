import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';
import { cx } from '../cx';
import { Icon } from './Icon';
import type { IconName } from './Icon';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: IconName;
  /** Required accessible name (also used as the tooltip). */
  label: string;
  variant?: 'ghost' | 'secondary' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  /** Toggle buttons: sets aria-pressed. */
  pressed?: boolean;
}

/** Square icon-only button. Minimum 44px hit area at md (48px at lg). */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, variant = 'ghost', size = 'md', pressed, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={cx('jpb-iconbtn', `jpb-iconbtn--${variant}`, `jpb-iconbtn--${size}`, className)}
      {...rest}
    >
      <Icon name={icon} />
    </button>
  );
});
