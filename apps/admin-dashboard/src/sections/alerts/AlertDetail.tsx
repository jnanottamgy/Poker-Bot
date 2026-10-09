import { Link } from 'react-router';
import type { AlertDto } from '@jpb/shared-types';
import { Button, EmptyState, Icon, IconButton, StatusPill, cx } from '@jpb/ui';
import { sectionHref } from '../../app/sections';
import type { Gate } from '../../auth/permissions';
import { formatAgo, formatDateTime, formatDuration, formatTimeOfDay } from '../../lib/time';
import { SEVERITY_META, TAB_META, alertTab, codeInfo } from './model';
import { describeTarget } from './targets';
import type { AlertActions } from './useAlertActions';

export interface AlertDetailProps {
  alert: AlertDto | null;
  /** Tournament of this screen (links fall back to it for system-wide alerts). */
  tournamentId: string;
  now: number;
  manage: Gate;
  actions: AlertActions;
  adminName: (id: string | null) => string;
  onClose: () => void;
}

/** Right-hand pane: everything about one alert, what it means, what to do, and its controls. */
export function AlertDetail({ alert, tournamentId, now, manage, actions, adminName, onClose }: AlertDetailProps) {
  if (!alert) {
    return (
      <section className="acr-alerts-detail is-empty" aria-label="Alert details">
        <EmptyState icon="bell" title="Select an alert" description="Click a row (or press Enter on it) to see what it means, the recommended steps and its controls." />
      </section>
    );
  }
  const sev = SEVERITY_META[alert.severity];
  const info = codeInfo(alert.code);
  const tab = alertTab(alert);
  const own = alert.tournamentId ?? tournamentId;
  const target = describeTarget(alert.target, own, alert.message);
  const otherTournament = alert.tournamentId !== null && alert.tournamentId !== tournamentId;
  const openFor = (alert.resolvedAt ?? now) - alert.at;

  return (
    <section className={cx('acr-alerts-detail', `is-${alert.severity.toLowerCase()}`)} aria-label="Alert details">
      <header className="acr-alerts-detail__head">
        <div className="acr-alerts-detail__pills">
          <StatusPill tone={sev.tone} icon={sev.icon} label={sev.label} size="sm" />
          <StatusPill tone={tab === 'resolved' ? 'positive' : tab === 'acknowledged' ? 'info' : 'neutral'} icon={TAB_META[tab].icon} label={TAB_META[tab].label} size="sm" />
        </div>
        <IconButton icon="x" label="Close alert details" size="sm" onClick={onClose} />
      </header>
      <h3 className="acr-alerts-detail__title">{info.title}</h3>
      <p className="acr-alerts-detail__code jpb-mono">{alert.code}</p>
      <p className="acr-alerts-detail__msg">{alert.message}</p>

      {(target || otherTournament || alert.tournamentId === null) && (
        <div className="acr-alerts-detail__links">
          {target &&
            (target.href ? (
              <Link to={target.href} className="jpb-btn jpb-btn--secondary jpb-btn--sm acr-buttonlink">
                <Icon name={target.icon} className="jpb-btn__icon" />
                <span className="jpb-btn__label">Open {target.label.charAt(0).toLowerCase() + target.label.slice(1)}</span>
              </Link>
            ) : (
              <span className="acr-alerts-detail__target">
                <Icon name={target.icon} /> {target.label}
              </span>
            ))}
          {otherTournament && (
            <Link to={sectionHref('overview', alert.tournamentId)} className="acr-link">
              Tournament {alert.tournamentId}
            </Link>
          )}
          {alert.tournamentId === null && <span className="acr-alerts-detail__system">System-wide alert</span>}
        </div>
      )}

      {tab !== 'resolved' && (
        <div className="acr-alerts-detail__actions" role="group" aria-label="Alert controls">
          {tab === 'open' && (
            <Button variant="primary" size="sm" icon="check" disabled={!manage.allowed} title={manage.reason ?? undefined} onClick={() => void actions.acknowledge(alert)}>
              Acknowledge
            </Button>
          )}
          <Button variant="secondary" size="sm" icon="check-circle" disabled={!manage.allowed} title={manage.reason ?? undefined} onClick={() => void actions.resolve(alert)}>
            Resolve
          </Button>
          {!manage.allowed && (
            <span className="acr-alerts-detail__lock">
              <Icon name="lock" /> Requires {manage.lockedPermission}
            </span>
          )}
        </div>
      )}

      <ol className="acr-alerts-timeline" aria-label="Alert timeline">
        <li className="is-done">
          <Icon name={sev.icon} />
          <span>
            <strong>Raised</strong> {formatDateTime(alert.at)}
            <span className="acr-alerts-dim"> · {formatAgo(now - alert.at)}</span>
          </span>
        </li>
        <li className={alert.acknowledgedAt ? 'is-done' : 'is-pending'}>
          <Icon name="eye" />
          {alert.acknowledgedAt ? (
            <span>
              <strong>Acknowledged</strong> by {adminName(alert.acknowledgedBy)} at {formatTimeOfDay(alert.acknowledgedAt)}
              <span className="acr-alerts-dim"> · after {formatDuration(alert.acknowledgedAt - alert.at)}</span>
            </span>
          ) : (
            <span className="acr-alerts-dim">Not acknowledged yet</span>
          )}
        </li>
        <li className={alert.resolvedAt ? 'is-done' : 'is-pending'}>
          <Icon name="check-circle" />
          {alert.resolvedAt ? (
            <span>
              <strong>Resolved</strong> at {formatTimeOfDay(alert.resolvedAt)}
              <span className="acr-alerts-dim"> · open for {formatDuration(openFor)}</span>
            </span>
          ) : (
            <span className="acr-alerts-dim">Open for {formatDuration(openFor)}</span>
          )}
        </li>
      </ol>

      <div className="acr-alerts-detail__help">
        <h4>What it means</h4>
        <p>{info.description}</p>
        {info.steps.length > 0 && (
          <>
            <h4>Recommended steps</h4>
            <ol className="acr-alerts-steps">
              {info.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </>
        )}
      </div>
      <p className="acr-alerts-detail__id">
        Alert id <span className="jpb-mono">{alert.id}</span>
        {alert.target && (
          <>
            {' '}
            · target <span className="jpb-mono">{alert.target}</span>
          </>
        )}
      </p>
    </section>
  );
}
