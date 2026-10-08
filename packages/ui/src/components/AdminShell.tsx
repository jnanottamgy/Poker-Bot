import { useState } from 'react';
import type { ReactNode } from 'react';
import { cx } from '../cx';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { IconButton } from './IconButton';

/** Matches the CSS breakpoint at which the rail auto-collapses. */
export const ADMIN_RAIL_BREAKPOINT_PX = 1100;

function narrowViewport(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(`(max-width: ${ADMIN_RAIL_BREAKPOINT_PX}px)`).matches;
}

export interface NavItem {
  id: string;
  label: string;
  icon: IconName;
  /** Count badge (e.g. open alerts). */
  badge?: number;
  badgeTone?: 'danger' | 'warning' | 'info';
  /** Section heading this item belongs to. */
  group?: string;
  disabled?: boolean;
}

export interface AdminShellProps {
  brand?: ReactNode;
  nav: NavItem[];
  activeId: string;
  onNavigate: (id: string) => void;
  /** Page title in the top bar. */
  title: ReactNode;
  subtitle?: ReactNode;
  /** Live status (tournament pill, clock, connection) in the top bar. */
  status?: ReactNode;
  /** Top-bar actions (right). */
  actions?: ReactNode;
  /** Signed-in admin. */
  user?: { name: string; role: string };
  /** Start collapsed (icon rail). The rail also collapses automatically on tablets via CSS. */
  defaultCollapsed?: boolean;
  /** Global alert strip above the content (e.g. EMERGENCY FREEZE ACTIVE). */
  banner?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Control-room frame: sidebar navigation (grouped, with count badges), top
 * bar (title, live status, actions, user), optional global banner, content.
 * Collapses to an icon rail on tablet widths; a toggle forces either state.
 */
export function AdminShell({
  brand = "Johnny's Poker Bot",
  nav,
  activeId,
  onNavigate,
  title,
  subtitle,
  status,
  actions,
  user,
  defaultCollapsed = false,
  banner,
  children,
  className,
}: AdminShellProps) {
  // null = automatic (CSS collapses the rail on tablet widths); boolean = user override.
  const [collapsed, setCollapsed] = useState<boolean | null>(defaultCollapsed ? true : null);
  const effectiveCollapsed = collapsed ?? narrowViewport();
  const groups: Array<{ name: string | undefined; items: NavItem[] }> = [];
  for (const item of nav) {
    const g = groups.find((x) => x.name === item.group);
    if (g) g.items.push(item);
    else groups.push({ name: item.group, items: [item] });
  }

  return (
    <div className={cx('jpb-shell', className)} data-collapsed={collapsed === null ? 'auto' : String(collapsed)}>
      <a className="jpb-skip" href="#jpb-main">
        Skip to content
      </a>
      <aside className="jpb-shell__side">
        <div className="jpb-shell__brand">
          <span className="jpb-shell__logo" aria-hidden="true">
            ♠
          </span>
          <span className="jpb-shell__brandtext">{brand}</span>
        </div>
        <nav aria-label="Admin sections" className="jpb-shell__nav">
          {groups.map((g) => (
            <div key={g.name ?? '_'} className="jpb-shell__group">
              {g.name && <p className="jpb-shell__grouplabel">{g.name}</p>}
              <ul>
                {g.items.map((item) => {
                  const active = item.id === activeId;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={cx('jpb-shell__link', active && 'is-active')}
                        aria-current={active ? 'page' : undefined}
                        disabled={item.disabled}
                        title={item.label}
                        onClick={() => onNavigate(item.id)}
                      >
                        <Icon name={item.icon} className="jpb-shell__linkicon" />
                        <span className="jpb-shell__linktext">{item.label}</span>
                        {item.badge !== undefined && item.badge > 0 && (
                          <span className={cx('jpb-shell__badge', `is-${item.badgeTone ?? 'info'}`)}>
                            {item.badge > 99 ? '99+' : item.badge}
                            <span className="jpb-sr-only"> items</span>
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        {user && (
          <div className="jpb-shell__user">
            <span className="jpb-shell__avatar" aria-hidden="true">
              {user.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="jpb-shell__usertext">
              <span className="jpb-shell__username">{user.name}</span>
              <span className="jpb-shell__role">{user.role.replace(/_/g, ' ')}</span>
            </span>
          </div>
        )}
      </aside>
      <div className="jpb-shell__main">
        <header className="jpb-shell__top">
          <IconButton
            icon={effectiveCollapsed ? 'menu' : 'chevron-left'}
            label={effectiveCollapsed ? 'Expand navigation' : 'Collapse navigation'}
            onClick={() => setCollapsed(!effectiveCollapsed)}
            className="jpb-shell__toggle"
            aria-expanded={!effectiveCollapsed}
          />
          <div className="jpb-shell__titles">
            <h1 className="jpb-shell__title">{title}</h1>
            {subtitle && <p className="jpb-shell__subtitle">{subtitle}</p>}
          </div>
          {status && <div className="jpb-shell__status">{status}</div>}
          {actions && <div className="jpb-shell__actions">{actions}</div>}
        </header>
        {banner && <div className="jpb-shell__banner">{banner}</div>}
        <main id="jpb-main" className="jpb-shell__content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
