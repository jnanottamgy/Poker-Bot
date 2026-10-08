import { useMemo, useState } from 'react';
import { ActivityFeed, Panel, Tabs } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import { qk } from '../../api/query/keys';
import { useQuery } from '../../api/query/useQuery';
import { usePermission } from '../../auth/permissions';
import { auditToFeed, eventToFeed } from '../../live/feed';
import type { FeedEntry, FeedKind } from '../../live/feed';
import { useLiveEvents } from '../../live/hooks';

type Filter = 'all' | 'elimination' | 'move' | 'milestone' | 'admin';
const MATCH: Record<Filter, (k: FeedKind) => boolean> = {
  all: () => true,
  elimination: (k) => k === 'elimination',
  move: (k) => k === 'move' || k === 'table',
  milestone: (k) => k === 'milestone' || k === 'clock',
  admin: (k) => k === 'admin' || k === 'integrity',
};
const MAX = 40;

/** Live feed: eliminations, moves, table breaks, milestones (socket) + admin actions (audit log). */
export function LiveFeedPanel({ tournamentId }: { tournamentId: string }) {
  const api = useApi();
  const events = useLiveEvents();
  const canAudit = usePermission('AUDIT_VIEW');
  const aq = { tournamentId, limit: 15 };
  const audit = useQuery(qk.audit(aq), (s) => api.audit.list(aq, s), { enabled: canAudit, pollMs: 20_000 });
  const [filter, setFilter] = useState<Filter>('all');

  const entries = useMemo(() => {
    const live = events.map(eventToFeed).filter((e): e is FeedEntry => e !== null);
    const admin = (audit.data?.entries ?? []).map(auditToFeed);
    return [...live, ...admin].sort((a, b) => b.at - a.at);
  }, [events, audit.data]);
  const shown = entries.filter((e) => MATCH[filter](e.kind)).slice(0, MAX);

  return (
    <Panel title="Live feed" icon="activity" description="Newest first · eliminations, moves, milestones and admin actions" flush>
      <div className="acr-feed-tabs">
        <Tabs
          label="Filter the live feed"
          variant="segmented"
          value={filter}
          onChange={(v) => setFilter(v as Filter)}
          tabs={[
            { id: 'all', label: 'All' },
            { id: 'elimination', label: 'Busts' },
            { id: 'move', label: 'Moves' },
            { id: 'milestone', label: 'Clock & milestones' },
            { id: 'admin', label: 'Admin' },
          ]}
        />
      </div>
      <div className="acr-feed" aria-live="off">
        <ActivityFeed entries={shown} label="Live tournament feed" empty="Waiting for the first live events…" />
      </div>
    </Panel>
  );
}
