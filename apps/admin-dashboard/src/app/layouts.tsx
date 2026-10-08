import { Suspense, useEffect } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';
import { Navigate, Outlet, useLocation, useParams } from 'react-router';
import { EmptyState, Skeleton } from '@jpb/ui';
import { useSession } from '../auth/SessionProvider';
import { TournamentScopeProvider, inTournamentScope } from '../auth/scope';
import { LiveProvider } from '../live/LiveProvider';
import { ControlRoomShell } from '../shell/ControlRoomShell';
import { ErrorBoundary } from './ErrorBoundary';
import { readLastTournament, writeLastTournament } from './lastTournament';
import type { SectionId } from './sections';

/**
 * Shell for every signed-in screen. The "current tournament" is the one in
 * the URL (/t/:tournamentId/…) or, on global screens, the last one opened —
 * so the top bar keeps showing live status while you visit Admin Users etc.
 */
export function ShellLayout() {
  const { tournamentId: fromRoute } = useParams();
  const { me } = useSession();
  const remembered = readLastTournament();
  const current = fromRoute ?? (remembered && inTournamentScope(me, remembered) ? remembered : null);

  useEffect(() => {
    if (fromRoute && inTournamentScope(me, fromRoute)) writeLastTournament(fromRoute);
  }, [fromRoute, me]);

  const shell = (
    <TournamentScopeProvider tournamentId={current}>
      <ControlRoomShell tournamentId={current}>
        <Outlet />
      </ControlRoomShell>
    </TournamentScopeProvider>
  );
  return current && inTournamentScope(me, current) ? (
    <LiveProvider key={current} tournamentId={current}>
      {shell}
    </LiveProvider>
  ) : (
    shell
  );
}

/** /t/:tournamentId — refuses tournaments outside the admin's scope (the server does too). */
export function TournamentLayout() {
  const { tournamentId } = useParams();
  const { me } = useSession();
  if (!tournamentId || !inTournamentScope(me, tournamentId)) {
    return <EmptyState icon="lock" title="You are not assigned to this tournament" description="Ask a super admin to add it to your tournament scope." />;
  }
  return <Outlet />;
}

function SectionFallback() {
  return (
    <div className="acr-page" aria-hidden="true">
      <Skeleton width="30%" height={28} />
      <div className="acr-skeleton-grid">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} shape="block" height={104} />
        ))}
      </div>
      <Skeleton shape="block" height={260} />
    </div>
  );
}

/** Lazy section with its own loading state and error boundary (one broken section never takes down the shell). */
export function SectionOutlet({ section, component: Component }: { section: SectionId; component: LazyExoticComponent<ComponentType> }) {
  const location = useLocation();
  return (
    <ErrorBoundary scope="section" resetKey={location.pathname}>
      <Suspense fallback={<SectionFallback />}>
        <Component key={section} />
      </Suspense>
    </ErrorBoundary>
  );
}

/** "/" → the last tournament's overview, else the tournament list. */
export function HomeRedirect() {
  const { me } = useSession();
  const last = readLastTournament();
  if (last && inTournamentScope(me, last)) return <Navigate to={`/t/${encodeURIComponent(last)}/overview`} replace />;
  return <Navigate to="/tournaments" replace />;
}
