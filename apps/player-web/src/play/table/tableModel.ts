/**
 * Pure mapping from the latest SERVER view (+ the events that came with it)
 * to table props. Nothing here decides game state: winners, hand
 * descriptions and legal actions are all read from server frames.
 */
import type { CardCode, LegalActions, PlayerTableView, SpectatorTableView, TableEvent } from '@jpb/shared-types';
import { seatPropsFromView } from '@jpb/ui';
import type { TableSeat } from '@jpb/ui';

export interface HandOutcome {
  /** Total won this hand, by seat. */
  winners: Map<number, number>;
  /** Hand description shown at showdown, by seat. */
  descriptions: Map<number, string>;
  /** Best five of the main pot winner (for card highlights). */
  winningCards: CardCode[];
}

const EMPTY_OUTCOME: HandOutcome = { winners: new Map(), descriptions: new Map(), winningCards: [] };

/** Events of the hand currently in the view (everything after its HAND_STARTED). */
export function eventsOfHand(events: readonly TableEvent[], handId: string | null | undefined): TableEvent[] {
  if (!handId) return [];
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i] as TableEvent;
    if (e.event.kind === 'HAND_STARTED' && e.event.handId === handId) return events.slice(i);
  }
  return [];
}

/** Winners / showdown descriptions announced by the server for this hand. */
export function handOutcome(handEvents: readonly TableEvent[]): HandOutcome {
  if (handEvents.length === 0) return EMPTY_OUTCOME;
  const winners = new Map<number, number>();
  const descriptions = new Map<number, string>();
  let winningCards: CardCode[] = [];
  for (const { event } of handEvents) {
    if (event.kind === 'SHOWDOWN') {
      for (const r of event.reveals) if (r.hand && !r.mucked) descriptions.set(r.seat, r.hand.description);
    } else if (event.kind === 'POT_AWARDED') {
      for (const w of event.winners) winners.set(w.seat, (winners.get(w.seat) ?? 0) + w.amount);
      if (event.potIndex === 0 && event.winningHand) winningCards = event.winningHand.bestFive;
    }
  }
  return { winners, descriptions, winningCards };
}

/** Seat props for <PokerTable>. Spectator views never carry private cards, so none can be shown. */
export function tableSeats(view: PlayerTableView | SpectatorTableView, outcome: HandOutcome): Array<TableSeat | null> {
  const heroSeat = view.audience === 'PLAYER' ? view.you.seat : null;
  return view.seats.map((s) => {
    if (!s) return null;
    const props: TableSeat = seatPropsFromView(s);
    const won = outcome.winners.get(s.seat);
    const description = outcome.descriptions.get(s.seat);
    return {
      ...props,
      holeCards: view.audience === 'PLAYER' && s.seat === heroSeat ? view.you.holeCards : null,
      winAmount: won ?? null,
      handDescription: description ?? null,
    };
  });
}

export interface HeroTurn {
  legal: LegalActions;
  turnVersion: number;
  deadline: number | null;
}

/** The hero's decision, only when the server says it is the hero's turn. */
export function heroTurn(view: PlayerTableView | null): HeroTurn | null {
  if (!view || !view.you.legal || !view.hand) return null;
  const { actingSeat, turnVersion, actionDeadline } = view.hand;
  if (actingSeat !== view.you.seat || turnVersion === null) return null;
  return { legal: view.you.legal, turnVersion, deadline: actionDeadline };
}

/** Full timer length of the current turn (for the countdown ring). */
export function turnTimerMs(events: readonly TableEvent[], turnVersion: number | null | undefined, fallback = 20_000): number {
  if (turnVersion === null || turnVersion === undefined) return fallback;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = (events[i] as TableEvent).event;
    if (e.kind === 'ACTION_REQUESTED' && e.turnVersion === turnVersion) return e.timerMs;
  }
  return fallback;
}

/** True while the server shows the result of a finished hand. */
export function isShowingResult(view: PlayerTableView | SpectatorTableView): boolean {
  const phase = view.hand?.phase;
  return phase === 'SHOWDOWN' || phase === 'POT_DISTRIBUTION' || phase === 'HAND_COMPLETE';
}

/** Short text for "what is happening now" (hierarchy item 6). */
export function currentActionText(view: PlayerTableView | SpectatorTableView, outcome: HandOutcome): string | null {
  const h = view.hand;
  if (!h) return view.status === 'HELD' ? 'Table on hold' : 'Waiting for the next hand';
  if (isShowingResult(view)) {
    const [seat, amount] = [...outcome.winners.entries()][0] ?? [];
    if (seat === undefined || amount === undefined) return 'Hand complete';
    const isHero = view.audience === 'PLAYER' && view.you.seat === seat;
    const name = isHero ? 'You' : (view.seats[seat]?.displayName ?? `Seat ${seat + 1}`);
    return `${name} ${isHero ? 'win' : 'wins'} the pot`;
  }
  if (h.actingSeat === null) return 'Dealing…';
  if (view.audience === 'PLAYER' && view.you.seat === h.actingSeat) return 'Your turn';
  const name = view.seats[h.actingSeat]?.displayName ?? `Seat ${h.actingSeat + 1}`;
  return `${name} is thinking…`;
}
