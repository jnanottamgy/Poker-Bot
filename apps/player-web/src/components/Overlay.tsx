import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '@jpb/ui';

/**
 * Full-screen notice layer (table move, elimination, final table). It must be
 * acknowledged explicitly — no click-outside or Escape dismissal — and it
 * keeps keyboard focus inside while open.
 */
export function Overlay({ children, label, tone = 'default', className }: { children: ReactNode; label: string; tone?: 'default' | 'gold'; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const previous = document.activeElement as HTMLElement | null;
    if (!el.contains(document.activeElement)) {
      const first = el.querySelector<HTMLElement>('[autofocus], button, [href], [tabindex]:not([tabindex="-1"])');
      first?.focus();
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = [...el.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])')];
      if (items.length === 0) return;
      const first = items[0] as HTMLElement;
      const last = items[items.length - 1] as HTMLElement;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    el.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, []);
  const node = (
    <div ref={ref} className={cx('pw-overlay', `pw-overlay--${tone}`, className)} role="dialog" aria-modal="true" aria-label={label}>
      <div className="pw-overlay__content">{children}</div>
    </div>
  );
  return typeof document === 'undefined' ? node : createPortal(node, document.body);
}
