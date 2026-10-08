import type { ActionType, CardCode, PublicSeatView } from '@jpb/shared-types';
import { lastActionLabel } from '../actionLogic';
import { cx } from '../cx';
import { cardLabel, formatChips, formatChipsCompact, initials, shortName } from '../format';
import { ActionTimer } from './ActionTimer';
import { HoleCards } from './HoleCards';
import { Icon } from './Icon';
import type { CardSize } from './PlayingCard';
import { Badge } from './StatusPill';

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
  /**
   * Chips in front this street. The table renders bets on the felt in the wide
   * layout; inside the pod (tall layout) it is shown only when no last-action
   * chip already states it (e.g. posted blinds).
   */
  bet?: number;
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
    bet: view.streetContribution,
  };
}

/** Verb and amount of a last action, split for the two-line chip ("RAISE" over "2,400"). */
export function lastActionParts(action: ActionType, toAmount: number, amount: number): { verb: string; amount: number | null } {
  switch (action) {
    case 'FOLD':
      return { verb: 'FOLD', amount: null };
    case 'CHECK':
      return { verb: 'CHECK', amount: null };
    case 'CALL':
      return { verb: 'CALL', amount };
    case 'BET':
      return { verb: 'BET', amount: toAmount };
    case 'RAISE':
      return { verb: 'RAISE', amount: toAmount };
    case 'ALL_IN':
      return { verb: 'ALL-IN', amount: toAmount };
    default:
      return { verb: String(action).replace(/_/g, ' '), amount: null };
  }
}

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
 * read "D / SB / BB" (spoken "Dealer button" etc.), FOLDED, ALL-IN (in the
 * stack line), AWAY / OFFLINE (icon after the name + text badge where there is
 * room), "TO ACT", "WINNER +12,400". The whole seat is one labelled group so a
 * screen reader hears it in one sentence, including cards shown at showdown.
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
    away = false,
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
    bet = 0,
    className,
  } = props;

  const statuses = statusText(props);
  const winner = typeof winAmount === 'number' && winAmount > 0;
  const cards = holeCards ?? shownCards ?? null;
  const showCards = inHand && (cards !== null || (showCardBacks && !folded));
  const faceUp = showCards && cards !== null;
  const spoken = [
    hero ? `You, ${name}` : name,
    seat !== undefined ? `seat ${seat + 1}` : null,
    allIn && stack === 0 ? 'all-in, no chips behind' : `stack ${formatChips(stack)} chips`,
    isButton ? 'dealer button' : null,
    isSmallBlind ? 'small blind' : null,
    isBigBlind ? 'big blind' : null,
    ...statuses.map((s) => s.toLowerCase()),
    acting ? 'to act' : null,
    lastAction ? `last action ${lastActionLabel(lastAction.action, lastAction.toAmount, lastAction.amount).toLowerCase()}` : null,
    // The card images are hidden to avoid double reading, so say them here.
    !hero && shownCards ? `shows ${shownCards.map(cardLabel).join(' and ')}` : null,
    winner ? `winner, won ${formatChips(winAmount)} chips` : null,
    handDescription ?? null,
  ]
    .filter(Boolean)
    .join(', ');

  const last = lastAction && !acting && !winner && !folded ? lastActionParts(lastAction.action, lastAction.toAmount, lastAction.amount) : null;
  const lastIsAllIn = lastAction?.action === 'ALL_IN';

  return (
    <div
      className={cx(
        'jpb-seat',
        `jpb-seat--${layout}`,
        acting && 'is-acting',
        folded && 'is-folded',
        allIn && 'is-allin',
        !connected && 'is-offline',
        away && 'is-away',
        winner && 'is-winner',
        hero && 'is-hero',
        !inHand && 'is-sitting-out',
        faceUp && 'has-shown',
        bet > 0 && 'has-bet',
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
        <div className="jpb-seat__avatar">
          {initials(name)}
          {acting && deadline !== null && timerMs > 0 && (
            <ActionTimer className="jpb-seat__timer" deadline={deadline} serverOffsetMs={serverOffsetMs} totalMs={timerMs} size="sm" />
          )}
        </div>
        <div className="jpb-seat__info">
          <span className="jpb-seat__name" title={name}>
            {hero && <span className="jpb-seat__you">YOU</span>}
            <span className="jpb-seat__fullname">{name}</span>
            <span className="jpb-seat__shortname">{shortName(name)}</span>
            {!connected && <Icon name="wifi-off" className="jpb-seat__stateicon is-offline" />}
            {connected && away && <Icon name="moon" className="jpb-seat__stateicon" />}
          </span>
          <span className="jpb-seat__stackline">
            <span className={cx('jpb-seat__stack', 'jpb-num', allIn && 'is-allin')} title={`${formatChips(stack)} chips`}>
              {allIn ? 'ALL-IN' : formatChipsCompact(stack)}
            </span>
            {isButton && (
              <Badge tone="neutral" variant="solid" className="jpb-seat__dealer">
                D
              </Badge>
            )}
            {isSmallBlind && <Badge tone="info">SB</Badge>}
            {isBigBlind && <Badge tone="info">BB</Badge>}
          </span>
        </div>
        <div className="jpb-seat__tags">
          {acting && <span className="jpb-seat__flag jpb-seat__flag--act">TO ACT</span>}
          {winner && <span className="jpb-seat__flag jpb-seat__flag--win">WINNER +{formatChipsCompact(winAmount)}</span>}
          {folded && !allIn && <Badge className="jpb-seat__state">FOLDED</Badge>}
          {!connected && (
            <Badge tone="danger" className="jpb-seat__state jpb-seat__state--sec">
              <span className="jpb-seat__long">DISCONNECTED</span>
              <span className="jpb-seat__short">OFFLINE</span>
            </Badge>
          )}
          {connected && away && <Badge className="jpb-seat__state jpb-seat__state--sec">AWAY</Badge>}
          {last && (
            <span className={cx('jpb-seat__last', `jpb-seat__last--${lastAction?.action.toLowerCase()}`, last.amount === null && 'is-verb-only', lastIsAllIn && 'is-amount-only')}>
              {!lastIsAllIn && <span className="jpb-seat__lastverb">{last.verb}</span>}
              {last.amount !== null && <span className="jpb-seat__lastamt jpb-num">{formatChips(last.amount)}</span>}
            </span>
          )}
          {bet > 0 && !(lastAction && !folded) && (
            <span className="jpb-seat__bet jpb-num">
              <span className="jpb-chip" />
              {formatChips(bet)}
            </span>
          )}
        </div>
        {handDescription && <span className="jpb-seat__hand">{handDescription}</span>}
      </div>
    </div>
  );
}
