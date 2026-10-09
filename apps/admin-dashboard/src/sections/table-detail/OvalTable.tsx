import type { CSSProperties, ReactNode } from 'react';
import type { AdminTableView, CardCode } from '@jpb/shared-types';
import { Board, Icon, cx, formatChips, formatCount } from '@jpb/ui';
import type { MenuItem } from '@jpb/ui';
import { useElementWidth } from '../../components/useElementWidth';
import { PHASE_LABEL } from './model';
import type { SeatModel } from './model';
import { SeatCard } from './SeatCard';

/** Below this width the oval would cramp the seat cards: seats are listed in a grid instead. */
export const OVAL_MIN_WIDTH = 860;
/** Room kept around the rail for the seat cards centred on it (px). */
export const OVAL_PAD_X = 100;
export const OVAL_PAD_Y = 84;
/** Height of the rail box (px); the width follows the panel. */
export const RING_HEIGHT = 400;
/** Widest seat card; narrower when a row is crowded (keeps a gap between neighbours). */
export const SEAT_MAX_WIDTH = 192;
const SEAT_GAP = 14;
/** Top/bottom rows start this far in from the ends when an end seat exists (px). */
const ROW_INSET = 60;
/** Without end seats (2-4 players) the rows span this middle fraction of the rail. */
const ROW_SPAN_SMALL = 0.64;
/** Bet markers sit this far inside the rail: clear of the seat card, clear of the centre (px). */
const ROW_MARK_INSET = 94;
const END_MARK_INSET = 150;
/** Sideways shift of the dealer button so it never covers the bet marker (px). */
const DEALER_SHIFT_PX = 56;

export interface Point {
  /** Pixels relative to the rail box (may be negative: the ends sit on the rail edge). */
  x: number;
  y: number;
}

export interface SeatLayout {
  points: Point[];
  /** Widest card that keeps a gap between row neighbours. */
  seatWidth: number;
}

/** Evenly spread `k` x positions over [a, b] (one seat sits in the middle). */
function spread(k: number, a: number, b: number): number[] {
  if (k <= 0) return [];
  if (k === 1) return [(a + b) / 2];
  return Array.from({ length: k }, (_, i) => a + ((b - a) * i) / (k - 1));
}

/**
 * Seat centres around a racetrack rail of `w` x `h` px: a bottom row, a top
 * row and (from 5 seats) one seat on each round end. Rows and ends are
 * separated vertically, so no two seat cards ever overlap. Seat 0 sits at the
 * bottom centre and seats go clockwise (to the left first), like a real table.
 */
export function seatLayout(n: number, w: number, h: number): SeatLayout {
  const ends = n >= 5 ? 2 : 0;
  const rest = n - ends;
  const bottom = Math.floor(rest / 2);
  const top = rest - bottom;
  const [a, b] = ends ? [ROW_INSET, w - ROW_INSET] : [(w * (1 - ROW_SPAN_SMALL)) / 2, (w * (1 + ROW_SPAN_SMALL)) / 2];
  const clockwise: Point[] = [
    ...spread(bottom, a, b)
      .reverse()
      .map((x) => ({ x, y: h })),
    ...(ends ? [{ x: 0, y: h / 2 }] : []),
    ...spread(top, a, b).map((x) => ({ x, y: 0 })),
    ...(ends ? [{ x: w, y: h / 2 }] : []),
  ];
  const first = Math.floor((bottom - 1) / 2);
  const points = Array.from({ length: n }, (_, i) => clockwise[(first + i) % n]!);
  const rowGap = Math.max(bottom, top) > 1 ? (b - a) / (Math.max(bottom, top) - 1) : SEAT_MAX_WIDTH + SEAT_GAP;
  return { points, seatWidth: Math.floor(Math.min(SEAT_MAX_WIDTH, rowGap - SEAT_GAP)) };
}

