import { useMemo } from 'react';
import type { TableEvent, PlayerTableView } from '@jpb/shared-types';
import { PokerTable } from '@jpb/ui';
import { eventsOfHand, handOutcome, heroTurn, isShowingResult, tableSeats, turnTimerMs } from './tableModel';
import type { HandOutcome } from './tableModel';
import { useTurnCues } from './useTurnCues';

const NO_OUTCOME: HandOutcome = { winners: new Map(), descriptions: new Map(), winningCards: [] };

export interface LiveTableProps {
  view: PlayerTableView;
  events: readonly TableEvent[];
  serverOffsetMs: number;
  wide: boolean;
  finalTable: boolean;
  /** Not live (reconnecting): greyed out so old numbers are never mistaken for live ones. */
  stale: boolean;
}

/**
 * The live table: renders ONLY the latest server view. Events are used for
 * presentation (winner badges, hand descriptions, timer length); animations
 * (board flips, pot count-up) come from the ui components and never delay
 * the state shown.
 */
export function LiveTable({ view, events, serverOffsetMs, wide, finalTable, stale }: LiveTableProps) {
  const handId = view.hand?.handId;
  const handEvents = useMemo(() => eventsOfHand(events, handId), [events, handId]);
  const showingResult = isShowingResult(view);
  const outcome = useMemo(() => (showingResult ? handOutcome(handEvents) : NO_OUTCOME), [showingResult, handEvents]);
  const seats = useMemo(() => tableSeats(view, outcome), [view, outcome]);
  const turn = heroTurn(view);
  useTurnCues(turn?.turnVersion ?? null, turn?.legal ?? null);
  const hand = view.hand;
  const pots = hand?.pots ?? [];
  const hero = view.seats[view.you.seat];
  const heroDescription = outcome.descriptions.get(view.you.seat);
  const sittingOut = hero && hand && !hero.inHand;

  return (
    <PokerTable
      className={stale ? 'jpb-stale' : undefined}
      maxSeats={view.maxSeats}
      seats={seats}
      heroSeat={view.you.seat}
      board={hand?.board ?? []}
      totalPot={hand?.totalPot ?? 0}
      pots={pots.length > 1 ? pots : undefined}
      actingSeat={hand?.actingSeat ?? null}
      actionDeadline={hand?.actionDeadline ?? null}
      timerMs={turnTimerMs(events, hand?.turnVersion)}
      serverOffsetMs={serverOffsetMs}
      winningCards={outcome.winningCards}
      tableNumber={view.tableNumber}
      handNumber={hand?.handNumber}
      bigBlind={view.blinds.bigBlind}
      finalTable={finalTable}
      variant={wide ? 'wide' : 'auto'}
      heroExtra={
        heroDescription ? (
          <span className="pw-dock-note is-strong">{heroDescription}</span>
        ) : sittingOut ? (
          <span className="pw-dock-note">You are dealt in from the next hand</span>
        ) : null
      }
    />
  );
}
