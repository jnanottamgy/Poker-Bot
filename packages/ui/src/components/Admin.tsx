import type { ReactNode } from 'react';
import { cx } from '../cx';
import { Icon } from './Icon';
import type { IconName } from './Icon';

/* ------------------------------------------------------------ Panel ---- */

export interface PanelProps {
  title?: ReactNode;
  /** Small text under the title. */
  description?: ReactNode;
  /** Right side of the header (buttons, pills). */
  actions?: ReactNode;
  icon?: IconName;
  children: ReactNode;
  /** Remove body padding (tables). */
  flush?: boolean;
  tone?: 'default' | 'danger' | 'gold';
  /** Column layout whose body fills the panel height (for maps / lists that should not leave a dead band). */
  fill?: boolean;
  className?: string;
}

/** Surface container used across the control room. */
export function Panel({ title, description, actions, icon, children, flush = false, tone = 'default', fill = false, className }: PanelProps) {
  return (
    <section className={cx('jpb-panel', `jpb-panel--${tone}`, flush && 'jpb-panel--flush', fill && 'jpb-panel--fill', className)}>
      {(title || actions) && (
        <header className="jpb-panel__head">
          <div className="jpb-panel__titles">
            {title && (
              <h3 className="jpb-panel__title">
                {icon && <Icon name={icon} />}
                {title}
              </h3>
            )}
            {description && <p className="jpb-panel__desc">{description}</p>}
          </div>
          {actions && <div className="jpb-panel__actions">{actions}</div>}
        </header>
      )}
      <div className="jpb-panel__body">{children}</div>
    </section>
  );
}

/* --------------------------------------------------- DescriptionList ---- */

export interface DescriptionItem {
  label: ReactNode;
  value: ReactNode;
  /** Monospace/tabular value (ids, hashes, numbers). */
  mono?: boolean;
}

export interface DescriptionListProps {
  items: DescriptionItem[];
  columns?: 1 | 2 | 3;
  className?: string;
}

/** Key/value details (player detail, table detail, seed hashes). */
export function DescriptionList({ items, columns = 2, className }: DescriptionListProps) {
  return (
    <dl className={cx('jpb-dl', `jpb-dl--${columns}`, className)}>
      {items.map((it, i) => (
        <div key={i} className="jpb-dl__item">
          <dt>{it.label}</dt>
          <dd className={cx(it.mono && 'jpb-mono')}>{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ------------------------------------------------------ ControlCard ---- */

export interface ControlCardProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: IconName;
  /** Current state line, e.g. "Clock running · Level 14". */
  state?: ReactNode;
  /** Controls (buttons, toggles, inputs). */
  children?: ReactNode;
  /** When set, controls are disabled and the missing permission is named. */
  lockedPermission?: string | null;
  tone?: 'default' | 'danger' | 'warning' | 'gold';
  className?: string;
}

/**
 * A group of related admin controls with its live state. If the operator
 * lacks the permission, the controls are inert (fieldset disabled) and the
 * card says exactly which permission is required — the server still enforces it.
 */
export function ControlCard({ title, description, icon, state, children, lockedPermission, tone = 'default', className }: ControlCardProps) {
  const locked = Boolean(lockedPermission);
  return (
    <section className={cx('jpb-control', `jpb-control--${tone}`, locked && 'is-locked', className)}>
      <header className="jpb-control__head">
        {icon && (
          <span className="jpb-control__icon">
            <Icon name={icon} />
          </span>
        )}
        <div>
          <h3 className="jpb-control__title">{title}</h3>
          {description && <p className="jpb-control__desc">{description}</p>}
        </div>
      </header>
      {state && <p className="jpb-control__state">{state}</p>}
      <fieldset className="jpb-control__body" disabled={locked}>
        <legend className="jpb-sr-only">{typeof title === 'string' ? title : 'Controls'}</legend>
        {children}
      </fieldset>
      {locked && (
        <p className="jpb-control__lock">
          <Icon name="lock" /> Requires {lockedPermission}
        </p>
      )}
    </section>
  );
}

/* ----------------------------------------------------- ActivityFeed ---- */

export interface ActivityEntry {
  id: string;
  /** Pre-formatted time, e.g. "21:04:17". */
  time: string;
  actor: string;
  /** e.g. "ADJUST_STACK". */
  action: string;
  target?: string;
  reason?: string;
  severity?: 'info' | 'warning' | 'critical' | 'gold';
  detail?: ReactNode;
}

export interface ActivityFeedProps {
  entries: ActivityEntry[];
  label?: string;
  empty?: ReactNode;
  className?: string;
}

const SEVERITY_TEXT: Readonly<Record<NonNullable<ActivityEntry['severity']>, string>> = {
  info: 'Info',
  warning: 'Warning',
  critical: 'Critical',
  gold: 'Milestone',
};

const SEVERITY_ICON: Readonly<Record<NonNullable<ActivityEntry['severity']>, IconName>> = {
  info: 'info',
  warning: 'warning',
  critical: 'critical',
  gold: 'trophy',
};

/** Audit / event timeline. Each entry: time, actor, action code, target and reason (text, never color-only). */
export function ActivityFeed({ entries, label = 'Activity', empty, className }: ActivityFeedProps) {
  if (entries.length === 0) return <div className={cx('jpb-feed', 'is-empty', className)}>{empty ?? 'No activity yet.'}</div>;
  return (
    <ol className={cx('jpb-feed', className)} aria-label={label}>
      {entries.map((e) => {
        const sev = e.severity ?? 'info';
        return (
          <li key={e.id} className={cx('jpb-feed__item', `is-${sev}`)}>
            <span className="jpb-feed__icon">
              <Icon name={SEVERITY_ICON[sev]} />
            </span>
            <div className="jpb-feed__body">
              <p className="jpb-feed__line">
                <span className="jpb-sr-only">{SEVERITY_TEXT[sev]}: </span>
                <span className="jpb-feed__action jpb-mono">{e.action}</span>
                {e.target && <span className="jpb-feed__target">{e.target}</span>}
              </p>
              <p className="jpb-feed__meta">
                <time className="jpb-num">{e.time}</time> · {e.actor}
                {e.reason && <span className="jpb-feed__reason"> · “{e.reason}”</span>}
              </p>
              {e.detail && <div className="jpb-feed__detail">{e.detail}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
