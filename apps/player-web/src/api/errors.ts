import { ApiError } from '@jpb/client-sdk';

export interface FriendlyError {
  code: string;
  title: string;
  message: string;
  /** HTTP status (0 = network). */
  status: number;
  /** Per-field messages from a validation error, when the server sent them. */
  fields: Record<string, string>;
}

/** Server error codes (services/game-server http routes) → player copy. */
const COPY: Readonly<Record<string, { title: string; message?: string }>> = {
  NETWORK: { title: 'No connection', message: 'We could not reach the tournament server. Check your Wi-Fi or mobile data and try again.' },
  RATE_LIMITED: { title: 'Please slow down', message: 'Too many attempts in a short time. Wait a few seconds and try again.' },
  UNAUTHORIZED: { title: 'Your session has ended', message: 'Rejoin with your player ID and rejoin code. Your chips and seat are safe.' },
  FORBIDDEN: { title: 'Security check failed', message: 'Reload the page and try again. Your chips and seat are safe.' },
  NOT_FOUND: { title: 'Tournament not found', message: 'This link or QR code does not match a tournament. Check the code at the venue.' },
  REGISTRATION_CLOSED: { title: 'Registration is closed' },
  ACCESS_CODE: { title: 'Access code not accepted' },
  INVALID_FIELDS: { title: 'Please check the form' },
  INVALID_INPUT: { title: 'Please check the form' },
  REJECTED: { title: 'Registration not accepted' },
  TOURNAMENT_FULL: { title: 'Tournament is full', message: 'Every seat is taken. Ask the organiser about the waiting list.' },
  REJOIN_FAILED: { title: 'Could not rejoin', message: 'That player ID and rejoin code do not match. Check both and try again, or ask a tournament official for a new code.' },
  REENTRY_DISABLED: { title: 'Re-entry is not available', message: 'This tournament does not allow re-entry.' },
  REENTRY_CLOSED: { title: 'Re-entry is closed', message: 'The re-entry period has ended. You can still watch the tournament.' },
  MAX_ENTRIES: { title: 'No re-entries left', message: 'You have used every entry this tournament allows.' },
  NOT_ELIMINATED: { title: 'You are still in', message: 'Only eliminated players can re-enter.' },
  UNAVAILABLE: { title: 'Server reconnecting', message: 'Please try again in a moment. Your chips are safe.' },
  INTERNAL: { title: 'Something went wrong', message: 'The server had a problem. Please try again in a moment.' },
};

const GENERIC = 'Something went wrong. Please try again.';

/** Turns any thrown value into short, human copy. Never exposes stack traces or raw exceptions. */
export function friendlyError(e: unknown): FriendlyError {
  if (e instanceof ApiError) {
    const code = e.status === 429 ? 'RATE_LIMITED' : e.code;
    const copy = COPY[code];
    const serverMessage = e.message && e.message.length <= 200 && !/\bat\s+\S+\s*\(|Error:/.test(e.message) ? e.message : null;
    return {
      code,
      status: e.status,
      title: copy?.title ?? (e.status >= 500 ? 'Something went wrong' : 'That did not work'),
      message: copy?.message ?? serverMessage ?? GENERIC,
      fields: fieldErrors(e.details),
    };
  }
  if (e instanceof DOMException && e.name === 'AbortError') return { code: 'ABORTED', status: 0, title: 'Cancelled', message: 'The request was cancelled.', fields: {} };
  return { code: 'UNKNOWN', status: 0, title: 'Something went wrong', message: GENERIC, fields: {} };
}

/**
 * Per-field messages. The server sends `INVALID_FIELDS` with `[{ field, message }]`
 * and zod failures (`INVALID_INPUT`) with `[{ path: "fields.email", message }]`.
 */
function fieldErrors(details: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const list = Array.isArray(details) ? details : details && typeof details === 'object' ? (details as { fields?: unknown }).fields : null;
  if (Array.isArray(list)) {
    for (const item of list as unknown[]) {
      if (!item || typeof item !== 'object') continue;
      const { field, path, message } = item as { field?: unknown; path?: unknown; message?: unknown };
      const key = typeof field === 'string' ? field : typeof path === 'string' ? path.replace(/^fields\./, '') : null;
      if (key && typeof message === 'string' && !(key in out)) out[key] = message;
    }
  } else if (list && typeof list === 'object') {
    for (const [k, v] of Object.entries(list as Record<string, unknown>)) if (typeof v === 'string') out[k] = v;
  }
  return out;
}

export function isAuthError(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 401 || e.code === 'UNAUTHORIZED');
}
