import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, ErrorState, SearchInput, Tabs, Toggle } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import { friendlyError } from '../../api/errors';
import { qk } from '../../api/query/keys';
import { useQuery } from '../../api/query/useQuery';
import { NEW_TOURNAMENT_PATH } from '../../app/sections';
import { Can } from '../../auth/permissions';
import { PageHeader } from '../../components/PageHeader';
import { LiveNow } from './LiveNow';
import { GROUP_LABELS, STATUS_GROUPS, inGroup } from './statusGroups';
import type { StatusGroup } from './statusGroups';
import { TournamentTable } from './TournamentTable';

const POLL_MS = 20_000;
/** Default order: in play first, then registration, drafts, finished; newest first within a status. */
const STATUS_ORDER = ['RUNNING', 'FINAL_TABLE', 'BREAK', 'PAUSED', 'STARTING', 'REGISTRATION', 'REGISTRATION_CLOSED', 'DRAFT', 'COMPLETED', 'CANCELLED'];

/** §2.1 Tournaments: live-now cards, status filter, simulations toggle, search, create / clone / delete draft. */
export default function TournamentsSection() {
  const api = useApi();
  const navigate = useNavigate();
  const [group, setGroup] = useState<StatusGroup>('all');
  const [sims, setSims] = useState(false);
  const [search, setSearch] = useState('');
  const list = useQuery(qk.tournaments({ simulations: sims }), (s) => api.tournaments.list({ simulations: sims }, s), { pollMs: POLL_MS });

  const all = list.data?.tournaments ?? [];
  const filtered = useMemo(() => {
    const f = search.trim().toLowerCase();
    return all
      .filter((t) => inGroup(t.status, group) && (!f || t.name.toLowerCase().includes(f) || t.joinCode.toLowerCase().includes(f)))
      .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || b.createdAt - a.createdAt);
  }, [all, group, search]);
  const live = all.filter((t) => STATUS_GROUPS.live.includes(t.status));
  const counts = (g: StatusGroup) => all.filter((t) => inGroup(t.status, g)).length;

  return (
    <div className="acr-page">
      <PageHeader
        title="Tournaments"
        icon="layers"
        description="Every tournament you can access. Open one to enter its control room."
        actions={
          <Can permission="TOURNAMENT_CREATE" tournamentId={null}>
            <Button variant="primary" icon="plus" onClick={() => navigate(NEW_TOURNAMENT_PATH)}>
              New tournament
            </Button>
          </Can>
        }
      />
      {list.error !== null && list.data === undefined ? (
        <ErrorState title="Could not load tournaments" description={friendlyError(list.error).description} onRetry={() => void list.refetch()} />
      ) : (
        <>
          <LiveNow rows={live} now={list.updatedAt || 0} />
          <div className="acr-toolbar">
            <Tabs
              label="Status"
              variant="segmented"
              value={group}
              onChange={(v) => setGroup(v as StatusGroup)}
              tabs={(Object.keys(GROUP_LABELS) as StatusGroup[]).map((g) => ({ id: g, label: GROUP_LABELS[g], count: counts(g) }))}
            />
            <div className="acr-toolbar__right">
              <Toggle checked={sims} onChange={setSims} label="Include simulations" />
              <SearchInput value={search} onChange={setSearch} label="Search tournaments" placeholder="Name or join code" resultSummary={`${filtered.length} tournaments`} />
            </div>
          </div>
          <TournamentTable rows={filtered} loading={list.isLoading} />
        </>
      )}
    </div>
  );
}
