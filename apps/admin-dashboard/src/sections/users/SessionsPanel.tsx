import type { AdminUserDto } from '@jpb/shared-types';
import { Button, EmptyState, ErrorState, Icon, Panel, Skeleton, cx, formatCount } from '@jpb/ui';
import { friendlyError } from '../../api/errors';
import type { UseQueryResult } from '../../api/query/useQuery';
import type { SessionsResponse } from '../../api/types';
import { formatAgo, formatDateTime, formatDuration } from '../../lib/time';
import { deviceLabel } from './model';
import type { UserActions } from './useUserActions';

export interface SessionsPanelProps {
  sessions: UseQueryResult<SessionsResponse>;
  users: readonly AdminUserDto[];
  meId: string | null;
  now: number;
  actions: UserActions;
  /** Show only this admin's sessions. */
  filterAdminId: string | null;
  onClearFilter: () => void;
}

/** Active admin sessions (devices signed in to the control room) with revoke. */
export function SessionsPanel({ sessions, users, meId, now, actions, filterAdminId, onClearFilter }: SessionsPanelProps) {
  const all = sessions.data?.sessions ?? [];
  const rows = (filterAdminId ? all.filter((s) => s.adminId === filterAdminId) : all).slice().sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  const userOf = (id: string) => users.find((u) => u.id === id);
  const filterUser = filterAdminId ? userOf(filterAdminId) : undefined;

  return (
    <Panel
      flush
      title="Active sessions"
      icon="key"
      className={cx('acr-users-sessions', sessions.isStale && 'jpb-stale')}
      description={filterAdminId ? `${formatCount(rows.length)} of ${formatCount(all.length)} · ${filterUser?.displayName ?? filterAdminId}` : `${formatCount(all.length)} signed-in ${all.length === 1 ? 'device' : 'devices'} across all admins`}
      actions={
        <span className="acr-users-panelactions">
          {filterAdminId && (
            <Button size="sm" variant="ghost" icon="x" onClick={onClearFilter}>
              Show all
            </Button>
          )}
          <Button size="sm" variant="ghost" icon="refresh" onClick={() => void sessions.refetch()}>
            Refresh
          </Button>
        </span>
      }
    >
      {sessions.isLoading ? (
        <div className="acr-users-pad" aria-busy="true" aria-label="Loading sessions">
          <Skeleton lines={4} />
        </div>
      ) : !sessions.data ? (
        <ErrorState title="Could not load the sessions" description={friendlyError(sessions.error).description} onRetry={() => void sessions.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState compact icon="key" title="No active sessions" description={filterAdminId ? 'This admin is not signed in anywhere.' : 'Nobody is signed in.'} />
      ) : (
        <div className="acr-users-tablewrap" tabIndex={0} role="region" aria-label="Active sessions (scrollable)">
          <table className="acr-users-table" aria-label="Active sessions">
            <thead>
              <tr>
                <th scope="col">Admin</th>
                <th scope="col">Device</th>
                <th scope="col">IP address</th>
                <th scope="col">Signed in</th>
                <th scope="col">Last seen</th>
                <th scope="col">Expires</th>
                <th scope="col">
                  <span className="jpb-sr-only">Revoke</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const u = userOf(s.adminId);
                const own = s.adminId === meId;
                const who = u ? u.displayName : s.adminId;
                return (
                  <tr key={s.id} className={cx(own && 'is-own')}>
                    <th scope="row">
                      <span className="acr-users-who">
                        <span>{who}</span>
                        <span className="acr-users-dim">
                          {u ? u.username : 'unknown admin'}
                          {own && <span className="acr-tag">YOU</span>}
                        </span>
                      </span>
                    </th>
                    <td title={s.userAgent ?? undefined}>
                      <Icon name="monitor" /> {deviceLabel(s.userAgent)}
                    </td>
                    <td className="jpb-mono">{s.ip ?? '—'}</td>
                    <td className="jpb-num" title={formatDateTime(s.createdAt)}>
                      {formatAgo(now - s.createdAt)}
                    </td>
                    <td className="jpb-num">{formatAgo(now - s.lastSeenAt)}</td>
                    <td className="jpb-num" title={formatDateTime(s.expiresAt)}>
                      {s.expiresAt > now ? `in ${formatDuration(s.expiresAt - now)}` : 'expired'}
                    </td>
                    <td className="is-action">
                      <Button size="sm" variant="danger-outline" icon="log-out" onClick={() => void actions.revokeSession(s, who, own)} aria-label={`Revoke session of ${who} on ${deviceLabel(s.userAgent)}`}>
                        Revoke
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
