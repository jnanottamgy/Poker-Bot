import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/** True when the OS asks for reduced motion OR the app set <html data-motion="reduced">. */
export function prefersReducedMotion(): boolean {
  if (typeof document !== 'undefined' && document.documentElement.dataset.motion === 'reduced') return true;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(QUERY).matches;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);

  useEffect(() => {
    const update = (): void => setReduced(prefersReducedMotion());
    const mql = typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null;
    mql?.addEventListener('change', update);
    const observer = typeof MutationObserver === 'function' ? new MutationObserver(update) : null;
    observer?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
    return () => {
      mql?.removeEventListener('change', update);
      observer?.disconnect();
    };
  }, []);

  return reduced;
}
