import type { CSSProperties } from 'react';
import type { CardCode } from '@jpb/shared-types';
import { cx } from '../cx';
import type { SuitChar } from '@jpb/shared-types';
import { cardLabel, parseCard, rankDisplay, suitName } from '../format';

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
 * Suit shapes on a 24x24 grid, drawn (not text glyphs) so every platform shows
 * the same four-colour-ready shapes, never colour emoji, with equal visual mass.
 */
export function Suit({ suit, className }: { suit: SuitChar; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cx('jpb-suit', className)} aria-hidden="true" focusable="false">
      {suit === 's' && (
        <path d="M12 1.6c-2.4 3.3-8.6 7.4-8.6 11.8 0 2.7 2.1 4.6 4.6 4.6 1.2 0 2.3-.4 3.1-1.1-.3 2-1.2 3.6-2.8 5.1v.4h7.4v-.4c-1.6-1.5-2.5-3.1-2.8-5.1.8.7 1.9 1.1 3.1 1.1 2.5 0 4.6-1.9 4.6-4.6 0-4.4-6.2-8.5-8.6-11.8z" />
      )}
      {suit === 'h' && <path d="M12 21.6C6.3 16.9 2.2 13.3 2.2 8.7c0-3.1 2.4-5.5 5.4-5.5 1.9 0 3.5 1 4.4 2.5.9-1.5 2.5-2.5 4.4-2.5 3 0 5.4 2.4 5.4 5.5 0 4.6-4.1 8.2-9.8 12.9z" />}
      {suit === 'd' && <path d="M12 1.2 20.6 12 12 22.8 3.4 12z" />}
      {suit === 'c' && (
        <>
          <circle cx="12" cy="6.9" r="4.7" />
          <circle cx="6.7" cy="13.6" r="4.7" />
          <circle cx="17.3" cy="13.6" r="4.7" />
          <path d="M10.9 12.2h2.2c.1 4.2.9 7.1 3.3 9.4v.6H7.6v-.6c2.4-2.3 3.2-5.2 3.3-9.4z" />
        </>
      )}
    </svg>
  );
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
          <span className="jpb-card__monogram">
            <Suit suit="s" />
          </span>
        </span>
      </span>
    );
  }

  const rank = rankDisplay(parsed.rank);
  const spoken = label ?? `${cardLabel(card as CardCode)}${highlight ? ', winning card' : ''}`;
  return (
    <span className={classes} style={style} role="img" aria-label={spoken}>
      <span className="jpb-card__corner" aria-hidden="true">
        <span className="jpb-card__rank">{rank}</span>
        <span className="jpb-card__suit">
          <Suit suit={parsed.suit} />
        </span>
      </span>
      <span className="jpb-card__pip" aria-hidden="true">
        <Suit suit={parsed.suit} />
      </span>
    </span>
  );
}
