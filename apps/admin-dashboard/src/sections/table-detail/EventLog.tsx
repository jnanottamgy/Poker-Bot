import { useId, useState } from 'react';
import type { TableEvent, TableEventPayload } from '@jpb/shared-types';
import { Button, EmptyState, ErrorState, Icon, Panel, Skeleton, cardShort, cx, formatChips, formatCount } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import { friendlyError } from '../../api/errors';
import { useQuery } from '../../api/query/useQuery';
import { formatTimeOfDay } from '../../lib/time';

export const EVENT_PAGE_SIZES = [25, 50, 100, 200] as const;
const DEFAULT_PAGE_SIZE = 50;

/** One-line human summary of a raw event (the full JSON is one click away). */
export function eventSummary(e: TableEventPayload): string {
  switch (e.kind) {
    case 'HAND_STARTED':
      return `Hand #${formatCount(e.handNumber)} · button seat ${e.buttonSeat + 1} · blinds ${formatChips(e.smallBlind)}/${formatChips(e.bigBlind)}${e.ante ? ` ante ${formatChips(e.ante)}` : ''} · ${e.players.length} players`;
    case 'FORCED_BET_POSTED':
      return `Seat ${e.seat + 1} posts ${e.betType.replace('_', ' ').toLowerCase()} ${formatChips(e.amount)}${e.allIn ? ' (all-in)' : ''}`;
    case 'HOLE_CARDS_DEALT':
      return `Seat ${e.seat + 1} dealt (private)`;
    case 'STREET_STARTED':
      return `${e.street} ${e.newCards.map(cardShort).join(' ')} · pot ${formatChips(e.pot)}`;
    case 'TURN_TO_ACT':
      return `Seat ${e.seat + 1} to act`;
    case 'PLAYER_ACTED':
      return `Seat ${e.seat + 1} ${e.action}${e.amount ? ` ${formatChips(e.amount)}` : ''}${e.toAmount ? ` (to ${formatChips(e.toAmount)})` : ''}${e.allIn ? ' all-in' : ''}${e.timeout ? ' · timeout' : ''}`;
    case 'BETTING_ROUND_COMPLETE':
      return `${e.street} betting complete · pot ${formatChips(e.pot)}`;
    case 'UNCALLED_BET_RETURNED':
      return `Seat ${e.seat + 1} uncalled ${formatChips(e.amount)} returned`;
    case 'SHOWDOWN':
      return `Showdown · ${e.reveals.map((r) => `seat ${r.seat + 1} ${r.cards ? r.cards.map(cardShort).join(' ') : 'mucks'}`).join(' · ')}`;
    case 'POT_AWARDED':
      return `${e.potType === 'MAIN' ? 'Main pot' : `Side pot ${e.potIndex}`} ${formatChips(e.amount)} → ${e.winners.map((w) => `seat ${w.seat + 1} ${formatChips(w.amount)}`).join(', ')}`;
    case 'HAND_COMPLETED':
      return `Hand #${formatCount(e.handNumber)} complete · pot ${formatChips(e.totalPot)}${e.bustedSeats.length ? ` · busted ${e.bustedSeats.map((s) => s + 1).join(', ')}` : ''}`;
    case 'TABLE_CREATED':
      return `Table ${e.tableNumber} created (${e.maxSeats} seats)`;
    case 'PLAYER_SEATED':
      return `${e.displayName} seated at seat ${e.seat + 1} with ${formatChips(e.stack)}`;
    case 'PLAYER_REMOVED':
      return `Seat ${e.seat + 1} removed (${e.reason.toLowerCase().replace('_', ' ')}) with ${formatChips(e.stack)}`;
    case 'BLINDS_SCHEDULED':
      return `Blinds level ${e.blinds.level}: ${formatChips(e.blinds.smallBlind)}/${formatChips(e.blinds.bigBlind)}${e.blinds.ante ? ` ante ${formatChips(e.blinds.ante)}` : ''}`;
    case 'TABLE_STATUS_CHANGED':
      return `Status ${e.status}${e.holds.length ? ` · holds ${e.holds.join(', ')}` : ''}${e.frozen ? ' · FROZEN' : ''}`;
    case 'ACTION_REQUESTED':
      return `Seat ${e.seat + 1} asked to act · ${Math.round(e.timerMs / 1000)}s · turn v${e.turnVersion}`;
    case 'PLAYER_CONNECTION_CHANGED':
      return `Seat ${e.seat + 1} ${e.connected ? 'connected' : 'disconnected'}`;
    case 'STACK_ADJUSTED':
      return `Seat ${e.seat + 1} stack ${formatChips(e.before)} → ${formatChips(e.after)}`;
    case 'HAND_RESULT':
      return `Hand #${formatCount(e.result.handNumber)} reported to the director · table chips ${formatChips(e.result.totalChipsAtTable)}`;
    case 'INTEGRITY_VIOLATION':
      return `${e.code}: ${e.detail}`;
    default:
      return '';
  }
}

