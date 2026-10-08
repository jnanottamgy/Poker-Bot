import type { CSSProperties, ReactNode } from 'react';
import type { CardCode } from '@jpb/shared-types';
import { cx } from '../cx';
import { formatChips, formatChipsCompact, formatCount } from '../format';
import { ActionTimer } from './ActionTimer';
import { Board } from './Board';
import { HoleCards } from './HoleCards';
import { PlayerSeat } from './PlayerSeat';
import type { PlayerSeatProps } from './PlayerSeat';
import { PotDisplay } from './PotDisplay';
import { StackDisplay } from './StackDisplay';
import { Badge } from './StatusPill';

export interface TableSeat extends PlayerSeatProps {
  /** Chips committed on the current street (rendered in front of the seat). */
  bet?: number;
}

export interface SeatPoint {
  /** Percent of the table box. */
  x: number;
  y: number;
}

export interface SeatGeometry {
  seat: SeatPoint;
  bet: SeatPoint;
}

/** Ellipse radii / centers (percent of the table box) per layout. */
const WIDE = { cx: 50, cy: 50, rx: 44, ry: 41, betK: 0.6 };
const TALL = { cx: 50, cy: 47, rx: 39, ry: 42, betK: 0.58 };
/** Angular gap kept free at the bottom of the tall layout (hero sits in the dock below the felt). */
const TALL_BOTTOM_GAP_DEG = 38;

function point(c: { cx: number; cy: number; rx: number; ry: number }, deg: number, k = 1): SeatPoint {
  const rad = (deg * Math.PI) / 180;
  return { x: round(c.cx + c.rx * k * Math.cos(rad)), y: round(c.cy + c.ry * k * Math.sin(rad)) };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Seat geometry. Seats are placed clockwise (increasing seat index) starting
 * from the hero at bottom-centre (90deg in screen coordinates, y down).
 *
 * - wide: all seats evenly around an ellipse, hero at the bottom.
 * - tall: the hero is rendered in a dock under the felt, so the n-1 opponents
 *   are spread over the arc that excludes a gap at the bottom.
 *
 * Returns one entry per seat index (0..maxSeats-1).
 */
export function seatLayout(maxSeats: number, heroSeat: number, variant: 'wide' | 'tall'): SeatGeometry[] {
  const n = Math.max(2, Math.min(10, maxSeats));
  const out: SeatGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const k = (((i - heroSeat) % n) + n) % n; // 0 = hero
    let deg: number;
    if (variant === 'wide') {
      deg = 90 + (k * 360) / n;
    } else if (k === 0) {
      deg = 90;
    } else if (n === 2) {
      deg = 270;
    } else {
      const span = 360 - 2 * TALL_BOTTOM_GAP_DEG;
      deg = 90 + TALL_BOTTOM_GAP_DEG + ((k - 1) * span) / (n - 2);
    }
    const c = variant === 'wide' ? WIDE : TALL;
    out.push({ seat: point(c, deg), bet: point(c, deg, c.betK) });
  }
  return out;
}

export interface PokerTableProps {
  maxSeats: number;
  /** Indexed by seat (0-based). Null = empty seat. */
  seats: Array<TableSeat | null>;
  /** The viewer's seat (bottom centre). Null for spectators/admins (seat 0 at the bottom). */
  heroSeat: number | null;
  board: CardCode[];
  totalPot: number;
  pots?: Array<{ amount: number }>;
  actingSeat?: number | null;
  actionDeadline?: number | null;
  timerMs?: number;
  serverOffsetMs?: number;
  winningCards?: CardCode[];
  tableNumber?: number;
  handNumber?: number;
  /** 'auto' picks tall below 640px of container width (CSS container query). */
  variant?: 'auto' | 'wide' | 'tall';
  /** Extra content under the hero dock (tall) — e.g. the hero's hand strength. */
  heroExtra?: ReactNode;
  /** Big blind (used for the hero's BB count). */
  bigBlind?: number;
  className?: string;
}

function vars(wide: SeatPoint, tall: SeatPoint): CSSProperties {
  return { '--wx': `${wide.x}%`, '--wy': `${wide.y}%`, '--tx': `${tall.x}%`, '--ty': `${tall.y}%` } as CSSProperties;
}

/**
 * Responsive oval table for 2-10 seats. Desktop (wide) is a landscape oval
 * with all seats on the rail; mobile (tall) is a portrait felt with
 * opponents around the top and the hero in a large dock underneath — it is a
 * different layout, not a shrunken desktop.
 */
