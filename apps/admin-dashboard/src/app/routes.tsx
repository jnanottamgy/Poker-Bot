import { lazy } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';
import { Navigate } from 'react-router';
import type { RouteObject } from 'react-router';
import { LoginRoute, RequireAuth } from './guards';
import { RouteError } from './RouteError';
import { NotFound } from './NotFound';
import { SECTIONS } from './sections';
import type { SectionId } from './sections';
import { HomeRedirect, SectionOutlet, ShellLayout, TournamentLayout } from './layouts';

/**
 * Each section is code-split and lives in its own folder
 * (src/sections/<id>/index.tsx, default export). Engineers building a
 * section edit only that folder — routes and navigation come from SECTIONS.
 */
export const SECTION_COMPONENTS: Record<SectionId, LazyExoticComponent<ComponentType>> = {
  tournaments: lazy(() => import('../sections/tournaments')),
  setup: lazy(() => import('../sections/setup')),
  overview: lazy(() => import('../sections/overview')),
  clock: lazy(() => import('../sections/clock')),
  tables: lazy(() => import('../sections/tables')),
  'table-detail': lazy(() => import('../sections/table-detail')),
  players: lazy(() => import('../sections/players')),
  'player-detail': lazy(() => import('../sections/player-detail')),
  registration: lazy(() => import('../sections/registration')),
  hands: lazy(() => import('../sections/hands')),
  'hand-detail': lazy(() => import('../sections/hand-detail')),
  fairness: lazy(() => import('../sections/fairness')),
  standings: lazy(() => import('../sections/standings')),
  payouts: lazy(() => import('../sections/payouts')),
  broadcast: lazy(() => import('../sections/broadcast')),
  alerts: lazy(() => import('../sections/alerts')),
  audit: lazy(() => import('../sections/audit')),
  system: lazy(() => import('../sections/system')),
  reports: lazy(() => import('../sections/reports')),
  users: lazy(() => import('../sections/users')),
  demo: lazy(() => import('../sections/demo')),
  settings: lazy(() => import('../sections/settings')),
};

function sectionRoute(id: SectionId, path: string): RouteObject {
  const Component = SECTION_COMPONENTS[id];
  return { path, handle: { section: id }, element: <SectionOutlet section={id} component={Component} /> };
}

export function createRoutes(): RouteObject[] {
  const global = SECTIONS.filter((s) => s.scope === 'global');
  const scoped = SECTIONS.filter((s) => s.scope === 'tournament');
  return [
    { path: '/login', element: <LoginRoute />, errorElement: <RouteError /> },
    {
      path: '/',
      element: (
        <RequireAuth>
          <ShellLayout />
        </RequireAuth>
      ),
      errorElement: <RouteError />,
      children: [
        { index: true, element: <HomeRedirect /> },
        sectionRoute('setup', 'tournaments/new'),
        ...global.map((s) => sectionRoute(s.id, s.path)),
        {
          path: 't/:tournamentId',
          element: <TournamentLayout />,
          children: [{ index: true, element: <Navigate to="overview" replace /> }, ...scoped.map((s) => sectionRoute(s.id, s.path))],
        },
        { path: '*', element: <NotFound /> },
      ],
    },
  ];
}
