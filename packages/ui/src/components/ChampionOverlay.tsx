import { useId, useRef } from 'react';
import { cx } from '../cx';
import { formatChips, formatCount, formatMoneyMinor } from '../format';
import { Button } from './Button';
import { Icon } from './Icon';
import { useFocusTrap } from '../hooks/useFocusTrap';

export interface ChampionOverlayProps {
  name: string;
  stack: number;
  playersInField: number;
  prizeMinor?: number;
  currency?: string;
  tournamentName?: string;
  /** Hides the overlay; omit for display-only (projector) use. */
  onClose?: () => void;
  /** 'fixed' covers the viewport; 'inline' fills its container (gallery / broadcast region). */
  position?: 'fixed' | 'inline';
  className?: string;
}

/**
 * The champion moment. Gold, cinematic, quiet: a slow light bloom and a
 * single sheen across the title. Under reduced motion everything is static.
 */
export function ChampionOverlay({
  name,
  stack,
  playersInField,
  prizeMinor = 0,
  currency = 'INR',
  tournamentName,
  onClose,
  position = 'fixed',
  className,
}: ChampionOverlayProps) {
  const uid = useId();
  const root = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  // Fixed overlay = modal: focus starts on the name, Tab stays inside, Esc continues.
  useFocusTrap(root, position === 'fixed', { initial: heading, onEscape: onClose });
  return (
    <div ref={root} className={cx('jpb-champ', `jpb-champ--${position}`, className)} role="dialog" aria-modal={position === 'fixed' ? true : undefined} aria-labelledby={`${uid}-name`} aria-describedby={`${uid}-desc`}>
      <div className="jpb-champ__bloom" aria-hidden="true" />
      <div className="jpb-champ__rings" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="jpb-champ__content">
        <div className="jpb-champ__trophy" aria-hidden="true">
          <Icon name="trophy" />
        </div>
        {tournamentName && <p className="jpb-champ__event">{tournamentName}</p>}
        <p className="jpb-champ__title">CHAMPION</p>
        <h2 id={`${uid}-name`} ref={heading} tabIndex={-1} className="jpb-champ__name">
          {name}
        </h2>
        <p className="jpb-champ__place">1ST PLACE</p>
        <dl id={`${uid}-desc`} className={cx('jpb-champ__stats', prizeMinor > 0 && 'has-prize')}>
          {prizeMinor > 0 && (
            <div className="jpb-champ__prize">
              <dt>Prize</dt>
              <dd className="jpb-num">{formatMoneyMinor(prizeMinor, currency)}</dd>
            </div>
          )}
          <div>
            <dt>Final stack</dt>
            <dd className="jpb-num">{formatChips(stack)}</dd>
          </div>
          <div>
            <dt>Players</dt>
            <dd className="jpb-num">{formatCount(playersInField)}</dd>
          </div>
        </dl>
        {onClose && (
          <Button variant="gold" size="lg" onClick={onClose} className="jpb-champ__continue">
            Continue
          </Button>
        )}
      </div>
    </div>
  );
}
