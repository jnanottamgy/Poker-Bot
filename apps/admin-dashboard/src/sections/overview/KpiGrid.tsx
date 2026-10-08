import type { LiveMetricsPoint, TournamentOverviewDto } from '@jpb/shared-types';
import { StackDisplay, StatTile, formatChips, formatChipsCompact, formatClock, formatCount, useServerCountdown } from '@jpb/ui';
import type { TournamentState } from '../../live/useTournamentState';
import { breakAfterLevel } from '../../lib/schedule';
import { formatDuration, formatTimeOfDay } from '../../lib/time';
import { ETA_FORMULA, delta, series, tableBreakdown } from './kpis';

function NextLevelTile({ state, overview }: { state: TournamentState; overview: TournamentOverviewDto }) {
  const clock = state.clock;
  const onBreak = clock?.breakEndsAt !== null && clock?.breakEndsAt !== undefined;
  const remaining = useServerCountdown(onBreak ? (clock?.breakEndsAt ?? null) : (clock?.levelEndsAt ?? null), state.offsetMs, { intervalMs: 500 });
  if (!clock || !state.currentLevel) return <StatTile label="Next level" icon="clock" value="—" hint="Clock not running" />;
  const paused = !onBreak && clock.levelEndsAt === null;
  const shown = paused ? (clock.pausedRemainingMs ?? 0) : remaining;
  const brk = breakAfterLevel(overview.config.breaks, state.currentLevel.level);
  return (
    <StatTile
      label={onBreak ? 'Break ends in' : brk ? 'Break in' : 'Next level in'}
      icon={onBreak ? 'coffee' : 'clock'}
      value={formatClock(shown)}
      tone={paused ? 'warning' : 'default'}
      hint={paused ? 'Clock stopped' : onBreak ? `Then level ${state.currentLevel.level}` : brk ? `${Math.round(brk.durationSeconds / 60)}-min break after this level` : 'Level changes on the director clock'}
    />
  );
}

/** KPI tiles of §2.3 (every number from the server; live counters when the socket is live). */
export function KpiGrid({ overview, state, points }: { overview: TournamentOverviewDto; state: TournamentState; points: LiveMetricsPoint[] | undefined }) {
  const c = state.counters ?? overview.counters;
  const s = overview.stats;
  const t = tableBreakdown(overview.tablesByStatus);
  const cur = state.currentLevel;
  const next = state.nextLevel;
  const bb = cur?.bigBlind ?? 0;
  const etaAt = s.estimatedRemainingMs !== null ? (state.overview.updatedAt || 0) + s.estimatedRemainingMs : null;
  return (
    <section className="acr-kpis" aria-label="Key figures">
      <StatTile
        label="Players remaining"
        icon="users"
        value={formatCount(c.active)}
        unit={`/ ${formatCount(c.registered)}`}
        spark={series(points, 'playersRemaining')}
        delta={delta(points, 'playersRemaining', false)}
      />
      <StatTile label="Eliminated" icon="x-circle" value={formatCount(c.eliminated)} hint={`${formatCount(c.inTransit)} in transit between tables`} />
      <StatTile
        label="Tables"
        icon="grid"
        value={formatCount(c.tables)}
        tone={t.stalled > 0 ? 'warning' : 'default'}
        hint={`${t.active} active · ${t.held} held · ${t.breaking} breaking · ${t.stalled} stalled · ${t.closed} closed`}
      />
      <StatTile label="Hands completed" icon="layers" value={formatCount(c.handsCompleted)} hint={`Avg hand ${formatDuration(s.averageHandDurationMs)}`} />
      <StatTile label="Hands / min" icon="zap" value={formatCount(s.handsPerMinute)} spark={series(points, 'handsPerMinute')} delta={delta(points, 'handsPerMinute', true)} />
      <StatTile label="Actions / sec" icon="activity" value={s.actionsPerSecond.toLocaleString('en-US', { maximumFractionDigits: 1 })} spark={series(points, 'actionsPerSecond')} sparkTone="neutral" />
      <StatTile
        label="Level"
        icon="sliders"
        value={cur ? String(cur.level) : '—'}
        unit={cur ? `${formatChips(cur.smallBlind)} / ${formatChips(cur.bigBlind)}${cur.ante ? ` · ante ${formatChips(cur.ante)}` : ''}` : undefined}
        hint={next ? `Next ${formatChips(next.smallBlind)} / ${formatChips(next.bigBlind)}${next.ante ? ` · ante ${formatChips(next.ante)}` : ''}` : 'Last level'}
      />
      <NextLevelTile state={state} overview={overview} />
      <StatTile label="Elapsed" icon="clock" value={formatDuration(s.elapsedMs)} hint={overview.startedAt ? `Started ${formatTimeOfDay(overview.startedAt, false)}` : 'Not started'} />
      <StatTile
        label="Estimated completion"
        icon="flame"
        value={s.estimatedRemainingMs !== null ? `≈ ${formatDuration(s.estimatedRemainingMs)}` : '—'}
        hint={
          <span title={ETA_FORMULA}>
            {etaAt ? `Around ${formatTimeOfDay(etaAt, false)} · ` : ''}
            <abbr title={ETA_FORMULA}>how is this estimated?</abbr>
          </span>
        }
      />
      <StatTile label="Average stack" icon="activity" value={<StackDisplay amount={s.averageStack} size="lg" />} unit={bb ? `${s.averageStackBB} BB` : undefined} />
      <StatTile label="Median stack" icon="activity" value={<StackDisplay amount={s.medianStack} size="lg" />} unit={bb ? `${Math.floor((s.medianStack / bb) * 10) / 10} BB` : undefined} />
      <StatTile label="Chip leader" icon="crown" value={s.chipLeader ? <StackDisplay amount={s.chipLeader.stack} size="lg" /> : '—'} hint={s.chipLeader?.displayName ?? 'No leader yet'} />
      <StatTile label="Largest pot" icon="trophy" value={<StackDisplay amount={s.largestPot} size="lg" />} hint={`${formatChipsCompact(c.totalChips)} chips in play`} />
      <StatTile label="Open alerts" icon="bell" value={formatCount(overview.openAlerts)} tone={overview.openAlerts > 0 ? 'danger' : 'positive'} hint={overview.openAlerts > 0 ? 'Needs attention' : 'All clear'} />
    </section>
  );
}
