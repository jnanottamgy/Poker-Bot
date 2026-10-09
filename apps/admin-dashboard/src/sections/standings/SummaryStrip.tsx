import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { TournamentCounters, TournamentStatsDto } from '@jpb/shared-types';
import { Icon, formatChips, formatCount } from '@jpb/ui';
import type { IconName } from '@jpb/ui';
import { sectionHref } from '../../app/sections';
import { formatBB } from './model';

interface Item {
  icon: IconName;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
}

export interface SummaryStripProps {
  tournamentId: string;
  counters: TournamentCounters | null;
  stats: TournamentStatsDto | null;
  bigBlind: number | null;
}

/** Headline figures above the standings (all from the server's counters and stats). */
export function SummaryStrip({ tournamentId, counters, stats, bigBlind }: SummaryStripProps) {
  const leader = stats?.chipLeader ?? null;
  const items: Item[] = [
    {
      icon: 'users',
      label: 'Players remaining',
      value: counters ? formatCount(counters.active) : '—',
      sub: counters ? `of ${formatCount(counters.registered)} registered` : undefined,
    },
    { icon: 'x-circle', label: 'Eliminated', value: counters ? formatCount(counters.eliminated) : '—', sub: counters && counters.inTransit > 0 ? `${formatCount(counters.inTransit)} in transit` : undefined },
    {
      icon: 'layers',
      label: 'Average stack',
      value: stats ? formatChips(stats.averageStack) : '—',
      sub: stats ? (bigBlind ? formatBB(stats.averageStack, bigBlind) : `${stats.averageStackBB} BB`) : undefined,
    },
    { icon: 'activity', label: 'Median stack', value: stats ? formatChips(stats.medianStack) : '—', sub: stats && bigBlind ? formatBB(stats.medianStack, bigBlind) : undefined },
    {
      icon: 'crown',
      label: 'Chip leader',
      value: leader ? (
        <Link className="acr-standings-sum__leader" to={sectionHref('player-detail', tournamentId, { playerId: leader.playerId })}>
          {leader.displayName}
        </Link>
      ) : (
        '—'
      ),
      sub: leader ? `${formatChips(leader.stack)} · ${formatBB(leader.stack, bigBlind)}` : undefined,
    },
    { icon: 'grid', label: 'Chips in play', value: counters ? formatChips(counters.totalChips) : '—', sub: counters ? `${formatCount(counters.tables)} ${counters.tables === 1 ? 'table' : 'tables'}` : undefined },
  ];
  return (
    <section className="acr-standings-sum" aria-label="Standings summary">
      {items.map((it) => (
        <div key={it.label} className="acr-standings-sum__item">
          <span className="acr-standings-sum__label">
            <Icon name={it.icon} /> {it.label}
          </span>
          <span className="acr-standings-sum__value jpb-num">{it.value}</span>
          {it.sub && <span className="acr-standings-sum__sub">{it.sub}</span>}
        </div>
      ))}
    </section>
  );
}
