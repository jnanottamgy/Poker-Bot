import { useId } from 'react';
import type { ReactNode } from 'react';
import { Icon, cx } from '@jpb/ui';
import type { IconName } from '@jpb/ui';

export interface GroupProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: IconName;
  /** Right side of the header (buttons, pills). */
  actions?: ReactNode;
  children: ReactNode;
  /** DOM id (e.g. the field id of a list, so an issue can focus the group). */
  id?: string;
  className?: string;
}

/** A titled block of related settings inside a step. */
export function Group({ title, description, icon, actions, children, id, className }: GroupProps) {
  const headingId = useId();
  return (
    <section className={cx('acr-setup-group', className)} aria-labelledby={headingId} id={id} tabIndex={id ? -1 : undefined}>
      <header className="acr-setup-group__head">
        <div className="acr-setup-group__titles">
          <h4 id={headingId} className="acr-setup-group__title">
            {icon && <Icon name={icon} />}
            {title}
          </h4>
          {description && <p className="acr-setup-group__desc">{description}</p>}
        </div>
        {actions && <div className="acr-setup-group__actions">{actions}</div>}
      </header>
      <div className="acr-setup-group__body">{children}</div>
    </section>
  );
}

/** Small labelled figure ("Projected duration · 3 h 20 min"). */
export function Fact({ label, value, sub, tone = 'default', icon }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: 'default' | 'positive' | 'warning' | 'danger'; icon?: IconName }) {
  return (
    <div className={cx('acr-setup-fact', `is-${tone}`)}>
      <span className="acr-setup-fact__label">
        {icon && <Icon name={icon} />}
        {label}
      </span>
      <span className="acr-setup-fact__value jpb-num">{value}</span>
      {sub && <span className="acr-setup-fact__sub">{sub}</span>}
    </div>
  );
}

/** Non-blocking advice (never a validation error): icon + text. */
export function Note({ children, tone = 'info', icon }: { children: ReactNode; tone?: 'info' | 'warning'; icon?: IconName }) {
  return (
    <p className={cx('acr-setup-note', `is-${tone}`)}>
      <Icon name={icon ?? (tone === 'warning' ? 'warning' : 'info')} />
      <span>{children}</span>
    </p>
  );
}
