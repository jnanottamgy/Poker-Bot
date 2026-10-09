import type { ReactNode } from 'react';
import type { AdminTableView, TableInternalsDto, TableListItemDto } from '@jpb/shared-types';
import { Icon, Panel, cx, formatChips, formatChipsDelta, formatCount } from '@jpb/ui';
import { formatTimeOfDay } from '../../lib/time';
import { formatElapsed } from '../tables/hooks';

/** A command queue longer than this is shown as a warning (the actor is falling behind). */
export const QUEUE_WARN_LENGTH = 3;

export interface InternalsPanelProps {
  internals: TableInternalsDto | null;
  view: AdminTableView;
  row: TableListItemDto | null;
  serverNow: number;
  fetchedAt: number;
}

function Row({ label, children, tone, mono = true }: { label: string; children: ReactNode; tone?: 'ok' | 'warn' | 'bad'; mono?: boolean }) {
  return (
    <div className={cx('acr-td-int__row', tone && `is-${tone}`)}>
      <dt>{label}</dt>
      <dd className={mono ? 'jpb-num' : undefined}>{children}</dd>
    </div>
  );
}

/**
 * Debug internals of the table actor: versions and sequence numbers, owner
 * node and lease, queue, fault flag, last progress, chip total vs what the
 * director expects, and the invariant check.
 */
export function InternalsPanel({ internals: i, view, row, serverNow, fetchedAt }: InternalsPanelProps) {
  const sumView = view.seats.reduce((n, s) => n + (s?.stack ?? 0), 0) + (view.hand?.totalPot ?? 0);
  const actor = i?.chipsAtTable ?? null;
  const expected = row?.chips ?? null;
  const diff = actor !== null && expected !== null ? actor - expected : null;
  const chipsOk = diff === null ? null : diff === 0;
  const lastProgress = i?.lastProgressAt ?? view.lastProgressAt;
  const violations = i?.invariantViolations ?? [];
  return (
    <Panel title="Internals" icon="monitor" description={i ? `Actor state as of ${formatTimeOfDay(fetchedAt)}` : 'Loading actor internals…'} className="acr-td-int">
      <dl className="acr-td-int__list">
        <Row label="State version">{formatCount(i?.version ?? view.version)}</Row>
        <Row label="Last event seq">{formatCount(i?.lastEventSeq ?? view.lastEventSeq)}</Row>
        <Row label="Last command seq">{i ? formatCount(i.lastCommandSeq) : '—'}</Row>
        <Row label="Owner node">{i?.ownerNode ?? 'unassigned'}</Row>
        <Row label="Lease epoch">{i?.leaseEpoch ?? '—'}</Row>
        <Row label="Command queue" tone={i && i.queueLength > QUEUE_WARN_LENGTH ? 'warn' : undefined}>
          {i ? `${formatCount(i.queueLength)} pending` : '—'}
        </Row>
        <Row label="Actor health" tone={i?.faulted ? 'bad' : 'ok'} mono={false}>
          <Icon name={i?.faulted ? 'critical' : 'check-circle'} /> {i?.faulted ? 'FAULTED — commands are not processed' : 'Running'}
        </Row>
        <Row label="Last progress">
          {formatElapsed(serverNow - lastProgress)} ago · {formatTimeOfDay(lastProgress)}
        </Row>
        <Row label="Chips at table (actor)">{actor !== null ? formatChips(actor) : '—'}</Row>
        <Row label="Expected (director)">{expected !== null ? formatChips(expected) : '—'}</Row>
        <Row label="Σ stacks + pot (view)">{formatChips(sumView)}</Row>
        <Row label="Chip total" tone={chipsOk === null ? undefined : chipsOk ? 'ok' : 'bad'} mono={false}>
          {chipsOk === null ? (
            'Waiting for both totals'
          ) : chipsOk ? (
            <>
              <Icon name="check-circle" /> Matches the director
            </>
          ) : (
            <>
              <Icon name="critical" /> Off by <span className="jpb-num">{formatChipsDelta(diff ?? 0)}</span>
            </>
          )}
        </Row>
      </dl>
      <div className={cx('acr-td-int__inv', violations.length ? 'is-bad' : 'is-ok')} role={violations.length ? 'alert' : 'status'}>
        <p className="acr-td-int__invhead">
          <Icon name={violations.length ? 'critical' : 'shield'} />
          {violations.length ? `${violations.length} invariant violation${violations.length === 1 ? '' : 's'}` : 'Invariant check: all invariants hold'}
        </p>
        {violations.length > 0 && (
          <ul>
            {violations.map((v, k) => (
              <li key={k} className="jpb-mono">
                {v}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
