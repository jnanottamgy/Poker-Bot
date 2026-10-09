import type { ActionType, AdminTableView, CardCode, HandActionLogEntry, HandPhase, RemovalReason, Street, TableEvent } from '@jpb/shared-types';
import type { IconName, Tone } from '@jpb/ui';
import { formatChips } from '@jpb/ui';

/**
 * Display projections of the admin table view. Everything here only RE-SHAPES
 * what the server sent (labels, grouping); nothing is decided or computed
 * about the game itself.
 */

export const PHASE_LABEL: Readonly<Record<HandPhase, string>> = {
  HAND_CREATED: 'Starting',
  DEAL_HOLE_CARDS: 'Dealing',
  PREFLOP: 'Pre-flop',
  FLOP: 'Flop',
  TURN: 'Turn',
  RIVER: 'River',
  SHOWDOWN: 'Showdown',
  POT_DISTRIBUTION: 'Paying pots',
  HAND_COMPLETE: 'Complete',
};

export const STREET_LABEL: Readonly<Record<Street, string>> = { PREFLOP: 'Pre-flop', FLOP: 'Flop', TURN: 'Turn', RIVER: 'River' };

export const REMOVAL_LABEL: Readonly<Record<RemovalReason, string>> = {
  MOVED: 'moving to another table',
  ELIMINATED: 'eliminated',
  DISQUALIFIED: 'disqualified',
  ADMIN: 'removed by an admin',
  TABLE_BROKEN: 'table breaking',
  FINAL_TABLE: 'going to the final table',
};

export interface SeatFlag {
  key: string;
  text: string;
  icon: IconName;
  tone: Tone;
}

export interface SeatModel {
  seat: number;
  playerId: string;
  name: string;
  publicId: string;
  stack: number;
  /** Stack in big blinds, truncated to one decimal (never overstated); null without blinds. */
  bb: number | null;
  isButton: boolean;
  isSmallBlind: boolean;
  isBigBlind: boolean;
  inHand: boolean;
  folded: boolean;
  allIn: boolean;
  acting: boolean;
  connected: boolean;
  away: boolean;
  suspended: boolean;
  /** Leaving this table (removal applied when the hand ends). */
  transit: RemovalReason | null;
  waitingForNextHand: boolean;
  consecutiveTimeouts: number;
  lastAction: { action: ActionType; amount: number; toAmount: number } | null;
  streetContribution: number;
  shownCards: [CardCode, CardCode] | null;
  /** Primary connection state, always icon + text. */
  status: SeatFlag;
  /** Additional states (suspended, in transit, next hand, timeouts). */
  flags: SeatFlag[];
}

export function stackInBB(stack: number, bigBlind: number): number | null {
  return bigBlind > 0 ? Math.floor((stack / bigBlind) * 10) / 10 : null;
}

function connectionFlag(connected: boolean, away: boolean): SeatFlag {
  if (!connected) return { key: 'conn', text: 'Disconnected', icon: 'wifi-off', tone: 'danger' };
  if (away) return { key: 'conn', text: 'Away', icon: 'moon', tone: 'warning' };
  return { key: 'conn', text: 'Connected', icon: 'wifi', tone: 'positive' };
}

