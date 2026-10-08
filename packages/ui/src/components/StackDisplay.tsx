import { useState } from 'react';
import { cx } from '../cx';
import { formatChips, formatChipsCompact } from '../format';

export interface StackDisplayProps {
  amount: number;
  /** Start in compact form ("12.4K"). Default true. */
  compact?: boolean;
  /** Tap/click toggles compact <-> exact. Default true. */
  interactive?: boolean;
  /** Optional visible caption (e.g. "Stack"). */
  label?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Big-blind count shown as metadata, e.g. "31 BB". */
  bigBlind?: number;
  className?: string;
}

/**
 * Chip stack. Compact by default (never rounded up, see formatChipsCompact);
 * the exact amount is always in the title and the accessible name, and a
 * tap toggles it visibly.
 */
export function StackDisplay({ amount, compact = true, interactive = true, label, size = 'md', bigBlind, className }: StackDisplayProps) {
  const [exact, setExact] = useState(!compact);
  const exactText = formatChips(amount);
  const shown = exact ? exactText : formatChipsCompact(amount);
  const bb = bigBlind && bigBlind > 0 ? `${Math.floor((amount / bigBlind) * 10) / 10} BB` : null;
  const spoken = `${label ?? 'Stack'} ${exactText} chips${bb ? `, ${bb}` : ''}`;
  const body = (
    <>
      {label && <span className="jpb-stack__label">{label}</span>}
      <span className="jpb-stack__value jpb-num">{shown}</span>
      {bb && <span className="jpb-stack__bb">{bb}</span>}
    </>
  );
  const classes = cx('jpb-stack', `jpb-stack--${size}`, className);
  if (!interactive) {
    return (
      <span className={classes} title={`${exactText} chips`}>
        <span className="jpb-stack__inner" aria-hidden="true">
          {body}
        </span>
        <span className="jpb-sr-only">{spoken}</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      className={cx(classes, 'jpb-stack--toggle')}
      title={`${exactText} chips — tap to ${exact ? 'shorten' : 'show exact'}`}
      aria-label={spoken}
      aria-pressed={exact}
      onClick={() => setExact((v) => !v)}
    >
      {body}
    </button>
  );
}
