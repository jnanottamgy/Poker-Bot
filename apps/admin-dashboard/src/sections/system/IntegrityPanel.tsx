import { useState } from 'react';
import { Link } from 'react-router';
import { Button, EmptyState, Icon, Panel, StatusPill, TOURNAMENT_STATUS_META, formatChips, formatChipsDelta, formatCount } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import { qk } from '../../api/query/keys';
import { useMutation } from '../../api/query/useMutation';
import { useQuery } from '../../api/query/useQuery';
import type { IntegrityCheckResponse } from '../../api/types';
import { sectionHref } from '../../app/sections';
import { useGate } from '../../auth/permissions';
import { formatTimeOfDay } from '../../lib/time';

const CODE_LABEL: Readonly<Record<string, string>> = {
  TABLE_STALLED: 'Stalled',
  INVARIANT_VIOLATION: 'Invariant violated',
  TABLE_UNREACHABLE: 'Not answering',
};

/**
 * "Run full integrity check" for the current tournament: every table's
 * invariants and the chip conservation total, checked on the server now.
 */
export function IntegrityPanel({ tournamentId }: { tournamentId: string | null }) {
  const api = useApi();
  const gate = useGate('TABLE_CONTROL', tournamentId);
  const overview = useQuery(qk.overview(tournamentId ?? '-'), (s) => api.tournaments.overview(tournamentId!, s), { enabled: tournamentId !== null, staleMs: 30_000 });
  const [result, setResult] = useState<{ tournamentId: string; data: IntegrityCheckResponse } | null>(null);
  const check = useMutation((id: string) => api.tables.integrityCheck(id), {
    invalidate: (_r, id) => [qk.overview(id)],
    onSuccess: (data, id) => setResult({ tournamentId: id, data }),
  });

  if (!tournamentId) {
    return (
      <Panel title="Full integrity check" icon="shield">
        <EmptyState compact icon="layers" title="No tournament selected" description="Open a tournament first; the check runs every invariant on all of its tables." action={<Link to="/tournaments" className="acr-link">Choose a tournament</Link>} />
      </Panel>
    );
  }
  const o = overview.data;
  const r = result && result.tournamentId === tournamentId ? result.data : null;
  const cc = r?.chipConservation;
  return (
    <Panel
      title="Full integrity check"
      icon="shield"
      tone={r && !r.ok ? 'danger' : 'default'}
      description={
        <span>
          {o ? (
            <>
              <Link to={sectionHref('overview', tournamentId)} className="acr-link">
                {o.name}
              </Link>{' '}
              · {TOURNAMENT_STATUS_META[o.status].label}
            </>
          ) : (
            'Current tournament'
          )}
        </span>
      }
      actions={
        <Button size="sm" variant="primary" icon="shield" loading={check.pending} loadingLabel="Checking all tables…" disabled={!gate.allowed} title={gate.reason ?? undefined} onClick={() => check.mutate(tournamentId)}>
          Run full integrity check
        </Button>
      }
    >
      {!gate.allowed && (
        <p className="acr-system-dim acr-system-lock">
          <Icon name="lock" /> Requires TABLE_CONTROL for this tournament.
        </p>
      )}
      {!r ? (
        <p className="acr-system-dim">Checks every table’s invariants (stacks, seats, pot), stalled tables and chip conservation (table chips + chips in transit = expected total). Writes an INTEGRITY_CHECK audit entry.</p>
      ) : (
        <div className="acr-system-integrity" aria-live="polite">
          <div className="acr-system-integrity__head">
            <StatusPill tone={r.ok ? 'positive' : 'danger'} label={r.ok ? 'All checks passed' : `${formatCount(r.violations.length)} problem${r.violations.length === 1 ? '' : 's'} found`} />
            <span className="acr-system-dim">
              {formatCount(r.checkedTables)} tables checked at {formatTimeOfDay(r.checkedAt)}
            </span>
          </div>
          {cc && (
            <dl className="acr-system-cc">
              <div>
                <dt>Expected chips</dt>
                <dd className="jpb-num">{formatChips(cc.expectedTotal)}</dd>
              </div>
              <div>
                <dt>Tables + in transit</dt>
                <dd className="jpb-num">{formatChips(cc.actualTotal)}</dd>
              </div>
              <div>
                <dt>Chip conservation</dt>
                <dd>
                  {cc.ok ? (
                    <StatusPill size="sm" tone="positive" label="Balanced" />
                  ) : (
                    <StatusPill size="sm" tone="danger" label={`Off by ${formatChipsDelta(cc.actualTotal - cc.expectedTotal)}`} />
                  )}
                </dd>
              </div>
            </dl>
          )}
          {r.violations.length > 0 && (
            <ul className="acr-system-violations" aria-label="Integrity problems">
              {r.violations.map((v, i) => (
                <li key={`${v.tableId}-${v.code}-${i}`}>
                  <Icon name="critical" />
                  <Link to={sectionHref('table-detail', tournamentId, { tableId: v.tableId })} className="acr-link">
                    Table {v.tableNumber}
                  </Link>
                  <span className="acr-system-violations__code">{CODE_LABEL[v.code] ?? v.code}</span>
                  <span className="acr-system-dim">{v.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Panel>
  );
}
