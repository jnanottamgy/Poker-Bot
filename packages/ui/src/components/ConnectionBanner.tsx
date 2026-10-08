import { cx } from '../cx';
import { Button } from './Button';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { Spinner } from './Spinner';

export type ConnectionState = 'connected' | 'reconnecting' | 'offline' | 'session-replaced';

export interface ConnectionCopy {
  title: string;
  body: string;
}

/**
 * Exact copy per state (tested). The message always reassures that the
 * server, not the device, holds the truth.
 */
export const CONNECTION_COPY: Readonly<Record<Exclude<ConnectionState, 'connected'>, ConnectionCopy>> = {
  reconnecting: {
    title: 'RECONNECTING…',
    body: 'Your chips are safe. Tournament continues on the server.',
  },
  offline: {
    title: 'OFFLINE',
    body: 'Your chips are safe. Tournament continues on the server. Actions resume when you reconnect.',
  },
  'session-replaced': {
    title: 'OPEN ON ANOTHER DEVICE',
    body: 'This tournament is now active in another tab or device. This screen is paused and not live.',
  },
};

const ICONS: Readonly<Record<Exclude<ConnectionState, 'connected'>, IconName>> = {
  reconnecting: 'wifi',
  offline: 'wifi-off',
  'session-replaced': 'phone',
};

export interface ConnectionBannerProps {
  state: ConnectionState;
  /** Seconds since the last authoritative update; shown so stale data is never mistaken for live. */
  staleForSeconds?: number | null;
  /** Reconnect attempt number (reconnecting). */
  attempt?: number;
  onRetry?: () => void;
  /** "Use this device" (session-replaced). */
  onTakeover?: () => void;
  className?: string;
}

/**
 * Connectivity banner. Renders nothing while connected. While not
 * connected, apply `.jpb-stale` (or data-stale) to the live area so old
 * numbers are visibly marked as not live.
 */
export function ConnectionBanner({ state, staleForSeconds, attempt, onRetry, onTakeover, className }: ConnectionBannerProps) {
  if (state === 'connected') return null;
  const copy = CONNECTION_COPY[state];
  const stale = typeof staleForSeconds === 'number' && staleForSeconds > 0;
  return (
    <div className={cx('jpb-conn', `jpb-conn--${state}`, className)}>
      {/* Only the state itself is live; the per-second counter and attempt number are not, so they are never re-announced. */}
      <div className="jpb-conn__live" role={state === 'reconnecting' ? 'status' : 'alert'}>
        <span className="jpb-conn__icon">{state === 'reconnecting' ? <Spinner size="sm" /> : <Icon name={ICONS[state]} />}</span>
        <div className="jpb-conn__text">
          <p className="jpb-conn__title">{copy.title}</p>
          <p className="jpb-conn__body">{copy.body}</p>
        </div>
      </div>
      {(stale || (state === 'reconnecting' && attempt !== undefined && attempt > 1)) && (
        <p className="jpb-conn__stale">
          <Icon name="clock" />
          {stale && <span>Not live — last update {staleForSeconds}s ago</span>}
          {state === 'reconnecting' && attempt !== undefined && attempt > 1 && <span className="jpb-conn__attempt">attempt {attempt}</span>}
        </p>
      )}
      {state === 'offline' && onRetry && (
        <Button size="sm" variant="secondary" icon="refresh" onClick={onRetry}>
          Retry
        </Button>
      )}
      {state === 'session-replaced' && onTakeover && (
        <Button size="sm" variant="primary" onClick={onTakeover}>
          Use this device
        </Button>
      )}
    </div>
  );
}
