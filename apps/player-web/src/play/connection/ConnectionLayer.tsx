import { useEffect, useRef, useState } from 'react';
import type { JpbClient } from '@jpb/client-sdk';
import { useGameState } from '@jpb/client-sdk/react';
import { ConnectionBanner, formatChips, useToast } from '@jpb/ui';
import { useNow } from '../../hooks/useNow';
import { bannerState } from './connectionState';

/**
 * "RECONNECTING… Your chips are safe." while the socket is down (the caller
 * greys out the live area), and a "CONNECTED · TABLE 37 · SEAT 4 · STACK
 * 12,450" toast once the authoritative snapshot is back.
 */
export function ConnectionLayer({ client }: { client: JpbClient }) {
  const connection = useGameState(client, (s) => s.connection);
  const synced = useGameState(client, (s) => s.synced);
  const self = useGameState(client, (s) => s.self);
  const everSynced = useRef(false);
  const wasDown = useRef(false);
  const [downSince, setDownSince] = useState<number | null>(null);
  const toast = useToast();
  const selfRef = useRef(self);
  selfRef.current = self;
  if (synced) everSynced.current = true;
  const state = bannerState(connection, synced, everSynced.current);
  const down = state === 'reconnecting' || state === 'offline';
  const now = useNow(1000, down);

  useEffect(() => {
    if (down) {
      wasDown.current = true;
      setDownSince((d) => d ?? Date.now());
      return;
    }
    setDownSince(null);
    if (state === 'connected' && wasDown.current && synced) {
      wasDown.current = false;
      const self = selfRef.current;
      const where = self && self.tableNumber !== null && self.seat !== null ? ` · TABLE ${self.tableNumber} · SEAT ${self.seat + 1}` : '';
      const stack = self && self.status !== 'ELIMINATED' ? ` · STACK ${formatChips(self.stack)}` : '';
      toast.push({ tone: 'success', title: 'CONNECTED', description: `Back in sync${where}${stack}`, durationMs: 5000 });
    }
  }, [down, state, synced, toast]);

  if (state === 'connected' || state === 'session-replaced') return null;
  const stale = downSince === null ? null : Math.max(0, Math.round((now - downSince) / 1000));
  return <ConnectionBanner state={state} staleForSeconds={stale} onRetry={() => client.connect()} className="pw-conn" />;
}
