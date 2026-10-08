import type { ConnectionStatus } from '@jpb/client-sdk';
import type { ConnectionState } from '@jpb/ui';

/**
 * Banner state from the socket status. Data is "live" only while the socket
 * is open AND an authoritative snapshot arrived on it.
 */
export function bannerState(connection: ConnectionStatus, synced: boolean, everSynced: boolean): ConnectionState {
  if (connection === 'replaced') return 'session-replaced';
  if (connection === 'closed') return 'offline';
  if (connection === 'open' && synced) return 'connected';
  // First connection: the "connecting" screen covers it; afterwards it is a reconnect.
  return everSynced ? 'reconnecting' : 'connected';
}

export function isLive(connection: ConnectionStatus, synced: boolean): boolean {
  return connection === 'open' && synced;
}
