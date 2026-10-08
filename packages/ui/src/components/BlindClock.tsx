import { cx } from '../cx';
import { formatChips, formatClock } from '../format';
import { useServerCountdown } from '../hooks/useServerCountdown';
import { Icon } from './Icon';

export interface BlindLevelInfo {
  level: number;
  smallBlind: number;
  bigBlind: number;
  ante: number;
}

export type BlindClockState = 'running' | 'paused' | 'not-started';

export interface BlindClockProps {
  current: BlindLevelInfo;
  next?: BlindLevelInfo | null;
  /** Server epoch ms when the level ends. Null while paused / not started. */
  levelEndsAt: number | null;
  serverOffsetMs: number;
  /** Frozen remaining time while the clock is paused (also during a paused break). */
  pausedRemainingMs?: number | null;
  /** When set, the clock shows the break state counting down to this time. */
  breakEndsAt?: number | null;
  /**
   * Explicit clock state. Default: derived — `paused` when pausedRemainingMs is
   * set, `not-started` when there is no deadline and nothing frozen, else running.
   */
  state?: BlindClockState;
  /**
   * compact   one 32px line for the player header ("L14 · 400/800 · ante 800 · 04:30")
   * bar       admin top bar: blinds muted + a 22px countdown
   * full      card with level, blinds, countdown and next level
   * broadcast projector scale
   */
  variant?: 'compact' | 'bar' | 'full' | 'broadcast';
  className?: string;
}

export function blindsText(l: BlindLevelInfo, sep = ' / '): string {
  return `${formatChips(l.smallBlind)}${sep}${formatChips(l.bigBlind)}`;
}

/** Level, blinds/ante and "Next level in 04:31". Break, paused and not-started states are explicit text. */
export function BlindClock({
  current,
  next,
  levelEndsAt,
  serverOffsetMs,
  pausedRemainingMs = null,
  breakEndsAt = null,
  state,
  variant = 'full',
  className,
}: BlindClockProps) {
  const onBreak = breakEndsAt !== null;
  const derived: BlindClockState = pausedRemainingMs !== null ? 'paused' : !onBreak && levelEndsAt === null ? 'not-started' : 'running';
  const clockState = state ?? derived;
  const paused = clockState === 'paused';
  const notStarted = clockState === 'not-started';
  const live = useServerCountdown(paused || notStarted ? null : onBreak ? breakEndsAt : levelEndsAt, serverOffsetMs, { intervalMs: 500 });
  // A paused clock (also a paused break) shows the FROZEN value, never a live countdown.
  const remaining = paused ? (pausedRemainingMs ?? 0) : live;
  const clock = notStarted ? '--:--' : formatClock(remaining);
  const lead = notStarted ? 'Starts soon' : paused ? (onBreak ? 'Break paused' : 'Clock paused') : onBreak ? 'Break ends in' : 'Next level in';
  const anteText = current.ante > 0 ? formatChips(current.ante) : null;

  const spoken = (
    <p className="jpb-sr-only">
      {onBreak ? 'On break. ' : ''}Level {current.level}, blinds {blindsText(current)}
      {anteText ? `, ante ${anteText}` : ''}. {lead}
      {notStarted ? '' : ` ${clock}`}.
    </p>
  );
  const classes = cx('jpb-blinds', `jpb-blinds--${variant}`, onBreak && 'is-break', paused && 'is-paused', notStarted && 'is-idle', className);
  const stateCue = onBreak ? (
    <span className="jpb-blinds__cue">
      <Icon name="coffee" /> BREAK
    </span>
  ) : paused ? (
    <span className="jpb-blinds__cue">
      <Icon name="pause" /> PAUSED
    </span>
  ) : notStarted ? (
    <span className="jpb-blinds__cue">
      <Icon name="clock" /> NOT STARTED
    </span>
  ) : null;

  if (variant === 'compact' || variant === 'bar') {
    return (
      <section className={classes} aria-label="Blind clock">
        {spoken}
        <span className="jpb-blinds__line jpb-num" aria-hidden="true">
          {stateCue ?? <span className="jpb-blinds__lvl">L{current.level}</span>}
          <span className="jpb-blinds__sep">·</span>
          <span>{blindsText(current, '/')}</span>
          {anteText && variant === 'compact' && (
            <>
              <span className="jpb-blinds__sep">·</span>
              <span>ante {anteText}</span>
            </>
          )}
          {anteText && variant === 'bar' && <span>({anteText})</span>}
          {variant === 'compact' && <span className="jpb-blinds__sep">·</span>}
          <span className="jpb-blinds__time">{clock}</span>
        </span>
      </section>
    );
  }

  return (
    <section className={classes} aria-label="Blind clock">
      {spoken}
      <div className="jpb-blinds__level" aria-hidden="true">
        {onBreak ? (
          <>
            <Icon name="coffee" /> BREAK
          </>
        ) : (
          <>LEVEL {current.level}</>
        )}
      </div>
      <div className="jpb-blinds__amounts jpb-num" aria-hidden="true">
        {blindsText(current)}
        {anteText && <span className="jpb-blinds__ante">ante {anteText}</span>}
      </div>
      <div className="jpb-blinds__clock" aria-hidden="true">
        <span className="jpb-blinds__lead">
          {paused && <Icon name="pause" />}
          {notStarted && <Icon name="clock" />} {lead}
        </span>
        <span className="jpb-blinds__time jpb-num">{clock}</span>
      </div>
      {next && (
        <div className="jpb-blinds__next" aria-hidden="true">
          Next: <span className="jpb-num">{blindsText(next)}</span>
          {next.ante > 0 && <span className="jpb-num"> · ante {formatChips(next.ante)}</span>}
        </div>
      )}
    </section>
  );
}
