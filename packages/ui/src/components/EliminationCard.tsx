import { useId } from 'react';
import { cx } from '../cx';
import { formatCount, formatMoneyMinor, formatOrdinal } from '../format';
import { Button } from './Button';

export interface EliminationCardProps {
  finishPosition: number;
  /** Players sharing the finish (1 = no tie). */
  tiedCount?: number;
  fieldSize?: number;
  handsPlayed: number;
  /** Prize in minor units; 0 / undefined = no prize. */
  prizeMinor?: number;
  currency?: string;
  onWatch: () => void;
  /** Optional secondary action, e.g. "Hand history". */
  secondaryLabel?: string;
  onSecondary?: () => void;
  className?: string;
}

/** "YOU'RE OUT" summary (PlayerNotice ELIMINATED). Respectful, not dramatic. */
export function EliminationCard({
  finishPosition,
  tiedCount = 1,
  fieldSize,
  handsPlayed,
  prizeMinor = 0,
  currency = 'INR',
  onWatch,
  secondaryLabel,
  onSecondary,
  className,
}: EliminationCardProps) {
  const uid = useId();
  const inMoney = prizeMinor > 0;
  return (
    <section className={cx('jpb-notice', 'jpb-elim', inMoney && 'is-itm', className)} aria-labelledby={`${uid}-title`}>
      <p className="jpb-notice__eyebrow">Tournament over for you</p>
      <h2 id={`${uid}-title`} className="jpb-notice__title jpb-elim__title">
        YOU&apos;RE OUT
      </h2>
      <p className="jpb-elim__finish">
        Finish <span className="jpb-num">#{formatCount(finishPosition)}</span>
        {fieldSize !== undefined && <span className="jpb-elim__field"> of {formatCount(fieldSize)}</span>}
      </p>
      {tiedCount > 1 && <p className="jpb-elim__tie">Tied {formatOrdinal(finishPosition)} with {tiedCount - 1} other player{tiedCount > 2 ? 's' : ''}</p>}
      <dl className="jpb-elim__stats">
        <div>
          <dt>Hands played</dt>
          <dd className="jpb-num">{formatCount(handsPlayed)}</dd>
        </div>
        <div>
          <dt>Prize</dt>
          <dd className={cx('jpb-num', inMoney && 'jpb-elim__prize')}>{inMoney ? formatMoneyMinor(prizeMinor, currency) : 'No prize'}</dd>
        </div>
      </dl>
      <div className="jpb-notice__actions">
        <Button variant="primary" size="xl" block onClick={onWatch} icon="eye">
          Watch tournament
        </Button>
        {secondaryLabel && onSecondary && (
          <Button variant="ghost" size="lg" block onClick={onSecondary}>
            {secondaryLabel}
          </Button>
        )}
      </div>
    </section>
  );
}
