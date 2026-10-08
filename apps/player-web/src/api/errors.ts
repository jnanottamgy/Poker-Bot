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

const COPY: Readonly<Record<string, { title: string; message?: string }>> = {
  NETWORK: { title: 'No connection', message: 'We could not reach the tournament server. Check your Wi-Fi or mobile data and try again.' },
  RATE_LIMITED: { title: 'Please slow down', message: 'Too many attempts in a short time. Wait a few seconds and try again.' },
  UNAUTHORIZED: { title: 'Your session has ended', message: 'Rejoin with your player ID and rejoin code. Your chips and seat are safe.' },
  NOT_FOUND: { title: 'Tournament not found', message: 'This link or QR code does not match a tournament. Check the code at the venue.' },
  TOURNAMENT_NOT_FOUND: { title: 'Tournament not found', message: 'This link or QR code does not match a tournament. Check the code at the venue.' },
  REGISTRATION_CLOSED: { title: 'Registration is closed' },
  ACCESS_CODE_INVALID: { title: 'Access code not accepted' },
  ALREADY_REGISTERED: { title: 'Already registered' },
  TOURNAMENT_FULL: { title: 'Tournament is full', message: 'Every seat is taken. Ask the organiser about the waiting list.' },
  REJOIN_INVALID: { title: 'Could not rejoin', message: 'That player ID and rejoin code do not match. Check both and try again, or ask a tournament official for a new code.' },
  VALIDATION_FAILED: { title: 'Please check the form' },
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

function fieldErrors(details: unknown): Record<string, string> {
  if (!details || typeof details !== 'object') return {};
  const fields = (details as { fields?: unknown }).fields;
  if (!fields || typeof fields !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields as Record<string, unknown>)) if (typeof v === 'string') out[k] = v;
  return out;
}

export function isAuthError(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 401 || e.code === 'UNAUTHORIZED');
}
