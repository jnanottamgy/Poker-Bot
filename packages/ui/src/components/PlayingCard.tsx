import type { CSSProperties } from 'react';
import type { CardCode } from '@jpb/shared-types';
import { cx } from '../cx';
import { cardLabel, parseCard, rankDisplay, suitGlyph, suitName } from '../format';

export type CardSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface PlayingCardProps {
  /** Card code ('As', 'Td'...). Null or `faceDown` renders the back. */
  card: CardCode | null;
  faceDown?: boolean;
  /** xs 28px, sm 36px, md 52px, lg 68px, xl 92px wide (5:7 aspect). */
  size?: CardSize;
  /** Plays the deal-in animation once on mount. */
  deal?: boolean;
  /** Plays the flip (back -> face) animation once on mount. */
  flip?: boolean;
  /** Animation delay in ms (stagger board cards). */
  delayMs?: number;
  /** Part of the winning five: green outline + "winning card" in the label. */
  highlight?: boolean;
  /** Not part of the winning hand (dimmed at showdown). */
  dimmed?: boolean;
  /** Override the accessible label. */
  label?: string;
  className?: string;
}

/**
 * Clean white/black card face. Colors come from tokens so the four-color deck
 * ([data-deck="four-color"]) and high-contrast mode apply automatically; the
 * suit is always also a glyph and spoken as text ("Ace of spades").
 */
export function PlayingCard({
  card,
  faceDown = false,
  size = 'md',
  deal = false,
  flip = false,
  delayMs,
  highlight = false,
  dimmed = false,
  label,
  className,
}: PlayingCardProps) {
  const parsed = card && !faceDown ? parseCard(card) : null;
  const style = delayMs ? ({ '--jpb-anim-delay': `${delayMs}ms` } as CSSProperties) : undefined;
  const classes = cx(
    'jpb-card',
    `jpb-card--${size}`,
    parsed ? `jpb-card--${suitName(parsed.suit)}` : 'jpb-card--back',
    deal && 'jpb-card--deal',
    flip && parsed && 'jpb-card--flip',
    highlight && 'is-highlight',
    dimmed && 'is-dimmed',
    className,
  );

  if (!parsed) {
    return (
      <span className={classes} style={style} role="img" aria-label={label ?? 'Face-down card'}>
        <span className="jpb-card__back" aria-hidden="true">
          <span className="jpb-card__monogram">♠</span>
        </span>
      </span>
    );
  }

  const rank = rankDisplay(parsed.rank);
  const suit = suitGlyph(parsed.suit);
  const spoken = label ?? `${cardLabel(card as CardCode)}${highlight ? ', winning card' : ''}`;
  return (
    <span className={classes} style={style} role="img" aria-label={spoken}>
      <span className="jpb-card__corner" aria-hidden="true">
        <span className="jpb-card__rank">{rank}</span>
        <span className="jpb-card__suit">{suit}</span>
      </span>
      <span className="jpb-card__pip" aria-hidden="true">
        {suit}
      </span>
    </span>
  );
}
