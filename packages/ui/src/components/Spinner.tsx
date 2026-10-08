import { cx } from '../cx';

export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  /** Accessible label. When omitted the spinner is decorative (aria-hidden). */
  label?: string;
  className?: string;
}

/** Indeterminate loading indicator. Under reduced motion it pulses opacity instead of spinning. */
export function Spinner({ size = 'md', label, className }: SpinnerProps) {
  return (
    <span
      className={cx('jpb-spinner', `jpb-spinner--${size}`, className)}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
