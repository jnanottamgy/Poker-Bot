import { Link } from 'react-router';
import type { PlayerDetailDto } from '@jpb/shared-types';
import { DescriptionList, Icon, Panel, formatChips, formatCount, formatMoneyMinor } from '@jpb/ui';
import type { DescriptionItem } from '@jpb/ui';
import { sectionHref } from '../../app/sections';
import { usePermission } from '../../auth/permissions';
import { formatDateTime, formatTimeOfDay } from '../../lib/time';
import { ACTIVE_STATUSES, finishText, formatBB, seatText } from '../players/model';
import { PlayerStatusPill } from '../players/pills';
import type { LiveSeat } from './usePlayerDetail';

export interface TournamentPanelProps {
  p: PlayerDetailDto;
  live: LiveSeat | null;
  tournamentId: string;
  bigBlind: number | null;
  currency: string;
}

/** §2.8 "Tournament": status, seat, stack + BB, rank, result and prize, hands, largest pot, elimination. */
export function TournamentPanel({ p, live, tournamentId, bigBlind, currency }: TournamentPanelProps) {
  const canHands = usePermission('HAND_HISTORY_VIEW');
  const stack = live?.occupant.stack ?? p.stack;
  const active = ACTIVE_STATUSES.has(p.status);
  const e = p.elimination;
  const items: DescriptionItem[] = [
    { label: 'Status', value: <PlayerStatusPill status={p.status} /> },
    {
      label: 'Table / seat',
      value: p.tableId ? (
        <Link className="acr-link" to={sectionHref('table-detail', tournamentId, { tableId: p.tableId })}>
          {seatText(p.tableNumber, p.seat)}
        </Link>
      ) : (
        '—'
      ),
    },
    { label: 'Stack', value: active ? `${formatChips(stack)} chips · ${formatBB(stack, bigBlind)}` : '—', mono: true },
    { label: 'Current stack rank', value: p.stackRank !== null ? `#${formatCount(p.stackRank)}` : '—', mono: true },
    { label: 'Finishing position', value: finishText(p.finishPosition, p.tiedCount) },
    { label: 'Prize', value: p.prizeMinor > 0 ? formatMoneyMinor(p.prizeMinor, currency) : '—', mono: true },
    { label: 'Hands played', value: formatCount(p.handsPlayed), mono: true },
    { label: 'Largest pot won', value: p.largestPotWon > 0 ? `${formatChips(p.largestPotWon)} chips` : '—', mono: true },
    { label: 'Registered', value: `#${formatCount(p.registrationSeq)} · ${formatDateTime(p.registeredAt)}` },
    { label: 'Entry', value: p.entryId, mono: true },
  ];
  if (live?.occupant.pendingRemoval) items.push({ label: 'Leaving table', value: `After this hand (${live.occupant.pendingRemoval.reason.toLowerCase().replace(/_/g, ' ')})` });
  if (live?.occupant.waitingForNextHand) items.push({ label: 'Next hand', value: 'Seated during a hand: dealt in from the next one' });

  return (
    <Panel title="Tournament" icon="trophy" description="Where the player stands. Live values come from the table frame; the rest from the server record.">
      <DescriptionList items={items} columns={2} />
      {e && (
        <div className="acr-player-detail-elim" role="group" aria-label="Elimination">
          <Icon name="x-circle" className="acr-player-detail-elim__icon" />
          <div className="acr-player-detail-elim__body">
            <p className="acr-player-detail-elim__title">
              Eliminated {finishText(e.finishPosition, e.tiedCount)} at {formatTimeOfDay(e.eliminatedAt)}
            </p>
            <p className="acr-player-detail-elim__meta">
              Hand #{formatCount(e.handNumber)} · started the hand with {formatChips(e.startingStackOfHand)} chips
              {e.tiedCount > 1 ? ` · ${formatCount(e.tiedCount)} players busted in the same hand and share the position` : ''}
            </p>
          </div>
          {canHands && (
            <Link className="jpb-btn jpb-btn--secondary jpb-btn--sm acr-buttonlink" to={sectionHref('hand-detail', tournamentId, { handId: e.handId })}>
              <Icon name="play" className="jpb-btn__icon" />
              <span className="jpb-btn__label">Replay hand</span>
            </Link>
          )}
        </div>
      )}
    </Panel>
  );
}
