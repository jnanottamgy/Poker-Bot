import { Link } from 'react-router';
import type { CardCode } from '@jpb/shared-types';
import { ActionTimer, Badge, HoleCards, Icon, Menu, cx, formatChips, lastActionLabel } from '@jpb/ui';
import type { MenuItem } from '@jpb/ui';
import type { SeatModel } from './model';

export interface SeatCardProps {
  model: SeatModel;
  /** Revealed hole cards for this seat (only when the operator chose to show them). */
  holeCards: [CardCode, CardCode] | null;
  playerHref: string;
  /** Countdown for the acting seat. */
  deadline: number | null;
  timerMs: number;
  serverOffsetMs: number;
  menu: Array<MenuItem | 'separator'>;
  className?: string;
}

/** Spoken summary of a seat (the card's visual parts are aria-hidden). */
export function seatSentence(m: SeatModel, revealed: [CardCode, CardCode] | null): string {
  return [
    `Seat ${m.seat + 1}`,
    m.name,
    m.publicId,
    `stack ${formatChips(m.stack)} chips${m.bb !== null ? `, ${m.bb} big blinds` : ''}`,
    m.isButton ? 'dealer button' : null,
    m.isSmallBlind ? 'small blind' : null,
    m.isBigBlind ? 'big blind' : null,
    m.status.text.toLowerCase(),
    ...m.flags.map((f) => f.text.toLowerCase()),
    m.acting ? 'to act' : null,
    m.folded ? 'folded' : m.allIn ? 'all-in' : m.inHand ? 'in the hand' : 'not in the hand',
    m.lastAction ? `last action ${lastActionLabel(m.lastAction.action, m.lastAction.toAmount, m.lastAction.amount).toLowerCase()}` : null,
    m.streetContribution > 0 ? `${formatChips(m.streetContribution)} in front this street` : null,
    revealed ? `hole cards revealed` : null,
  ]
    .filter(Boolean)
    .join(', ');
}

/** Admin seat: identity, stack (chips + BB), D/SB/BB, connection and sanctions, timeouts, last action, street contribution. */
export function SeatCard({ model: m, holeCards, playerHref, deadline, timerMs, serverOffsetMs, menu, className }: SeatCardProps) {
  const cards = holeCards ?? m.shownCards;
  const showCards = cards !== null;
  return (
    <article
      className={cx('acr-td-seat', m.acting && 'is-acting', m.folded && 'is-folded', !m.inHand && 'is-out', m.allIn && 'is-allin', !m.connected && 'is-offline', m.suspended && 'is-suspended', className)}
      aria-label={seatSentence(m, holeCards)}
      data-seat={m.seat}
    >
      {showCards && (
        <div className={cx('acr-td-seat__cards', holeCards && 'is-revealed')} aria-hidden="true">
          <HoleCards cards={cards} size="xs" folded={m.folded} labelPrefix={`${m.name}'s cards`} />
        </div>
      )}
      <header className="acr-td-seat__head">
        <span className="acr-td-seat__no jpb-num" aria-hidden="true">
          {m.seat + 1}
        </span>
        <Link to={playerHref} className="acr-td-seat__name" title={`${m.name} — open player detail`}>
          {m.name}
        </Link>
        <span className="acr-td-seat__pos" aria-hidden="true">
          {m.isButton && (
            <Badge variant="solid" className="acr-td-seat__dealer">
              D
            </Badge>
          )}
          {m.isSmallBlind && <Badge tone="info">SB</Badge>}
          {m.isBigBlind && <Badge tone="info">BB</Badge>}
        </span>
        <Menu label={`Actions for ${m.name}, seat ${m.seat + 1}`} items={menu} className="acr-td-seat__menu" />
      </header>
      <div className="acr-td-seat__id jpb-mono" aria-hidden="true" title="Public id">
        {m.publicId}
      </div>
      <div className="acr-td-seat__stack" aria-hidden="true">
        <span className="jpb-num acr-td-seat__chips">{m.allIn && m.stack === 0 ? 'ALL-IN' : formatChips(m.stack)}</span>
        {m.bb !== null && <span className="jpb-num acr-td-seat__bb">{m.bb} BB</span>}
      </div>
      <div className="acr-td-seat__state" aria-hidden="true">
        <span className={cx('acr-td-flag', `is-${m.status.tone}`)}>
          <Icon name={m.status.icon} />
          {m.status.text}
        </span>
        {m.flags.map((f) => (
          <span key={f.key} className={cx('acr-td-flag', `is-${f.tone}`)} title={f.text}>
            <Icon name={f.icon} />
            {f.key === 'to' ? `${m.consecutiveTimeouts}× timeout` : f.key === 'transit' ? 'In transit' : f.text}
          </span>
        ))}
      </div>
      <footer className="acr-td-seat__act" aria-hidden="true">
        {m.acting ? (
          <span className="acr-td-seat__toact">
            {deadline !== null && timerMs > 0 && <ActionTimer deadline={deadline} serverOffsetMs={serverOffsetMs} totalMs={timerMs} size="sm" showCaption={false} />}
            TO ACT
          </span>
        ) : m.folded ? (
          <span className="acr-td-seat__last is-fold">FOLDED</span>
        ) : m.lastAction ? (
          <span className={cx('acr-td-seat__last', `is-${m.lastAction.action.toLowerCase()}`)}>{lastActionLabel(m.lastAction.action, m.lastAction.toAmount, m.lastAction.amount)}</span>
        ) : (
          <span className="acr-td-seat__last is-none">{m.inHand ? 'No action yet' : m.waitingForNextHand ? 'Waiting for next hand' : 'Not in hand'}</span>
        )}
        {m.streetContribution > 0 && (
          <span className="acr-td-seat__in" title="Chips put in on the current street">
            <span className="acr-td-chip" /> <span className="jpb-num">{formatChips(m.streetContribution)}</span>
          </span>
        )}
      </footer>
    </article>
  );
}
