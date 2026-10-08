import type { ReactNode } from 'react';
import { RouterProvider, createBrowserRouter } from 'react-router';
import { LiveAnnouncerProvider, ToastProvider } from '@jpb/ui';
import { JoinPage } from '../join/JoinPage';
import { PlayPage } from '../play/PlayPage';
import { SettingsProvider } from '../settings/SettingsContext';
import { BackendProvider } from './backend';
import type { Backend } from './backend';
import { HomePage } from './HomePage';
import { NotFoundPage } from './NotFoundPage';

export const ROUTES = [
  { path: '/', element: <HomePage /> },
  { path: '/join/:joinCode', element: <JoinPage /> },
  { path: '/play', element: <PlayPage /> },
  { path: '*', element: <NotFoundPage /> },
];

export function AppProviders({ backend, children }: { backend: Backend; children: ReactNode }) {
  return (
    <BackendProvider backend={backend}>
      <SettingsProvider>
        <LiveAnnouncerProvider>
          <ToastProvider placement="top-center">{children}</ToastProvider>
        </LiveAnnouncerProvider>
      </SettingsProvider>
    </BackendProvider>
  );
}

export function App({ backend }: { backend: Backend }) {
  const router = createBrowserRouter(ROUTES, { basename: import.meta.env.BASE_URL.replace(/\/$/, '') || '/' });
  return (
    <AppProviders backend={backend}>
      <RouterProvider router={router} />
    </AppProviders>
  );
}
