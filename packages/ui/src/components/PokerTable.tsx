import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import type { CardCode } from '@jpb/shared-types';
import { cx } from '../cx';
import { formatChips, formatChipsCompact, formatCount } from '../format';
import { ActionTimer } from './ActionTimer';
import { Board } from './Board';
import { HoleCards } from './HoleCards';
import { PlayerSeat } from './PlayerSeat';
import type { PlayerSeatProps } from './PlayerSeat';
import { PotDisplay } from './PotDisplay';
import { Badge } from './StatusPill';

/** A seat on the table; `bet` (chips in front this street) comes from PlayerSeatProps. */
export type TableSeat = PlayerSeatProps;

export interface SeatPoint {
  /** Percent of the table box. */
  x: number;
  y: number;
}

export interface SeatGeometry {
  seat: SeatPoint;
  bet: SeatPoint;
}

/** Ellipse radii / centers (percent of the table box) for the wide layout. */
const WIDE = { cx: 50, cy: 50, rx: 44, ry: 41, betKx: 0.64, betKy: 0.5 };

/**
 * Tall (phone) layout: FIXED seat-box centres (percent of the table box) for
 * the k seats around the felt, clockwise from the hero's left. An even-angle
 * ellipse puts the left/right seats at the board's height, where an 86-92px
 * box covers the outer board cards on a 360px phone; these tables keep every
 * box clear of the board row (board centre at y = 46%) and of each other.
 * Verified by gallery/screenshot.mjs (bounding-box overlap check, 2-10 seats,
 * 328 / 358 / 398px).
 */
const TALL_RING: Readonly<Record<number, ReadonlyArray<readonly [number, number]>>> = {
  1: [[50, 10]],
  2: [[20, 14], [80, 14]],
  3: [[11, 66], [50, 10], [89, 66]],
  4: [[11, 66], [24, 13], [76, 13], [89, 66]],
  5: [[11, 68], [14, 26], [50, 10], [86, 26], [89, 68]],
  6: [[11, 70], [13, 28], [35, 9], [65, 9], [87, 28], [89, 70]],
  7: [[24, 88], [11, 66], [13, 27], [50, 9], [87, 27], [89, 66], [76, 88]],
  8: [[22, 88], [10, 67], [12, 27], [36, 9], [64, 9], [88, 27], [90, 67], [78, 88]],
  9: [[22, 89], [10, 68], [11, 31], [24, 10], [50, 7], [76, 10], [89, 31], [90, 68], [78, 89]],
};
/** Hero (tall: rendered in the dock under the felt; the point only matters for ordering). */
const TALL_HERO: SeatPoint = { x: 50, y: 97 };
/** Spectator view (no dock): seat 0 sits on the bottom rail. */
const TALL_ANCHOR: SeatPoint = { x: 50, y: 92 };
/** Bet markers sit between the seat and the board. */
const TALL_BOARD: SeatPoint = { x: 50, y: 46 };
const TALL_BET_K = 0.55;

function point(c: { cx: number; cy: number; rx: number; ry: number }, deg: number, kx = 1, ky = kx): SeatPoint {
  const rad = (deg * Math.PI) / 180;
  return { x: round(c.cx + c.rx * kx * Math.cos(rad)), y: round(c.cy + c.ry * ky * Math.sin(rad)) };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function toward(from: SeatPoint, to: SeatPoint, k: number): SeatPoint {
  return { x: round(to.x + (from.x - to.x) * k), y: round(to.y + (from.y - to.y) * k) };
}

/**
 * Seat geometry. Seats are placed clockwise (increasing seat index) starting
 * from the hero at bottom-centre (y grows downwards).
 *
 * - wide: all seats evenly around an ellipse, hero at the bottom.
 * - tall: the hero is rendered in a dock under the felt; the n-1 others use
 *   the fixed TALL_RING positions. `spectator` puts the anchor seat (0) on the
 *   bottom rail instead of the dock.
 *
 * Returns one entry per seat index (0..maxSeats-1).
 */
export function seatLayout(maxSeats: number, heroSeat: number, variant: 'wide' | 'tall', opts: { spectator?: boolean } = {}): SeatGeometry[] {
  const n = Math.max(2, Math.min(10, maxSeats));
  const ring = TALL_RING[n - 1] ?? [];
  const out: SeatGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const k = (((i - heroSeat) % n) + n) % n; // 0 = hero
    if (variant === 'wide') {
      const deg = 90 + (k * 360) / n;
      out.push({ seat: point(WIDE, deg), bet: point(WIDE, deg, WIDE.betKx, WIDE.betKy) });
      continue;
    }
    const p = ring[k - 1];
    const seat: SeatPoint = k === 0 ? (opts.spectator ? TALL_ANCHOR : TALL_HERO) : { x: p?.[0] ?? 50, y: p?.[1] ?? 10 };
    out.push({ seat, bet: toward(seat, TALL_BOARD, TALL_BET_K) });
  }
  return out;
}

