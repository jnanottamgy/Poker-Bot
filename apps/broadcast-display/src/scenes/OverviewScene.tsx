import type { CSSProperties } from 'react';
import type { BlindLevel } from '@jpb/shared-types';
import { Icon, cx, formatChips, formatClock, formatCount, formatMoneyMinor } from '@jpb/ui';
import type { IconName } from '@jpb/ui';
import { blindsText } from '../model/events';
import { formatBB } from '../model/derive';
import type { ClockView, TournamentStats } from '../model/derive';
import { hasStarted } from '../model/scenes';
import type { DisplayState } from '../model/types';

export interface OverviewProps {
  state: DisplayState;
  clock: ClockView;
  stats: TournamentStats;
}

/** The huge blind clock plus the room's key numbers. */
export function OverviewScene({ state, clock, stats }: OverviewProps) {
  const t = state.tournament!;
  if (!hasStarted(state)) return <PreStart state={state} stats={stats} />;
  const level = t.currentLevel;
  const currency = state.info?.currency ?? 'INR';
  return (
    <section className="bd-scene bd-overview" aria-label="Overview">
      <div className="bd-clock">
        <div className="bd-clock__head">
          <span className="bd-eyebrow">{clock.mode === 'BREAK' ? 'Break' : level ? `Level ${level.level}` : 'Blind clock'}</span>
          {clock.mode === 'PAUSED' && <span className="bd-pill bd-pill--warning">Clock stopped</span>}
        </div>
        <div className={cx('bd-clock__time', clock.mode !== 'LEVEL' && clock.mode !== 'BREAK' && 'is-held', clock.mode === 'LEVEL' && clock.remainingMs < 60_000 && 'is-ending')} aria-label="Time left in the level">
          {clock.mode === 'IDLE' ? '--:--' : formatClock(clock.remainingMs)}
        </div>
        <Progress value={clock.progress} />
        {level && (
          <div className="bd-clock__blinds">
            <span className="bd-label">Blinds</span>
            <span className="bd-clock__blinds-value">
              {formatChips(level.smallBlind)} / {formatChips(level.bigBlind)}
            </span>
            {level.ante > 0 && <span className="bd-clock__ante">Ante {formatChips(level.ante)}</span>}
          </div>
        )}
        <NextLevel level={t.nextLevel} />
      </div>
      <div className="bd-stats">
        <Stat icon="users" label="Players remaining" value={formatCount(stats.remaining)} sub={`of ${formatCount(stats.registered)} registered`} accent />
        <Stat icon="grid" label="Tables" value={formatCount(stats.tables)} sub={`${formatCount(t.counters.handsCompleted)} hands played`} />
        <Stat icon="layers" label="Average stack" value={stats.averageStack !== null ? formatChips(stats.averageStack) : '—'} sub={formatBB(stats.averageBB)} />
        <Stat
          icon="crown"
          label="Chip leader"
          value={stats.chipLeader ? formatChips(stats.chipLeader.stack) : '—'}
          sub={stats.chipLeader ? stats.chipLeader.displayName : 'Ranking loading'}
          gold
        />
        <Stat
          icon="trophy"
          label="Prize pool"
          value={stats.prizePoolMinor !== null ? formatMoneyMinor(stats.prizePoolMinor, currency) : '—'}
          sub={stats.paidPlaces > 0 ? `${formatCount(stats.paidPlaces)} places paid` : 'Prizes to be announced'}
          gold
          wide
        />
      </div>
    </section>
  );
}

function PreStart({ state, stats }: { state: DisplayState; stats: TournamentStats }) {
  const t = state.tournament!;
  const code = state.info?.joinCode ?? null;
  const first = t.currentLevel;
  return (
    <section className="bd-scene bd-overview bd-overview--pre" aria-label="Before the start">
      <div className="bd-clock">
        <span className="bd-eyebrow">{t.status === 'STARTING' ? 'Seats are being drawn' : 'Starting soon'}</span>
        <div className="bd-pre__title">{t.status === 'REGISTRATION' ? 'Registration is open' : 'Get to your seat'}</div>
        {code && (
          <div className="bd-pre__join">
            <span className="bd-label">Join code</span>
            <span className="bd-pre__code">{code}</span>
            <span className="bd-pre__url">{`${location.host}/join/${code}`}</span>
          </div>
        )}
        {first && <span className="bd-clock__next">First level {blindsText(first)}</span>}
      </div>
      <div className="bd-stats">
        <Stat icon="users" label="Registered" value={formatCount(stats.registered)} sub="players" accent />
        <Stat icon="layers" label="Starting stack" value={state.info?.startingStack ? formatChips(state.info.startingStack) : '—'} sub="chips" />
        <Stat
          icon="trophy"
          label="Prize pool"
          value={stats.prizePoolMinor !== null ? formatMoneyMinor(stats.prizePoolMinor, state.info?.currency ?? 'INR') : '—'}
          sub={stats.paidPlaces > 0 ? `${formatCount(stats.paidPlaces)} places paid` : 'Prizes to be announced'}
          gold
          wide
        />
      </div>
    </section>
  );
}

function NextLevel({ level }: { level: BlindLevel | null }) {
  if (!level) return <span className="bd-clock__next">Final level</span>;
  return (
    <span className="bd-clock__next">
      Next · Level {level.level} · {blindsText(level)}
    </span>
  );
}

export function Progress({ value }: { value: number | null }) {
  const style = { '--bd-progress': `${Math.round((value ?? 0) * 1000) / 10}%` } as CSSProperties;
  return (
    <div className={cx('bd-progress', value === null && 'is-unknown')} style={style} aria-hidden="true">
      <span className="bd-progress__bar" />
    </div>
  );
}

interface StatProps {
  icon: IconName;
  label: string;
  value: string;
  sub: string | null;
  accent?: boolean;
  gold?: boolean;
  wide?: boolean;
}

function Stat({ icon, label, value, sub, accent, gold, wide }: StatProps) {
  return (
    <div className={cx('bd-stat', accent && 'bd-stat--accent', gold && 'bd-stat--gold', wide && 'bd-stat--wide')}>
      <span className="bd-stat__label">
        <Icon name={icon} />
        {label}
      </span>
      <span className="bd-stat__value">{value}</span>
      {sub && <span className="bd-stat__sub">{sub}</span>}
    </div>
  );
}
