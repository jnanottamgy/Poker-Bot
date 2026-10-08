import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { focusableIn, trapTab } from '../components/Modal';

/**
 * Modal behaviour for overlays that are not rendered through <Modal>
 * (ChampionOverlay, TableMoveCard as an overlay): focus `initial` (or the
 * container) on mount, keep Tab / Shift+Tab inside, call `onEscape` on Esc,
 * restore focus to the previously focused element on unmount.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  options: { initial?: RefObject<HTMLElement | null>; onEscape?: () => void } = {},
): void {
  const onEscape = useRef(options.onEscape);
  onEscape.current = options.onEscape;
  const initial = options.initial;

  useEffect(() => {
    if (!active) return undefined;
    const root = ref.current;
    if (!root) return undefined;
    const opener = document.activeElement;
    (initial?.current ?? root).focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && onEscape.current) {
        e.stopPropagation();
        onEscape.current();
        return;
      }
      if (e.key === 'Tab') trapTab(e, focusableIn(root));
    };
    root.addEventListener('keydown', onKey);
    return () => {
      root.removeEventListener('keydown', onKey);
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
    };
  }, [ref, active, initial]);
}