/** Container width (px) below which every table uses the tall layout, even variant="wide". */
export const TABLE_TALL_BELOW_PX = 720;

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
  /**
   * 'auto' (default) and 'wide' use the landscape oval at >= 720px of container
   * width and the portrait layout below it (a forced wide table never piles its
   * seats onto the board in a side panel or on a phone). 'tall' is always portrait.
   */
  variant?: 'auto' | 'wide' | 'tall';
  /** Extra content under the hero dock (tall) — e.g. the hero's hand strength. */
  heroExtra?: ReactNode;
  /** Big blind (used for the hero's BB count). */
  bigBlind?: number;
  /** Final table: gold rail (gold is reserved for milestones). */
  finalTable?: boolean;
  /** Extra content per occupied seat (admin overlay: seat menu). Rendered inside the seat slot. */
  renderSeatExtra?: (seat: number, s: TableSeat) => ReactNode;
  /** Card size inside the dock. Default lg; 'md' for short viewports (PlayerLayout fit mode). */
  dockCardSize?: 'md' | 'lg';
  className?: string;
}

function vars(p: SeatPoint): CSSProperties {
  return { '--x': `${p.x}%`, '--y': `${p.y}%` } as CSSProperties;
}

/** Felt marker amount: exact below 1,000,000 (the seat box shows only the verb), compact above. */
export function betMarkerText(amount: number): string {
  return amount < 1_000_000 ? formatChips(amount) : formatChipsCompact(amount);
}

const canMeasure = typeof window !== 'undefined' && typeof ResizeObserver === 'function';
const useIsoLayoutEffect = canMeasure ? useLayoutEffect : useEffect;

/** 'tall' | 'wide' from the variant and the measured container width (synchronously before paint). */
function useTableLayout(variant: 'auto' | 'wide' | 'tall'): [RefObject<HTMLDivElement | null>, 'tall' | 'wide'] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el || variant === 'tall') return undefined;
    const measure = (): void => setWidth(el.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver !== 'function') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [variant]);
  if (variant === 'tall') return [ref, 'tall'];
  // Unknown width (SSR / jsdom): honour the request.
  if (width === null || width === 0) return [ref, 'wide'];
  return [ref, width < TABLE_TALL_BELOW_PX ? 'tall' : 'wide'];
}

