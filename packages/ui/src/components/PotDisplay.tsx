import { useEffect, useRef, useState } from 'react';
import { cx } from '../cx';
import { formatChips } from '../format';
import { useAnimatedNumber } from '../hooks/useAnimatedNumber';

export interface PotDisplayProps {
  total: number;
  /** Main + side pots; side pots are listed when there is more than one. */
  pots?: Array<{ amount: number }>;
  size?: 'md' | 'lg' | 'xl';
  label?: string;
  className?: string;
}

/** Pot total with a short count-up and a soft bump when it grows. */
export function PotDisplay({ total, pots, size = 'md', label = 'Pot', className }: PotDisplayProps) {
  const root = useRef<HTMLDivElement>(null);
  const shown = useAnimatedNumber(total, 450, root);
  const prev = useRef(total);
  const [bump, setBump] = useState(0);
  useEffect(() => {
    if (total > prev.current) setBump((b) => b + 1);
    prev.current = total;
  }, [total]);

  const sidePots = pots && pots.length > 1 ? pots : null;
  return (
    <div ref={root} className={cx('jpb-pot', `jpb-pot--${size}`, className)}>
      <span className="jpb-sr-only">
        {`${label} ${formatChips(total)} chips`}
        {sidePots ? `. ${sidePots.map((p, i) => `${i === 0 ? 'Main pot' : `Side pot ${i}`} ${formatChips(p.amount)}`).join(', ')}` : ''}
      </span>
      <span className="jpb-pot__label" aria-hidden="true">
        {label}
      </span>
      <span key={bump} className={cx('jpb-pot__value jpb-num', bump > 0 && 'is-bump')} aria-hidden="true">
        {formatChips(shown)}
      </span>
      {sidePots && (
        <span className="jpb-pot__sides" aria-hidden="true">
          {sidePots.map((p, i) => (
            <span key={i} className="jpb-pot__side">
              {i === 0 ? 'Main' : `Side ${i}`} <span className="jpb-num">{formatChips(p.amount)}</span>
            </span>
          ))}
        </span>
      )}
    </div>
  );
}
