import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { cx } from '../cx';
import { initials } from '../format';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { IconButton } from './IconButton';

/** Matches the CSS breakpoint at which the rail auto-collapses. */
export const ADMIN_RAIL_BREAKPOINT_PX = 1100;
/** Below this width the rail is hidden and navigation opens as a drawer. */
export const ADMIN_DRAWER_BREAKPOINT_PX = 720;

/** Live `matchMedia` subscription (false on the server / in environments without it). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
      const mql = window.matchMedia(query);
      mql.addEventListener('change', cb);
      return () => mql.removeEventListener('change', cb);
    },
    [query],
  );
  const get = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  return useSyncExternalStore(subscribe, get, () => false);
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
  /** Level clock right after the title (use <BlindClock variant="bar" />). */
  clock?: ReactNode;
  /** Live status (tournament pill, connection) in the top bar. */
  status?: ReactNode;
  /** Top-bar actions (right). */
  actions?: ReactNode;
  /** Signed-in admin. */
  user?: { name: string; role: string };
  /** Start collapsed (icon rail). The rail also collapses automatically on tablets. */
  defaultCollapsed?: boolean;
  /** Global alert strip above the content (e.g. EMERGENCY FREEZE ACTIVE). */
  banner?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Control-room frame: sidebar navigation (grouped, with count badges), top
 * bar (title, level clock, live status, actions, user), optional global
 * banner, content. Desktop: full sidebar. Tablet (<= 1100px): icon rail.
 * Phone (<= 720px): no rail; the menu button opens the navigation as a drawer.
 */
export function AdminShell({
  brand = "Johnny's Poker Bot",
  nav,
  activeId,
  onNavigate,
  title,
  subtitle,
  clock,
  status,
  actions,
  user,
  defaultCollapsed = false,
  banner,
  children,
  className,
}: AdminShellProps) {
  // null = automatic (collapses on tablet widths); boolean = user override.
  const [collapsed, setCollapsed] = useState<boolean | null>(defaultCollapsed ? true : null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const tablet = useMediaQuery(`(max-width: ${ADMIN_RAIL_BREAKPOINT_PX}px)`);
  const phone = useMediaQuery(`(max-width: ${ADMIN_DRAWER_BREAKPOINT_PX}px)`);
  const effectiveCollapsed = phone ? false : (collapsed ?? tablet);

  useEffect(() => {
    if (!phone) setDrawerOpen(false);
  }, [phone]);
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  const groups: Array<{ name: string | undefined; items: NavItem[] }> = [];
  for (const item of nav) {
    const g = groups.find((x) => x.name === item.group);
    if (g) g.items.push(item);
    else groups.push({ name: item.group, items: [item] });
  }

  const toggleLabel = phone ? (drawerOpen ? 'Close navigation' : 'Open navigation') : effectiveCollapsed ? 'Expand navigation' : 'Collapse navigation';
  const onToggle = (): void => {
    if (phone) setDrawerOpen((v) => !v);
    else setCollapsed(!effectiveCollapsed);
  };

  return (
    <div className={cx('jpb-shell', className)} data-collapsed={phone ? 'false' : String(effectiveCollapsed)} data-drawer={phone ? (drawerOpen ? 'open' : 'closed') : undefined}>
      <a className="jpb-skip" href="#jpb-main">
        Skip to content
      </a>
      {phone && drawerOpen && <div className="jpb-shell__scrim" aria-hidden="true" onClick={() => setDrawerOpen(false)} />}
      <aside className="jpb-shell__side" id="jpb-admin-nav" aria-hidden={phone && !drawerOpen ? true : undefined} inert={phone && !drawerOpen ? true : undefined}>
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
                  const hasBadge = item.badge !== undefined && item.badge > 0;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={cx('jpb-shell__link', active && 'is-active')}
                        aria-current={active ? 'page' : undefined}
                        aria-label={hasBadge ? `${item.label}, ${item.badge} ${item.badgeTone === 'danger' ? 'urgent ' : ''}items` : item.label}
                        disabled={item.disabled}
                        title={effectiveCollapsed ? item.label : undefined}
                        onClick={() => {
                          onNavigate(item.id);
                          setDrawerOpen(false);
                        }}
                      >
                        <Icon name={item.icon} className="jpb-shell__linkicon" />
                        <span className="jpb-shell__linktext">{item.label}</span>
                        {hasBadge && (
                          <span className={cx('jpb-shell__badge', `is-${item.badgeTone ?? 'info'}`)} aria-hidden="true">
                            {(item.badge ?? 0) > 99 ? '99+' : item.badge}
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
              {initials(user.name)}
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
            icon={phone ? (drawerOpen ? 'x' : 'menu') : effectiveCollapsed ? 'menu' : 'chevron-left'}
            label={toggleLabel}
            onClick={onToggle}
            className="jpb-shell__toggle"
            aria-expanded={phone ? drawerOpen : !effectiveCollapsed}
            aria-controls="jpb-admin-nav"
          />
          <div className="jpb-shell__titles">
            <h1 className="jpb-shell__title">{title}</h1>
            {subtitle && <p className="jpb-shell__subtitle">{subtitle}</p>}
          </div>
          {clock && <div className="jpb-shell__clock">{clock}</div>}
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
