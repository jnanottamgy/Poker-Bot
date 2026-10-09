import { useEffect, useRef } from 'react';
import { EmptyState, Icon, Panel, PlayingCard, cardLabel, cx, formatChips } from '@jpb/ui';
import type { CardCode } from '@jpb/shared-types';
import { formatTimeOfDay } from '../../lib/time';
import type { LogEntry, LogSource } from './model';

const SOURCE_TEXT: Readonly<Record<LogSource, string>> = {
  actor: 'From the table actor — authoritative, live',
  socket: 'Live WebSocket feed of this table (events since you opened it)',
  none: 'Waiting for the first action of this hand',
};

function Cards({ cards }: { cards: CardCode[] }) {
  return (
    <span className="acr-td-log__cards" role="img" aria-label={cards.map(cardLabel).join(', ')}>
      {cards.map((c) => (
        <PlayingCard key={c} card={c} size="xs" />
      ))}
    </span>
  );
}

/** Every forced bet and action of the hand in order, grouped by street; follows the newest entry while scrolled to the bottom. */
export function ActionLog({ entries, source, handNumber }: { entries: LogEntry[]; source: LogSource; handNumber: number | null }) {
  const ref = useRef<HTMLOListElement>(null);
  const pinned = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  return (
    <Panel title={handNumber !== null ? `Action log · hand #${handNumber}` : 'Action log'} icon="list" description={SOURCE_TEXT[entries.length ? source : 'none']} className="acr-td-logpanel" flush>
      {entries.length === 0 ? (
        <EmptyState compact icon="list" title="No actions yet" description="Forced bets and every decision of the hand appear here the moment the server applies them." />
      ) : (
        <ol
          ref={ref}
          className="acr-td-log"
          aria-label="Actions of this hand"
          aria-live="polite"
          aria-relevant="additions"
          onScroll={(e) => {
            const el = e.currentTarget;
            pinned.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
          }}
        >
          {entries.map((e) =>
            e.kind === 'street' ? (
              <li key={e.key} className="acr-td-log__street">
                <span>{e.text}</span>
                {e.cards && e.cards.length > 0 && <Cards cards={e.cards} />}
              </li>
            ) : (
              <li key={e.key} className={cx('acr-td-log__item', `is-${e.kind}`)}>
                {e.seat !== null && (
                  <span className="acr-td-log__seat jpb-num" aria-label={`Seat ${e.seat + 1}`}>
                    {e.seat + 1}
                  </span>
                )}
                <span className="acr-td-log__text">
                  {e.who && <strong>{e.who}</strong>} {e.text}
                  {e.amount !== null && (
                    <>
                      {' '}
                      <span className="jpb-num acr-td-log__amt">{formatChips(e.amount)}</span>
                    </>
                  )}
                  {e.cards && e.cards.length > 0 && <Cards cards={e.cards} />}
                </span>
                {e.tags.map((t) => (
                  <span key={t.text} className={cx('acr-td-flag', `is-${t.tone}`)}>
                    {t.icon && <Icon name={t.icon} />}
                    {t.text}
                  </span>
                ))}
                {e.at !== undefined && <time className="acr-td-log__time jpb-num">{formatTimeOfDay(e.at)}</time>}
              </li>
            ),
          )}
        </ol>
      )}
    </Panel>
  );
}