/** One model per seat index (null = empty seat), from `seats` (public) + `seatDetails` (admin). */
export function seatModels(view: AdminTableView): Array<SeatModel | null> {
  const acting = view.hand?.actingSeat ?? null;
  const out: Array<SeatModel | null> = [];
  for (let i = 0; i < view.maxSeats; i++) {
    const pub = view.seats[i] ?? null;
    const det = view.seatDetails[i] ?? null;
    if (!pub && !det) {
      out.push(null);
      continue;
    }
    const connected = pub?.connected ?? det?.connected ?? true;
    const away = pub?.away ?? false;
    const suspended = det?.suspended === true;
    const transit = det?.pendingRemoval?.reason ?? null;
    const waiting = det?.waitingForNextHand ?? false;
    const timeouts = det?.consecutiveTimeouts ?? 0;
    const stack = pub?.stack ?? det?.stack ?? 0;
    const flags: SeatFlag[] = [];
    if (suspended) flags.push({ key: 'susp', text: 'Suspended', icon: 'ban', tone: 'danger' });
    if (transit) flags.push({ key: 'transit', text: `In transit · ${REMOVAL_LABEL[transit]}`, icon: 'move', tone: 'info' });
    if (waiting) flags.push({ key: 'next', text: 'Joins next hand', icon: 'clock', tone: 'info' });
    if (timeouts > 0) flags.push({ key: 'to', text: `${timeouts} timeout${timeouts === 1 ? '' : 's'} in a row`, icon: 'clock', tone: 'warning' });
    out.push({
      seat: i,
      playerId: pub?.playerId ?? det?.playerId ?? '',
      name: pub?.displayName ?? det?.displayName ?? 'Unknown player',
      publicId: pub?.publicId ?? det?.publicId ?? '',
      stack,
      bb: stackInBB(stack, view.blinds.bigBlind),
      isButton: pub?.isButton ?? view.buttonSeat === i,
      isSmallBlind: pub?.isSmallBlind ?? false,
      isBigBlind: pub?.isBigBlind ?? false,
      inHand: pub?.inHand ?? false,
      folded: pub?.folded ?? false,
      allIn: pub?.allIn ?? false,
      acting: acting === i,
      connected,
      away,
      suspended,
      transit,
      waitingForNextHand: waiting,
      consecutiveTimeouts: timeouts,
      lastAction: pub?.lastAction ?? null,
      streetContribution: pub?.streetContribution ?? 0,
      shownCards: pub?.shownCards ?? null,
      status: connectionFlag(connected, away),
      flags,
    });
  }
  return out;
}

/** Seat number as people say it (seats are 0-based on the wire). */
export function seatLabel(seat: number): string {
  return `Seat ${seat + 1}`;
}

/** "RAISE TO 2,400", "CALL 800", "CHECK" … */
export function actionText(action: ActionType | Exclude<ActionType, 'ALL_IN'>, amount: number, toAmount: number): string {
  switch (action) {
    case 'FOLD':
      return 'folds';
    case 'CHECK':
      return 'checks';
    case 'CALL':
      return `calls ${formatChips(amount)}`;
    case 'BET':
      return `bets ${formatChips(toAmount)}`;
    case 'RAISE':
      return `raises to ${formatChips(toAmount)}`;
    case 'ALL_IN':
      return `all-in for ${formatChips(toAmount)}`;
    default:
      return String(action).toLowerCase();
  }
}

const FORCED_TEXT: Readonly<Record<string, string>> = { SMALL_BLIND: 'posts small blind', BIG_BLIND: 'posts big blind', ANTE: 'posts ante' };

export type LogKind = 'street' | 'forced' | 'action' | 'returned' | 'showdown' | 'award' | 'end';

export interface LogEntry {
  key: string;
  kind: LogKind;
  street: Street | null;
  seat: number | null;
  who: string | null;
  text: string;
  amount: number | null;
  tags: Array<{ text: string; tone: Tone; icon?: IconName }>;
  cards?: CardCode[];
  at?: number;
}

export type LogSource = 'actor' | 'socket' | 'none';

/** From the table actor's authoritative `handActionLog` (real server). */
export function logFromActionLog(entries: readonly HandActionLogEntry[], nameOf: (seat: number) => string): LogEntry[] {
  const out: LogEntry[] = [];
  let street: Street | null = null;
  entries.forEach((e, i) => {
    if (e.street !== street) {
      street = e.street;
      out.push({ key: `s${i}`, kind: 'street', street, seat: null, who: null, text: STREET_LABEL[street], amount: null, tags: [] });
    }
    if (e.kind === 'FORCED_BET') {
      out.push({ key: `f${i}`, kind: 'forced', street: e.street, seat: e.seat, who: nameOf(e.seat), text: FORCED_TEXT[e.betType] ?? 'posts', amount: e.amount, tags: e.allIn ? [{ text: 'ALL-IN', tone: 'danger' }] : [] });
      return;
    }
    const tags: LogEntry['tags'] = [];
    if (e.allIn) tags.push({ text: 'ALL-IN', tone: 'danger' });
    if (e.timeout) tags.push({ text: 'TIMEOUT', tone: 'warning', icon: 'clock' });
    if (e.fullRaise === false) tags.push({ text: 'incomplete raise', tone: 'info' });
    out.push({ key: `a${i}`, kind: 'action', street: e.street, seat: e.seat, who: nameOf(e.seat), text: actionText(e.action, e.amount, e.toAmount), amount: null, tags });
  });
  return out;
}

