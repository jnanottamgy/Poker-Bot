import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../cx';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { Kbd } from './Kbd';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'gold';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** sm 36px, md 44px, lg 52px, xl 64px tall (lg/xl for touch-first player UI). */
  size?: ButtonSize;
  /** Shows a spinner + `loadingLabel` and disables the button (aria-busy). */
  loading?: boolean;
  loadingLabel?: string;
  icon?: IconName;
  iconRight?: IconName;
  /** Full width. */
  block?: boolean;
  /** Keyboard shortcut hint rendered as <kbd> (visual only; wire the key yourself). */
  shortcut?: string;
  children?: ReactNode;
}

/**
 * The one button. Variants map to meaning: primary = positive/proceed (green),
 * danger = destructive (red), gold = milestone moments only.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    loadingLabel = 'Submitting…',
    icon,
    iconRight,
    block = false,
    shortcut,
    className,
    disabled,
    type = 'button',
    children,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx('jpb-btn', `jpb-btn--${variant}`, `jpb-btn--${size}`, block && 'jpb-btn--block', loading && 'is-loading', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-keyshortcuts={shortcut}
      {...rest}
    >
      {loading ? (
        <>
          <Spinner size="sm" />
          <span className="jpb-btn__label">{loadingLabel}</span>
        </>
      ) : (
        <>
          {icon && <Icon name={icon} className="jpb-btn__icon" />}
          {children !== undefined && <span className="jpb-btn__label">{children}</span>}
          {iconRight && <Icon name={iconRight} className="jpb-btn__icon" />}
          {shortcut && (
            <span className="jpb-btn__kbd" aria-hidden="true">
              <Kbd>{shortcut}</Kbd>
            </span>
          )}
        </>
      )}
    </button>
  );
});
