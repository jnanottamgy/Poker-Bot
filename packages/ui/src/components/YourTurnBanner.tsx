import { useEffect } from 'react';
import { cx } from '../cx';
import { useAnnouncer } from './LiveAnnouncer';
import { ActionTimer } from './ActionTimer';

export interface YourTurnBannerProps {
  /** Short context, e.g. "Call 500 to continue" or "Check or bet". */
  detail?: string;
  deadline: number | null;
  serverOffsetMs: number;
  timerMs: number;
  className?: string;
}

/**
 * Unmissable "YOUR TURN" strip with the action timer. Announced assertively
 * once per turn (deadline) through <LiveAnnouncerProvider> when present —
 * a role="status" inserted already populated is often never spoken — with
 * role="status" kept as the fallback. The timer announces 10s / 5s.
 */
export function YourTurnBanner({ detail, deadline, serverOffsetMs, timerMs, className }: YourTurnBannerProps) {
  const announcer = useAnnouncer();
  useEffect(() => {
    announcer?.announce(`Your turn.${detail ? ` ${detail}.` : ''}`, 'assertive');
    // Once per turn: keyed on the deadline, not on every detail change.
  }, [announcer, deadline]);
  return (
    <div className={cx('jpb-yourturn', className)}>
      <div className="jpb-yourturn__text" role={announcer ? undefined : 'status'}>
        <span className="jpb-yourturn__title">YOUR TURN</span>
        {detail && <span className="jpb-yourturn__detail">{detail}</span>}
      </div>
      <ActionTimer deadline={deadline} serverOffsetMs={serverOffsetMs} totalMs={timerMs} size="md" announce />
    </div>
  );
}
