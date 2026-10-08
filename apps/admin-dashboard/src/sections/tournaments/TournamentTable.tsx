import { useNavigate } from 'react-router';
import type { TournamentListItemDto } from '@jpb/shared-types';
import { DataTable, TournamentStatusPill, formatCount } from '@jpb/ui';
import type { Column, DataTableProps } from '@jpb/ui';

type RowAction = ReturnType<NonNullable<DataTableProps<TournamentListItemDto>['rowActions']>>[number];
import { useApi } from '../../api/ApiProvider';
import { qk } from '../../api/query/keys';
import { sectionHref } from '../../app/sections';
import { usePermission } from '../../auth/permissions';
import { useDangerousAction } from '../../danger/DangerProvider';
import { formatDateTime } from '../../lib/time';

function useRowActions() {
  const api = useApi();
  const navigate = useNavigate();
  const danger = useDangerousAction();
  const canCreate = usePermission('TOURNAMENT_CREATE', null);
  return (t: TournamentListItemDto): RowAction[] => [
    { id: 'open', label: 'Open control room', icon: 'arrow-right', onSelect: () => navigate(sectionHref('overview', t.id)) },
    {
      id: 'clone',
      label: 'Clone configuration',
      icon: 'layers',
      disabled: !canCreate,
      disabledReason: 'Requires TOURNAMENT_CREATE',
      onSelect: () =>
        void danger({
          level: 0,
          endpoint: 'tournamentClone',
          title: 'Clone configuration',
          run: () => api.tournaments.clone(t.id),
          success: (r) => `Draft “${r.tournament.name}” created`,
          invalidate: [qk.tournamentsAll()],
          onSuccess: (r) => navigate(sectionHref('setup', r.tournament.id)),
        }),
    },
    'separator',
    {
      id: 'delete',
      label: 'Delete draft',
      icon: 'x-circle',
      danger: true,
      disabled: !canCreate || t.status !== 'DRAFT',
      disabledReason: t.status !== 'DRAFT' ? 'Only drafts can be deleted' : 'Requires TOURNAMENT_CREATE',
      onSelect: () =>
        void danger({
          level: 1,
          endpoint: 'tournamentDelete',
          title: `Delete “${t.name}”?`,
          summary: 'The draft and its configuration are removed. Nobody has registered yet.',
          confirmLabel: 'Delete draft',
          tone: 'danger',
          run: () => api.tournaments.remove(t.id),
          success: 'Draft deleted',
          invalidate: [qk.tournamentsAll()],
        }),
    },
  ];
}

export function TournamentTable({ rows, loading }: { rows: TournamentListItemDto[]; loading: boolean }) {
  const navigate = useNavigate();
  const rowActions = useRowActions();
  const columns: Column<TournamentListItemDto>[] = [
    {
      key: 'name',
      header: 'Tournament',
      sortValue: (r) => r.name.toLowerCase(),
      render: (r) => (
        <span className="acr-cell-stack">
          <span className="acr-cell-strong">
            {r.name}
            {r.isSimulation && <span className="acr-tag">SIM</span>}
          </span>
          <span className="acr-cell-sub jpb-mono">{r.joinCode}</span>
        </span>
      ),
    },
    { key: 'status', header: 'Status', sortValue: (r) => r.status, render: (r) => <TournamentStatusPill status={r.status} size="sm" /> },
    {
      key: 'players',
      header: 'Players',
      numeric: true,
      sortValue: (r) => r.registered,
      render: (r) =>
        r.startedAt ? (
          <span>
            {formatCount(r.active)} <span className="acr-cell-sub">/ {formatCount(r.registered)}</span>
          </span>
        ) : (
          `${formatCount(r.registered)} registered`
        ),
    },
    { key: 'tables', header: 'Tables', numeric: true, sortValue: (r) => r.tables, render: (r) => (r.tables ? formatCount(r.tables) : '—') },
    { key: 'started', header: 'Started', sortValue: (r) => r.startedAt ?? r.createdAt, render: (r) => (r.startedAt ? formatDateTime(r.startedAt) : <span className="acr-cell-sub">Created {formatDateTime(r.createdAt)}</span>) },
  ];
  return (
    <DataTable
      label="Tournaments"
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      rowLabel={(r) => r.name}
      loading={loading}
      onRowActivate={(r) => navigate(sectionHref('overview', r.id))}
      rowActions={rowActions}
      empty="No tournaments match these filters."
    />
  );
}
