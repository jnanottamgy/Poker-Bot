import fc from 'fast-check';
import type { RandomSource } from '@jpb/randomness';
import type { BalancingConfig, SeatIndex, SeatPositionStats, SeatSummary, TableSizeConfig, TableSummary } from '@jpb/shared-types';

export const DEFAULT_TABLE_CFG: TableSizeConfig = { targetSize: 8, maxSize: 9, minSize: 2, finalTableSize: 9 };

export const DEFAULT_BALANCING: BalancingConfig = {
  maxImbalance: 1,
  recentMoveWindowHands: 10,
  weights: { position: 1, blindFairness: 1, recentMove: 10, seatCompatibility: 0.5 },
  consolidateBy: 'TARGET',
};

/** Deterministic non-cryptographic test stream (mulberry32). */
export function testRng(seed: number): RandomSource {
  let a = seed >>> 0;
  return {
    nextUint32(): number {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return (t ^ (t >>> 14)) >>> 0;
    },
  };
}

export function scriptedRng(values: readonly number[]): RandomSource & { consumed: () => number } {
  let i = 0;
  return {
    nextUint32(): number {
      if (i >= values.length) throw new Error('scripted rng exhausted');
      i += 1;
      return values[i - 1] as number;
    },
    consumed: () => i,
  };
}

export function stats(partial: Partial<SeatPositionStats> = {}): SeatPositionStats {
  return { handsDealtAtTable: 0, handsSinceBigBlind: 0, handsSinceSmallBlind: 0, handsPlayedTotal: 0, ...partial };
}

export type SeatSpec =
  | SeatIndex
  | { seat: SeatIndex; playerId?: string; stats?: Partial<SeatPositionStats>; recentMovesAtHand?: number[]; movingOut?: boolean; stack?: number };

export interface TableSpec {
  id?: string;
  number: number;
  maxSeats?: number;
  seats: SeatSpec[];
  reserved?: SeatIndex[];
  button?: SeatIndex | null;
  lastSB?: SeatIndex | null;
  lastBB?: SeatIndex | null;
  inHand?: boolean;
  status?: TableSummary['status'];
}

export function makeTable(spec: TableSpec): TableSummary {
  const tableId = spec.id ?? `T${spec.number}`;
  const seats: SeatSummary[] = spec.seats.map((raw) => {
    const s = typeof raw === 'number' ? { seat: raw } : raw;
    const out: SeatSummary = {
      seat: s.seat,
      playerId: s.playerId ?? `${tableId}-s${s.seat}`,
      stack: s.stack ?? 1000,
      stats: stats(s.stats),
      recentMovesAtHand: s.recentMovesAtHand ?? [],
    };
    if (s.movingOut !== undefined) out.movingOut = s.movingOut;
    return out;
  });
  return {
    tableId,
    tableNumber: spec.number,
    maxSeats: spec.maxSeats ?? 9,
    status: spec.status ?? 'ACTIVE',
    seats: seats.sort((a, b) => a.seat - b.seat),
    reservedSeats: spec.reserved ?? [],
    buttonSeat: spec.button ?? null,
    lastSmallBlindSeat: spec.lastSB ?? null,
    lastBigBlindSeat: spec.lastBB ?? null,
    handNumber: 0,
    inHand: spec.inHand ?? false,
  };
}

/** `n` players on seats 0..n-1 with the blinds as if seat 0 was the last big blind. */
export function tableOf(number: number, n: number, extra: Partial<TableSpec> = {}): TableSummary {
  return makeTable({
    number,
    seats: Array.from({ length: n }, (_, i) => i),
    lastBB: n > 0 ? 0 : null,
    lastSB: n > 0 ? 8 : null,
    ...extra,
  });
}

export function sizes(tables: readonly TableSummary[]): number[] {
  return tables.filter((t) => t.status !== 'CLOSED').map((t) => t.seats.filter((s) => s.movingOut !== true).length + t.reservedSeats.length);
}

