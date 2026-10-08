/**
 * Build/runtime environment switches.
 *
 * Mock mode (`npx vite --mode mock`, or `VITE_MOCK=1 npx vite`) runs the whole
 * control room in the browser against the deterministic mock backend in
 * `src/api/mock`. Otherwise the real game server is used (proxied by Vite in
 * development, same origin in production).
 */
export const IS_MOCK: boolean = import.meta.env.VITE_MOCK === '1' || import.meta.env.MODE === 'mock';

/** Router basename; must match `base` in vite.config.ts (trailing slash removed). */
export const BASENAME = '/admin';
