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

export interface BlindClockProps {
  current: BlindLevelInfo;
  next?: BlindLevelInfo | null;
  /** Server epoch ms when the level ends. Null while paused (use pausedRemainingMs). */
  levelEndsAt: number | null;
  serverOffsetMs: number;
  /** Frozen remaining time shown while the clock is paused. */
  pausedRemainingMs?: number | null;
  /** When set, the clock shows the break state counting down to this time. */
  breakEndsAt?: number | null;
  variant?: 'compact' | 'full' | 'broadcast';
  className?: string;
}

export function blindsText(l: BlindLevelInfo): string {
  return `${formatChips(l.smallBlind)} / ${formatChips(l.bigBlind)}`;
}

/** Level, blinds/ante and "Next level in 04:31". Break and paused states are explicit text. */
export function BlindClock({
  current,
  next,
  levelEndsAt,
  serverOffsetMs,
  pausedRemainingMs = null,
  breakEndsAt = null,
  variant = 'full',
  className,
}: BlindClockProps) {
  const onBreak = breakEndsAt !== null;
  const paused = !onBreak && levelEndsAt === null;
  const live = useServerCountdown(onBreak ? breakEndsAt : levelEndsAt, serverOffsetMs, { intervalMs: 500 });
  const remaining = paused ? (pausedRemainingMs ?? 0) : live;
  const clock = formatClock(remaining);
  const lead = onBreak ? 'Break ends in' : paused ? 'Clock paused' : 'Next level in';

  return (
    <section className={cx('jpb-blinds', `jpb-blinds--${variant}`, onBreak && 'is-break', paused && 'is-paused', className)} aria-label="Blind clock">
      <p className="jpb-sr-only">
        {onBreak ? 'On break. ' : ''}Level {current.level}, blinds {blindsText(current)}
        {current.ante ? `, ante ${formatChips(current.ante)}` : ''}. {lead} {clock}.
      </p>
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
        {current.ante > 0 && <span className="jpb-blinds__ante">ante {formatChips(current.ante)}</span>}
      </div>
      <div className="jpb-blinds__clock" aria-hidden="true">
        <span className="jpb-blinds__lead">
          {paused && <Icon name="pause" />} {lead}
        </span>
        <span className="jpb-blinds__time jpb-num">{clock}</span>
      </div>
      {next && variant !== 'compact' && (
        <div className="jpb-blinds__next" aria-hidden="true">
          Next: <span className="jpb-num">{blindsText(next)}</span>
          {next.ante > 0 && <span className="jpb-num"> · ante {formatChips(next.ante)}</span>}
        </div>
      )}
    </section>
  );
}