export function PokerTable({
  maxSeats,
  seats,
  heroSeat,
  board,
  totalPot,
  pots,
  actingSeat = null,
  actionDeadline = null,
  timerMs = 0,
  serverOffsetMs = 0,
  winningCards,
  tableNumber,
  handNumber,
  variant = 'auto',
  heroExtra,
  bigBlind,
  className,
}: PokerTableProps) {
  const n = Math.max(2, Math.min(10, maxSeats));
  const anchor = heroSeat ?? 0;
  const wide = seatLayout(n, anchor, 'wide');
  const tall = seatLayout(n, anchor, 'tall');
  const hero = heroSeat !== null ? (seats[heroSeat] ?? null) : null;
  const occupied = seats.filter(Boolean).length;
  const heroActing = heroSeat !== null && actingSeat === heroSeat;

  const tableLabel = [
    tableNumber !== undefined ? `Table ${tableNumber}` : 'Poker table',
    handNumber !== undefined ? `hand ${formatCount(handNumber)}` : null,
    `${occupied} of ${n} seats filled`,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div className={cx('jpb-table-wrap', className)} data-variant={variant}>
      <section className="jpb-table" data-seats={n} aria-label={tableLabel}>
        <div className="jpb-table__felt" aria-hidden="true">
          <div className="jpb-table__rail" />
        </div>

        <div className="jpb-table__center">
          {(tableNumber !== undefined || handNumber !== undefined) && (
            <div className="jpb-table__meta" aria-hidden="true">
              {tableNumber !== undefined && <span>TABLE {tableNumber}</span>}
              {handNumber !== undefined && <span>HAND #{formatCount(handNumber)}</span>}
            </div>
          )}
          <PotDisplay total={totalPot} pots={pots} size="md" />
          <Board cards={board} winningCards={winningCards} className="jpb-table__board" />
        </div>

        {Array.from({ length: n }, (_, i) => {
          const s = seats[i] ?? null;
          const g = wide[i];
          const t = tall[i];
          if (!g || !t) return null;
          const isHero = i === heroSeat;
          if (!s) {
            return (
              <div key={`empty-${i}`} className="jpb-table__slot jpb-table__empty" style={vars(g.seat, t.seat)}>
                <span aria-hidden="true">{i + 1}</span>
                <span className="jpb-sr-only">Seat {i + 1} empty</span>
              </div>
            );
          }
          const acting = actingSeat === i;
          return (
            <div key={`seat-${i}`} className={cx('jpb-table__slot', isHero && 'is-hero-slot')} style={vars(g.seat, t.seat)}>
              <PlayerSeat
                {...s}
                seat={i}
                hero={isHero}
                acting={acting}
                deadline={acting ? actionDeadline : null}
                timerMs={timerMs}
                serverOffsetMs={serverOffsetMs}
                winningCards={winningCards}
                cardSize={isHero ? 'md' : 'sm'}
              />
            </div>
          );
        })}

        {Array.from({ length: n }, (_, i) => {
          const s = seats[i];
          const g = wide[i];
          const t = tall[i];
          if (!s || !s.bet || !g || !t) return null;
          return (
            <div key={`bet-${i}`} className={cx('jpb-table__bet', i === heroSeat && 'is-hero-bet')} style={vars(g.bet, t.bet)} title={`${formatChips(s.bet)} chips`}>
              <span className="jpb-chip" aria-hidden="true" />
              <span className="jpb-num">{formatChipsCompact(s.bet)}</span>
              <span className="jpb-sr-only">{`${s.name} has ${formatChips(s.bet)} chips in front`}</span>
            </div>
          );
        })}
      </section>

      {hero && heroSeat !== null && (
        <section className={cx('jpb-dock', heroActing && 'is-acting', hero.folded && 'is-folded')} aria-label="Your seat">
          <HoleCards cards={hero.holeCards ?? null} size="lg" fanned folded={hero.folded} winningCards={winningCards} labelPrefix="Your cards" className="jpb-dock__cards" />
          <div className="jpb-dock__info">
            <span className="jpb-dock__name">
              <span className="jpb-seat__you">YOU</span> {hero.name}
              {hero.isButton && (
                <Badge variant="solid" className="jpb-seat__dealer" srLabel="Dealer button">
                  D
                </Badge>
              )}
              {hero.isSmallBlind && <Badge tone="info" srLabel="Small blind">SB</Badge>}
              {hero.isBigBlind && <Badge tone="info" srLabel="Big blind">BB</Badge>}
            </span>
            <StackDisplay amount={hero.stack} size="lg" bigBlind={bigBlind} />
            {hero.bet ? (
              <span className="jpb-dock__bet">
                In front: <span className="jpb-num">{formatChips(hero.bet)}</span>
              </span>
            ) : null}
            {heroExtra}
          </div>
          {heroActing && actionDeadline !== null && timerMs > 0 && (
            <ActionTimer deadline={actionDeadline} serverOffsetMs={serverOffsetMs} totalMs={timerMs} size="md" announce={false} className="jpb-dock__timer" />
          )}
        </section>
      )}
    </div>
  );
}
