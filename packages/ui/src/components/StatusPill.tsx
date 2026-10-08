import type { ReactNode } from 'react';
import { cx } from '../cx';
import { Icon } from './Icon';
import type { IconName } from './Icon';

export type Tone = 'neutral' | 'positive' | 'info' | 'warning' | 'danger' | 'gold';

const DEFAULT_ICON: Readonly<Record<Tone, IconName>> = {
  neutral: 'dot',
  positive: 'check-circle',
  info: 'info',
  warning: 'warning',
  danger: 'critical',
  gold: 'trophy',
};

export interface StatusPillProps {
  tone?: Tone;
  /** REQUIRED visible text: status is never communicated by color alone. */
  label: ReactNode;
  /** Icon override; `null` hides the icon (text still carries meaning). */
  icon?: IconName | null;
  /** Animated live dot (e.g. LIVE / IN HAND). Static under reduced motion. */
  live?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  title?: string;
}

/** Status indicator: icon + text + tone. */
export function StatusPill({ tone = 'neutral', label, icon, live = false, size = 'md', className, title }: StatusPillProps) {
  const iconName = icon === undefined ? DEFAULT_ICON[tone] : icon;
  return (
    <span className={cx('jpb-pill', `jpb-pill--${tone}`, `jpb-pill--${size}`, className)} title={title}>
      {live ? <span className="jpb-pill__live" aria-hidden="true" /> : iconName && <Icon name={iconName} className="jpb-pill__icon" />}
      <span className="jpb-pill__label">{label}</span>
    </span>
  );
}

export interface BadgeProps {
  /** Short visible text, e.g. "D", "SB", "BB", "ALL-IN". */
  children: ReactNode;
  tone?: Tone;
  /** Long form for screen readers, e.g. "Dealer button". */
  srLabel?: string;
  variant?: 'solid' | 'soft' | 'outline';
  className?: string;
}

/** Compact text badge. Always text; optional spoken long form. */
export function Badge({ children, tone = 'neutral', srLabel, variant = 'soft', className }: BadgeProps) {
  return (
    <span className={cx('jpb-badge', `jpb-badge--${tone}`, `jpb-badge--${variant}`, className)} title={srLabel}>
      <span aria-hidden={srLabel ? true : undefined}>{children}</span>
      {srLabel && <span className="jpb-sr-only">{srLabel}</span>}
    </span>
  );
}
