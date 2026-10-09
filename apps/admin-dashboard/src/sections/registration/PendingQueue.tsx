import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { Paginated, PlayerListItemDto } from '@jpb/shared-types';
import { Button, DataTable, EmptyState, ErrorState, Icon, Panel, cx, formatCount } from '@jpb/ui';
import type { Column } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import { friendlyError } from '../../api/errors';
import { qk } from '../../api/query/keys';
import { useQuery } from '../../api/query/useQuery';
import type { PlayersQuery } from '../../api/types';
import { sectionHref } from '../../app/sections';
import { usePermission } from '../../auth/permissions';
import { useDangerousAction } from '../../danger/DangerProvider';
import { formatAgo, formatDateTime } from '../../lib/time';
import { BULK_APPROVE_MAX, useBulkApprove } from '../players/useBulkApprove';

export const QUEUE_PAGE_SIZE = 25;
const QUEUE_POLL_MS = 8_000;

/**
 * §2.9 pending approvals queue (oldest first, server-paginated): approve
 * (level 1) or reject with a reason (level 1, reason required); bulk
 * approval of the selected rows behind one confirmation.
 */
export function PendingQueue({ tournamentId, requireApproval, now }: { tournamentId: string; requireApproval: boolean; now: number }) {
  const api = useApi();
  const danger = useDangerousAction();
  const canApprove = usePermission('PLAYER_APPROVE_REGISTRATION');
  const bulk = useBulkApprove(tournamentId);
  const [page, setPage] = useState(0);
  const [checked, setChecked] = useState<string[]>([]);
  const q: PlayersQuery = { status: 'PENDING_APPROVAL', sort: 'registration', offset: page * QUEUE_PAGE_SIZE, limit: QUEUE_PAGE_SIZE };
  const list = useQuery<Paginated<PlayerListItemDto>>(qk.players(tournamentId, q), (s) => api.players.list(tournamentId, q, s), { pollMs: QUEUE_POLL_MS });
  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;

  // A page emptied by approvals falls back to the last page that has rows.
  useEffect(() => {
    if (list.data && rows.length === 0 && page > 0) setPage(Math.max(0, Math.ceil(total / QUEUE_PAGE_SIZE) - 1));
  }, [list.data, rows.length, page, total]);

  const nameOf = (id: string) => rows.find((r) => r.playerId === id)?.displayName ?? id;
  const approve = (targets: Array<{ playerId: string; displayName: string }>) =>
    void bulk.run(targets, (r) => setChecked((prev) => prev.filter((id) => !r.approved.includes(id))));
  const reject = (r: PlayerListItemDto) =>
    void danger({
      level: 1,
      endpoint: 'playerReject',
      title: `Reject ${r.displayName}`,
      summary: 'The registration is not accepted.',
      consequences: ['The registration is withdrawn and does not count toward the player limit', 'The player sees that the registration was not accepted', 'Your reason is written to the audit log'],
      reason: 'required',
      confirmLabel: 'Reject registration',
      tone: 'danger',
      run: ({ reason }) => api.players.reject(r.playerId, { reason }),
      success: `Registration of ${r.displayName} rejected`,
      invalidate: [qk.tournament(tournamentId)],
      onSuccess: () => setChecked((prev) => prev.filter((id) => id !== r.playerId)),
    });

  const columns: Column<PlayerListItemDto>[] = [
    { key: 'seq', header: '#', numeric: true, width: '64px', render: (r) => formatCount(r.registrationSeq) },
    {
      key: 'name',
      header: 'Player',
      render: (r) => (
        <span className="acr-cell-stack">
          <Link className="acr-registration-name" to={sectionHref('player-detail', tournamentId, { playerId: r.playerId })}>
            {r.displayName}
          </Link>
          {r.nickname && <span className="acr-cell-sub">“{r.nickname}”</span>}
        </span>
      ),
    },
    { key: 'pid', header: 'Public ID', width: '110px', render: (r) => <span className="jpb-mono acr-registration-pid">{r.publicId}</span> },
    { key: 'at', header: 'Registered', width: '110px', render: (r) => <span title={formatDateTime(r.registeredAt)}>{formatAgo(now - r.registeredAt)}</span> },
    ...(canApprove
      ? [
          {
            key: 'act',
            header: <span className="jpb-sr-only">Decision</span>,
            width: '210px',
            align: 'right' as const,
            render: (r: PlayerListItemDto) => (
              <span className="acr-registration-rowbtns">
                <Button size="sm" variant="secondary" icon="check" disabled={bulk.progress !== null} onClick={() => approve([{ playerId: r.playerId, displayName: r.displayName }])} aria-label={`Approve ${r.displayName}`}>
                  Approve
                </Button>
                <Button size="sm" variant="ghost" icon="x" disabled={bulk.progress !== null} onClick={() => reject(r)} aria-label={`Reject ${r.displayName}`}>
                  Reject
                </Button>
              </span>
            ),
          },
        ]
      : []),
  ];

  return (
    <Panel
      title={
        <span className="acr-registration-paneltitle">
          Pending approvals
          <span className={cx('acr-registration-badge', total > 0 && 'is-attn')}>{list.data ? formatCount(total) : '—'}</span>
        </span>
      }
      icon="clock"
      description={requireApproval ? 'Oldest first. Approved players count toward the limit and are seated at the start.' : 'Approval is not required for this tournament: registrations are approved automatically.'}
      flush
      className="acr-registration-pending"
    >
      {bulk.progress && (
        <p className="acr-registration-progress" aria-live="polite">
          <Icon name="refresh" /> Approving {formatCount(bulk.progress.done)} of {formatCount(bulk.progress.total)}…
        </p>
      )}
      {bulk.last && bulk.last.failed.length > 0 && (
        <ul className="acr-registration-failed" aria-label="Registrations that could not be approved">
          {bulk.last.failed.map((f) => (
            <li key={f.playerId}>
              <Icon name="warning" /> <strong>{f.displayName}</strong> — {f.message}
            </li>
          ))}
        </ul>
      )}
      {list.data === undefined && list.status === 'error' ? (
        <ErrorState title="Could not load the queue" description={friendlyError(list.error).description} onRetry={() => void list.refetch()} />
      ) : (
        <div className={list.isStale ? 'jpb-stale' : undefined}>
          <DataTable
            label="Pending registrations"
            columns={columns}
            rows={rows}
            rowKey={(r) => r.playerId}
            rowLabel={(r) => r.displayName}
            loading={list.isLoading}
            density="compact"
            {...(canApprove
              ? {
                  checkedKeys: checked,
                  onCheckedChange: (keys: string[]) => setChecked(keys.slice(0, BULK_APPROVE_MAX)),
                  bulkActions: (keys: string[]) => (
                    <Button size="sm" variant="primary" icon="check" disabled={bulk.progress !== null} onClick={() => approve(keys.map((id) => ({ playerId: id, displayName: nameOf(id) })))}>
                      Approve {formatCount(keys.length)}
                    </Button>
                  ),
                }
              : {})}
            empty={<EmptyState compact icon="check-circle" title="No registrations waiting" description={requireApproval ? 'New registrations appear here for approval.' : 'Players are approved automatically.'} />}
            pagination={total > QUEUE_PAGE_SIZE ? { page, pageSize: QUEUE_PAGE_SIZE, total, onPageChange: setPage } : undefined}
          />
        </div>
      )}
    </Panel>
  );
}