/** Where a seat's bet marker sits: straight in from the rail (rows move vertically, ends horizontally). */
function markPoint(p: Point, w: number, h: number): Point {
  if (p.y <= 0) return { x: p.x, y: ROW_MARK_INSET };
  if (p.y >= h) return { x: p.x, y: h - ROW_MARK_INSET };
  return { x: p.x < w / 2 ? p.x + END_MARK_INSET : p.x - END_MARK_INSET, y: p.y };
}

const at = (p: Point): CSSProperties => ({ left: `${Math.round(p.x)}px`, top: `${Math.round(p.y)}px` });

export interface OvalTableProps {
  view: AdminTableView;
  seats: Array<SeatModel | null>;
  /** Hole cards to draw (null = hidden). */
  holeCards: Record<number, [CardCode, CardCode]> | null;
  playerHref: (playerId: string) => string;
  seatMenu: (m: SeatModel) => Array<MenuItem | 'separator'>;
  deadline: number | null;
  timerMs: number;
  serverOffsetMs: number;
  finalTable: boolean;
  /** Extra line in the centre (e.g. "Held — Admin hold"). */
  centerNote?: ReactNode;
}

/** Dealer button: next to the button seat's bet marker, shifted sideways so both stay readable. */
function dealerPoint(seat: Point, w: number, h: number): Point {
  const p = markPoint(seat, w, h);
  if (seat.y <= 0 || seat.y >= h) return { x: p.x + (seat.x <= w / 2 ? DEALER_SHIFT_PX : -DEALER_SHIFT_PX), y: p.y };
  return { x: p.x, y: p.y + DEALER_SHIFT_PX };
}

function Center({ view, finalTable, centerNote }: { view: AdminTableView; finalTable: boolean; centerNote?: ReactNode }) {
  const hand = view.hand;
  const sidePots = hand && hand.pots.length > 1 ? hand.pots : null;
  return (
    <div className="acr-td-center">
      {view.frozen && (
        <p className="acr-td-frozenmark" role="status">
          <Icon name="freeze" /> Frozen — no action or timer is processed
        </p>
      )}
      <p className="acr-td-center__meta">
        {finalTable && <span className="acr-td-center__final">FINAL TABLE</span>}
        <span>TABLE {view.tableNumber}</span>
        {hand ? (
          <>
            <span className="jpb-num">HAND #{formatCount(hand.handNumber)}</span>
            <span className="acr-td-center__phase">{PHASE_LABEL[hand.phase]}</span>
            <span className="jpb-num">
              L{view.blinds.level} {formatChips(view.blinds.smallBlind)}/{formatChips(view.blinds.bigBlind)}
            </span>
          </>
        ) : (
          <span>No hand in progress</span>
        )}
      </p>
      <Board cards={hand?.board ?? []} size="sm" className="acr-td-center__board" />
      {hand ? (
        <div className="acr-td-center__pot">
          <span className="acr-td-center__potl">Pot</span>
          <span className="jpb-num acr-td-center__potv">{formatChips(hand.totalPot)}</span>
          {sidePots && (
            <span className="acr-td-center__sides">
              {sidePots.map((p, i) => (
                <span key={i}>
                  {i === 0 ? 'Main' : `Side ${i}`} <span className="jpb-num">{formatChips(p.amount)}</span>
                </span>
              ))}
            </span>
          )}
          {hand.currentBet > 0 && (
            <span className="acr-td-center__bet">
              Bet to call <span className="jpb-num">{formatChips(hand.currentBet)}</span>
            </span>
          )}
        </div>
      ) : (
        centerNote && <p className="acr-td-center__note">{centerNote}</p>
      )}
      {/* During a hand the blinds are in the hand panel; the felt keeps room for the bet markers. */}
      {!hand && (
        <p className="acr-td-center__blinds jpb-num">
          Level {view.blinds.level} · {formatChips(view.blinds.smallBlind)} / {formatChips(view.blinds.bigBlind)}
          {view.blinds.ante > 0 ? ` · ante ${formatChips(view.blinds.ante)}` : ''}
        </p>
      )}
    </div>
  );
}

