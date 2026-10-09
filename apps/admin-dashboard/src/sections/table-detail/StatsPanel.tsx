import { Link } from 'react-router';
import type { AdminTableView, HandListItemDto } from '@jpb/shared-types';
import { EmptyState, Icon, Panel, formatChips, formatCount, formatPercent } from '@jpb/ui';
import { sectionHref } from '../../app/sections';
import { formatDuration, formatTimeOfDay } from '../../lib/time';

interface Stat {
  label: string;
  value: string;
  hint?: string;
}

/** Table statistics: the actor's running counters when present, else the recent hands (labelled as such). */
export function tableStats(view: AdminTableView, recent: readonly HandListItemDto[]): { stats: Stat[]; basis: string } {
  const c = view.counters;
  if (c && c.handsPlayed > 0) {
    const n = c.handsPlayed;
    return {
      basis: `All ${formatCount(n)} hands at this table`,
      stats: [
        { label: 'Hands played', value: formatCount(n) },
        { label: 'Average pot', value: formatChips(Math.round(c.totalPotChips / n)) },
        { label: 'Largest pot', value: formatChips(c.largestPot) },
        { label: 'Avg hand duration', value: formatDuration(c.totalHandDurationMs / n) },
        { label: 'Showdowns', value: formatPercent(c.showdowns / n), hint: `${formatCount(c.showdowns)} hands` },
        { label: 'Timeouts', value: formatCount(c.timeouts) },
        { label: 'Eliminations', value: formatCount(c.eliminations) },
        { label: 'Seated / left', value: `${formatCount(c.playersSeated)} / ${formatCount(c.playersRemoved)}` },
      ],
    };
  }
  const done = recent.filter((h) => h.completedAt !== null);
  const pots = done.map((h) => h.totalPot);
  const durations = done.map((h) => (h.completedAt ?? h.startedAt) - h.startedAt).filter((d) => d >= 0);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return {
    basis: done.length ? `Based on the last ${formatCount(done.length)} hands` : 'No completed hands yet',
    stats: [
      { label: 'Hands played', value: formatCount(view.counters?.handsPlayed ?? view.handsPlayed) },
      { label: 'Average pot', value: pots.length ? formatChips(Math.round(avg(pots))) : '—' },
      { label: 'Largest pot', value: pots.length ? formatChips(Math.max(...pots)) : '—' },
      { label: 'Avg hand duration', value: durations.length ? formatDuration(avg(durations)) : '—' },
      { label: 'Showdowns', value: done.length ? formatPercent(done.filter((h) => h.showdown).length / done.length) : '—' },
      { label: 'All-in hands', value: done.length ? formatCount(done.filter((h) => h.allIn).length) : '—' },
    ],
  };
}

export function StatsPanel({ view, recent }: { view: AdminTableView; recent: readonly HandListItemDto[] }) {
  const { stats, basis } = tableStats(view, recent);
  return (
    <Panel title="Table stats" icon="activity" description={basis} className="acr-td-stats">
      <dl className="acr-td-stats__grid">
        {stats.map((s) => (
          <div key={s.label}>
            <dt>{s.label}</dt>
            <dd className="jpb-num" title={s.hint}>
              {s.value}
            </dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

/** Recent hands of this table → hand detail / replay. */
export function RecentHands({ tournamentId, tableId, hands, canOpen }: { tournamentId: string; tableId: string; hands: readonly HandListItemDto[]; canOpen: boolean }) {
  return (
    <Panel
      title="Recent hands"
      icon="layers"
      flush
      className="acr-td-recent"
      actions={
        canOpen ? (
          <Link className="acr-link acr-td-recent__all" to={`${sectionHref('hands', tournamentId)}?tableId=${encodeURIComponent(tableId)}`}>
            All hands <Icon name="arrow-right" />
          </Link>
        ) : undefined
      }
    >
      {hands.length === 0 ? (
        <EmptyState compact icon="layers" title="No completed hands yet" description="Finished hands appear here with a link to their replay." />
      ) : (
        <ul className="acr-td-recent__list">
          {hands.map((h) => {
            const winners = h.winners.map((w) => w.displayName).join(', ');
            const body = (
              <>
                <span className="acr-td-recent__no jpb-num">#{formatCount(h.handNumber)}</span>
                <span className="acr-td-recent__main">
                  <span className="acr-td-recent__win" title={winners}>
                    {winners ? (
                      <>
                        <Icon name="trophy" /> {winners}
                      </>
                    ) : (
                      'In progress'
                    )}
                  </span>
                  <span className="acr-td-recent__meta">
                    {h.completedAt ? formatTimeOfDay(h.completedAt) : '—'} · L{h.level} {formatChips(h.smallBlind)}/{formatChips(h.bigBlind)} · {h.players} players
                    {h.showdown && <span className="acr-td-tag">Showdown</span>}
                    {h.allIn && <span className="acr-td-tag is-danger">All-in</span>}
                  </span>
                </span>
                <span className="acr-td-recent__pot jpb-num">{formatChips(h.totalPot)}</span>
                {canOpen && <Icon name="chevron-right" className="acr-td-recent__go" />}
              </>
            );
            return (
              <li key={h.handId}>
                {canOpen ? (
                  <Link className="acr-td-recent__row" to={sectionHref('hand-detail', tournamentId, { handId: h.handId })} aria-label={`Hand ${h.handNumber}, pot ${formatChips(h.totalPot)}${winners ? `, won by ${winners}` : ''}. Open the replay.`}>
                    {body}
                  </Link>
                ) : (
                  <div className="acr-td-recent__row">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
