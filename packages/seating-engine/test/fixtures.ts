import type { RandomSource } from '@jpb/randomness';
import type { BalancingConfig, SeatIndex, SeatPositionStats, SeatSummary, TableSizeConfig, TableSummary } from '@jpb/shared-types';

export const DEFAULT_TABLE_CFG: TableSizeConfig = { targetSize: 8, maxSize: 9, minSize: 2, finalTableSize: 9 };

export const EQUAL_WEIGHTS: BalancingConfig['weights'] = { position: 1, blindFairness: 1, recentMove: 1, seatCompatibility: 1 };

/**
 * Deterministic non-cryptographic test stream (mulberry32). Production code
 * uses the HMAC-DRBG from @jpb/randomness; tests only need reproducibility.
 */
export function testRng(seed: number): RandomSource & { draws: () => number } {
  let a = seed >>> 0;
  let draws = 0;
  return {
    nextUint32(): number {
      draws += 1;
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return (t ^ (t >>> 14)) >>> 0;
    },
    draws: () => draws,
  };
}

/** Returns the scripted values in order; throws when exhausted. */
export function scriptedRng(values: readonly number[]): RandomSource & { consumed: () => number } {
  let i = 0;
  return {
    nextUint32(): number {
      if (i >= values.length) throw new Error('scripted rng exhausted');
      const v = values[i] as number;
      i += 1;
      return v;
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
  number?: number;
  maxSeats?: number;
  seats: SeatSpec[];
  reserved?: SeatIndex[];
  button?: SeatIndex | null;
  lastSB?: SeatIndex | null;
  lastBB?: SeatIndex | null;
  inHand?: boolean;
  status?: TableSummary['status'];
  handNumber?: number;
}

export function seatSummary(spec: SeatSpec, tableId: string): SeatSummary {
  const s = typeof spec === 'number' ? { seat: spec } : spec;
  const out: SeatSummary = {
    seat: s.seat,
    playerId: s.playerId ?? `${tableId}-p${s.seat}`,
    stack: s.stack ?? 1000,
    stats: stats(s.stats),
    recentMovesAtHand: s.recentMovesAtHand ?? [],
  };
  if (s.movingOut !== undefined) out.movingOut = s.movingOut;
  return out;
}

export function makeTable(spec: TableSpec): TableSummary {
  const number = spec.number ?? 1;
  const tableId = spec.id ?? `T${number}`;
  return {
    tableId,
    tableNumber: number,
    maxSeats: spec.maxSeats ?? 9,
    status: spec.status ?? 'ACTIVE',
    seats: spec.seats.map((s) => seatSummary(s, tableId)).sort((a, b) => a.seat - b.seat),
    reservedSeats: spec.reserved ?? [],
    buttonSeat: spec.button ?? null,
    lastSmallBlindSeat: spec.lastSB ?? null,
    lastBigBlindSeat: spec.lastBB ?? null,
    handNumber: spec.handNumber ?? 0,
    inHand: spec.inHand ?? false,
  };
}
