import { useEffect, useState } from 'react';
import type { RefObject } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * True when the OS asks for reduced motion OR data-motion="reduced" is set on
 * <html> or (when `el` is given) on any ancestor of `el`.
 */
export function prefersReducedMotion(el?: Element | null): boolean {
  if (typeof document !== 'undefined' && document.documentElement.dataset.motion === 'reduced') return true;
  if (el?.closest('[data-motion="reduced"]')) return true;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(QUERY).matches;
}

/**
 * Reduced-motion preference for JS animation (e.g. useAnimatedNumber). Pass a
 * ref to also honour data-motion="reduced" on any ANCESTOR of that element
 * (gallery toggles, a broadcast region); without it only <html> is checked.
 */
export function useReducedMotion(ref?: RefObject<Element | null>): boolean {
  const [reduced, setReduced] = useState(() => prefersReducedMotion(ref?.current));

  useEffect(() => {
    const update = (): void => setReduced(prefersReducedMotion(ref?.current));
    update();
    const mql = typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null;
    mql?.addEventListener('change', update);
    const observer = typeof MutationObserver === 'function' ? new MutationObserver(update) : null;
    // Watch the whole document's data-motion attributes (any ancestor may toggle).
    observer?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'], subtree: Boolean(ref) });
    return () => {
      mql?.removeEventListener('change', update);
      observer?.disconnect();
    };
  }, [ref]);

  return reduced;
}
