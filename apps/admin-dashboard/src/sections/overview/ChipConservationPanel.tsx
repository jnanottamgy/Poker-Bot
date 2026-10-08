import { useState } from 'react';
import { Link } from 'react-router';
import type { ChipConservationDto } from '@jpb/shared-types';
import { Button, Icon, Panel, formatChips, formatChipsDelta } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import { qk } from '../../api/query/keys';
import type { IntegrityCheckResponse } from '../../api/types';
import { sectionHref } from '../../app/sections';
import { useGate } from '../../auth/permissions';
import { useDangerousAction } from '../../danger/DangerProvider';
import { formatAgo } from '../../lib/time';

/** Expected chips vs Σ table chips + chips in transit; green ✓ or red CRITICAL with the affected tables. */
export function ChipConservationPanel({ tournamentId, cc, fetchedAt }: { tournamentId: string; cc: ChipConservationDto | null; fetchedAt: number }) {
  const api = useApi();
  const danger = useDangerousAction();
  const gate = useGate('TABLE_CONTROL');
  const [check, setCheck] = useState<IntegrityCheckResponse | null>(null);

  const run = () =>
    void danger({
      level: 0,
      endpoint: 'tournamentIntegrityCheck',
      title: 'Run integrity check',
      run: () => api.tables.integrityCheck(tournamentId),
      onSuccess: setCheck,
      success: (r) => (r.ok ? `Integrity check passed on ${r.checkedTables} tables` : `Integrity check found ${r.violations.length} problem(s)`),
      invalidate: [qk.overview(tournamentId)],
    });

  const ok = cc?.ok ?? true;
  const diff = cc ? cc.actualTotal - cc.expectedTotal : 0;
  return (
    <Panel
      title="Chip conservation"
      icon="shield"
      tone={ok ? 'default' : 'danger'}
      actions={
        <Button size="sm" icon="refresh" onClick={run} disabled={!gate.allowed} title={gate.reason ?? 'Checks every invariant on every table now'}>
          Run integrity check
        </Button>
      }
    >
      {!cc ? (
        <p className="acr-muted">Chip conservation is checked once the tournament starts.</p>
      ) : (
        <div className={`acr-cc ${ok ? 'is-ok' : 'is-critical'}`}>
          <p className="acr-cc__verdict" role={ok ? 'status' : 'alert'}>
            <Icon name={ok ? 'check-circle' : 'critical'} />
            {ok ? 'Conserved — every chip is accounted for' : `CRITICAL — ${formatChipsDelta(diff)} chips unaccounted for`}
          </p>
          <dl className="acr-cc__rows">
            <div>
              <dt>Expected total</dt>
              <dd className="jpb-num">{formatChips(cc.expectedTotal)}</dd>
            </div>
            <div>
              <dt>Σ table chips + in transit</dt>
              <dd className="jpb-num">{formatChips(cc.actualTotal)}</dd>
            </div>
            <div>
              <dt>Difference</dt>
              <dd className="jpb-num">{formatChipsDelta(diff)}</dd>
            </div>
            <div>
              <dt>Last check</dt>
              <dd>{formatAgo(Math.max(0, fetchedAt - cc.checkedAt))}</dd>
            </div>
          </dl>
          {!ok && cc.offendingTables.length > 0 && (
            <p className="acr-cc__tables">
              Affected tables:{' '}
              {cc.offendingTables.map((id) => (
                <Link key={id} to={sectionHref('table-detail', tournamentId, { tableId: id })} className="acr-link">
                  {id}
                </Link>
              ))}
            </p>
          )}
        </div>
      )}
      {check && (
        <div className="acr-cc__check" role="status">
          <p className="acr-cc__check-title">
            <Icon name={check.ok ? 'check' : 'warning'} /> Integrity check: {check.checkedTables} tables · {check.violations.length === 0 ? 'no violations' : `${check.violations.length} violation(s)`}
          </p>
          {check.violations.length > 0 && (
            <ul className="acr-cc__violations">
              {check.violations.slice(0, 6).map((v) => (
                <li key={`${v.tableId}-${v.code}`}>
                  <Link to={sectionHref('table-detail', tournamentId, { tableId: v.tableId })} className="acr-link">
                    Table {v.tableNumber}
                  </Link>{' '}
                  <span className="jpb-mono">{v.code}</span> — {v.detail}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Panel>
  );
}