export function activePlayersOf(tables: readonly TableSummary[]): number {
  return sizes(tables).reduce((a, b) => a + b, 0);
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

/** Plain-JSON stats/blind data for a random table; seat occupancy decided by the caller. */
const seatDataArb = fc.record({
  handsSinceBigBlind: fc.integer({ min: 0, max: 20 }),
  handsPlayedTotal: fc.integer({ min: 0, max: 200 }),
  recent: fc.array(fc.integer({ min: 0, max: 30 }), { maxLength: 2 }),
});

export interface RandomStateOptions {
  minTables?: number;
  maxTables?: number;
  /** Allow movingOut flags and reservations (in-flight state). */
  inFlight?: boolean;
  /** Allow BREAKING tables with residual players. */
  breaking?: boolean;
}

/**
 * Random but valid tournament states: unique player ids, unique table
 * numbers (possibly sparse), seats within maxSeats (9), sizes within maxSize.
 */
export function stateArb(opts: RandomStateOptions = {}): fc.Arbitrary<TableSummary[]> {
  const minTables = opts.minTables ?? 2;
  const maxTables = opts.maxTables ?? 12;
  const tableArb = fc.record({
    seats: fc.uniqueArray(fc.integer({ min: 0, max: 8 }), { minLength: 0, maxLength: 9 }),
    seatData: fc.array(seatDataArb, { minLength: 9, maxLength: 9 }),
    reservedPicks: fc.array(fc.integer({ min: 0, max: 8 }), { maxLength: opts.inFlight === true ? 2 : 0 }),
    movingMask: fc.array(fc.boolean(), { minLength: 9, maxLength: 9 }),
    lastBB: fc.option(fc.integer({ min: 0, max: 8 }), { nil: null }),
    lastSB: fc.option(fc.integer({ min: 0, max: 8 }), { nil: null }),
    button: fc.option(fc.integer({ min: 0, max: 8 }), { nil: null }),
    inHand: fc.boolean(),
    breaking: opts.breaking === true ? fc.integer({ min: 0, max: 9 }).map((x) => x === 0) : fc.constant(false),
    numberGap: fc.integer({ min: 1, max: 3 }),
  });
  return fc.array(tableArb, { minLength: minTables, maxLength: maxTables }).map((raws) => {
    let number = 0;
    return raws.map((r, ti) => {
      number += r.numberGap;
      const tableId = `t${ti}`;
      const occupied = new Set(r.seats);
      const reserved = [...new Set(r.reservedPicks)].filter((s) => !occupied.has(s));
      const seats: SeatSummary[] = r.seats
        .slice()
        .sort((a, b) => a - b)
        .map((seat) => {
          const d = r.seatData[seat] as { handsSinceBigBlind: number; handsPlayedTotal: number; recent: number[] };
          const s: SeatSummary = {
            seat,
            playerId: `${tableId}:p${seat}`,
            stack: 500 + seat,
            stats: stats({ handsSinceBigBlind: d.handsSinceBigBlind, handsPlayedTotal: d.handsPlayedTotal + 30 }),
            recentMovesAtHand: d.recent.map((x) => d.handsPlayedTotal + x).sort((a, b) => a - b),
          };
          if (opts.inFlight === true && r.movingMask[seat] === true && seat % 3 === 0) s.movingOut = true;
          return s;
        });
      return {
        tableId,
        tableNumber: number,
        maxSeats: 9,
        status: r.breaking ? 'BREAKING' : 'ACTIVE',
        seats,
        reservedSeats: r.breaking ? [] : reserved,
        buttonSeat: r.button,
        lastSmallBlindSeat: r.lastSB,
        lastBigBlindSeat: r.lastBB,
        handNumber: 0,
        inHand: r.inHand,
      } satisfies TableSummary;
    });
  });
}

export const balancingArb: fc.Arbitrary<BalancingConfig> = fc.record({
  maxImbalance: fc.integer({ min: 0, max: 3 }),
  recentMoveWindowHands: fc.integer({ min: 0, max: 20 }),
  weights: fc.record({
    position: fc.integer({ min: 0, max: 5 }),
    blindFairness: fc.integer({ min: 0, max: 5 }),
    recentMove: fc.integer({ min: 0, max: 20 }),
    seatCompatibility: fc.constantFrom(0, 0.25, 0.5, 1),
  }),
  consolidateBy: fc.constantFrom('TARGET' as const, 'MAX' as const),
});
