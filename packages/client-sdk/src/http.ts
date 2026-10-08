/**
 * Small fetch wrapper for the REST API: same-origin cookies, the CSRF header
 * on state-changing requests, and typed friendly errors.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: unknown = null,
  ) {
    super(message);
  }
}

export function readCookie(name: string, cookieString: string = typeof document === 'undefined' ? '' : document.cookie): string | null {
  for (const part of cookieString.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json' };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') {
    const csrf = readCookie('jpb_csrf');
    if (csrf) headers['x-csrf-token'] = csrf;
  }
  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)((opts.baseUrl ?? '') + path, {
      method,
      headers,
      credentials: 'same-origin',
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Unable to connect. Check your connection and try again.');
  }
  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? 'ERROR', err?.message ?? 'Something went wrong.', err?.details ?? null);
  }
  return json as T;
}

/** ws:// or wss:// URL for the current page's origin. */
export function websocketUrl(path = '/ws', location: { protocol: string; host: string } = globalThis.location): string {
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${path}`;
}
