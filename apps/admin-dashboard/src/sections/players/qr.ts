import { useApi } from '../../api/ApiProvider';
import { useQuery } from '../../api/query/useQuery';

/** Pixel size requested from the server QR endpoint (it is an SVG: crisp at any scale). */
export const QR_SIZE = 512;
/** The join QR never changes for a tournament; refresh rarely. */
const QR_STALE_MS = 10 * 60_000;

/**
 * The tournament join QR (GET /qr.svg) as an <img>-safe data URL. Fetched
 * through the API client (works with the mock backend and the session
 * cookie); an SVG inside <img> cannot run scripts.
 */
export function useJoinQr(tournamentId: string) {
  const api = useApi();
  const q = useQuery<string>(['t', tournamentId, 'qr', QR_SIZE], () => api.registration.qrSvg(tournamentId, QR_SIZE), { staleMs: QR_STALE_MS });
  const svg = q.data?.trim() ?? '';
  const src = /^(<\?xml[^>]*>\s*)?<svg[\s>]/.test(svg) ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : null;
  return { src, loading: q.isLoading, error: q.data === undefined && q.status === 'error' ? q.error : null, refetch: q.refetch };
}

/**
 * Public join link encoded in the tournament QR: `{public base}/join/{CODE}`
 * (game-server http/qr.ts). The admin app is served by the same server, so
 * the page origin is the public base (see Registration README contract notes).
 */
export function joinUrlFor(joinCode: string, origin: string = typeof location === 'undefined' ? '' : location.origin): string {
  return `${origin}/join/${encodeURIComponent(joinCode)}`;
}

/** The join page part of a rejoin URL (`…/join/CODE#rejoin=…`). */
export function joinUrlOfRejoin(rejoinUrl: string): string {
  const i = rejoinUrl.indexOf('#');
  return i < 0 ? rejoinUrl : rejoinUrl.slice(0, i);
}
