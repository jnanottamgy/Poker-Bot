import type { MovementDto } from '@jpb/shared-types';
import { Icon, Panel, StatusPill, formatChips, formatCount } from '@jpb/ui';
import { formatDateTime, formatTimeOfDay } from '../../lib/time';
import { MOVE_REASON_LABEL, SCORE_LABEL } from '../players/model';

const SCORE_DIGITS = 2;

function place(table: number | null, seat: number | null): string {
  if (table === null) return '—';
  return seat === null ? `T${table}` : `T${table} · S${seat + 1}`;
}

/** Score breakdown of the seat-fairness formula (lower is better), "total" last. */
function Breakdown({ score }: { score: Record<string, number> | null }) {
  if (!score) return <span className="acr-player-detail-muted">—</span>;
  const entries = Object.entries(score).sort(([a], [b]) => (a === 'total' ? 1 : b === 'total' ? -1 : a.localeCompare(b)));
  return (
    <span className="acr-player-detail-score" title="Seat-fairness score (lower is better); weights from the tournament balancing config">
      {entries.map(([k, v]) => (
        <span key={k} className={k === 'total' ? 'acr-player-detail-score__item is-total' : 'acr-player-detail-score__item'}>
          {SCORE_LABEL[k] ?? k} <span className="jpb-num">{Number.isInteger(v) ? v : v.toFixed(SCORE_DIGITS)}</span>
        </span>
      ))}
    </span>
  );
}

/** §2.8 "Movement history": every move (from → to, reason, time, stack, score breakdown). */
export function MovementsPanel({ movements }: { movements: MovementDto[] }) {
  const rows = [...movements].sort((a, b) => b.requestedAt - a.requestedAt);
  return (
    <Panel title="Movement history" icon="move" description={`${formatCount(rows.length)} move${rows.length === 1 ? '' : 's'}, newest first. Every move by Johnny or an admin, with the seat score that chose the seat.`} flush>
      {rows.length === 0 ? (
        <p className="acr-player-detail-empty">
          <Icon name="info" /> No moves yet — the player is seated when the tournament starts.
        </p>
      ) : (
        <div className="acr-player-detail-tablewrap" role="region" aria-label="Movement history (scrollable)" tabIndex={0}>
          <table className="acr-player-detail-table">
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">From → to</th>
                <th scope="col">Reason</th>
                <th scope="col" className="is-num">
                  Stack
                </th>
                <th scope="col">Score breakdown</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.moveId}>
                  <td title={formatDateTime(m.requestedAt)}>
                    <span className="acr-player-detail-cellmain">{formatTimeOfDay(m.requestedAt)}</span>
                    {m.completedAt === null ? (
                      <StatusPill size="sm" tone="info" icon="move" label="In progress" />
                    ) : (
                      <span className="acr-player-detail-cellsub">seated {formatTimeOfDay(m.completedAt)}</span>
                    )}
                  </td>
                  <td className="acr-player-detail-route">
                    <span className="jpb-num">{place(m.fromTableNumber, m.fromSeat)}</span>
                    <Icon name="arrow-right" />
                    <span className="jpb-num acr-player-detail-route__to">{place(m.toTableNumber, m.toSeat)}</span>
                  </td>
                  <td>{MOVE_REASON_LABEL[m.reason]}</td>
                  <td className="is-num jpb-num">{formatChips(m.stack)}</td>
                  <td>
                    <Breakdown score={m.scoreBreakdown} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
