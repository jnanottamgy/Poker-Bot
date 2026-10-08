import { useMemo } from 'react';
import type { PlayerTableView, SpectatorTableView, TableEvent } from '@jpb/shared-types';
import { EmptyState, cx } from '@jpb/ui';
import { buildHandLog } from './handLog';

/** Recent hands in words, newest first. */
export function HandLog({ events, view }: { events: readonly TableEvent[]; view: PlayerTableView | SpectatorTableView | null }) {
  const hands = useMemo(() => {
    const names = new Map<number, string>();
    for (const e of events) if (e.event.kind === 'PLAYER_SEATED') names.set(e.event.seat, e.event.displayName);
    view?.seats.forEach((s) => s && names.set(s.seat, s.displayName));
    const heroSeat = view?.audience === 'PLAYER' ? view.you.seat : null;
    return buildHandLog(events, { heroSeat, nameOf: (seat) => names.get(seat) ?? null });
  }, [events, view]);

  if (hands.length === 0) {
    return <EmptyState compact icon="list" title="No hands yet" description="Every action at your table appears here in plain words." />;
  }
  return (
    <ol className="pw-log" aria-label="Hand log, newest hand first">
      {hands.map((h) => (
        <li key={h.key} className="pw-log__hand">
          <p className="pw-log__title">{h.handNumber !== null ? `Hand #${h.handNumber.toLocaleString('en-US')}` : 'Table'}</p>
          <ul className="pw-log__lines">
            {h.lines.map((l) => (
              <li key={l.seq} className={cx('pw-log__line', `is-${l.tone}`)}>
                {l.text}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
