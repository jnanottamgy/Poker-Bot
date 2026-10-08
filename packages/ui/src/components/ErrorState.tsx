import type { ReactNode } from 'react';
import { cx } from '../cx';
import { Button } from './Button';
import { Icon } from './Icon';

export interface ErrorStateProps {
  title?: ReactNode;
  /** Friendly, human copy. Never pass raw error messages or stack traces here. */
  description?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  /** Optional short support reference (e.g. a request id) — not an error dump. */
  reference?: string;
  className?: string;
}

/** Recoverable error. Deliberately has no prop for an Error object. */
export function ErrorState({
  title = 'Something went wrong',
  description = 'This is on our side, not yours. Your chips and seat are safe on the server.',
  onRetry,
  retryLabel = 'Try again',
  reference,
  className,
}: ErrorStateProps) {
  return (
    <div className={cx('jpb-error', className)} role="alert">
      <span className="jpb-error__icon">
        <Icon name="warning" />
      </span>
      <p className="jpb-error__title">{title}</p>
      <p className="jpb-error__desc">{description}</p>
      {onRetry && (
        <Button variant="secondary" icon="refresh" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
      {reference && <p className="jpb-error__ref">Reference: {reference}</p>}
    </div>
  );
}
