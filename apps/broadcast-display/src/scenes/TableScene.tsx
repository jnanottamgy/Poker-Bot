import { cx, formatChips, formatCount, formatMoneyMinor, formatOrdinal } from '@jpb/ui';
import { BroadcastTable } from '../components/BroadcastTable';
import { blindsText } from '../model/events';
import type { DisplayState } from '../model/types';

export interface TableSceneProps {
  state: DisplayState;
  serverNow: number;
  final: boolean;
}

/** FEATURED TABLE and FINAL TABLE (gold dressing plus the pay ladder). */
export function TableScene({ state, serverNow, final }: TableSceneProps) {
  const view = state.featured!;
  const players = view.seats.filter((s) => s !== null).length;
  const places = state.info?.places ?? [];
  const remaining = state.tournament?.counters.active ?? players;
  const currency = state.info?.currency ?? 'INR';
  return (
    <section className={cx('bd-scene', 'bd-tablescene', final && 'bd-tablescene--final')} aria-label={final ? 'Final table' : 'Featured table'}>
      <div className="bd-tablescene__head">
        <div>
          <span className={cx('bd-eyebrow', final && 'bd-eyebrow--gold')}>{final ? 'Final table' : 'Featured table'}</span>
          <span className="bd-tablescene__title">
            Table {view.tableNumber}
            {view.hand && <span className="bd-tablescene__hand">Hand #{formatCount(view.hand.handNumber)}</span>}
          </span>
        </div>
        <div className="bd-tablescene__meta">
          <span className="bd-tablescene__blinds">{blindsText({ smallBlind: view.blinds.smallBlind, bigBlind: view.blinds.bigBlind, ante: view.blinds.ante })}</span>
          <span className="bd-tablescene__players">{formatCount(players)} players at the table</span>
        </div>
      </div>
      <div className="bd-tablescene__body">
        <div className="bd-table-holder">
          <BroadcastTable view={view} showdown={state.showdown} turn={state.turn} serverNow={serverNow} final={final} />
        </div>
        {final && places.length > 0 && (
          <aside className="bd-payouts" aria-label="Payouts">
            <span className="bd-eyebrow bd-eyebrow--gold">Pay ladder</span>
            <ol className="bd-payouts__list">
              {places
                .slice()
                .sort((a, b) => a.position - b.position)
                .map((p) => (
                  <li key={p.position} className={cx('bd-payouts__row', p.position === remaining && 'is-next', p.position > remaining && 'is-paid')}>
                    <span className="bd-payouts__pos">{formatOrdinal(p.position)}</span>
                    <span className="bd-payouts__amt">{formatMoneyMinor(p.amountMinor, currency)}</span>
                  </li>
                ))}
            </ol>
            <span className="bd-payouts__foot">Chips in play {formatChips(state.tournament?.counters.totalChips ?? 0)}</span>
          </aside>
        )}
      </div>
    </section>
  );
}
