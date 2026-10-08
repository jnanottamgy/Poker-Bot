import { useEffect, useRef } from 'react';

export interface HotkeyHandlers {
  /** `/` */
  onSearch: () => void;
  /** `?` */
  onHelp: () => void;
  /** `g` then a key (within 1.2 s). Return true when handled. */
  onGo: (key: string) => boolean;
}

const SEQUENCE_MS = 1200;

function typingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** Global keyboard shortcuts; ignored while typing, with modifiers, or while a dialog is open. */
export function useHotkeys(h: HotkeyHandlers, enabled = true): void {
  const ref = useRef(h);
  ref.current = h;
  useEffect(() => {
    if (!enabled) return undefined;
    let pendingG = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || typingTarget(e.target)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const now = performance.now();
      if (pendingG && now - pendingG < SEQUENCE_MS) {
        pendingG = 0;
        if (ref.current.onGo(e.key.toLowerCase())) e.preventDefault();
        return;
      }
      if (e.key === '/') {
        e.preventDefault();
        ref.current.onSearch();
      } else if (e.key === '?') {
        e.preventDefault();
        ref.current.onHelp();
      } else if (e.key === 'g' && !e.shiftKey) {
        pendingG = now;
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [enabled]);
}
