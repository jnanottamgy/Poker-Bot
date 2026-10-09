import { Link } from 'react-router';
import type { PlayerDetailDto } from '@jpb/shared-types';
import { Icon, Panel, StatusPill, formatChips, formatCount } from '@jpb/ui';
import { sectionHref } from '../../app/sections';
import { usePermission } from '../../auth/permissions';
import { formatAgo, formatDateTime } from '../../lib/time';

type RecentAction = PlayerDetailDto['recentActions'][number];

const STREET: Readonly<Record<RecentAction['street'], string>> = { PREFLOP: 'Pre-flop', FLOP: 'Flop', TURN: 'Turn', RIVER: 'River' };
const ACTION: Readonly<Record<RecentAction['action'], string>> = { FOLD: 'Fold', CHECK: 'Check', CALL: 'Call', BET: 'Bet', RAISE: 'Raise', ALL_IN: 'All-in' };

function actionText(a: RecentAction): string {
  const base = ACTION[a.action];
  if (a.action === 'BET' || a.action === 'RAISE') return `${base} to ${formatChips(a.toAmount)}`;
  if (a.action === 'CALL' || a.action === 'ALL_IN') return a.amount > 0 ? `${base} ${formatChips(a.amount)}` : base;
  return base;
}

/** §2.8 "Recent actions and timeouts": the player's latest decisions (server keeps the last 25), timeouts flagged. */
export function ActionsPanel({ p, tournamentId, now }: { p: PlayerDetailDto; tournamentId: string; now: number }) {
  const canHands = usePermission('HAND_HISTORY_VIEW');
  const rows = p.recentActions;
  const timeouts = rows.filter((a) => a.timeout).length;
  return (
    <Panel
      title="Recent actions & timeouts"
      icon="activity"
      description={rows.length ? `Last ${formatCount(rows.length)} decisions · ${formatCount(timeouts)} timed out · ${formatCount(p.consecutiveTimeouts)} in a row now` : undefined}
      actions={
        canHands ? (
          <Link className="acr-link" to={`${sectionHref('hands', tournamentId)}?playerId=${encodeURIComponent(p.playerId)}`}>
            All hands of this player
          </Link>
        ) : undefined
      }
      flush
    >
      {rows.length === 0 ? (
        <p className="acr-player-detail-empty">
          <Icon name="info" /> No decisions yet.
        </p>
      ) : (
        <div className="acr-player-detail-tablewrap" role="region" aria-label="Recent actions (scrollable)" tabIndex={0}>
          <table className="acr-player-detail-table">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Hand</th>
                <th scope="col">Street</th>
                <th scope="col">Action</th>
                <th scope="col">Timeout</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a, i) => (
                <tr key={`${a.handId}-${i}`} className={a.timeout ? 'is-timeout' : undefined}>
                  <td title={formatDateTime(a.at)}>{formatAgo(now - a.at)}</td>
                  <td className="jpb-num">
                    {canHands ? (
                      <Link className="acr-link" to={sectionHref('hand-detail', tournamentId, { handId: a.handId })}>
                        #{formatCount(a.handNumber)}
                      </Link>
                    ) : (
                      `#${formatCount(a.handNumber)}`
                    )}
                  </td>
                  <td>{STREET[a.street]}</td>
                  <td className="jpb-num">{actionText(a)}</td>
                  <td>{a.timeout ? <StatusPill size="sm" tone="warning" icon="clock" label="Timed out" /> : <span className="acr-player-detail-muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
