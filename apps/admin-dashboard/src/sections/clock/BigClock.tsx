import type { TournamentOverviewDto } from '@jpb/shared-types';
import { Icon, ProgressBar, StatusPill, formatChips, formatClock, useServerCountdown } from '@jpb/ui';
import type { IconName, Tone } from '@jpb/ui';
import { shownRemaining } from '../../lib/clock';
import type { ClockModel } from '../../lib/clock';
import type { Projection } from '../../lib/schedule';
import { formatTimeOfDay } from '../../lib/time';
import type { TournamentState } from '../../live/useTournamentState';

const UP_NEXT = 4;

interface UpNext {
  key: string;
  at: number;
  kind: 'level' | 'break';
  text: string;
}

/** The next few clock events (level starts and breaks) from the projection. */
function upNext(projection: Projection, model: ClockModel): UpNext[] {
  const out: UpNext[] = [];
  for (const l of projection.levels) {
    if (l.played) continue;
    const resumes = model.onBreak && l.index === model.playIndex;
    if ((!l.isCurrent || resumes) && l.startsAt !== null) {
      out.push({ key: `l${l.index}`, at: l.startsAt, kind: 'level', text: `Level ${l.level.level}${resumes && !model.scheduledBreak ? ' resumes' : ''} · ${formatChips(l.level.smallBlind)} / ${formatChips(l.level.bigBlind)}${l.level.ante ? ` · ante ${formatChips(l.level.ante)}` : ''}` });
    }
    if (l.breakAfter) out.push({ key: `b${l.index}`, at: l.breakAfter.startsAt, kind: 'break', text: `Break · ${Math.round(l.breakAfter.durationSeconds / 60)} min${l.breakAfter.message ? ` · ${l.breakAfter.message}` : ''}` });
    if (out.length >= UP_NEXT) break;
  }
  return out.slice(0, UP_NEXT);
}

const PHASE: Record<ClockModel['phase'], { tone: Tone; icon: IconName }> = {
  'not-started': { tone: 'neutral', icon: 'clock' },
  running: { tone: 'positive', icon: 'play' },
  'last-level': { tone: 'info', icon: 'flame' },
  paused: { tone: 'warning', icon: 'pause' },
  frozen: { tone: 'danger', icon: 'freeze' },
  break: { tone: 'info', icon: 'coffee' },
  ended: { tone: 'neutral', icon: 'trophy' },
};

/**
 * The big clock: level, blinds, ante and remaining time. The countdown is
 * cosmetic (driven by the server deadline + clock offset); the director's
 * clock on the server is the authority.
 */
