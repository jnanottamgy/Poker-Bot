import { RouterProvider, createMemoryRouter } from 'react-router';
import { cleanup, render } from '@testing-library/react';
import { afterEach } from 'vitest';
import { createMockBackend } from '../../src/api/mock';
import type { MockBackend } from '../../src/api/mock';
import { Providers } from '../../src/app/App';
import { createRoutes } from '../../src/app/routes';

afterEach(() => cleanup());

export interface RenderOptions {
  /** Mock username to sign in as (director, super, staff, viewer, campus.td). Null = signed out. */
  as?: string | null;
  /** Fixed server clock for deterministic times (default: real time). */
  now?: () => number;
}

/**
 * Renders the whole control room (providers, router, shell, lazy section)
 * at `path` against the deterministic in-memory mock backend: no network,
 * no latency, no background simulation ticks (call `mock.server.tick()`).
 */
export function renderControlRoom(path: string, opts: RenderOptions = {}) {
  const mock: MockBackend = createMockBackend({
    latencyMs: [0, 0],
    tickMs: 0,
    persistSession: false,
    ...(opts.as === null ? {} : { signedInAs: opts.as ?? 'director' }),
    ...(opts.now ? { now: opts.now } : {}),
  });
  const router = createMemoryRouter(createRoutes(), { initialEntries: [path] });
  const utils = render(
    <Providers backend={mock.backend}>
      <RouterProvider router={router} />
    </Providers>,
  );
  afterEach(() => mock.stop());
  return { ...utils, mock, router };
}
