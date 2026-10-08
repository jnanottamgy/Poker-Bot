/**
 * Typed HTTP errors. The error handler maps these to friendly JSON bodies;
 * anything else becomes a generic 500 without internals (spec §135: never
 * display raw stack traces).
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (code: string, message: string, details?: unknown) => new HttpError(400, code, message, details);
export const unauthorized = (message = 'Your session expired. Please sign in again.') => new HttpError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'You do not have permission to do that.') => new HttpError(403, 'FORBIDDEN', message);
export const notFound = (what = 'Resource') => new HttpError(404, 'NOT_FOUND', `${what} not found.`);
export const conflict = (code: string, message: string, details?: unknown) => new HttpError(409, code, message, details);
export const tooManyRequests = (retryAfterSeconds: number) =>
  new HttpError(429, 'RATE_LIMITED', 'Too many requests. Please slow down.', { retryAfterSeconds });
export const unavailable = (message = 'Server reconnecting. Please try again in a moment.') => new HttpError(503, 'UNAVAILABLE', message);
