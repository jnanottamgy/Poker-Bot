import { useSyncExternalStore } from 'react';

/** Live `matchMedia` result (false where matchMedia is unavailable, e.g. tests). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false),
    () => false,
  );
}

/** Desktop layout: side panel + wide virtual table. */
export const DESKTOP_QUERY = '(min-width: 1024px)';
