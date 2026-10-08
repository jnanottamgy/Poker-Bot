import { isRouteErrorResponse, useRouteError } from 'react-router';
import { ErrorState } from '@jpb/ui';
import { BASENAME } from '../env';
import { errorReference } from './errorReference';

/** Router-level error screen: friendly copy, never a stack trace. */
export function RouteError() {
  const error = useRouteError();
  const ref = errorReference();
  if (isRouteErrorResponse(error) && error.status === 404) {
    return (
      <div className="acr-fullpage">
        <ErrorState title="Page not found" description="This address does not exist in the control room." onRetry={() => window.location.assign(`${BASENAME}/`)} retryLabel="Go to tournaments" />
      </div>
    );
  }
  const chunk = error instanceof Error && /dynamically imported module|Failed to fetch|Importing a module script failed/i.test(error.message);
  console.error('[control room] route error', ref, error);
  return (
    <div className="acr-fullpage">
      <ErrorState
        title={chunk ? 'A new version of the control room is available' : 'This screen hit a problem'}
        description={chunk ? 'Reload to get the latest version. Tournaments keep running on the server.' : 'Reload to try again. Tournaments keep running on the server; nothing was changed by this error.'}
        onRetry={() => window.location.reload()}
        retryLabel="Reload"
        reference={ref}
      />
    </div>
  );
}
