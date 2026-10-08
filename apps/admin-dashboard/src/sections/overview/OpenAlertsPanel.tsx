import { Link } from 'react-router';
import type { AlertDto } from '@jpb/shared-types';
import { Button, Icon, Panel } from '@jpb/ui';
import type { IconName } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import { qk } from '../../api/query/keys';
import { useQuery } from '../../api/query/useQuery';
import { sectionHref } from '../../app/sections';
import { useGate, usePermission } from '../../auth/permissions';
import { useDangerousAction } from '../../danger/DangerProvider';
import { formatAgo } from '../../lib/time';

const SEVERITY: Record<AlertDto['severity'], { icon: IconName; word: string }> = {
  CRITICAL: { icon: 'critical', word: 'Critical' },
  WARNING: { icon: 'warning', word: 'Warning' },
  INFO: { icon: 'info', word: 'Info' },
};

/** Link to the alert's target (table / player) when it has one. */
function targetHref(tournamentId: string, target: string | null): string | null {
  if (!target) return null;
  const [kind, id] = target.split(':');
  if (kind === 'table' && id) return sectionHref('table-detail', tournamentId, { tableId: id });
  if (kind === 'player' && id) return sectionHref('player-detail', tournamentId, { playerId: id });
  return null;
}

export function OpenAlertsPanel({ tournamentId, now }: { tournamentId: string; now: number }) {
  const api = useApi();
  const danger = useDangerousAction();
  const canView = usePermission('METRICS_VIEW');
  const ack = useGate('ALERTS_MANAGE');
  const q = { tournamentId, open: true, limit: 8 };
  const alerts = useQuery(qk.alerts(q), (s) => api.alerts.list(q, s), { enabled: canView, pollMs: 15_000 });
  const rows = (alerts.data?.alerts ?? []).slice().sort((a, b) => (a.severity === b.severity ? b.at - a.at : a.severity === 'CRITICAL' ? -1 : b.severity === 'CRITICAL' ? 1 : a.severity === 'WARNING' ? -1 : 1));

  const acknowledge = (a: AlertDto) =>
    void danger({
      level: 1,
      endpoint: 'alertAck',
      title: 'Acknowledge alert',
      summary: a.message,
      consequences: ['The alert stays open until resolved, marked as acknowledged by you'],
      reason: 'optional',
      confirmLabel: 'Acknowledge',
      run: ({ reason }) => api.alerts.ack(a.id, reason ? { reason } : {}),
      success: 'Alert acknowledged',
      invalidate: [qk.alertsAll(), qk.overview(tournamentId)],
    });

  return (
    <Panel
      title="Open alerts"
      icon="bell"
      tone={rows.some((a) => a.severity === 'CRITICAL') ? 'danger' : 'default'}
      actions={
        <Link to={sectionHref('alerts', tournamentId)} className="acr-link">
          View all
        </Link>
      }
    >
      {!canView ? (
        <p className="acr-muted">
          <Icon name="lock" /> Requires METRICS_VIEW
        </p>
      ) : rows.length === 0 ? (
        <p className="acr-allclear">
          <Icon name="check-circle" /> {alerts.isLoading ? 'Loading alerts…' : 'No open alerts — all clear.'}
        </p>
      ) : (
        <ul className="acr-alerts">
          {rows.map((a) => {
            const sev = SEVERITY[a.severity];
            const href = targetHref(tournamentId, a.target);
            return (
              <li key={a.id} className={`acr-alerts__item is-${a.severity.toLowerCase()}`}>
                <Icon name={sev.icon} className="acr-alerts__icon" />
                <div className="acr-alerts__body">
                  <p className="acr-alerts__line">
                    <span className="acr-alerts__sev">{sev.word}</span>
                    <span className="jpb-mono acr-alerts__code">{a.code}</span>
                  </p>
                  <p className="acr-alerts__msg">{a.message}</p>
                  <p className="acr-alerts__meta">
                    {formatAgo(now - a.at)}
                    {a.acknowledgedAt ? ' · acknowledged' : ''}
                  </p>
                </div>
                <div className="acr-alerts__actions">
                  {href && (
                    <Link to={href} className="acr-link">
                      Open
                    </Link>
                  )}
                  {!a.acknowledgedAt && (
                    <Button size="sm" variant="ghost" onClick={() => acknowledge(a)} disabled={!ack.allowed} title={ack.reason ?? undefined}>
                      Acknowledge
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
