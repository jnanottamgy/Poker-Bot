import type { AdminTableView } from '@jpb/shared-types';
import { ActionTimer, Icon, Panel, StatusPill, formatChips, formatClock, formatCount, useServerCountdown } from '@jpb/ui';
import { formatTimeOfDay } from '../../lib/time';
import { HOLD_REASON_LABEL } from '../tables/tableStatus';
import { PHASE_LABEL, seatLabel } from './model';
import type { SeatModel } from './model';

export interface HandPanelProps {
  view: AdminTableView;
  seats: Array<SeatModel | null>;
  timerMs: number;
  serverOffsetMs: number;
}

function nameAt(seats: Array<SeatModel | null>, seat: number): string {
  return seats[seat]?.name ?? seatLabel(seat);
}

function Countdown({ deadline, offset }: { deadline: number | null; offset: number }) {
  const ms = useServerCountdown(deadline, offset, { intervalMs: 250 });
  return <span className="jpb-num">{formatClock(ms)}</span>;
}

function Acting({ view, seats, timerMs, serverOffsetMs }: HandPanelProps) {
  const hand = view.hand;
  if (!hand || hand.actingSeat === null) return null;
  const turn = view.turn ?? null;
  const frozenLeft = view.freeze?.turnRemainingMs ?? null;
  return (
    <div className="acr-td-acting" role="group" aria-label="Player to act">
      {hand.actionDeadline !== null && timerMs > 0 ? (
        <ActionTimer deadline={hand.actionDeadline} serverOffsetMs={serverOffsetMs} totalMs={timerMs} size="md" showCaption />
      ) : (
        <span className="acr-td-acting__frozen" aria-hidden="true">
          <Icon name="freeze" />
        </span>
      )}
      <div className="acr-td-acting__body">
        <p className="acr-td-acting__who">
          <span className="acr-td-acting__label">To act</span> {nameAt(seats, hand.actingSeat)} · {seatLabel(hand.actingSeat)}
        </p>
        <p className="acr-td-acting__meta">
          {hand.actionDeadline !== null ? (
            <>
              <Countdown deadline={hand.actionDeadline} offset={serverOffsetMs} /> left · deadline {formatTimeOfDay(hand.actionDeadline)}
            </>
          ) : view.frozen ? (
            <>Frozen — {frozenLeft !== null ? `${formatClock(frozenLeft)} preserved for when the table unfreezes` : 'remaining time preserved'}</>
          ) : (
            'No deadline running'
          )}
        </p>
        {turn && (
          <p className="acr-td-acting__meta">
            {turn.away ? 'Away timer' : 'Action timer'} {Math.round(turn.timerMs / 1000)}s
            {turn.addedMs > 0 ? ` · +${Math.round(turn.addedMs / 1000)}s added` : ''} · turn v{turn.turnVersion} · grace until {formatTimeOfDay(turn.hardDeadline)}
          </p>
        )}
      </div>
    </div>
  );
}

function Idle({ view, serverOffsetMs }: { view: AdminTableView; serverOffsetMs: number }) {
  const next = useServerCountdown(view.nextHandAt ?? null, serverOffsetMs, { intervalMs: 500 });
  if (view.status === 'CLOSED') return <p className="acr-td-idle">This table is closed.</p>;
  if (view.frozen) return <p className="acr-td-idle"><Icon name="freeze" /> Frozen between hands. Nothing is dealt until the table is unfrozen.</p>;
  if (view.status === 'HELD') return <p className="acr-td-idle"><Icon name="pause" /> Held — {view.holds.map((h) => HOLD_REASON_LABEL[h]).join(', ') || 'hold active'}. No new hand starts until released.</p>;
  if (view.status === 'WAITING') return <p className="acr-td-idle"><Icon name="moon" /> Waiting — fewer than two players can be dealt in{view.started === false ? ', or the table has not started' : ''}.</p>;
  return (
    <p className="acr-td-idle">
      <Icon name="skip-forward" /> Between hands{view.nextHandAt ? <> — next hand in <span className="jpb-num">{formatClock(next)}</span></> : ''}.
    </p>
  );
}