const IMPORTANT = new Set(['INTEGRITY_VIOLATION', 'STACK_ADJUSTED', 'TABLE_STATUS_CHANGED', 'PLAYER_REMOVED']);

function EventRow({ e }: { e: TableEvent }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <li className={cx('acr-td-ev', IMPORTANT.has(e.event.kind) && 'is-important', e.event.kind === 'INTEGRITY_VIOLATION' && 'is-bad')}>
      <button type="button" className="acr-td-ev__row" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} className="acr-td-ev__chev" />
        <span className="acr-td-ev__seq jpb-num">{e.seq}</span>
        <span className="acr-td-ev__ver jpb-num">v{e.version}</span>
        <time className="acr-td-ev__time jpb-num">{formatTimeOfDay(e.at)}</time>
        <span className="acr-td-ev__kind jpb-mono">{e.event.kind}</span>
        <span className="acr-td-ev__sum">{eventSummary(e.event)}</span>
      </button>
      {open && (
        <pre id={id} className="acr-td-ev__json jpb-mono">
          {JSON.stringify(e, null, 2)}
        </pre>
      )}
    </li>
  );
}

/** Raw, paginated event log of the table (forward cursor `after` + `limit`; private hole-card events are never included). */
export function EventLog({ tableId, lastEventSeq }: { tableId: string; lastEventSeq: number }) {
  const api = useApi();
  const sizeId = useId();
  const [limit, setLimit] = useState<number>(DEFAULT_PAGE_SIZE);
  const [after, setAfter] = useState<number | null>(null);
  // Default: the newest page.
  const cursor = after ?? Math.max(0, lastEventSeq - limit);
  const q = { after: cursor, limit };
  const res = useQuery(['table', tableId, 'events', q], (s) => api.tables.events(tableId, q, s), { staleMs: 30_000 });
  const events = res.data?.events ?? [];
  const following = after === null;
  const first = events[0]?.seq ?? cursor + 1;
  const last = events[events.length - 1]?.seq ?? cursor;

  return (
    <Panel
      title="Raw event log"
      icon="file"
      flush
      className="acr-td-events"
      description={`Every public event of this table in sequence order. Hole cards are never included. Latest seq ${formatCount(lastEventSeq)}.`}
      actions={
        <div className="acr-td-events__nav" role="group" aria-label="Event log pages">
          <span className="jpb-select-wrap acr-td-events__size">
            <label htmlFor={sizeId} className="jpb-sr-only">
              Events per page
            </label>
            <select id={sizeId} className="jpb-input jpb-select" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
              {EVENT_PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n} / page
                </option>
              ))}
            </select>
            <Icon name="chevron-down" className="jpb-select__chevron" />
          </span>
          <Button size="sm" variant="ghost" icon="skip-forward" className="acr-td-flip" onClick={() => setAfter(0)} disabled={cursor === 0} aria-label="First page">
            First
          </Button>
          <Button size="sm" variant="ghost" icon="chevron-left" onClick={() => setAfter(Math.max(0, cursor - limit))} disabled={cursor === 0}>
            Older
          </Button>
          <Button size="sm" variant="ghost" iconRight="chevron-right" onClick={() => res.data?.nextAfter !== null && res.data?.nextAfter !== undefined && setAfter(res.data.nextAfter)} disabled={!res.data || res.data.nextAfter === null}>
            Newer
          </Button>
          <Button size="sm" variant={following ? 'secondary' : 'ghost'} icon="skip-forward" onClick={() => setAfter(null)} aria-pressed={following}>
            Latest
          </Button>
        </div>
      }
    >
      {res.isLoading ? (
        <div className="acr-td-events__loading" aria-busy="true" aria-label="Loading events">
          <Skeleton lines={6} />
        </div>
      ) : !res.data && res.error ? (
        <ErrorState title="Could not load the event log" description={friendlyError(res.error).description} onRetry={() => void res.refetch()} />
      ) : events.length === 0 ? (
        <EmptyState compact icon="file" title="No events on this page" description="Try the latest page or an earlier one." />
      ) : (
        <>
          <p className="acr-td-events__range">
            Showing seq <span className="jpb-num">{formatCount(first)}</span>–<span className="jpb-num">{formatCount(last)}</span> ({events.length} events){following ? ' · newest page' : ''}
          </p>
          <ol className="acr-td-events__list" aria-label="Table events">
            {events.map((e) => (
              <EventRow key={e.seq} e={e} />
            ))}
          </ol>
        </>
      )}
    </Panel>
  );
}
