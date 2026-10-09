import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router';
import { configure, render } from '@testing-library/react';
import { vi } from 'vitest';
import { createMockBackend } from '../src/api/mock';
import type { MockBackend } from '../src/api/mock';
import { Providers } from '../src/app/App';
import { useSession } from '../src/auth/SessionProvider';
import { TournamentScopeProvider } from '../src/auth/scope';
import { LiveProvider } from '../src/live/LiveProvider';
import TablesSection from '../src/sections/tables';
import TableDetailSection from '../src/sections/table-detail';

/** Test harness for the table map (§2.5) and table detail (§2.6) on the in-memory mock backend. */

export const SPRING = 'trn_spring';

// Each test builds the full mock world (2,000 players, ~19k hands): give async UI and tests headroom on busy CI machines.
configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 30_000 });

function Scoped({ children }: { children: ReactNode }) {
  const { tournamentId = '' } = useParams();
  const { status } = useSession();
  if (status !== 'signedIn') return <p>signing in…</p>;
  return (
    <LiveProvider tournamentId={tournamentId}>
      <TournamentScopeProvider tournamentId={tournamentId}>{children}</TournamentScopeProvider>
    </LiveProvider>
  );
}

/** Exposes the router location to assertions (navigation, URL-backed filters). */
export const location: { current: { pathname: string; search: string } } = { current: { pathname: '', search: '' } };
function LocationProbe() {
  const l = useLocation();
  location.current = { pathname: l.pathname, search: l.search };
  return null;
}

export interface Rendered {
  mock: MockBackend;
}

export function renderAt(path: string, user = 'director'): Rendered {
  const mock = createMockBackend({ latencyMs: [0, 0], tickMs: 0, persistSession: false, signedInAs: user });
  render(
    <Providers backend={mock.backend}>
      <MemoryRouter initialEntries={[path]}>
        <LocationProbe />
        <Routes>
          <Route
            path="/t/:tournamentId/tables"
            element={
              <Scoped>
                <TablesSection />
              </Scoped>
            }
          />
          <Route
            path="/t/:tournamentId/tables/:tableId"
            element={
              <Scoped>
                <TableDetailSection />
              </Scoped>
            }
          />
          <Route path="*" element={<p>elsewhere</p>} />
        </Routes>
      </MemoryRouter>
    </Providers>,
  );
  return { mock };
}
