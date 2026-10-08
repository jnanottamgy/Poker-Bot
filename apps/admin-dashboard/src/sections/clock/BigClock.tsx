import type { TournamentConfig } from '@jpb/shared-types';
import { Icon, ProgressBar, StatusPill, formatChips, formatClock, useServerCountdown } from '@jpb/ui';
import type { TournamentState } from '../../live/useTournamentState';
import { breakAfterLevel } from '../../lib/schedule';

/** Big clock: level, blinds, ante, remaining (cosmetic countdown on the server's deadline). */
export function BigClock({ state, config }: { state: TournamentState; config: TournamentConfig }) {
  const { clock, currentLevel: cur, nextLevel: next } = state;
  const onBreak = clock?.breakEndsAt !== null && clock?.breakEndsAt !== undefined;
  const deadline = onBreak ? (clock?.breakEndsAt ?? null) : (clock?.levelEndsAt ?? null);
  const live = useServerCountdown(deadline, state.offsetMs, { intervalMs: 250 });
  if (!clock || !cur) {
    return (
      <section className="acr-bigclock is-idle" aria-label="Blind clock">
        <p className="acr-bigclock__state">
          <Icon name="clock" /> The blind clock starts with the tournament.
        </p>
      </section>
    );
  }
  const paused = !onBreak && clock.levelEndsAt === null;
  const remaining = paused ? (clock.pausedRemainingMs ?? 0) : live;
  const duration = cur.durationSeconds * 1000;
  const brk = breakAfterLevel(config.breaks, cur.level);
  const stateLabel = state.frozen ? 'Frozen' : onBreak ? 'On break' : paused ? 'Paused' : 'Running';
  const tone = state.frozen ? 'danger' : onBreak || paused ? 'warning' : 'positive';
  const spoken = `${onBreak ? 'On break.' : `Level ${cur.level}.`} Blinds ${formatChips(cur.smallBlind)} / ${formatChips(cur.bigBlind)}${cur.ante ? `, ante ${formatChips(cur.ante)}` : ''}. ${onBreak ? 'Break ends in' : paused ? 'Clock paused with' : 'Level ends in'} ${formatClock(remaining)}${paused ? ' remaining' : ''}.`;

  return (
    <section className={`acr-bigclock is-${tone}`} aria-label="Blind clock">
      <p className="jpb-sr-only" role="timer">
        {spoken}
      </p>
      <div className="acr-bigclock__top" aria-hidden="true">
        <span className="acr-bigclock__level">{onBreak ? 'BREAK' : `LEVEL ${cur.level}`}</span>
        <StatusPill tone={tone} label={stateLabel} icon={state.frozen ? 'freeze' : onBreak ? 'coffee' : paused ? 'pause' : 'play'} live={!paused && !onBreak && !state.frozen} />
        {state.handForHand && <StatusPill tone="warning" icon="pause" label="Hand-for-hand" />}
      </div>
      <div className="acr-bigclock__time jpb-num" aria-hidden="true">
        {formatClock(remaining)}
      </div>
      <div className="acr-bigclock__blinds jpb-num" aria-hidden="true">
        {onBreak ? (
          <>Next: {formatChips(cur.smallBlind)} / {formatChips(cur.bigBlind)}</>
        ) : (
          <>
            {formatChips(cur.smallBlind)} / {formatChips(cur.bigBlind)}
            {cur.ante > 0 && <span className="acr-bigclock__ante">ante {formatChips(cur.ante)}</span>}
          </>
        )}
      </div>
      {!onBreak && <ProgressBar value={Math.max(0, duration - remaining)} max={duration} label="Level progress" valueText={`${formatClock(remaining)} left of ${Math.round(duration / 60000)} minutes`} tone={paused ? 'warning' : 'positive'} />}
      <p className="acr-bigclock__next" aria-hidden="true">
        {next ? (
          <>
            <Icon name="skip-forward" /> Next level {next.level}: <span className="jpb-num">{formatChips(next.smallBlind)} / {formatChips(next.bigBlind)}</span>
            {next.ante > 0 && <span className="jpb-num"> · ante {formatChips(next.ante)}</span>}
          </>
        ) : (
          'Final level of the schedule'
        )}
        {brk && !onBreak && (
          <span className="acr-bigclock__break">
            <Icon name="coffee" /> {Math.round(brk.durationSeconds / 60)}-min break after this level
          </span>
        )}
      </p>
    </section>
  );
}
