import type { CSSProperties } from 'react';
import type { ActionType, CardCode, PublicSeatView, SpectatorTableView } from '@jpb/shared-types';
import { PlayingCard, cx, formatChips, formatClock, initials } from '@jpb/ui';
import { betPosition, formatBB, seatPositions } from '../model/derive';
import type { ShowdownState, TurnState } from '../model/types';

const ACTION_LABEL: Readonly<Record<ActionType, string>> = {
  FOLD: 'Fold',
  CHECK: 'Check',
  CALL: 'Call',
  BET: 'Bet',
  RAISE: 'Raise to',
  ALL_IN: 'All-in',
};

/** Below these fractions of the action time the ring turns warning, then danger. */
const RING_WARN = 0.35;
const RING_DANGER = 0.15;

export interface BroadcastTableProps {
  view: SpectatorTableView;
  showdown: ShowdownState | null;
  turn: TurnState | null;
  serverNow: number;
  final?: boolean;
}

/** The featured table, broadcast-sized: oval felt, seats on the rail, bets, board, pot, timer ring, showdown. */
export function BroadcastTable({ view, showdown, turn, serverNow, final = false }: BroadcastTableProps) {
  const positions = seatPositions(view.maxSeats);
  const hand = view.hand;
  const board: CardCode[] = hand?.board.length ? hand.board : (showdown?.board ?? []);
  const winners = showdown && Object.keys(showdown.winners).length > 0 ? showdown.winners : null;
  const best = new Set(winners ? showdown!.bestFive : []);
  const bb = view.blinds.bigBlind;
  const pot = hand ? hand.totalPot : 0;
  return (
    <div className={cx('bd-table', final && 'bd-table--final', view.frozen && 'is-frozen')}>
      <div className="bd-table__rail">
        <div className="bd-table__felt">
          <div className="bd-table__center">
            <div className="bd-table__pot">
              {winners ? (
                <>
                  <span className="bd-table__pot-label">{showdown!.description ?? 'Pot awarded'}</span>
                  <span className="bd-table__pot-value bd-table__pot-value--win">{formatChips(Object.values(winners).reduce((a, b) => a + b, 0))}</span>
                </>
              ) : hand ? (
                <>
                  <span className="bd-table__pot-label">{phaseLabel(hand.phase)} · Pot</span>
                  <span className="bd-table__pot-value">{formatChips(pot)}</span>
                </>
              ) : (
                <span className="bd-table__pot-label">{view.frozen ? 'Table frozen' : view.status === 'HELD' ? 'Table on hold' : 'Next hand shortly'}</span>
              )}
            </div>
            <div className="bd-board" role="group" aria-label={board.length ? `Board: ${board.join(' ')}` : 'Board: no cards yet'}>
              {Array.from({ length: 5 }, (_, i) => {
                const c = board[i];
                return c ? (
                  <PlayingCard key={c} card={c} size="xl" className="bd-card bd-card--board" flip highlight={winners !== null && best.has(c)} dimmed={winners !== null && best.size > 0 && !best.has(c)} />
                ) : (
                  <span key={`slot${i}`} className="bd-board__slot" aria-hidden="true" />
                );
              })}
            </div>
          </div>
        </div>
      </div>
      {view.seats.map((seat, i) => {
        const p = positions[i];
        if (!p) return null;
        if (!seat) return <EmptySeat key={`e${i}`} x={p.x} y={p.y} />;
        const won = winners?.[seat.seat] ?? 0;
        const acting = hand?.actingSeat === seat.seat && turn?.seat === seat.seat;
        const fraction = acting && turn ? Math.max(0, Math.min(1, (turn.deadline - serverNow) / turn.totalMs)) : null;
        const remaining = acting && turn ? Math.max(0, turn.deadline - serverNow) : null;
        const bet = seat.streetContribution;
        const bp = betPosition(p);
        return (
          <div key={seat.playerId} className="bd-seat-wrap">
            <Seat seat={seat} x={p.x} y={p.y} bb={bb} won={won} fraction={fraction} remainingMs={remaining} reveal={showdown?.reveals[seat.seat] ?? null} best={best} showCards={!!hand} />
            {bet > 0 && (
              <span className="bd-bet" style={{ left: `${bp.x}%`, top: `${bp.y}%` }}>
                <span className="bd-bet__chip" aria-hidden="true" />
                {formatChips(bet)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface SeatProps {
  seat: PublicSeatView;
  x: number;
  y: number;
  bb: number;
  won: number;
  fraction: number | null;
  remainingMs: number | null;
  reveal: string | null;
  best: Set<CardCode>;
  showCards: boolean;
}

function Seat({ seat, x, y, bb, won, fraction, remainingMs, reveal, best, showCards }: SeatProps) {
  const acting = fraction !== null;
  const ringTone = fraction === null ? '' : fraction < RING_DANGER ? 'danger' : fraction < RING_WARN ? 'warning' : 'accent';
  const style = { left: `${x}%`, top: `${y}%` } as CSSProperties;
  const label = won > 0 ? null : seat.lastAction ? actionText(seat.lastAction.action, seat.lastAction.toAmount, seat.allIn) : null;
  const shown = seat.shownCards;
  return (
    <div
      className={cx('bd-seat', seat.folded && 'is-folded', acting && 'is-acting', won > 0 && 'is-winner', !seat.connected && 'is-away', y < 50 && 'is-top')}
      style={style}
      aria-label={`${seat.displayName}, ${formatChips(seat.stack)} chips${acting ? ', to act' : ''}${won > 0 ? `, wins ${formatChips(won)}` : ''}`}
    >
      <div className="bd-seat__cards">
        {shown
          ? shown.map((c) => <PlayingCard key={c} card={c} size="lg" className="bd-card bd-card--hole" flip highlight={won > 0 && best.has(c)} />)
          : showCards && seat.inHand && !seat.folded
            ? [0, 1].map((k) => <PlayingCard key={k} card={null} size="sm" className="bd-card bd-card--back" />)
            : null}
      </div>
      <div className="bd-seat__plate">
        <span className="bd-seat__avatar" aria-hidden="true">
          {initials(seat.displayName)}
          {fraction !== null && (
            <svg className={cx('bd-ring', `bd-ring--${ringTone}`)} viewBox="0 0 44 44" aria-hidden="true">
              <circle className="bd-ring__track" cx="22" cy="22" r="20" />
              <circle className="bd-ring__bar" cx="22" cy="22" r="20" pathLength={100} strokeDasharray="100" strokeDashoffset={100 * (1 - fraction)} />
            </svg>
          )}
        </span>
        <span className="bd-seat__text">
          <span className="bd-seat__name">{seat.displayName}</span>
          <span className="bd-seat__stack">
            {seat.allIn && seat.stack === 0 ? 'All-in' : formatChips(seat.stack)}
            {bb > 0 && seat.stack > 0 && <span className="bd-seat__bb">{formatBB(seat.stack / bb)}</span>}
          </span>
        </span>
        {seat.isButton && (
          <span className="bd-dealer" aria-label="Dealer button">
            D
          </span>
        )}
      </div>
      <div className="bd-seat__tag">
        {won > 0 ? (
          <span className="bd-tag bd-tag--win">Wins {formatChips(won)}</span>
        ) : acting && remainingMs !== null ? (
          <span className="bd-tag bd-tag--act">To act · {formatClock(remainingMs)}</span>
        ) : reveal ? (
          <span className="bd-tag">{reveal}</span>
        ) : label ? (
          <span className={cx('bd-tag', seat.lastAction?.action === 'FOLD' && 'bd-tag--muted')}>{label}</span>
        ) : !seat.connected ? (
          <span className="bd-tag bd-tag--muted">Away</span>
        ) : null}
        {won > 0 && reveal && <span className="bd-tag bd-tag--hand">{reveal}</span>}
      </div>
    </div>
  );
}

function EmptySeat({ x, y }: { x: number; y: number }) {
  return <div className="bd-seat bd-seat--empty" style={{ left: `${x}%`, top: `${y}%` }} aria-hidden="true" />;
}

export function actionText(action: ActionType, toAmount: number, allIn: boolean): string {
  if (allIn) return `All-in ${formatChips(toAmount)}`;
  if (action === 'BET' || action === 'RAISE' || action === 'CALL') return `${ACTION_LABEL[action]} ${formatChips(toAmount)}`;
  return ACTION_LABEL[action];
}

function phaseLabel(phase: string): string {
  switch (phase) {
    case 'PREFLOP':
      return 'Pre-flop';
    case 'FLOP':
      return 'Flop';
    case 'TURN':
      return 'Turn';
    case 'RIVER':
      return 'River';
    case 'SHOWDOWN':
      return 'Showdown';
    default:
      return 'Hand';
  }
}
