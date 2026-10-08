import { useEffect, useRef, useState } from 'react';
import { cx } from '../cx';
import { secondsLeft } from '../format';
import { useServerCountdown } from '../hooks/useServerCountdown';

export interface ActionTimerProps {
  /** Server epoch ms when the action times out. Null = no running timer. */
  deadline: number | null;
  serverOffsetMs: number;
  /** Full timer length (for the ring). */
  totalMs: number;
  /** Seconds at/under which the warning state applies. Default 5. */
  warnAtSeconds?: number;
  size?: 'sm' | 'md' | 'lg';
  /** Show the HURRY / TIME caption under the ring (default true at md/lg). */
  showCaption?: boolean;
  /** Announce 10s / 5s to screen readers (default true; enable only for the hero). */
  announce?: boolean;
  className?: string;
}

const ANNOUNCE_AT = [10, 5] as const;

/**
 * Countdown ring with the number of seconds in the middle. Visual only: the
 * server enforces the deadline. Warning state (<= 5s) changes the ring color
 * AND adds a "HURRY" text cue; screen readers hear "10 seconds left" and
 * "5 seconds left" exactly once each.
 */
export function ActionTimer({
  deadline,
  serverOffsetMs,
  totalMs,
  warnAtSeconds = 5,
  size = 'md',
  showCaption,
  announce = true,
  className,
}: ActionTimerProps) {
  const remaining = useServerCountdown(deadline, serverOffsetMs);
  const secs = secondsLeft(remaining);
  const warning = deadline !== null && secs <= warnAtSeconds;
  const progress = totalMs > 0 ? Math.min(1, remaining / totalMs) : 0;

  const [message, setMessage] = useState('');
  const announced = useRef<Set<number>>(new Set());
  useEffect(() => {
    announced.current = new Set();
    setMessage('');
  }, [deadline]);
  useEffect(() => {
    if (!announce || deadline === null) return;
    for (const mark of ANNOUNCE_AT) {
      if (secs <= mark && secs > 0 && !announced.current.has(mark)) {
        // Mark every threshold already passed so a late mount does not double-announce.
        for (const m of ANNOUNCE_AT) if (m >= mark) announced.current.add(m);
        setMessage(`${mark} seconds left`);
        break;
      }
    }
  }, [secs, announce, deadline]);

  const r = 20;
  const c = 2 * Math.PI * r;
  const caption = showCaption ?? size !== 'sm';
  return (
    <div className={cx('jpb-timer', `jpb-timer--${size}`, warning && 'is-warning', className)}>
      <div className="jpb-timer__ring" role="timer" aria-label={`${secs} seconds to act`}>
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <circle className="jpb-timer__track" cx="24" cy="24" r={r} />
          <circle
            className="jpb-timer__bar"
            cx="24"
            cy="24"
            r={r}
            strokeDasharray={c}
            strokeDashoffset={c * (1 - progress)}
            transform="rotate(-90 24 24)"
          />
        </svg>
        <span className="jpb-timer__secs jpb-num" aria-hidden="true">
          {secs}
        </span>
      </div>
      {caption && (
        <span className="jpb-timer__caption" aria-hidden="true">
          {warning ? 'HURRY' : 'TIME'}
        </span>
      )}
      <span className="jpb-sr-only" aria-live="assertive" aria-atomic="true">
        {message}
      </span>
    </div>
  );
}
