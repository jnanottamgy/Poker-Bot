import type { ReactNode } from 'react';
import { cx } from '@jpb/ui';

export interface ScreenProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  tone?: 'default' | 'gold' | 'info' | 'warning' | 'danger';
  icon?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
  /** Live region role for state screens (status by default). */
  role?: 'status' | 'alert' | 'region';
  labelledBy?: string;
}

/**
 * A full-height state screen (lobby, break, paused, another device…): a
 * centred card with an eyebrow, a big title and supporting copy. Large type,
 * one primary action, never colour-only.
 */
export function Screen({ eyebrow, title, lede, tone = 'default', icon, children, actions, className, role = 'region' }: ScreenProps) {
  return (
    <section className={cx('pw-screen', `pw-screen--${tone}`, className)} role={role === 'region' ? undefined : role} aria-live={role === 'alert' ? 'assertive' : undefined}>
      <div className="pw-screen__card">
        {icon && <div className="pw-screen__icon">{icon}</div>}
        {eyebrow && <p className="pw-eyebrow pw-screen__eyebrow">{eyebrow}</p>}
        <h1 className="pw-screen__title">{title}</h1>
        {lede && <p className="pw-screen__lede">{lede}</p>}
        {children}
        {actions && <div className="pw-screen__actions">{actions}</div>}
      </div>
    </section>
  );
}
