import { useEffect, useId, useRef } from 'react';
import { cx } from '../cx';
import { formatChips } from '../format';
import { Button } from './Button';
import { Icon } from './Icon';

export interface TableMoveCardProps {
  fromTableNumber: number | null;
  /** 0-based SeatIndex (displayed +1). */
  fromSeat: number | null;
  toTableNumber: number;
  /** 0-based SeatIndex (displayed +1). */
  toSeat: number;
  stack: number;
  onContinue: () => void;
  className?: string;
}

/** Full-screen-friendly "♠ TABLE CHANGE" notice (PlayerNotice TABLE_MOVE). Focuses Continue on mount. */
export function TableMoveCard({ fromTableNumber, fromSeat, toTableNumber, toSeat, stack, onContinue, className }: TableMoveCardProps) {
  const uid = useId();
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => btn.current?.focus(), []);
  const from = fromTableNumber !== null ? `TABLE ${fromTableNumber}${fromSeat !== null ? ` / SEAT ${fromSeat + 1}` : ''}` : 'WAITING AREA';
  const to = `TABLE ${toTableNumber} / SEAT ${toSeat + 1}`;
  return (
    <section className={cx('jpb-notice', 'jpb-move', className)} role="alertdialog" aria-labelledby={`${uid}-title`} aria-describedby={`${uid}-desc`}>
      <p className="jpb-notice__eyebrow">
        <span aria-hidden="true">♠ </span>TABLE CHANGE
      </p>
      <h2 id={`${uid}-title`} className="jpb-notice__title">
        You have been moved.
      </h2>
      <div id={`${uid}-desc`} className="jpb-move__route">
        <div className="jpb-move__end">
          <span className="jpb-move__k">FROM</span>
          <span className="jpb-move__v">{from}</span>
        </div>
        <Icon name="arrow-right" className="jpb-move__arrow" />
        <span className="jpb-sr-only"> to </span>
        <div className="jpb-move__end is-to">
          <span className="jpb-move__k">TO</span>
          <span className="jpb-move__v">{to}</span>
        </div>
      </div>
      <p className="jpb-move__stack">
        Your stack <span className="jpb-num">{formatChips(stack)}</span>
      </p>
      <Button ref={btn} variant="primary" size="xl" block onClick={onContinue} iconRight="arrow-right">
        Continue
      </Button>
    </section>
  );
}
