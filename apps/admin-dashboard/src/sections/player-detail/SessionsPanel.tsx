import type { PlayerDetailDto, SessionDto } from '@jpb/shared-types';
import { Icon, Panel, StatusPill, formatCount } from '@jpb/ui';
import { formatAgo, formatDateTime, formatTimeOfDay } from '../../lib/time';
import { shortUserAgent } from '../players/model';

type SessionState = 'controller' | 'active' | 'revoked' | 'expired';

function stateOf(s: SessionDto, now: number): SessionState {
  if (s.revokedAt !== null) return 'revoked';
  if (s.expiresAt <= now) return 'expired';
  return s.isController ? 'controller' : 'active';
}

const STATE_META = {
  controller: { label: 'Controller', tone: 'positive', icon: 'monitor' },
  active: { label: 'Active', tone: 'info', icon: 'check-circle' },
  revoked: { label: 'Revoked', tone: 'danger', icon: 'ban' },
  expired: { label: 'Expired', tone: 'neutral', icon: 'clock' },
} as const;

const REVOKE_REASON: Readonly<Record<string, string>> = {
  REVOKED_BY_ADMIN: 'Signed out by an admin',
  LOGOUT: 'Player signed out',
};

/** §2.8 "Connection": controller device and every session (created, last seen, IP, user agent, revoke reason). */
export function SessionsPanel({ p, now }: { p: PlayerDetailDto; now: number }) {
  const sessions = [...p.sessions].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  const active = sessions.filter((s) => stateOf(s, now) === 'controller' || stateOf(s, now) === 'active');
  // The server may not flag the controller socket on sessions: fall back to the most recently seen active one.
  const flagged = sessions.find((s) => stateOf(s, now) === 'controller') ?? null;
  const controller = flagged ?? active[0] ?? null;
  return (
    <Panel
      title="Connection & sessions"
      icon="wifi"
      description={`${formatCount(active.length)} active of ${formatCount(sessions.length)} session${sessions.length === 1 ? '' : 's'} (a new session is created each time the player signs in or rejoins).`}
      flush
    >
      {controller && (
        <p className="acr-player-detail-controller">
          <Icon name="monitor" /> {flagged ? 'Controller device' : 'Most recent device'}: <strong>{shortUserAgent(controller.userAgent)}</strong>
          <span className="acr-player-detail-muted"> · {controller.ip ?? 'IP unknown'} · seen {formatAgo(now - controller.lastSeenAt)}</span>
        </p>
      )}
      {sessions.length === 0 ? (
        <p className="acr-player-detail-empty">
          <Icon name="info" /> No sessions yet — the player has not signed in on any device.
        </p>
      ) : (
        <div className="acr-player-detail-tablewrap" role="region" aria-label="Sessions (scrollable)" tabIndex={0}>
          <table className="acr-player-detail-table">
            <thead>
              <tr>
                <th scope="col">Device</th>
                <th scope="col">State</th>
                <th scope="col">IP</th>
                <th scope="col">Created</th>
                <th scope="col">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => {
                const st = stateOf(s, now);
                const m = STATE_META[st];
                return (
                  <tr key={s.id}>
                    <td title={s.userAgent ?? undefined}>
                      <span className="acr-player-detail-cellmain">{shortUserAgent(s.userAgent)}</span>
                      <span className="acr-player-detail-cellsub jpb-mono">{s.id}</span>
                    </td>
                    <td>
                      <StatusPill size="sm" tone={m.tone} icon={m.icon} label={m.label} />
                      {st === 'revoked' && (
                        <span className="acr-player-detail-cellsub">
                          {REVOKE_REASON[s.revokedReason ?? ''] ?? s.revokedReason ?? 'Revoked'}
                          {s.revokedAt !== null ? ` · ${formatTimeOfDay(s.revokedAt, false)}` : ''}
                        </span>
                      )}
                    </td>
                    <td className="jpb-mono">{s.ip ?? '—'}</td>
                    <td title={formatDateTime(s.createdAt)}>{formatTimeOfDay(s.createdAt, false)}</td>
                    <td title={formatDateTime(s.lastSeenAt)}>{formatAgo(now - s.lastSeenAt)}</td>
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
