import { useEffect, useSyncExternalStore } from 'react';
import type { AdminTableView, TournamentEventEnvelope, TournamentPublicSummary } from '@jpb/shared-types';
import type { ConnectionStatus, GameState } from '@jpb/client-sdk';
import { useLive, useLiveClient, useOptionalLiveClient } from './LiveProvider';

export interface ConnectionInfo {
  status: ConnectionStatus | 'none';
  /** Open AND an authoritative snapshot arrived on this connection: data may be shown as live. */
  live: boolean;
  /** Server clock offset estimate for cosmetic countdowns. */
  offsetMs: number;
  rttMs: number | null;
}

const NO_CONNECTION: ConnectionInfo = { status: 'none', live: false, offsetMs: 0, rttMs: null };
const noopSubscribe = () => () => undefined;

function useOptionalState(): GameState | null {
  const client = useOptionalLiveClient();
  return useSyncExternalStore(client ? client.store.subscribe : noopSubscribe, () => (client ? client.store.getState() : null));
}

/** Connection health; works outside a tournament route too (status 'none'). */
export function useConnection(): ConnectionInfo {
  const s = useOptionalState();
  if (!s) return NO_CONNECTION;
  return { status: s.connection, live: s.connection === 'open' && s.synced, offsetMs: s.serverOffsetMs, rttMs: s.rttMs };
}

/** Latest authoritative tournament summary from the socket (null until the first snapshot). */
export function useLiveSummary(): TournamentPublicSummary | null {
  return useOptionalState()?.tournament ?? null;
}

/** Tournament events received on this connection (bounded, oldest first). */
export function useLiveEvents(): TournamentEventEnvelope[] {
  return useLive((s) => s.tournamentEvents);
}

/**
 * Watch one table live (admin view). Only one table is watched per
 * connection; the latest `table_update` view is returned as-is.
 */
export function useWatchedTable(tableId: string | null): AdminTableView | null {
  const client = useLiveClient();
  useEffect(() => {
    client.watch(tableId);
    return () => client.watch(null);
  }, [client, tableId]);
  return useLive((s) => (s.table && s.table.tableId === tableId && s.table.audience === 'ADMIN' ? s.table : null));
}
