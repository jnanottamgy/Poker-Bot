import { ApiError } from '@jpb/client-sdk';

export interface FriendlyError {
  title: string;
  description: string;
  code: string;
  status: number;
}

/**
 * Turns any thrown value into operator-friendly copy. Never exposes stack
 * traces or raw exception text; server messages are used only when they come
 * from the documented `{ error: { code, message } }` body (already friendly).
 */
export function friendlyError(err: unknown): FriendlyError {
  if (err instanceof ApiError) {
    const base = { code: err.code, status: err.status };
    if (err.status === 0 || err.code === 'NETWORK') {
      return { ...base, title: 'Cannot reach the server', description: 'Check the network connection. Nothing was changed; try again in a moment.' };
    }
    if (err.status === 401) return { ...base, title: 'Signed out', description: 'Your session ended. Please sign in again.' };
    if (err.status === 403) return { ...base, title: 'Not allowed', description: err.message || 'Your role does not include this permission.' };
    if (err.status === 404) return { ...base, title: 'Not found', description: err.message || 'It may have been removed or you may not have access to it.' };
    if (err.status === 409) return { ...base, title: 'Not possible right now', description: err.message || 'The tournament state changed. Refresh and try again.' };
    if (err.status === 423) return { ...base, title: 'Account locked', description: err.message || 'Too many failed attempts. Try again later.' };
    if (err.status === 429) return { ...base, title: 'Slow down', description: 'Too many requests in a short time. Wait a few seconds and try again.' };
    if (err.status >= 500) return { ...base, title: 'Server problem', description: 'The server could not complete this. Nothing was changed by this screen; try again.' };
    return { ...base, title: 'Request refused', description: err.message || 'Please check the values and try again.' };
  }
  if (err instanceof DOMException && err.name === 'AbortError') {
    return { code: 'ABORTED', status: 0, title: 'Cancelled', description: 'The request was cancelled.' };
  }
  return { code: 'UNKNOWN', status: 0, title: 'Something went wrong', description: 'An unexpected problem occurred. Try again; if it keeps happening, reload the page.' };
}

export function isUnauthorized(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401;
}
