import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import type { Paginated, PlayerListItemDto, TournamentPlayerStatus } from '@jpb/shared-types';
import { DataTable, EmptyState, ErrorState, Panel, SearchInput, Tabs, formatCount } from '@jpb/ui';
import type { Column } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import { friendlyError } from '../../api/errors';
import { qk } from '../../api/query/keys';
import { useQuery } from '../../api/query/useQuery';
import type { PlayersQuery } from '../../api/types';
import { sectionHref } from '../../app/sections';
import { ButtonLink } from '../../components/ButtonLink';
import { formatDateTime, formatTimeOfDay } from '../../lib/time';
import { MAX_SEARCH_LENGTH } from '../players/filters';
import { PlayerStatusPill } from '../players/pills';

export const REGISTERED_PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;
const LIST_POLL_MS = 15_000;

type View = 'all' | TournamentPlayerStatus;
const VIEWS: Array<{ id: View; label: string }> = [
  { id: 'all', label: 'Everyone' },
  { id: 'REGISTERED', label: 'Approved' },
  { id: 'PENDING_APPROVAL', label: 'Pending' },
  { id: 'WITHDRAWN', label: 'Withdrawn / rejected' },
];

/** §2.9 registered list: newest registrations, server-paginated, searchable; rows open the player. */
export function RegisteredList({ tournamentId }: { tournamentId: string }) {
  const api = useApi();
  const navigate = useNavigate();
  const [view, setView] = useState<View>('all');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text]);
  useEffect(() => setPage(0), [q, view]);

  const query: PlayersQuery = { ...(q ? { q } : {}), ...(view !== 'all' ? { status: view } : {}), sort: 'registration', offset: page * REGISTERED_PAGE_SIZE, limit: REGISTERED_PAGE_SIZE };
  const list = useQuery<Paginated<PlayerListItemDto>>(qk.players(tournamentId, query), (s) => api.players.list(tournamentId, query, s), { pollMs: LIST_POLL_MS });
  const total = list.data?.total ?? 0;

  const columns: Column<PlayerListItemDto>[] = [
    { key: 'seq', header: '#', numeric: true, width: '64px', render: (r) => formatCount(r.registrationSeq) },
    {
      key: 'name',
      header: 'Player',
      render: (r) => (
        <span className="acr-cell-stack">
          <span className="acr-cell-strong">{r.displayName}</span>
          {r.nickname && <span className="acr-cell-sub">“{r.nickname}”</span>}
        </span>
      ),
    },
    { key: 'pid', header: 'Public ID', width: '110px', render: (r) => <span className="jpb-mono acr-registration-pid">{r.publicId}</span> },
    { key: 'status', header: 'Status', width: '170px', render: (r) => <PlayerStatusPill status={r.status} /> },
    { key: 'at', header: 'Registered', width: '120px', render: (r) => <span title={formatDateTime(r.registeredAt)}>{formatTimeOfDay(r.registeredAt, false)}</span> },
  ];

  return (
    <Panel
      title="Registered players"
      icon="users"
      description="In registration order. Search runs on the server (name, nickname or public id)."
      actions={
        <ButtonLink to={`${sectionHref('players', tournamentId)}?sort=registration`} icon="users" variant="ghost">
          Open in Players
        </ButtonLink>
      }
      flush
    >
      <div className="acr-registration-listbar">
        <Tabs tabs={VIEWS.map((v) => ({ id: v.id, label: v.label }))} value={view} onChange={(v) => setView(v as View)} label="Which registrations" variant="segmented" />
        <SearchInput value={text} onChange={(v) => setText(v.slice(0, MAX_SEARCH_LENGTH))} label="Search registrations" placeholder="Name, nickname or JPN-…" resultSummary={list.data ? `${formatCount(total)} registrations` : undefined} className="acr-registration-listsearch" />
      </div>
      {list.data === undefined && list.status === 'error' ? (
        <ErrorState title="Could not load registrations" description={friendlyError(list.error).description} onRetry={() => void list.refetch()} />
      ) : (
        <div className={list.isStale ? 'jpb-stale' : undefined}>
          <DataTable
            label="Registered players"
            columns={columns}
            rows={list.data?.rows ?? []}
            rowKey={(r) => r.playerId}
            rowLabel={(r) => r.displayName}
            loading={list.isLoading}
            density="compact"
            onRowActivate={(r) => navigate(sectionHref('player-detail', tournamentId, { playerId: r.playerId }))}
            empty={<EmptyState compact icon="users" title={q ? 'Nobody matches this search' : 'No registrations yet'} description={q ? 'Try a public id (JPN-…) or another spelling.' : 'Share the QR code or the join link to get players in.'} />}
            pagination={{ page, pageSize: REGISTERED_PAGE_SIZE, total, onPageChange: setPage }}
          />
        </div>
      )}
    </Panel>
  );
}
