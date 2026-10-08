/**
 * Shared fixtures for the table-geometry gallery section and the overlap check
 * in screenshot.mjs (2-10 seats, every seat filled and busy).
 */
import type { TableSeat } from '../src';

const FIRST = ['Arjun', 'Sofia', 'Kenji', 'Priya', 'Marcus', 'Lena', 'Wei', 'Diego', 'Hannah', 'Johnny'];
const LAST = ['Mehta', 'Lindqvist', 'Watanabe', 'Raman', 'Hale', 'Fischer', 'Zhang', 'Alvarez', 'Okafor', 'Kowalski'];

/** A worst-case busy table: long names, two-line action chips, badges, shown cards. */
export function busySeats(n: number, heroSeat: number | null, showdown = false): TableSeat[] {
  return Array.from({ length: n }, (_, i) => {
    const name = `${FIRST[i % 10]} ${LAST[(i + 3) % 10]}`;
    const base: TableSeat = { name, stack: 12_000 + i * 7_350 };
    if (i === heroSeat) return { ...base, holeCards: ['Ah', 'Kh'], isBigBlind: true };
    if (showdown) return { ...base, shownCards: i % 2 ? ['Qs', 'Qc'] : ['Jd', 'Td'] };
    switch (i % 5) {
      case 0:
        return { ...base, isButton: true, lastAction: { action: 'RAISE', amount: 2200, toAmount: 2400 }, bet: 2400 };
      case 1:
        return { ...base, folded: true, connected: false };
      case 2:
        return { ...base, isSmallBlind: true, lastAction: { action: 'CALL', amount: 125_000, toAmount: 125_000 }, bet: 125_000 };
      case 3:
        return { ...base, stack: 0, allIn: true, lastAction: { action: 'ALL_IN', amount: 6100, toAmount: 6500 }, bet: 6500 };
      default:
        return { ...base, away: true, folded: true };
    }
  });
}

export const GEOMETRY_WIDTHS = [328, 358, 398] as const;
export const GEOMETRY_SEATS = [2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
