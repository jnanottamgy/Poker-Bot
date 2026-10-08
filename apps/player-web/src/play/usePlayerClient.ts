import { useMemo } from 'react';
import { JpbClient } from '@jpb/client-sdk';
import type { ClientAudience } from '@jpb/shared-types';
import { useClientLifecycle } from '@jpb/client-sdk/react';
import { useBackend } from '../app/backend';

/**
 * One JpbClient per (tournament, audience) for the lifetime of the screen.
 * Connects on mount, reconnects when the tab becomes visible / the browser
 * comes back online, closes on unmount.
 */
export function useJpbClient(tournamentId: string, audience: ClientAudience): JpbClient {
  const backend = useBackend();
  const client = useMemo(
    () => new JpbClient({ url: backend.wsUrl, audience, tournamentId, socketFactory: backend.socketFactory }),
    [backend, audience, tournamentId],
  );
  useClientLifecycle(client);
  return client;
}
