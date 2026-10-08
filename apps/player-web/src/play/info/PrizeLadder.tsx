import { useState } from 'react';
import type { PrizePlace } from '@jpb/shared-types';
import { Button, cx, formatMoneyMinor, formatOrdinal } from '@jpb/ui';

/** Prize per finishing position (money is integer minor units). */
export function PrizeLadder({ places, currency, notes, yourPosition }: { places: readonly PrizePlace[]; currency: string; notes: string | null; yourPosition: number | null }) {
  const [all, setAll] = useState(false);
  const sorted = [...places].sort((a, b) => a.position - b.position);
  const shown = all ? sorted : sorted.slice(0, 9);
  if (sorted.length === 0) return <p className="pw-muted">Prizes will be announced by the organiser.</p>;
  return (
    <div className="pw-ladder">
      <ol className="pw-ladder__list">
        {shown.map((p) => (
          <li key={p.position} className={cx('pw-ladder__row', p.position <= 3 && 'is-podium', yourPosition === p.position && 'is-you')}>
            <span className="pw-ladder__pos jpb-num">{formatOrdinal(p.position)}</span>
            <span className="pw-ladder__label">{p.label ?? ''}</span>
            <span className="pw-ladder__amt jpb-num">{formatMoneyMinor(p.amountMinor, currency)}</span>
          </li>
        ))}
      </ol>
      {sorted.length > shown.length && (
        <Button variant="ghost" size="sm" onClick={() => setAll(true)}>
          Show all {sorted.length} paid places
        </Button>
      )}
      {notes && <p className="pw-muted">{notes}</p>}
    </div>
  );
}
