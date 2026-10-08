import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { cx } from '../cx';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { IconButton } from './IconButton';

export type ToastTone = 'info' | 'success' | 'warning' | 'danger' | 'gold';

export interface ToastInput {
  title: ReactNode;
  description?: ReactNode;
  tone?: ToastTone;
  /** ms before auto-dismiss; 0 = sticky. Default 5000 (danger defaults to sticky). */
  durationMs?: number;
  action?: { label: string; onClick: () => void };
}

export interface ToastItem extends ToastInput {
  id: number;
}

interface ToastApi {
  push: (t: ToastInput) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const TONE_ICON: Readonly<Record<ToastTone, IconName>> = {
  info: 'info',
  success: 'check-circle',
  warning: 'warning',
  danger: 'critical',
  gold: 'trophy',
};

export interface ToastProps extends ToastItem {
  onDismiss: (id: number) => void;
}

/** A single toast (also usable standalone). Danger toasts use role="alert". */
export function Toast({ id, title, description, tone = 'info', durationMs, action, onDismiss }: ToastProps) {
  const ms = durationMs ?? (tone === 'danger' ? 0 : 5000);
  useEffect(() => {
    if (ms <= 0) return undefined;
    const t = setTimeout(() => onDismiss(id), ms);
    return () => clearTimeout(t);
  }, [id, ms, onDismiss]);
  return (
    <div className={cx('jpb-toast', `jpb-toast--${tone}`)} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon name={TONE_ICON[tone]} className="jpb-toast__icon" />
      <div className="jpb-toast__body">
        <p className="jpb-toast__title">{title}</p>
        {description && <p className="jpb-toast__desc">{description}</p>}
      </div>
      {action && (
        <button
          type="button"
          className="jpb-toast__action"
          onClick={() => {
            action.onClick();
            onDismiss(id);
          }}
        >
          {action.label}
        </button>
      )}
      <IconButton icon="x" label="Dismiss notification" size="sm" onClick={() => onDismiss(id)} />
    </div>
  );
}

export interface ToastProviderProps {
  children: ReactNode;
  /** Max toasts on screen (oldest dropped). Default 4. */
  max?: number;
  placement?: 'bottom-right' | 'top-center';
}

/** Provides useToast(). Renders a polite live region; one region per app. */
export function ToastProvider({ children, max = 4, placement = 'bottom-right' }: ToastProviderProps) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (t: ToastInput) => {
      const id = next.current++;
      setItems((xs) => [...xs, { ...t, id }].slice(-max));
      return id;
    },
    [max],
  );
  const api = useMemo(() => ({ push, dismiss }), [push, dismiss]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={cx('jpb-toasts', `jpb-toasts--${placement}`)} aria-live="polite" aria-relevant="additions">
        {items.map((t) => (
          <Toast key={t.id} {...t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
