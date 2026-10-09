import { Icon, cx, formatClock } from '@jpb/ui';
import type { ClockView } from '../model/derive';
import type { PauseState, Splash } from '../model/types';

const SPLASH_ICON = {
  ELIMINATION: 'x-circle',
  MILESTONE: 'flame',
  FINAL_TABLE: 'crown',
  TABLE_BROKEN: 'split',
  HAND_FOR_HAND: 'clock',
  LEVEL_UP: 'arrow-up',
} as const;

/** Milestone splash over the stage (one at a time; the queue lives in the reducer). */
export function SplashCard({ splash }: { splash: Splash }) {
  return (
    <div className="bd-splash-layer" role="alert">
      <div key={splash.id} className={cx('bd-splash', `bd-splash--${splash.tone}`)}>
        <span className="bd-splash__icon" aria-hidden="true">
          <Icon name={SPLASH_ICON[splash.kind]} />
        </span>
        <span className="bd-splash__eyebrow">{splash.eyebrow}</span>
        <span className="bd-splash__title">{splash.title}</span>
        {splash.subtitle && <span className="bd-splash__subtitle">{splash.subtitle}</span>}
      </div>
    </div>
  );
}

/** PAUSED / FROZEN overlay: the stage stays visible (dimmed) underneath. */
export function PauseOverlay({ pause, clock, level }: { pause: PauseState; clock: ClockView; level: number | null }) {
  const frozen = pause.mode === 'EMERGENCY_FREEZE';
  return (
    <div className={cx('bd-pause', frozen && 'bd-pause--frozen')} role="status">
      <div className="bd-pause__card">
        <span className="bd-pause__icon" aria-hidden="true">
          <Icon name={frozen ? 'freeze' : 'pause'} />
        </span>
        <span className="bd-pause__title">{frozen ? 'Play frozen' : 'Tournament paused'}</span>
        <span className="bd-pause__reason">{pause.reason ?? (frozen ? 'The tournament director has stopped play. Every hand is safe.' : 'Play stops after the current hands.')}</span>
        {clock.mode === 'PAUSED' && (
          <span className="bd-pause__clock">
            Clock stopped at <strong>{formatClock(clock.remainingMs)}</strong>
            {level !== null ? ` · level ${level}` : ''}
          </span>
        )}
      </div>
    </div>
  );
}

/** Full-screen state before the first snapshot (connecting / refused / misconfigured URL). */
export function Waiting({ title, detail, busy }: { title: string; detail: string | null; busy: boolean }) {
  return (
    <div className="bd-waiting">
      <span className="bd-waiting__logo" aria-hidden="true">
        ♠
      </span>
      <span className="bd-waiting__title">{title}</span>
      {detail && <span className="bd-waiting__detail">{detail}</span>}
      {busy && <span className="bd-waiting__bar" aria-hidden="true" />}
    </div>
  );
}
