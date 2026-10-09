import { CONFIRM_WORDS, ENDPOINTS } from '../endpoints';
import type { EndpointDef, EndpointKey } from '../endpoints';
import { HANDLERS } from './handlers';
import type { HandlerResult } from './handlers';
import { Rng } from './rng';
import { MockHttpError } from './server';
import type { MockServer } from './server';

interface Route {
  key: EndpointKey;
  def: EndpointDef;
  regex: RegExp;
  names: string[];
}

function compile(): Route[] {
  return (Object.keys(ENDPOINTS) as EndpointKey[]).map((key) => {
    const def = ENDPOINTS[key];
    const names: string[] = [];
    const pattern = def.path
      .split('/')
      .map((seg) => {
        if (seg.startsWith(':')) {
          names.push(seg.slice(1));
          return '([^/]+)';
        }
        return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/');
    return { key, def, regex: new RegExp(`^${pattern}$`), names };
  });
}

const ROUTES = compile();

export interface MockFetchOptions {
  /** [min, max] simulated latency in ms (0 disables timers entirely — tests). */
  latencyMs?: [number, number];
  /** Called with every request (debugging, tests). */
  onRequest?: (method: string, path: string, body: unknown) => void;
}

interface MiniResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  json(): Promise<unknown>;
}

function respond(status: number, body: string, contentType = 'application/json'): Response {
  const res: MiniResponse = {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n) => (n.toLowerCase() === 'content-type' ? contentType : null) },
    text: async () => body,
    json: async () => JSON.parse(body) as unknown,
  };
  return res as unknown as Response;
}

const errorBody = (code: string, message: string, details: unknown = null) => JSON.stringify({ error: { code, message, details } });

/** Server-side checks every admin route performs (auth, permission, scope, level-2 confirmation). */
function guard(server: MockServer, route: Route, params: Record<string, string>, body: Record<string, unknown>) {
  if (route.def.section !== 'Admin' || route.key === 'authLogin') return null;
  const admin = server.currentAdmin();
  if (!admin) throw new MockHttpError(401, 'UNAUTHORIZED', 'Your session expired. Please sign in again.');
  const perms = server.permissionsOf(admin);
  if (route.def.permission && !perms.includes(route.def.permission)) {
    throw new MockHttpError(403, 'FORBIDDEN', `Your role (${admin.role.replace(/_/g, ' ').toLowerCase()}) does not include ${route.def.permission}.`);
  }
  if (route.def.path.startsWith('/api/admin/tournaments/:id') && admin.tournamentScope && !admin.tournamentScope.includes(params.id ?? '')) {
    throw new MockHttpError(403, 'FORBIDDEN', 'You do not have permission to do that.');
  }
  if (route.def.level === 2 && route.def.word) {
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (reason.length < 3) throw new MockHttpError(400, 'REASON_REQUIRED', 'Please enter a reason (at least 3 characters).');
    const word = CONFIRM_WORDS[route.def.word];
    if (body.confirm !== word) throw new MockHttpError(400, 'CONFIRMATION_REQUIRED', `Type ${word} to confirm this action.`, { confirmWord: word });
  }
  return admin;
}

function dispatch(server: MockServer, method: string, rawUrl: string, body: Record<string, unknown>): Response {
  const url = new URL(rawUrl, 'http://mock.local');
  const path = decodeURIComponent(url.pathname).replace(/^\/admin(?=\/api\/)/, '');
  const route = ROUTES.find((r) => r.def.method === method && r.regex.test(path));
  if (!route) return respond(404, errorBody('NOT_FOUND', 'This endpoint does not exist.'));
  const m = route.regex.exec(path)!;
  const params = Object.fromEntries(route.names.map((n, i) => [n, m[i + 1] ?? '']));
  try {
    const admin = guard(server, route, params, body);
    const result: HandlerResult = HANDLERS[route.key]({ server, params, query: url.searchParams, body, admin });
    if (result && typeof result === 'object' && '__text' in result) {
      const r = result as { __text: string; contentType: string };
      return respond(200, r.__text, r.contentType);
    }
    return respond(200, JSON.stringify(result ?? null));
  } catch (err) {
    if (err instanceof MockHttpError) return respond(err.status, errorBody(err.code, err.message, err.details));
    console.error('[mock backend]', route.key, err);
    return respond(500, errorBody('INTERNAL', 'Something went wrong on the server.'));
  }
}

/** A `fetch` implementation served entirely by the in-memory mock server. */
export function createMockFetch(server: MockServer, opts: MockFetchOptions = {}): typeof fetch {
  const jitter = new Rng('latency');
  const [min, max] = opts.latencyMs ?? [0, 0];
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    let body: Record<string, unknown> = {};
    if (typeof init?.body === 'string' && init.body) {
      try {
        body = JSON.parse(init.body) as Record<string, unknown>;
      } catch {
        return respond(400, errorBody('INVALID_JSON', 'The request body is not valid JSON.'));
      }
    }
    opts.onRequest?.(method, url, body);
    if (max > 0) {
      const delay = jitter.int(min, max);
      await new Promise((r) => setTimeout(r, delay));
    }
    if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return dispatch(server, method, url, body);
  }) as typeof fetch;
}
