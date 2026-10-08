import { useEffect, useId, useRef } from 'react';
import type { KeyboardEvent, ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../cx';
import { IconButton } from './IconButton';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Footer actions (right-aligned). */
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** 'center' dialog or 'right' drawer (admin detail panes). */
  placement?: 'center' | 'right';
  /** When false, Esc and backdrop clicks do nothing (forced decisions). Default true. */
  dismissible?: boolean;
  /** Tone accent for the header rule. */
  tone?: 'default' | 'danger' | 'gold';
  /** Element to focus first (defaults to the first focusable element). */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Render in place instead of a portal (gallery / tests). */
  inline?: boolean;
  className?: string;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hasAttribute('aria-hidden'));
}

/**
 * Accessible dialog: role="dialog", aria-modal, labelled by its title,
 * focus trapped (Tab / Shift+Tab wrap), Esc closes when dismissible, focus
 * restored to the opener on close, body scroll locked.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  placement = 'center',
  dismissible = true,
  tone = 'default',
  initialFocusRef,
  inline = false,
  className,
}: ModalProps) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    opener.current = document.activeElement;
    const node = panel.current;
    const target = initialFocusRef?.current ?? (node ? focusables(node)[0] : null) ?? node;
    target?.focus();
    const prevOverflow = document.body.style.overflow;
    if (!inline) document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, [open, initialFocusRef, inline]);

  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (dismissible) onClose();
      return;
    }
    if (e.key !== 'Tab' || !panel.current) return;
    const items = focusables(panel.current);
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  };

  const content = (
    <div className={cx('jpb-modal', `jpb-modal--${placement}`, inline && 'jpb-modal--inline')} onKeyDown={onKeyDown}>
      <div className="jpb-modal__backdrop" aria-hidden="true" onClick={dismissible ? onClose : undefined} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={description ? `${id}-desc` : undefined}
        tabIndex={-1}
        className={cx('jpb-modal__panel', `jpb-modal__panel--${size}`, `jpb-modal__panel--${tone}`, className)}
      >
        <header className="jpb-modal__head">
          <div>
            <h2 id={`${id}-title`} className="jpb-modal__title">
              {title}
            </h2>
            {description && (
              <p id={`${id}-desc`} className="jpb-modal__desc">
                {description}
              </p>
            )}
          </div>
          {dismissible && <IconButton icon="x" label="Close" onClick={onClose} className="jpb-modal__close" />}
        </header>
        {children !== undefined && <div className="jpb-modal__body">{children}</div>}
        {footer && <footer className="jpb-modal__foot">{footer}</footer>}
      </div>
    </div>
  );

  return inline || typeof document === 'undefined' ? content : createPortal(content, document.body);
}