/**
 * The live table as an oval (wide panels) or a seat grid (narrow panels):
 * every seat with its admin details, the board, pots and the acting seat's
 * countdown. Purely a view of the server's admin projection.
 */
export function OvalTable({ view, seats, holeCards, playerHref, seatMenu, deadline, timerMs, serverOffsetMs, finalTable, centerNote }: OvalTableProps) {
  const [ref, width] = useElementWidth<HTMLDivElement>(1100);
  const oval = width >= OVAL_MIN_WIDTH;
  const n = Math.max(2, view.maxSeats);
  const w = Math.max(RING_HEIGHT, width - 2 * OVAL_PAD_X);
  const h = RING_HEIGHT;
  const layout = seatLayout(n, w, h);
  const seatAt = (i: number) => layout.points[i] ?? { x: w / 2, y: h };
  const seatWidth = layout.seatWidth;
  const card = (m: SeatModel) => (
    <SeatCard
      model={m}
      holeCards={holeCards?.[m.seat] ?? null}
      playerHref={playerHref(m.playerId)}
      deadline={m.acting ? deadline : null}
      timerMs={timerMs}
      serverOffsetMs={serverOffsetMs}
      menu={seatMenu(m)}
    />
  );

  return (
    <div ref={ref} className={cx('acr-td-tablewrap', oval ? 'is-oval' : 'is-grid', finalTable && 'is-final', view.frozen && 'is-frozen')}>
      {oval ? (
        <div className="acr-td-oval" style={{ padding: `${OVAL_PAD_Y}px ${OVAL_PAD_X}px`, ['--acr-td-seat-w' as string]: `${seatWidth}px` }}>
          <div className="acr-td-ring" style={{ height: h }} role="group" aria-label={`Table ${view.tableNumber}, ${seats.filter(Boolean).length} of ${view.maxSeats} seats filled`}>
            <div className="acr-td-felt" aria-hidden="true" />
            <Center view={view} finalTable={finalTable} centerNote={centerNote} />
            {view.buttonSeat !== null && (
              <span className="acr-td-dealer" style={at(dealerPoint(seatAt(view.buttonSeat), w, h))} aria-hidden="true" title="Dealer button">
                D
              </span>
            )}
            {seats.map((m, i) => {
              if (!m || m.streetContribution <= 0) return null;
              return (
                <span key={`bet-${i}`} className="acr-td-betmark" style={at(markPoint(seatAt(i), w, h))} aria-hidden="true" title={`${formatChips(m.streetContribution)} in front`}>
                  <span className="acr-td-chip" />
                  <span className="jpb-num">{formatChips(m.streetContribution)}</span>
                </span>
              );
            })}
            {Array.from({ length: n }, (_, i) => {
              const m = seats[i] ?? null;
              const p = seatAt(i);
              return (
                <div key={i} className={cx('acr-td-slot', p.y < h / 2 ? 'is-top' : 'is-bottom')} style={at(p)}>
                  {m ? (
                    card(m)
                  ) : (
                    <div className="acr-td-empty">
                      <span className="jpb-num">{i + 1}</span>
                      <span>Empty seat</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="acr-td-compact">
          <div className="acr-td-compact__felt">
            <Center view={view} finalTable={finalTable} centerNote={centerNote} />
          </div>
          <ol className="acr-td-compact__seats" aria-label={`Seats of table ${view.tableNumber}`}>
            {Array.from({ length: n }, (_, i) => {
              const m = seats[i] ?? null;
              return (
                <li key={i}>
                  {m ? (
                    card(m)
                  ) : (
                    <div className="acr-td-empty is-row">
                      <span className="jpb-num">{i + 1}</span>
                      <span>Empty seat</span>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}
