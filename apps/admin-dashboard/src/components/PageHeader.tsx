import type { ReactNode } from 'react';
import { Icon } from '@jpb/ui';
import type { IconName } from '@jpb/ui';

export interface PageHeaderProps {
  title: ReactNode;
  icon?: IconName;
  description?: ReactNode;
  /** Right side: page-level actions. */
  actions?: ReactNode;
  /** Small line above the title (breadcrumb-ish), e.g. "Spring Showdown 2026". */
  eyebrow?: ReactNode;
}

/** Section heading inside the content area (the top bar's h1 is the tournament switcher). */
export function PageHeader({ title, icon, description, actions, eyebrow }: PageHeaderProps) {
  return (
    <header className="acr-page__head">
      <div className="acr-page__titles">
        {eyebrow && <p className="acr-page__eyebrow">{eyebrow}</p>}
        <h2 className="acr-page__title">
          {icon && <Icon name={icon} />}
          {title}
        </h2>
        {description && <p className="acr-page__desc">{description}</p>}
      </div>
      {actions && <div className="acr-page__actions">{actions}</div>}
    </header>
  );
}
