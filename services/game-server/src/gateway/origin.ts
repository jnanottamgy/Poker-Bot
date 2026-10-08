/**
 * Cross-site WebSocket hijacking defence. Browsers attach session cookies to
 * a WebSocket upgrade from ANY page (SameSite=Lax does not cover WS in every
 * browser) and the upgrade is not subject to CORS, so the server must check
 * the Origin header itself: it must equal the origin of PUBLIC_BASE_URL (or
 * an explicitly configured extra origin).
 *
 * A missing Origin header means a non-browser client (browsers always send
 * it on WebSocket upgrades). Such clients cannot be driven by a hostile web
 * page, so they are allowed outside production for tooling and tests; in
 * production every upgrade must carry a matching Origin.
 */
export function isAllowedOrigin(
  origin: string | undefined,
  input: { publicBaseUrl: string; nodeEnv: 'development' | 'test' | 'production'; extraAllowedOrigins?: readonly string[] },
): boolean {
  if (origin === undefined || origin === '') return input.nodeEnv !== 'production';
  const actual = normalizeOrigin(origin);
  if (actual === null) return false;
  const allowed = [input.publicBaseUrl, ...(input.extraAllowedOrigins ?? [])].map(normalizeOrigin);
  return allowed.includes(actual);
}

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}
