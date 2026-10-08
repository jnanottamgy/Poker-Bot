import type { ReactNode } from 'react';
import { cx } from '../cx';
import { Icon } from './Icon';
import type { IconName } from './Icon';

export interface EmptyStateProps {
  icon?: IconName;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}

export function EmptyState({ icon = 'layers', title, description, action, compact = false, className }: EmptyStateProps) {
  return (
    <div className={cx('jpb-empty', compact && 'jpb-empty--compact', className)}>
      <span className="jpb-empty__icon">
        <Icon name={icon} />
      </span>
      <p className="jpb-empty__title">{title}</p>
      {description && <p className="jpb-empty__desc">{description}</p>}
      {action && <div className="jpb-empty__action">{action}</div>}
    </div>
  );
}
