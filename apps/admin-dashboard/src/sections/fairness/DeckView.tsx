import { useMemo } from 'react';
import type { HandFairnessRecord, HandVerificationResult } from '@jpb/shared-types';
import { PlayingCard, cardLabel, cx } from '@jpb/ui';
import { deckRoles } from './engine';
import type { DeckRole } from './engine';

function roleText(r: DeckRole): string {
  switch (r.kind) {
    case 'hole':
      return `S${r.seat + 1}·${r.card}`;
    case 'burn':
      return 'Burn';
    case 'board':
      return r.name;
    default:
      return '';
  }
}

function roleSpoken(r: DeckRole): string {
  switch (r.kind) {
    case 'hole':
      return `seat ${r.seat + 1}, hole card ${r.card}`;
    case 'burn':
      return `burn before the ${r.street}`;
    case 'board':
      return r.dealt ? r.name.toLowerCase() : `${r.name.toLowerCase()}, not dealt`;
    default:
      return 'not used in this hand';
  }
}

/**
 * The deck derived in the browser from the revealed seed, top card first,
 * with what each position was dealt as. Positions whose published card
 * differs from the derived one are flagged (icon + text, not color only).
 */
export function DeckView({ record, result }: { record: HandFairnessRecord; result: HandVerificationResult }) {
  const derived = result.derived;
  const model = useMemo(() => {
    if (!derived?.deal) return null;
    const order = derived.deal.holeCards.map((h) => h.seat);
    const roles = deckRoles(order, record.board.length);
    const published = new Map(record.holeCards.map((h) => [h.seat, h.cards]));
    const bad = new Set<number>();
    const shownAt = new Map<number, string>();
    roles.forEach((r, i) => {
      if (r.kind === 'hole') {
        const cards = published.get(r.seat) ?? null;
        if (cards) {
          shownAt.set(i, cards[r.card - 1]!);
          if (cards[r.card - 1] !== derived.deck[i]) bad.add(i);
        }
      } else if (r.kind === 'board' && r.dealt) {
        const k = ['Flop 1', 'Flop 2', 'Flop 3', 'Turn', 'River'].indexOf(r.name);
        const card = record.board[k];
        if (card) {
          shownAt.set(i, card);
          if (card !== derived.deck[i]) bad.add(i);
        }
      } else if (r.kind === 'burn' && record.burns) {
        const k = ['flop', 'turn', 'river'].indexOf(r.street);
        const card = record.burns[k];
        if (card) {
          shownAt.set(i, card);
          if (card !== derived.deck[i]) bad.add(i);
        }
      }
    });
    return { roles, bad, shownAt };
  }, [derived, record]);

  if (!derived || !model) return null;
  return (
    <figure className="acr-fair-deck">
      <figcaption className="acr-fair-deck__cap">
        <span>Deck derived in this browser — top card first (position 1)</span>
        <span className="acr-fair-deck__legend" aria-hidden="true">
          <span className="is-hole">Hole card</span>
          <span className="is-burn">Burn</span>
          <span className="is-board">Board</span>
          <span className="is-unused">Not used</span>
        </span>
      </figcaption>
      <ol className="acr-fair-deck__grid">
        {derived.deck.map((card, i) => {
          const role = model.roles[i]!;
          const bad = model.bad.has(i);
          const used = role.kind === 'hole' || role.kind === 'burn' || (role.kind === 'board' && role.dealt);
          return (
            <li
              key={i}
              className={cx('acr-fair-deck__cell', `is-${role.kind}`, !used && 'is-idle', bad && 'is-bad')}
              aria-label={`Position ${i + 1}: ${cardLabel(card)}, ${roleSpoken(role)}${bad ? `. MISMATCH: published ${model.shownAt.get(i) ?? '?'}` : ''}`}
            >
              <span className="acr-fair-deck__pos" aria-hidden="true">
                {i + 1}
              </span>
              <PlayingCard card={card} size="xs" dimmed={!used} label={cardLabel(card)} />
              <span className="acr-fair-deck__role" aria-hidden="true">
                {bad ? `≠ ${model.shownAt.get(i) ?? '?'}` : roleText(role)}
              </span>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}
