import { useId, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { cx } from '../cx';

export interface TabItem {
  id: string;
  label: ReactNode;
  /** Small count/badge after the label. */
  count?: number;
  disabled?: boolean;
}

export interface TabsProps {
  tabs: TabItem[];
  value: string;
  onChange: (id: string) => void;
  /** Accessible name for the tablist. */
  label: string;
  variant?: 'underline' | 'segmented';
  /** Panel content for the active tab (rendered in a role="tabpanel"). */
  children?: ReactNode;
  className?: string;
}

/**
 * WAI-ARIA tabs with automatic activation: Left/Right (and Home/End) move
 * and select; only the active tab is in the tab order.
 */
export function Tabs({ tabs, value, onChange, label, variant = 'underline', children, className }: TabsProps) {
  const base = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const enabled = tabs.filter((t) => !t.disabled);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const idx = enabled.findIndex((t) => t.id === value);
    let next = -1;
    if (e.key === 'ArrowRight') next = (idx + 1) % enabled.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + enabled.length) % enabled.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = enabled.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const target = enabled[next];
    if (!target) return;
    onChange(target.id);
    refs.current[tabs.indexOf(target)]?.focus();
  };

  return (
    <div className={cx('jpb-tabs', `jpb-tabs--${variant}`, className)}>
      <div role="tablist" aria-label={label} className="jpb-tabs__list" onKeyDown={onKeyDown}>
        {tabs.map((t, i) => {
          const selected = t.id === value;
          return (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`${base}-panel`}
              tabIndex={selected ? 0 : -1}
              disabled={t.disabled}
              className={cx('jpb-tabs__tab', selected && 'is-selected')}
              onClick={() => onChange(t.id)}
            >
              {t.label}
              {t.count !== undefined && <span className="jpb-tabs__count">{t.count}</span>}
            </button>
          );
        })}
      </div>
      {children !== undefined && (
        <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${value}`} className="jpb-tabs__panel" tabIndex={0}>
          {children}
        </div>
      )}
    </div>
  );
}
