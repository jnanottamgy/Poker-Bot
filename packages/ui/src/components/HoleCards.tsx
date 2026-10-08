import type { CardCode } from '@jpb/shared-types';
import { cx } from '../cx';
import { cardLabel } from '../format';
import { PlayingCard } from './PlayingCard';
import type { CardSize } from './PlayingCard';

export interface HoleCardsProps {
  /** Null renders two backs (an opponent still in the hand). */
  cards: [CardCode, CardCode] | null;
  size?: CardSize;
  /** Slight fan (hero hand). */
  fanned?: boolean;
  deal?: boolean;
  winningCards?: CardCode[];
  /** Folded hands are dimmed. */
  folded?: boolean;
  /** Prefix for the label, e.g. "Your cards". */
  labelPrefix?: string;
  className?: string;
}

export function HoleCards({ cards, size = 'md', fanned = false, deal = false, winningCards, folded = false, labelPrefix = 'Hole cards', className }: HoleCardsProps) {
  const label = cards ? `${labelPrefix}: ${cards.map(cardLabel).join(' and ')}` : `${labelPrefix}: face down`;
  const win = winningCards ? new Set(winningCards) : null;
  return (
    <div className={cx('jpb-hole', fanned && 'jpb-hole--fanned', folded && 'is-folded', className)} role="group" aria-label={folded ? `${label} (folded)` : label}>
      {[0, 1].map((i) => {
        const card = cards?.[i] ?? null;
        return (
          <PlayingCard
            key={i}
            card={card}
            faceDown={!card}
            size={size}
            deal={deal}
            delayMs={deal ? i * 120 : undefined}
            highlight={card ? (win?.has(card) ?? false) : false}
            dimmed={card && win ? !win.has(card) : false}
          />
        );
      })}
    </div>
  );
}
