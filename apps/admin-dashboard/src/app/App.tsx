import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { RouterProvider, createBrowserRouter } from 'react-router';
import { ToastProvider } from '@jpb/ui';
import { ApiProvider } from '../api/ApiProvider';
import type { Backend } from '../api/backend';
import type { QueryClient } from '../api/query/QueryClient';
import { SessionProvider } from '../auth/SessionProvider';
import { DangerProvider } from '../danger/DangerProvider';
import { BASENAME } from '../env';
import { ErrorBoundary } from './ErrorBoundary';
import { createRoutes } from './routes';

/** Everything a screen relies on: typed API + query cache, toasts, session, the danger dialog. */
export function Providers({ backend, queryClient, children }: { backend: Backend; queryClient?: QueryClient; children: ReactNode }) {
  return (
    <ErrorBoundary scope="app">
      <ApiProvider backend={backend} queryClient={queryClient}>
        <ToastProvider>
          <SessionProvider>
            <DangerProvider>{children}</DangerProvider>
          </SessionProvider>
        </ToastProvider>
      </ApiProvider>
    </ErrorBoundary>
  );
}

export function App({ backend }: { backend: Backend }) {
  const router = useMemo(() => createBrowserRouter(createRoutes(), { basename: BASENAME }), []);
  return (
    <Providers backend={backend}>
      <RouterProvider router={router} />
    </Providers>
  );
}
