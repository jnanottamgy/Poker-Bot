import { Link } from 'react-router';
import { Icon, IconButton, Panel, cx, formatChips, formatChipsDelta, formatCount } from '@jpb/ui';
import type { IntegrityCheckResponse } from '../../api/types';
import { sectionHref } from '../../app/sections';
import { formatTimeOfDay } from '../../lib/time';

const VIOLATION_LABEL: Readonly<Record<string, string>> = {
  TABLE_STALLED: 'Stalled',
  INVARIANT_VIOLATION: 'Invariant violation',
  TABLE_UNREACHABLE: 'Table unreachable',
};

/** Result of POST /integrity-check: every invariant on every table + chip conservation. */
export function IntegrityResult({ tournamentId, result, onDismiss }: { tournamentId: string; result: IntegrityCheckResponse; onDismiss: () => void }) {
  const cc = result.chipConservation;
  const diff = cc.actualTotal - cc.expectedTotal;
  return (
    <Panel
      className={cx('acr-tables-integrity', result.ok ? 'is-ok' : 'is-bad')}
      tone={result.ok ? 'default' : 'danger'}
      icon="shield"
      title="Integrity check"
      description={`${formatCount(result.checkedTables)} tables checked at ${formatTimeOfDay(result.checkedAt)}`}
      actions={<IconButton icon="x" label="Dismiss the integrity check result" size="sm" onClick={onDismiss} />}
    >
      <div className="acr-tables-integrity__grid">
        <p className={cx('acr-tables-integrity__verdict', result.ok ? 'is-ok' : 'is-bad')} role={result.ok ? 'status' : 'alert'}>
          <Icon name={result.ok ? 'check-circle' : 'critical'} />
          {result.ok ? 'All invariants hold on every table' : `${formatCount(result.violations.length)} problem${result.violations.length === 1 ? '' : 's'} found`}
        </p>
        <dl className="acr-tables-integrity__cc">
          <div>
            <dt>Chip conservation</dt>
            <dd className={cc.ok ? 'is-ok' : 'is-bad'}>
              <Icon name={cc.ok ? 'check' : 'critical'} /> {cc.ok ? 'Conserved' : 'CRITICAL — not conserved'}
            </dd>
          </div>
          <div>
            <dt>Expected total</dt>
            <dd className="jpb-num">{formatChips(cc.expectedTotal)}</dd>
          </div>
          <div>
            <dt>Σ tables + in transit</dt>
            <dd className="jpb-num">{formatChips(cc.actualTotal)}</dd>
          </div>
          <div>
            <dt>Difference</dt>
            <dd className={cx('jpb-num', diff !== 0 && 'is-bad')}>{formatChipsDelta(diff)}</dd>
          </div>
        </dl>
      </div>
      {result.violations.length > 0 && (
        <ul className="acr-tables-integrity__list" aria-label="Violations">
          {result.violations.map((v, i) => (
            <li key={`${v.tableId}-${v.code}-${i}`}>
              <Icon name="warning" />
              <Link className="acr-link" to={sectionHref('table-detail', tournamentId, { tableId: v.tableId })}>
                Table {v.tableNumber}
              </Link>
              <span className="acr-tables-integrity__code jpb-mono">{VIOLATION_LABEL[v.code] ?? v.code}</span>
              <span className="acr-tables-integrity__detail">{v.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
