import type { RandomSource } from '@jpb/randomness';
import type { PlayerId, SeatIndex, TableSizeConfig } from '@jpb/shared-types';
import type { ConsolidateBy } from './config';
import { compareIds, drawButtonSeat, shuffled } from './random';
import { spreadSeats } from './spread';
import { computeTableCount, distributeSizes } from './tableCount';

export interface InitialSeatingInput {
  playerIds: readonly PlayerId[];
  cfg: TableSizeConfig;
  consolidateBy: ConsolidateBy;
  /** Seat-draw stream, e.g. fairness drawSource('seating'). */
  rng: RandomSource;
  /**
   * Optional per-table button stream (e.g. drawSource(`button:${tableId}`)).
   * When omitted, buttons are drawn from `rng` after the player shuffle, in
   * table-number order.
   */
  buttonSource?: (tableNumber: number) => RandomSource;
}

export interface InitialTable {
  /** 1-based, in creation order. */
  tableNumber: number;
  maxSeats: number;
  /** Ascending by seat. */
  seats: Array<{ seat: SeatIndex; playerId: PlayerId }>;
  buttonSeat: SeatIndex;
}

export interface InitialSeatingResult {
  tables: InitialTable[];
}

/**
 * Random initial seat draw (fully determined by the rng stream):
 *
 *  1. ids = playerIds sorted by UTF-16 code units (input order never matters).
 *  2. order = Fisher–Yates(ids, rng)                         — consumes n-1 draws.
 *  3. T = computeTableCount(n); sizes = distributeSizes(n, T, maxSize).
 *  4. Table k (k = 1..T) takes the next sizes[k-1] players of `order`; its i-th
 *     player sits in spreadSeats(size, maxSize)[i].
 *  5. For k = 1..T: buttonSeat = drawButtonSeat(occupied seats, buttonSource?.(k) ?? rng).
 */
export function initialSeating(input: InitialSeatingInput): InitialSeatingResult {
  const { cfg, consolidateBy, rng } = input;
  const ids = input.playerIds.slice().sort(compareIds);
  if (ids.length === 0) throw new RangeError('initialSeating requires at least one player');
  for (let i = 1; i < ids.length; i += 1) {
    if (ids[i] === ids[i - 1]) throw new RangeError(`duplicate playerId ${String(ids[i])}`);
  }
  const order = shuffled(ids, rng);
  const tableCount = computeTableCount(order.length, cfg, consolidateBy);
  const sizes = distributeSizes(order.length, tableCount, cfg.maxSize);

  const tables: InitialTable[] = [];
  let offset = 0;
  for (let t = 0; t < sizes.length; t += 1) {
    const size = sizes[t] as number;
    const seatList = spreadSeats(size, cfg.maxSize);
    const seats = seatList.map((seat, i) => ({ seat, playerId: order[offset + i] as PlayerId }));
    offset += size;
    tables.push({ tableNumber: t + 1, maxSeats: cfg.maxSize, seats, buttonSeat: -1 });
  }
  for (const table of tables) {
    const source = input.buttonSource ? input.buttonSource(table.tableNumber) : rng;
    table.buttonSeat = drawButtonSeat(
      table.seats.map((s) => s.seat),
      source,
    );
  }
  return { tables };
}
