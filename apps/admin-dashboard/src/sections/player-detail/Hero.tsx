import { Link } from 'react-router';
import type { PlayerDetailDto, TournamentCounters } from '@jpb/shared-types';
import { StatTile, formatChips, formatCount, formatMoneyMinor } from '@jpb/ui';
import { sectionHref } from '../../app/sections';
import { formatTimeOfDay } from '../../lib/time';
import { ACTIVE_STATUSES, PLAYER_STATUS_META, connectionOf, finishText, formatBB } from '../players/model';
import type { LiveSeat } from './usePlayerDetail';

const TONE_TO_TILE = { positive: 'positive', warning: 'warning', danger: 'danger', gold: 'gold', info: 'default', neutral: 'default' } as const;

export interface HeroProps {
  p: PlayerDetailDto;
  live: LiveSeat | null;
  tournamentId: string;
  bigBlind: number | null;
  counters: TournamentCounters | null;
  awayAfterTimeouts: number | null;
  currency: string;
  fetchedAt: number;
}

/** Headline figures of one player: status, stack (+BB), rank, seat, connection and result. */
export function Hero({ p, live, tournamentId, bigBlind, counters, awayAfterTimeouts, currency, fetchedAt }: HeroProps) {
  const status = PLAYER_STATUS_META[p.status];
  const active = ACTIVE_STATUSES.has(p.status);
  const stack = live?.occupant.stack ?? p.stack;
  const conn = connectionOf({ status: p.status, connected: live ? live.occupant.connected : p.connected, consecutiveTimeouts: live?.occupant.consecutiveTimeouts ?? p.consecutiveTimeouts }, awayAfterTimeouts);
  const timeouts = live?.occupant.consecutiveTimeouts ?? p.consecutiveTimeouts;
  const finished = p.finishPosition !== null;
  return (
    <section className="acr-player-detail-hero" aria-label="Player at a glance">
      <StatTile label="Status" icon={status.icon} value={<span className="acr-player-detail-hero__text">{status.label}</span>} tone={TONE_TO_TILE[status.tone]} hint={status.hint} />
      <StatTile
        label="Stack"
        icon="layers"
        value={active ? formatChips(stack) : '—'}
        hint={
          active
            ? `${bigBlind ? `${formatBB(stack, bigBlind)} · ` : ''}${live ? `live from table ${live.tableNumber}${live.handInProgress ? `, hand #${live.handNumber ?? '—'} running` : ''}` : `as of ${formatTimeOfDay(fetchedAt)}`}`
            : 'Not in play'
        }
      />
      <StatTile
        label="Stack rank"
        icon="award"
        value={p.stackRank !== null ? `#${formatCount(p.stackRank)}` : '—'}
        unit={p.stackRank !== null && counters ? `of ${formatCount(counters.active)}` : undefined}
        hint={p.stackRank !== null ? 'Among players still in play' : 'Only players in play are ranked'}
      />
      <StatTile
        label="Table / seat"
        icon="grid"
        value={p.tableNumber !== null ? <span className="acr-player-detail-hero__text">T{p.tableNumber}{p.seat !== null ? ` · S${p.seat + 1}` : ''}</span> : '—'}
        hint={
          p.tableId ? (
            <Link className="acr-link" to={sectionHref('table-detail', tournamentId, { tableId: p.tableId })}>
              Open table {p.tableNumber} live
            </Link>
          ) : p.status === 'IN_TRANSIT' ? (
            'Moving between tables'
          ) : (
            'Not seated'
          )
        }
      />
      <StatTile
        label="Connection"
        icon={conn.icon}
        value={<span className="acr-player-detail-hero__text">{conn.key === 'none' ? '—' : conn.label}</span>}
        tone={conn.key === 'offline' ? 'danger' : conn.key === 'away' ? 'warning' : 'default'}
        hint={`${formatCount(timeouts)} consecutive timeout${timeouts === 1 ? '' : 's'}`}
      />
      <StatTile
        label={finished ? 'Finished' : 'Result'}
        icon="trophy"
        value={<span className="acr-player-detail-hero__text">{finished ? finishText(p.finishPosition, p.tiedCount) : 'Still playing'}</span>}
        tone={p.prizeMinor > 0 ? 'gold' : 'default'}
        hint={p.prizeMinor > 0 ? `Prize ${formatMoneyMinor(p.prizeMinor, currency)}` : finished ? 'Outside the prizes' : `${formatCount(p.handsPlayed)} hands played`}
      />
    </section>
  );
}
