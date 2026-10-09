import { Link } from 'react-router';
import type { AuditEntryDto } from '@jpb/shared-types';
import { Badge, Button, EmptyState, Icon, IconButton } from '@jpb/ui';
import { sectionHref } from '../../app/sections';
import { formatDateTime } from '../../lib/time';
import { describeTarget } from '../alerts/targets';
import { DiffViewer } from './DiffViewer';
import { GROUP_ICON, actionInfo } from './model';
import type { AuditFilters } from './model';

export interface EntryDetailProps {
  entry: AuditEntryDto | null;
  tournamentId: string;
  adminName: (id: string | null) => string;
  /** The entry is the first broken link of the last chain verification. */
  broken: boolean;
  onFilter: (patch: Partial<AuditFilters>) => void;
  onClose: () => void;
}

/** One audit entry: who, when, what, target, reason, before → after and its hash-chain link. */
export function EntryDetail({ entry, tournamentId, adminName, broken, onFilter, onClose }: EntryDetailProps) {
  if (!entry) {
    return (
      <section className="acr-audit-detail is-empty" aria-label="Audit entry">
        <EmptyState icon="file" title="Select an entry" description="Click a row (or press Enter on it) to see the reason, the before → after change and its hash-chain link." />
      </section>
    );
  }
  const info = actionInfo(entry.action);
  const target = describeTarget(entry.target, entry.tournamentId ?? tournamentId);
  return (
    <section className="acr-audit-detail" aria-label="Audit entry">
      <header className="acr-audit-detail__head">
        <div className="acr-audit-detail__titles">
          <p className="acr-audit-detail__eyebrow">
            <Icon name={GROUP_ICON[info.group]} /> {info.group} · entry <span className="jpb-num">#{entry.seq}</span>
          </p>
          <h3 className="acr-audit-detail__title">
            {info.label}
            {info.danger && (
              <Badge tone="danger" srLabel="Danger level 2 action">
                L2
              </Badge>
            )}
          </h3>
          <p className="jpb-mono acr-audit-detail__code">{entry.action}</p>
        </div>
        <IconButton icon="x" label="Close entry" size="sm" onClick={onClose} />
      </header>

      {broken && (
        <p className="acr-audit-detail__broken" role="alert">
          <Icon name="critical" /> The hash chain breaks at this entry: its previous-hash does not match the entry before it. The log may have been altered here.
        </p>
      )}

      <dl className="acr-audit-kv">
        <div>
          <dt>When</dt>
          <dd>
            {formatDateTime(entry.at)}
            <span className="acr-audit-dim jpb-mono acr-audit-kv__sub">{new Date(entry.at).toISOString()}</span>
          </dd>
        </div>
        <div>
          <dt>Admin</dt>
          <dd>
            {entry.adminUsername}
            <span className="acr-audit-dim acr-audit-kv__sub">{entry.adminId ? adminName(entry.adminId) : 'Automatic (system)'}</span>
          </dd>
        </div>
        <div>
          <dt>Target</dt>
          <dd>
            {target?.href ? (
              <Link to={target.href} className="acr-link">
                {target.label}
              </Link>
            ) : (
              target?.label ?? entry.target
            )}
            <span className="acr-audit-dim jpb-mono acr-audit-kv__sub">{entry.target}</span>
          </dd>
        </div>
        <div>
          <dt>Reason</dt>
          <dd>{entry.reason ? <q className="acr-audit-detail__reason">{entry.reason}</q> : <span className="acr-audit-dim">No reason given</span>}</dd>
        </div>
        <div>
          <dt>Tournament</dt>
          <dd>
            {entry.tournamentId ? (
              <Link to={sectionHref('overview', entry.tournamentId)} className="acr-link jpb-mono">
                {entry.tournamentId}
              </Link>
            ) : (
              <span className="acr-audit-dim">Not tournament-specific</span>
            )}
          </dd>
        </div>
        <div>
          <dt>IP address</dt>
          <dd className="jpb-mono">{entry.ip ?? <span className="acr-audit-dim">unknown</span>}</dd>
        </div>
      </dl>

      <div className="acr-audit-detail__filters" role="group" aria-label="Filter the log by this entry">
        {entry.adminId && (
          <Button size="sm" variant="ghost" icon="user" onClick={() => onFilter({ adminId: entry.adminId ?? '' })}>
            Only {entry.adminUsername}
          </Button>
        )}
        <Button size="sm" variant="ghost" icon="list" onClick={() => onFilter({ action: entry.action })}>
          Only this action
        </Button>
        {entry.target && entry.target.includes(':') && (
          <Button size="sm" variant="ghost" icon="search" onClick={() => onFilter({ target: entry.target })}>
            Only this target
          </Button>
        )}
      </div>

      <div className="acr-audit-detail__section">
        <h4>Before → after</h4>
        <DiffViewer before={entry.beforeState} after={entry.afterState} />
      </div>

      <div className="acr-audit-detail__section">
        <h4>Hash chain</h4>
        <dl className="acr-audit-hashes">
          <div>
            <dt>Previous hash</dt>
            <dd className="jpb-mono">{entry.prevHash}</dd>
          </div>
          <div>
            <dt>This entry</dt>
            <dd className="jpb-mono">{entry.hash}</dd>
          </div>
        </dl>
        <p className="acr-audit-dim acr-audit-detail__note">Each hash covers the previous one, so changing any earlier entry breaks every hash after it. Use “Verify chain” to re-check the whole log on the server.</p>
      </div>
    </section>
  );
}
