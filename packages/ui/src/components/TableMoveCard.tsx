import { useEffect, useId, useRef } from 'react';
import { cx } from '../cx';
import { formatChips } from '../format';
import { useFocusTrap } from '../hooks/useFocusTrap';
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
  /** Render as a full-screen modal overlay (scrim, focus trap, Esc continues). */
  overlay?: boolean;
  className?: string;
}

/**
 * "TABLE CHANGE" notice (PlayerNotice TABLE_MOVE). The destination — table and
 * seat — is the loudest thing on the card; the headline is context. Focus
 * starts on the heading so screen readers read the notice first.
 */
export function TableMoveCard({ fromTableNumber, fromSeat, toTableNumber, toSeat, stack, onContinue, overlay = false, className }: TableMoveCardProps) {
  const uid = useId();
  const root = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useFocusTrap(root, overlay, { initial: heading, onEscape: onContinue });
  useEffect(() => {
    if (!overlay) heading.current?.focus();
  }, [overlay]);
  const from = fromTableNumber !== null ? `Table ${fromTableNumber}${fromSeat !== null ? ` · Seat ${fromSeat + 1}` : ''}` : 'Waiting area';
  const card = (
    <section
      ref={root}
      className={cx('jpb-notice', 'jpb-move', className)}
      role="alertdialog"
      aria-modal={overlay ? true : undefined}
      aria-labelledby={`${uid}-title`}
      aria-describedby={`${uid}-desc`}
    >
      <p className="jpb-notice__eyebrow">
        <Icon name="move" className="jpb-notice__eyeicon" />
        TABLE CHANGE
      </p>
      <h2 id={`${uid}-title`} ref={heading} tabIndex={-1} className="jpb-notice__title jpb-move__title">
        You have been moved
      </h2>
      <div id={`${uid}-desc`} className="jpb-move__route">
        <div className="jpb-move__to">
          <span className="jpb-move__k">TO</span>
          <span className="jpb-move__big jpb-num">Table {toTableNumber}</span>
          <span className="jpb-move__big jpb-num">Seat {toSeat + 1}</span>
        </div>
        <p className="jpb-move__from">
          <span className="jpb-move__k">FROM</span> <span className="jpb-num">{from}</span>
        </p>
      </div>
      <p className="jpb-move__stack">
        Your stack <span className="jpb-num">{formatChips(stack)}</span>
      </p>
      <Button variant="primary" size="xl" block onClick={onContinue} iconRight="arrow-right">
        Continue
      </Button>
    </section>
  );
  return overlay ? <div className="jpb-overlay">{card}</div> : card;
}
