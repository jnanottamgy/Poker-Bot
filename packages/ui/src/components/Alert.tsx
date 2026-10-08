import type { ReactNode } from 'react';
import { cx } from '../cx';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { IconButton } from './IconButton';

export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL' | 'SUCCESS';

const META: Readonly<Record<AlertSeverity, { icon: IconName; label: string }>> = {
  INFO: { icon: 'info', label: 'Info' },
  WARNING: { icon: 'warning', label: 'Warning' },
  CRITICAL: { icon: 'critical', label: 'Critical' },
  SUCCESS: { icon: 'check-circle', label: 'Done' },
};

export interface AlertProps {
  severity?: AlertSeverity;
  title: ReactNode;
  children?: ReactNode;
  /** Right-aligned actions (buttons). */
  actions?: ReactNode;
  onDismiss?: () => void;
  /** Extra metadata line (time, table, code). */
  meta?: ReactNode;
  className?: string;
}

/**
 * Inline alert. CRITICAL uses role="alert" (interrupts screen readers);
 * others use role="status". The severity word is always rendered as text.
 */
export function Alert({ severity = 'INFO', title, children, actions, onDismiss, meta, className }: AlertProps) {
  const m = META[severity];
  return (
    <div className={cx('jpb-alert', `jpb-alert--${severity.toLowerCase()}`, className)} role={severity === 'CRITICAL' ? 'alert' : 'status'}>
      <Icon name={m.icon} className="jpb-alert__icon" />
      <div className="jpb-alert__body">
        <div className="jpb-alert__head">
          <span className="jpb-alert__severity">{m.label}</span>
          <span className="jpb-alert__title">{title}</span>
        </div>
        {children && <div className="jpb-alert__text">{children}</div>}
        {meta && <div className="jpb-alert__meta">{meta}</div>}
      </div>
      {actions && <div className="jpb-alert__actions">{actions}</div>}
      {onDismiss && <IconButton icon="x" label="Dismiss" size="sm" onClick={onDismiss} className="jpb-alert__close" />}
    </div>
  );
}