/**
 * Responsive oval table for 2-10 seats. Desktop (wide) is a landscape oval
 * with all seats on the rail; phones (tall) get a portrait felt with
 * opponents around it and the hero in a large dock underneath — a different
 * layout, not a shrunken desktop. The layout is chosen from the measured
 * container width and exposed as `data-layout` (the only switch the CSS uses).
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
  finalTable = false,
  renderSeatExtra,
  dockCardSize = 'lg',
  className,
}: PokerTableProps) {
  const [wrapRef, layout] = useTableLayout(variant);
  const n = Math.max(2, Math.min(10, maxSeats));
  const anchor = heroSeat ?? 0;
  const geometry = seatLayout(n, anchor, layout, { spectator: heroSeat === null });
  const hero = heroSeat !== null ? (seats[heroSeat] ?? null) : null;
  const occupied = seats.filter(Boolean).length;
  const heroActing = heroSeat !== null && actingSeat === heroSeat;
  const showDock = layout === 'tall' && hero !== null;

  const tableLabel = [
    tableNumber !== undefined ? `Table ${tableNumber}` : 'Poker table',
    handNumber !== undefined ? `hand ${formatCount(handNumber)}` : null,
    `${occupied} of ${n} seats filled`,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div ref={wrapRef} className={cx('jpb-table-wrap', finalTable && 'is-final', className)} data-variant={variant} data-layout={layout}>
      <section className="jpb-table" data-seats={n} aria-label={tableLabel}>
        <div className="jpb-table__felt" aria-hidden="true">
          <div className="jpb-table__rail" />
        </div>

        {(tableNumber !== undefined || handNumber !== undefined) && (
          <div className="jpb-table__meta jpb-table__meta--corner" aria-hidden="true">
            {finalTable && <span className="jpb-table__final">FINAL TABLE</span>}
            {tableNumber !== undefined && <span>TABLE {tableNumber}</span>}
            {handNumber !== undefined && <span>HAND #{formatCount(handNumber)}</span>}
          </div>
        )}
        <div className="jpb-table__center">
          <PotDisplay total={totalPot} pots={pots} size="md" className="jpb-table__pot" />
          <Board cards={board} winningCards={winningCards} className="jpb-table__board" />
          {(tableNumber !== undefined || handNumber !== undefined) && (
            <div className="jpb-table__meta jpb-table__meta--center" aria-hidden="true">
              {finalTable && <span className="jpb-table__final">FINAL</span>}
              {tableNumber !== undefined && <span>T{tableNumber}</span>}
              {handNumber !== undefined && <span>#{formatCount(handNumber)}</span>}
            </div>
          )}
        </div>

        {Array.from({ length: n }, (_, i) => {
          const s = seats[i] ?? null;
          const g = geometry[i];
          if (!g) return null;
          const isHero = i === heroSeat;
          if (!s) {
            return (
              <div key={`empty-${i}`} className="jpb-table__slot jpb-table__empty" style={vars(g.seat)}>
                <span aria-hidden="true">{i + 1}</span>
                <span className="jpb-sr-only">Seat {i + 1} empty</span>
              </div>
            );
          }
          const acting = actingSeat === i;
          return (
            <div key={`seat-${i}`} className={cx('jpb-table__slot', isHero && 'is-hero-slot', isHero && showDock && 'is-docked')} style={vars(g.seat)} data-seat={i}>
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
              {renderSeatExtra?.(i, s)}
            </div>
          );
        })}

        {Array.from({ length: n }, (_, i) => {
          const s = seats[i];
          const g = geometry[i];
          if (!s || !s.bet || !g) return null;
          return (
            <div key={`bet-${i}`} className={cx('jpb-table__bet', i === heroSeat && 'is-hero-bet')} style={vars(g.bet)} title={`${formatChips(s.bet)} chips`}>
              <span className="jpb-chip" aria-hidden="true" />
              <span className="jpb-num" aria-hidden="true">
                {betMarkerText(s.bet)}
              </span>
              <span className="jpb-sr-only">{`${s.name} has ${formatChips(s.bet)} chips in front`}</span>
            </div>
          );
        })}
      </section>

      {hero && heroSeat !== null && (
        <section className={cx('jpb-dock', heroActing && 'is-acting', hero.folded && 'is-folded')} aria-label="Your seat" hidden={!showDock}>
          {heroActing && <span className="jpb-dock__turn">YOUR TURN</span>}
          {heroActing && actionDeadline !== null && timerMs > 0 && (
            <ActionTimer deadline={actionDeadline} serverOffsetMs={serverOffsetMs} totalMs={timerMs} size="md" showCaption={false} className="jpb-dock__timer" />
          )}
          <HoleCards cards={hero.holeCards ?? null} size={dockCardSize} fanned folded={hero.folded} winningCards={winningCards} labelPrefix="Your cards" className="jpb-dock__cards" />
          <div className="jpb-dock__info">
            <span className="jpb-dock__name">
              <span className="jpb-dock__nametext">{hero.name}</span>
              {hero.isButton && (
                <Badge variant="solid" className="jpb-seat__dealer" srLabel="Dealer button">
                  D
                </Badge>
              )}
              {hero.isSmallBlind && <Badge tone="info" srLabel="Small blind">SB</Badge>}
              {hero.isBigBlind && <Badge tone="info" srLabel="Big blind">BB</Badge>}
              {hero.allIn && <Badge variant="solid">ALL-IN</Badge>}
            </span>
            <span className="jpb-dock__stack jpb-num" aria-hidden="true">
              {formatChips(hero.stack)}
            </span>
            <span className="jpb-sr-only">{`Stack ${formatChips(hero.stack)} chips${bigBlind && bigBlind > 0 ? `, ${bbText(hero.stack, bigBlind)}` : ''}`}</span>
            {bigBlind && bigBlind > 0 ? (
              <span className="jpb-dock__bb jpb-num" aria-hidden="true">
                {bbText(hero.stack, bigBlind)}
              </span>
            ) : null}
            {hero.bet ? (
              <span className="jpb-dock__bet">
                In front <span className="jpb-num">{formatChips(hero.bet)}</span>
              </span>
            ) : null}
            {heroExtra}
          </div>
        </section>
      )}
    </div>
  );
}

/** "39.3 BB" (truncated to one decimal, never overstated). */
export function bbText(stack: number, bigBlind: number): string {
  return `${Math.floor((stack / bigBlind) * 10) / 10} BB`;
}
