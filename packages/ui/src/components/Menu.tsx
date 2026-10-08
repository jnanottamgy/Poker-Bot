import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { cx } from '../cx';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { Kbd } from './Kbd';

export interface MenuItem {
  id: string;
  label: string;
  icon?: IconName;
  /** Destructive item: red text + icon (the confirmation happens in a ConfirmDialog). */
  danger?: boolean;
  disabled?: boolean;
  /** Why it is disabled (permission, state). Spoken and shown as a tooltip. */
  disabledReason?: string;
  /** Visual shortcut hint. */
  shortcut?: string;
  onSelect: () => void;
}

export interface MenuProps {
  /** Accessible name of the trigger, e.g. "Actions for Sofia Lind". */
  label: string;
  items: Array<MenuItem | 'separator'>;
  /** Trigger content. Default: the "more" (⋯) icon. */
  trigger?: ReactNode;
  /** Visible trigger text next to the icon (default none: icon only). */
  triggerText?: string;
  align?: 'start' | 'end';
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Menu button (WAI-ARIA menu pattern): Enter / Space / ArrowDown open it and
 * focus the first item; ArrowUp/Down, Home/End move; Esc closes and returns
 * focus to the trigger; Tab closes. Clicking outside closes.
 */
export function Menu({ label, items, trigger, triggerText, align = 'end', size = 'sm', className }: MenuProps) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const enabled = (): HTMLElement[] => Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []);

  useEffect(() => {
    if (!open) return undefined;
    enabled()[0]?.focus();
    const onDoc = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const close = (refocus: boolean): void => {
    setOpen(false);
    if (refocus) btnRef.current?.focus();
  };

  const onListKey = (e: KeyboardEvent<HTMLUListElement>): void => {
    const list = enabled();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = list.length;
      if (n === 0) return;
      const next = e.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n;
      list[next]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      (e.key === 'Home' ? list[0] : list[list.length - 1])?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === 'Tab') {
      close(false);
    }
  };

  return (
    <div ref={rootRef} className={cx('jpb-menu', `jpb-menu--${align}`, className)}>
      <button
        ref={btnRef}
        type="button"
        className={cx('jpb-menu__trigger', `jpb-menu__trigger--${size}`, triggerText && 'has-text')}
        aria-label={triggerText ? undefined : label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${uid}-menu` : undefined}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {trigger ?? <Icon name="more" />}
        {triggerText && <span>{triggerText}</span>}
        {triggerText && <span className="jpb-sr-only">{`, ${label}`}</span>}
      </button>
      {open && (
        <ul id={`${uid}-menu`} ref={listRef} className="jpb-menu__list" role="menu" aria-label={label} onKeyDown={onListKey}>
          {items.map((it, i) =>
            it === 'separator' ? (
              <li key={`sep-${i}`} role="separator" className="jpb-menu__sep" />
            ) : (
              <li
                key={it.id}
                role="menuitem"
                tabIndex={-1}
                aria-disabled={it.disabled || undefined}
                title={it.disabled ? it.disabledReason : undefined}
                className={cx('jpb-menu__item', it.danger && 'is-danger', it.disabled && 'is-disabled')}
                onClick={(e) => {
                  e.stopPropagation();
                  if (it.disabled) return;
                  close(true);
                  it.onSelect();
                }}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ' ') && !it.disabled) {
                    e.preventDefault();
                    e.stopPropagation();
                    close(true);
                    it.onSelect();
                  }
                }}
              >
                {it.icon ? <Icon name={it.icon} className="jpb-menu__icon" /> : <span className="jpb-menu__icon" />}
                <span className="jpb-menu__label">{it.label}</span>
                {it.disabled && it.disabledReason && <span className="jpb-sr-only">{`, unavailable: ${it.disabledReason}`}</span>}
                {it.shortcut && (
                  <span className="jpb-menu__kbd" aria-hidden="true">
                    <Kbd>{it.shortcut}</Kbd>
                  </span>
                )}
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}