export function BigClock({ state, overview, model, projection }: { state: TournamentState; overview: TournamentOverviewDto; model: ClockModel; projection: Projection }) {
  const live = useServerCountdown(model.deadline, state.offsetMs, { intervalMs: 250 });
  const schedule = overview.config.blindSchedule;
  const total = schedule.length;

  if (model.phase === 'not-started' || model.phase === 'ended' || !state.clock) {
    const first = schedule[0];
    return (
      <section className="acr-clock-big is-idle" aria-label="Blind clock">
        <div className="acr-clock-big__top">
          <span className="acr-clock-big__level">BLIND CLOCK</span>
          <span className="acr-clock-big__pills">
            <StatusPill tone="neutral" icon={PHASE[model.phase].icon} label={model.label} />
          </span>
        </div>
        <p className="acr-clock-big__idle">
          <Icon name="clock" />
          {model.phase === 'ended' ? 'The tournament is over; the blind clock no longer runs.' : 'The blind clock starts with the tournament.'}
        </p>
        {first && model.phase === 'not-started' && (
          <p className="acr-clock-big__next">
            Level 1 · <span className="jpb-num">{formatChips(first.smallBlind)} / {formatChips(first.bigBlind)}</span> · {Math.round(first.durationSeconds / 60)} min
          </p>
        )}
      </section>
    );
  }

  const remaining = shownRemaining(model, live);
  const onBreak = model.onBreak;
  const playing = schedule[model.playIndex];
  const cur = onBreak ? playing : (state.currentLevel ?? playing);
  const following = schedule[model.playIndex + 1];
  /** On a break: the level that plays when it ends (next level, or the same one after an ad-hoc break). */
  const next = onBreak ? playing : following;
  const tone = PHASE[model.phase].tone;
  const proj = projection.levels.find((l) => l.index === model.playIndex);
  const levelDuration = (cur?.durationSeconds ?? 0) * 1000;
  const breakAfter = !onBreak ? proj?.breakAfter : null;
  const unknown = !model.ticking && model.heldRemainingMs === null;
  const timeText = model.phase === 'last-level' ? 'NO END' : unknown ? '— : —' : formatClock(remaining);
  const ends = onBreak ? projection.currentBreak?.endsAt : proj?.endsAt;
  const events = model.phase === 'last-level' ? [] : upNext(projection, model);
  const levelLabel = onBreak ? 'BREAK' : `LEVEL ${cur?.level ?? '—'}`;
  const spoken = onBreak
    ? `On break. ${unknown ? 'Break clock stopped.' : `Break ends in ${formatClock(remaining)}.`} Next level ${next?.level ?? ''}: ${next ? `${formatChips(next.smallBlind)} / ${formatChips(next.bigBlind)}` : ''}.`
    : `Level ${cur?.level ?? ''} of ${total}. Blinds ${cur ? `${formatChips(cur.smallBlind)} / ${formatChips(cur.bigBlind)}` : ''}${cur?.ante ? `, ante ${formatChips(cur.ante)}` : ''}. ${
        model.phase === 'last-level' ? 'Last level, no end time.' : model.ticking ? `Level ends in ${formatClock(remaining)}.` : `Clock ${model.label.toLowerCase()} with ${unknown ? 'unknown time' : formatClock(remaining)} left.`
      }`;

  return (
    <section className={`acr-clock-big is-${tone}${state.stale ? ' is-stale' : ''}`} aria-label="Blind clock">
      <p className="jpb-sr-only" role="timer" aria-live="off">
        {spoken}
      </p>
      <div className="acr-clock-big__top" aria-hidden="true">
        <span className="acr-clock-big__level">{levelLabel}</span>
        {!onBreak && <span className="acr-clock-big__of jpb-num">of {total}</span>}
        <span className="acr-clock-big__pills">
          <StatusPill tone={tone} label={model.label} icon={PHASE[model.phase].icon} live={model.phase === 'running'} />
          {state.handForHand && <StatusPill tone="warning" icon="split" label="Hand-for-hand" />}
        </span>
      </div>

      <div className={`acr-clock-big__time jpb-num${model.phase === 'last-level' ? ' is-text' : ''}`} aria-hidden="true">
        {timeText}
      </div>

      <div className="acr-clock-big__blinds" aria-hidden="true">
        {onBreak ? (
          <>
            <span className="acr-clock-big__next-label">{model.scheduledBreak ? 'Next' : 'Resumes'}: level {next?.level ?? '—'}</span>
            <span className="jpb-num acr-clock-big__sbbb">
              {next ? `${formatChips(next.smallBlind)} / ${formatChips(next.bigBlind)}` : '—'}
            </span>
            {next && next.ante > 0 && <span className="acr-clock-big__ante jpb-num">ante {formatChips(next.ante)}</span>}
          </>
        ) : (
          <>
            <span className="jpb-num acr-clock-big__sbbb">{cur ? `${formatChips(cur.smallBlind)} / ${formatChips(cur.bigBlind)}` : '—'}</span>
            {cur && cur.ante > 0 && <span className="acr-clock-big__ante jpb-num">ante {formatChips(cur.ante)}</span>}
          </>
        )}
      </div>

      {!onBreak && model.phase !== 'last-level' && levelDuration > 0 && !unknown && (
        <ProgressBar
          className="acr-clock-big__progress"
          value={Math.max(0, levelDuration - remaining)}
          max={levelDuration}
          label="Level progress"
          valueText={`${formatClock(remaining)} left of ${Math.round(levelDuration / 60_000)} min`}
          tone={model.phase === 'running' ? 'positive' : 'warning'}
        />
      )}

      {events.length > 0 && (
        <div className="acr-clock-big__upnext">
          <p className="acr-clock-big__upnext-title">
            Up next{projection.tentative ? <span className="acr-clock-big__tentative"> · if the clock resumes now</span> : null}
          </p>
          <ol>
            {events.map((ev) => (
              <li key={ev.key} className={`is-${ev.kind}`}>
                <span className="acr-clock-big__upnext-time jpb-num">{formatTimeOfDay(ev.at, false)}</span>
                <Icon name={ev.kind === 'break' ? 'coffee' : 'skip-forward'} />
                <span className="acr-clock-big__upnext-text">{ev.text}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <dl className="acr-clock-big__facts">
        <div>
          <dt>{onBreak ? 'Break ends' : 'Level ends'}</dt>
          <dd className="jpb-num">
            {model.phase === 'last-level' ? 'never (last level)' : ends ? `${formatTimeOfDay(ends, false)}${projection.tentative ? ' if resumed now' : ''}` : '—'}
          </dd>
        </div>
        <div>
          <dt>{onBreak ? 'Then' : 'Level started'}</dt>
          <dd className="jpb-num">
            {onBreak
              ? `level ${next?.level ?? '—'}${model.scheduledBreak ? '' : ' (resumes)'}`
              : state.clock.levelStartedAt !== null
                ? `${formatTimeOfDay(state.clock.levelStartedAt, false)} · ${Math.round((levelDuration / 60_000) * 100) / 100} min level`
                : '—'}
          </dd>
        </div>
        <div>
          <dt>Break</dt>
          <dd>
            {onBreak ? (
              <span className="acr-clock-big__onbreak">
                <Icon name="coffee" /> In progress
              </span>
            ) : breakAfter ? (
              <span>
                <Icon name="coffee" /> {Math.round(breakAfter.durationSeconds / 60)} min after this level
              </span>
            ) : (
              'None after this level'
            )}
          </dd>
        </div>
        <div>
          <dt>Average stack</dt>
          <dd className="jpb-num">{overview.stats.averageStack > 0 && cur ? `${formatChips(overview.stats.averageStack)} · ${(Math.round((overview.stats.averageStack / (onBreak && next ? next.bigBlind : cur.bigBlind)) * 10) / 10).toLocaleString('en-US')} BB` : '—'}</dd>
        </div>
      </dl>
    </section>
  );
}