/** Current hand: number, phase, board, pots with eligible seats, current bet, acting seat with live countdown. */
export function HandPanel(props: HandPanelProps) {
  const { view, seats } = props;
  const hand = view.hand;
  const pos = view.positions;
  return (
    <Panel
      title={hand ? `Hand #${formatCount(hand.handNumber)}` : 'Current hand'}
      icon="layers"
      className="acr-td-hand"
      actions={hand ? <StatusPill size="sm" tone="info" icon="play" label={PHASE_LABEL[hand.phase]} /> : <StatusPill size="sm" tone="neutral" icon="pause" label="No hand" />}
    >
      {hand ? (
        <>
          <Acting {...props} />
          <table className="acr-td-pots">
            <caption className="jpb-sr-only">Pots and the seats eligible to win them</caption>
            <thead>
              <tr>
                <th scope="col">Pot</th>
                <th scope="col" className="is-num">
                  Amount
                </th>
                <th scope="col">Eligible seats</th>
              </tr>
            </thead>
            <tbody>
              {hand.pots.length === 0 ? (
                <tr>
                  <td colSpan={3} className="acr-td-muted">
                    Blinds and bets are still in front of the players.
                  </td>
                </tr>
              ) : (
                hand.pots.map((p, i) => (
                  <tr key={i}>
                    <th scope="row">{i === 0 ? 'Main pot' : `Side pot ${i}`}</th>
                    <td className="is-num jpb-num">{formatChips(p.amount)}</td>
                    <td>
                      <span className="acr-td-eligible">
                        {p.eligibleSeats.map((s) => (
                          <span key={s} className="acr-td-eligible__seat" title={nameAt(seats, s)}>
                            <span className="jpb-num">{s + 1}</span> {nameAt(seats, s)}
                          </span>
                        ))}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <dl className="acr-td-kv">
            <div>
              <dt>Total pot</dt>
              <dd className="jpb-num">{formatChips(hand.totalPot)}</dd>
            </div>
            <div>
              <dt>Current bet</dt>
              <dd className="jpb-num">{formatChips(hand.currentBet)}</dd>
            </div>
            <div>
              <dt>Blinds</dt>
              <dd className="jpb-num">
                {formatChips(view.blinds.smallBlind)} / {formatChips(view.blinds.bigBlind)}
                {view.blinds.ante > 0 ? ` · ante ${formatChips(view.blinds.ante)}` : ''}
              </dd>
            </div>
            <div>
              <dt>Positions</dt>
              <dd>
                {view.buttonSeat !== null ? `D ${view.buttonSeat + 1}` : 'D —'}
                {pos?.lastSmallBlindSeat !== null && pos?.lastSmallBlindSeat !== undefined ? ` · SB ${pos.lastSmallBlindSeat + 1}` : ''}
                {pos?.lastBigBlindSeat !== null && pos?.lastBigBlindSeat !== undefined ? ` · BB ${pos.lastBigBlindSeat + 1}` : ''}
              </dd>
            </div>
            <div className="is-wide">
              <dt>Hand id</dt>
              <dd className="jpb-mono acr-td-ellipsis" title={hand.handId}>
                {hand.handId}
              </dd>
            </div>
            {view.handDeckHash && (
              <div className="is-wide">
                <dt>Deck hash (SHA-256)</dt>
                <dd className="jpb-mono acr-td-ellipsis" title={view.handDeckHash}>
                  {view.handDeckHash}
                </dd>
              </div>
            )}
          </dl>
        </>
      ) : (
        <Idle view={view} serverOffsetMs={props.serverOffsetMs} />
      )}
      {(view.pendingBlinds || pos?.next) && (
        <p className="acr-td-nexthand">
          <Icon name="skip-forward" />
          Next hand:
          {pos?.next ? ` D ${pos.next.buttonSeat + 1} · SB ${pos.next.smallBlindPosition + 1}${pos.next.smallBlindPosted ? '' : ' (dead)'} · BB ${pos.next.bigBlindSeat + 1}${pos.next.headsUp ? ' · heads-up' : ''}` : ''}
          {view.pendingBlinds ? ` · blinds ${formatChips(view.pendingBlinds.smallBlind)} / ${formatChips(view.pendingBlinds.bigBlind)} (level ${view.pendingBlinds.level})` : ''}
        </p>
      )}
    </Panel>
  );
}
