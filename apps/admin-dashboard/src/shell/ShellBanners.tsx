import { useEffect, useState } from 'react';
import { Alert, Button } from '@jpb/ui';
import { usePermission } from '../auth/permissions';
import type { TournamentControls } from '../danger/useTournamentControls';
import type { ConnectionInfo } from '../live/hooks';
import { formatAgo } from '../lib/time';

/** True once `flag` has stayed true for `ms` (avoids flashing "reconnecting" during the first connect). */
export function useSustained(flag: boolean, ms: number): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!flag) {
      setOn(false);
      return undefined;
    }
    const t = setTimeout(() => setOn(true), ms);
    return () => clearTimeout(t);
  }, [flag, ms]);
  return on;
}

/** "Last update 12s ago", re-rendered every second while shown. */
function useAgo(since: number | null): string | null {
  const [, tick] = useState(0);
  useEffect(() => {
    if (since === null) return undefined;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [since]);
  return since === null ? null : formatAgo(Date.now() - since);
}

export interface ShellBannersProps {
  tournamentId: string | null;
  frozen: boolean;
  stale: boolean;
  conn: ConnectionInfo;
  lastLiveAt: number | null;
  controls: TournamentControls;
}

/** Global strips above the content: EMERGENCY FREEZE ACTIVE and "not live" (reconnecting) notices. */
export function ShellBanners({ tournamentId, frozen, stale, conn, lastLiveAt, controls }: ShellBannersProps) {
  const canFreeze = usePermission('TOURNAMENT_FREEZE', tournamentId);
  const ago = useAgo(stale ? lastLiveAt : null);
  if (!tournamentId) return null;
  const items = [];
  if (frozen) {
    items.push(
      <Alert
        key="frozen"
        severity="CRITICAL"
        title="EMERGENCY FREEZE ACTIVE — no actions or timers are processed on any table"
        meta="Players see “Tournament frozen by the director”. Remaining action time is preserved."
        actions={
          canFreeze ? (
            <Button size="sm" variant="danger" icon="play" onClick={() => void controls.unfreeze()}>
              Lift freeze…
            </Button>
          ) : undefined
        }
      />,
    );
  }
  if (stale) {
    const offline = conn.status === 'closed' || conn.status === 'replaced';
    items.push(
      <Alert key="stale" severity="WARNING" title={offline ? 'Live updates are offline' : 'Reconnecting to live updates…'} meta={`Figures below are greyed and NOT live${ago ? ` — last update ${ago}` : ''}. The tournament keeps running on the server.`} />,
    );
  }
  if (items.length === 0) return null;
  return <div className="acr-banners">{items}</div>;
}