/**
 * From the live WebSocket table feed (events received since this table was
 * opened): the hand `handId`, or the latest hand when null.
 */
export function logFromEvents(events: readonly TableEvent[], handId: string | null, nameOf: (seat: number) => string): LogEntry[] {
  let start = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]!.event;
    if (ev.kind === 'HAND_STARTED' && (handId === null || ev.handId === handId)) {
      start = i;
      break;
    }
  }
  if (start < 0) return [];
  const out: LogEntry[] = [];
  out.push({ key: 'street-pre', kind: 'street', street: 'PREFLOP', seat: null, who: null, text: STREET_LABEL.PREFLOP, amount: null, tags: [] });
  for (let i = start + 1; i < events.length; i++) {
    const env = events[i]!;
    const ev = env.event;
    const key = `e${env.seq}`;
    switch (ev.kind) {
      case 'HAND_STARTED':
        return out;
      case 'FORCED_BET_POSTED':
        out.push({ key, kind: 'forced', street: 'PREFLOP', seat: ev.seat, who: nameOf(ev.seat), text: FORCED_TEXT[ev.betType] ?? 'posts', amount: ev.amount, tags: ev.allIn ? [{ text: 'ALL-IN', tone: 'danger' }] : [], at: env.at });
        break;
      case 'STREET_STARTED':
        if (ev.street !== 'PREFLOP') out.push({ key, kind: 'street', street: ev.street, seat: null, who: null, text: STREET_LABEL[ev.street], amount: null, tags: [], cards: ev.newCards, at: env.at });
        break;
      case 'PLAYER_ACTED': {
        const tags: LogEntry['tags'] = [];
        if (ev.allIn) tags.push({ text: 'ALL-IN', tone: 'danger' });
        if (ev.timeout) tags.push({ text: 'TIMEOUT', tone: 'warning', icon: 'clock' });
        out.push({ key, kind: 'action', street: null, seat: ev.seat, who: nameOf(ev.seat), text: actionText(ev.action, ev.amount, ev.toAmount), amount: null, tags, at: env.at });
        break;
      }
      case 'UNCALLED_BET_RETURNED':
        out.push({ key, kind: 'returned', street: null, seat: ev.seat, who: nameOf(ev.seat), text: 'uncalled bet returned', amount: ev.amount, tags: [], at: env.at });
        break;
      case 'SHOWDOWN':
        for (const r of ev.reveals) {
          out.push({ key: `${key}-${r.seat}`, kind: 'showdown', street: null, seat: r.seat, who: nameOf(r.seat), text: r.mucked || !r.cards ? 'mucks' : `shows${r.hand ? ` — ${r.hand.description}` : ''}`, amount: null, tags: [], cards: r.cards ?? undefined, at: env.at });
        }
        break;
      case 'POT_AWARDED':
        for (const w of ev.winners) {
          out.push({
            key: `${key}-${w.seat}`,
            kind: 'award',
            street: null,
            seat: w.seat,
            who: nameOf(w.seat),
            text: `wins ${ev.potType === 'MAIN' ? 'the main pot' : `side pot ${ev.potIndex}`}${ev.winningHand ? ` with ${ev.winningHand.description}` : ''}`,
            amount: w.amount,
            tags: w.oddChips > 0 ? [{ text: `+${w.oddChips} odd chip${w.oddChips === 1 ? '' : 's'}`, tone: 'info' }] : [],
            at: env.at,
          });
        }
        break;
      case 'HAND_COMPLETED':
        out.push({ key, kind: 'end', street: null, seat: null, who: null, text: `Hand #${ev.handNumber} complete`, amount: ev.totalPot, tags: [], at: env.at });
        break;
      default:
        break;
    }
  }
  return out;
}
