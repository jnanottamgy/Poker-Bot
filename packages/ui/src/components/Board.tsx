import { useEffect, useRef } from 'react';
import type { CardCode } from '@jpb/shared-types';
import { cx } from '../cx';
import { cardLabel } from '../format';
import { PlayingCard } from './PlayingCard';
import type { CardSize } from './PlayingCard';

export interface BoardProps {
  cards: CardCode[];
  size?: CardSize;
  /** Cards in the winning five (highlighted); others dimmed when provided. */
  winningCards?: CardCode[];
  /** Animate newly added cards (default true; disabled automatically by reduced motion CSS). */
  animate?: boolean;
  className?: string;
}

const SLOTS = 5;
const STAGGER_MS = 90;

/** Community cards: always five slots, empty ones shown as quiet placeholders. */
export function Board({ cards, size = 'md', winningCards, animate = true, className }: BoardProps) {
  // Cards already on the board at the previous render do not re-animate.
  const prevCount = useRef(cards.length);
  const firstNew = Math.min(prevCount.current, cards.length);
  useEffect(() => {
    prevCount.current = cards.length;
  }, [cards.length]);

  const spoken = cards.length === 0 ? 'Board: no cards yet' : `Board: ${cards.map(cardLabel).join(', ')}`;
  const win = winningCards ? new Set(winningCards) : null;
  return (
    <div className={cx('jpb-board', `jpb-board--${size}`, className)} role="group" aria-label={spoken}>
      {Array.from({ length: SLOTS }, (_, i) => {
        const card = cards[i];
        if (!card) return <span key={`slot-${i}`} className={cx('jpb-board__slot', `jpb-card--${size}`)} aria-hidden="true" />;
        const isNew = animate && i >= firstNew;
        return (
          <PlayingCard
            key={card}
            card={card}
            size={size}
            flip={isNew}
            delayMs={isNew ? (i - firstNew) * STAGGER_MS : undefined}
            highlight={win?.has(card) ?? false}
            dimmed={win ? !win.has(card) : false}
          />
        );
      })}
    </div>
  );
}
