import type { ActionType, CardCode, PublicSeatView } from '@jpb/shared-types';
import { lastActionLabel } from '../actionLogic';
import { cx } from '../cx';
import { formatChips, formatChipsCompact, initials } from '../format';
import { ActionTimer } from './ActionTimer';
import { HoleCards } from './HoleCards';
import type { CardSize } from './PlayingCard';
import { Badge } from './StatusPill';
import type { Tone } from './StatusPill';

export interface PlayerSeatProps {
  name: string;
  stack: number;
  /** 0-based seat index; shown to humans as index + 1. */
  seat?: number;
  isButton?: boolean;
  isSmallBlind?: boolean;
  isBigBlind?: boolean;
  /** Dealt into the current hand. */
  inHand?: boolean;
  folded?: boolean;
  allIn?: boolean;
  away?: boolean;
  /** False shows DISCONNECTED (text + icon dot), never just a gray avatar. */
  connected?: boolean;
  /** This seat is the one to act: green glow + "TO ACT" text label. */
  acting?: boolean;
  /** Timer for the acting seat. */
  deadline?: number | null;
  timerMs?: number;
  serverOffsetMs?: number;
  lastAction?: { action: ActionType; amount: number; toAmount: number } | null;
  /** Public showdown cards. */
  shownCards?: [CardCode, CardCode] | null;
  /** The viewer's own private cards (hero seat only). */
  holeCards?: [CardCode, CardCode] | null;
  /** Show two card backs when in hand and cards are not known. Default true. */
  showCardBacks?: boolean;
  /** Winner highlight: amount won this hand. */
  winAmount?: number | null;
  /** Hand description at showdown, e.g. "Full House, Kings full of Sevens". */
  handDescription?: string | null;
  winningCards?: CardCode[];
  /** The viewer (adds "YOU"). */
  hero?: boolean;
  /** Visual density. `pod` is the default table pod; `row` is a list row (admin). */
  layout?: 'pod' | 'row';
  cardSize?: CardSize;
  className?: string;
}

/** Map a server PublicSeatView into PlayerSeat props. */
export function seatPropsFromView(view: PublicSeatView): PlayerSeatProps {
  return {
    name: view.displayName,
    stack: view.stack,
    seat: view.seat,
    isButton: view.isButton,
    isSmallBlind: view.isSmallBlind,
    isBigBlind: view.isBigBlind,
    inHand: view.inHand,
    folded: view.folded,
    allIn: view.allIn,
    away: view.away,
    connected: view.connected,
    lastAction: view.lastAction,
    shownCards: view.shownCards,
  };
}

const STATUS_TONE: Readonly<Record<string, Tone>> = {
  'ALL-IN': 'warning',
  FOLDED: 'neutral',
  AWAY: 'neutral',
  DISCONNECTED: 'danger',
};

function statusText(p: PlayerSeatProps): string[] {
  const out: string[] = [];
  if (p.connected === false) out.push('DISCONNECTED');
  else if (p.away) out.push('AWAY');
  if (p.allIn) out.push('ALL-IN');
  else if (p.folded) out.push('FOLDED');
  return out;
}

/**
 * One player at the table. Every state has a text form: position badges
 * read "D / SB / BB" (spoken "Dealer button" etc.), FOLDED, ALL-IN,
 * AWAY / DISCONNECTED, "TO ACT", "WINNER +12,400".
 */
export function PlayerSeat(props: PlayerSeatProps) {
  const {
    name,
    stack,
    seat,
    isButton,
    isSmallBlind,
    isBigBlind,
    inHand = true,
    folded = false,
    allIn = false,
    connected = true,
    acting = false,
    deadline = null,
    timerMs = 0,
    serverOffsetMs = 0,
    lastAction,
    shownCards,
    holeCards,
    showCardBacks = true,
    winAmount,
    handDescription,
    winningCards,
    hero = false,
    layout = 'pod',
    cardSize = 'sm',
    className,
  } = props;

  const statuses = statusText(props);
  const winner = typeof winAmount === 'number' && winAmount > 0;
  const cards = holeCards ?? shownCards ?? null;
  const showCards = inHand && (cards !== null || (showCardBacks && !folded));
  const spoken = [
    hero ? `You, ${name}` : name,
    seat !== undefined ? `seat ${seat + 1}` : null,
    `stack ${formatChips(stack)} chips`,
    isButton ? 'dealer button' : null,
    isSmallBlind ? 'small blind' : null,
    isBigBlind ? 'big blind' : null,
    ...statuses.map((s) => s.toLowerCase()),
    acting ? 'to act' : null,
    lastAction ? `last action ${lastActionLabel(lastAction.action, lastAction.toAmount, lastAction.amount).toLowerCase()}` : null,
    winner ? `winner, won ${formatChips(winAmount)} chips` : null,
    handDescription ?? null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div
      className={cx(
        'jpb-seat',
        `jpb-seat--${layout}`,
        acting && 'is-acting',
        folded && 'is-folded',
        allIn && 'is-allin',
        !connected && 'is-offline',
        props.away && 'is-away',
        winner && 'is-winner',
        hero && 'is-hero',
        !inHand && 'is-sitting-out',
        className,
      )}
      role="group"
      aria-label={spoken}
    >
      {showCards && (
        <div className="jpb-seat__cards" aria-hidden={hero ? undefined : true}>
          <HoleCards cards={cards} size={cardSize} folded={folded} winningCards={winningCards} labelPrefix={hero ? 'Your cards' : `${name}'s cards`} />
        </div>
      )}
      <div className="jpb-seat__pod" aria-hidden="true">
        {acting && <span className="jpb-seat__toact">TO ACT</span>}
        {winner && <span className="jpb-seat__winner">WINNER +{formatChipsCompact(winAmount)}</span>}
        <div className="jpb-seat__avatar">
          {initials(name)}
          {acting && deadline !== null && timerMs > 0 && (
            <ActionTimer className="jpb-seat__timer" deadline={deadline} serverOffsetMs={serverOffsetMs} totalMs={timerMs} size="sm" announce={false} />
          )}
        </div>
        <div className="jpb-seat__info">
          <span className="jpb-seat__name">
            {hero && <span className="jpb-seat__you">YOU</span>}
            {name}
          </span>
          <span className="jpb-seat__stack jpb-num" title={`${formatChips(stack)} chips`}>
            {allIn && stack === 0 ? 'ALL-IN' : formatChipsCompact(stack)}
          </span>
        </div>
        <div className="jpb-seat__badges">
          {isButton && (
            <Badge tone="neutral" variant="solid" className="jpb-seat__dealer" srLabel="Dealer button">
              D
            </Badge>
          )}
          {isSmallBlind && <Badge tone="info" srLabel="Small blind">SB</Badge>}
          {isBigBlind && <Badge tone="info" srLabel="Big blind">BB</Badge>}
          {statuses.map((s) => (
            <Badge key={s} tone={STATUS_TONE[s] ?? 'neutral'} variant={s === 'ALL-IN' ? 'solid' : 'soft'}>
              {s}
            </Badge>
          ))}
        </div>
        {lastAction && !acting && !winner && (
          <span className={cx('jpb-seat__last', `jpb-seat__last--${lastAction.action.toLowerCase()}`)}>
            {lastActionLabel(lastAction.action, lastAction.toAmount, lastAction.amount)}
          </span>
        )}
        {handDescription && <span className="jpb-seat__hand">{handDescription}</span>}
      </div>
    </div>
  );
}
