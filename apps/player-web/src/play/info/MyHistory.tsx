import { ErrorState, Skeleton, formatChips, formatMoneyMinor, formatOrdinal } from '@jpb/ui';
import { useBackend } from '../../app/backend';
import { InfoTiles } from '../../components/InfoTiles';
import { useAsync } from '../../hooks/useAsync';

const REASON: Record<string, string> = {
  INITIAL_SEATING: 'First seat',
  BALANCE: 'Table balancing',
  TABLE_BREAK: 'Table closed',
  FINAL_TABLE: 'Final table',
  ADMIN: 'Moved by staff',
  LATE_REGISTRATION: 'Late registration',
};

/** GET /api/player/history — your own numbers only. */
export function MyHistory({ refreshKey }: { refreshKey: number }) {
  const { api } = useBackend();
  const h = useAsync((signal) => api.history(signal), [refreshKey]);
  if (h.error && !h.data) return <ErrorState title={h.error.title} description={h.error.message} onRetry={h.reload} />;
  if (!h.data) return <Skeleton lines={3} />;
  const d = h.data;
  return (
    <div className="pw-history">
      <InfoTiles
        tiles={[
          { label: 'Hands played', value: formatChips(d.handsPlayed) },
          { label: 'Largest pot won', value: d.largestPotWon > 0 ? formatChips(d.largestPotWon) : '—' },
          { label: d.finishPosition !== null ? 'Final stack' : 'Stack now', value: formatChips(d.finalStack) },
          d.finishPosition !== null
            ? { label: 'Finished', value: formatOrdinal(d.finishPosition), emphasis: true }
            : { label: 'Starting stack', value: formatChips(d.startingStack) },
        ]}
      />
      {d.prizeMinor > 0 && <p className="pw-chipline is-gold">Prize {formatMoneyMinor(d.prizeMinor, d.currency)}</p>}
      {d.movements.length > 0 && (
        <ol className="pw-moves" aria-label="Your seats">
          {d.movements.map((m) => (
            <li key={m.moveId} className="pw-moves__row">
              <span className="pw-moves__route jpb-num">
                {m.fromTableNumber !== null ? `T${m.fromTableNumber} · S${(m.fromSeat ?? 0) + 1} → ` : ''}T{m.toTableNumber} · S{m.toSeat + 1}
              </span>
              <span className="pw-moves__why">{REASON[m.reason] ?? m.reason}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
