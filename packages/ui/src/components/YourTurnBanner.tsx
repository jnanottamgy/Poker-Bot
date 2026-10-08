import { cx } from '../cx';
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
 * Unmissable "YOUR TURN" strip with the action timer. The text is announced
 * once (role="status"); the timer announces 10s / 5s.
 */
export function YourTurnBanner({ detail, deadline, serverOffsetMs, timerMs, className }: YourTurnBannerProps) {
  return (
    <div className={cx('jpb-yourturn', className)}>
      <div className="jpb-yourturn__text" role="status">
        <span className="jpb-yourturn__title">YOUR TURN</span>
        {detail && <span className="jpb-yourturn__detail">{detail}</span>}
      </div>
      <ActionTimer deadline={deadline} serverOffsetMs={serverOffsetMs} totalMs={timerMs} size="md" announce />
    </div>
  );
}
