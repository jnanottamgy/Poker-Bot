import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { ErrorState, Spinner } from '@jpb/ui';
import { LoginPage } from '../auth/LoginPage';
import { useSession } from '../auth/SessionProvider';

function FullPage({ children }: { children: ReactNode }) {
  return <div className="acr-fullpage">{children}</div>;
}

/** Routes below require a signed-in admin; otherwise → /login (remembering where to return). */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, retry } = useSession();
  const location = useLocation();
  if (status === 'loading') {
    return (
      <FullPage>
        <Spinner size="lg" label="Checking your session…" />
      </FullPage>
    );
  }
  if (status === 'unavailable') {
    return (
      <FullPage>
        <ErrorState title="Cannot reach the control room server" description="The server did not answer. Live tournaments keep running on the server; check the network and try again." onRetry={retry} />
      </FullPage>
    );
  }
  if (status === 'signedOut') {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
}

export function LoginRoute() {
  const { status } = useSession();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  if (status === 'signedIn') return <Navigate to={from && from !== '/login' ? from : '/'} replace />;
  if (status === 'loading') {
    return (
      <FullPage>
        <Spinner size="lg" label="Checking your session…" />
      </FullPage>
    );
  }
  return <LoginPage />;
}
