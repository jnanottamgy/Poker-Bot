import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { cx } from '@jpb/ui';

export interface PopoverProps {
  /** Renders the trigger; spread `props` onto a <button>. */
  trigger: (props: { 'aria-expanded': boolean; 'aria-controls': string; onClick: () => void; ref: (el: HTMLButtonElement | null) => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'start' | 'end';
  /** Accessible name of the panel. */
  label: string;
  className?: string;
  panelClassName?: string;
}

/**
 * Disclosure popover (non-modal): Esc closes and returns focus to the
 * trigger; clicking outside closes. Content stays in the normal tab order.
 */
export function Popover({ trigger, children, align = 'start', label, className, panelClassName }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    btn.current?.focus();
  };

  return (
    <div ref={root} className={cx('acr-popover', className)}>
      {trigger({ 'aria-expanded': open, 'aria-controls': id, onClick: () => setOpen((v) => !v), ref: (el) => (btn.current = el) })}
      {open && (
        <div id={id} role="region" aria-label={label} className={cx('acr-popover__panel', `acr-popover__panel--${align}`, panelClassName)}>
          {children(close)}
        </div>
      )}
    </div>
  );
}
