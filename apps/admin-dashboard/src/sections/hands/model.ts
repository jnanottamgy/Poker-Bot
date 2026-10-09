import type { HandListItemDto } from '@jpb/shared-types';
import { formatChips } from '@jpb/ui';

/**
 * Display helpers shared by the hand list (§2.10), the hand detail and the
 * fairness screen. Pure functions: no locale from the environment, chips are
 * integers, nothing here decides anything about the game.
 */

/** "300 / 600" or "300 / 600 · ante 75". */
export function blindsText(smallBlind: number, bigBlind: number, ante = 0): string {
  const base = `${formatChips(smallBlind)} / ${formatChips(bigBlind)}`;
  return ante > 0 ? `${base} · ante ${formatChips(ante)}` : base;
}

/** Big blinds, truncated to one decimal (never overstated): 12,345 at 600 → "20.5 BB". */
export function bbText(chips: number, bigBlind: number): string {
  if (!(bigBlind > 0) || !Number.isFinite(chips)) return '';
  const tenths = Math.floor((chips * 10) / bigBlind);
  return `${tenths % 10 === 0 ? tenths / 10 : (tenths / 10).toFixed(1)} BB`;
}

/** Hand duration in ms (null while the hand has no completion time). */
export function handDurationMs(h: Pick<HandListItemDto, 'startedAt' | 'completedAt'>): number | null {
  return h.completedAt === null ? null : Math.max(0, h.completedAt - h.startedAt);
}

const CHIP_SUFFIX: Readonly<Record<string, number>> = { k: 1_000, m: 1_000_000, b: 1_000_000_000 };
/** Largest chip amount accepted in a filter (the server stores bigint pots; this is far above any real pot). */
export const MAX_CHIP_INPUT = 1_000_000_000_000;

/**
 * Parses an operator-typed chip amount: "12500", "12,500", "12.5k", "1.2M".
 * Returns null for anything that is not a non-negative whole number of chips.
 */
export function parseChipInput(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/[,_\s]/g, '');
  if (t === '') return null;
  const m = /^(\d+(?:\.\d+)?)([kmb])?$/.exec(t);
  if (!m) return null;
  const mult = m[2] ? (CHIP_SUFFIX[m[2]] ?? 1) : 1;
  // Integer arithmetic on the decimal digits avoids 1.1 * 1000 = 1100.0000000000002.
  const [whole = '0', frac = ''] = (m[1] ?? '0').split('.');
  const scale = 10 ** frac.length;
  const scaled = Number(whole) * scale + (frac ? Number(frac) : 0);
  const value = (scaled * mult) / scale;
  if (!Number.isSafeInteger(value) || value > MAX_CHIP_INPUT) return null;
  return value;
}

/** Parses a positive hand number ("1234", "#1,234"); null otherwise. */
export function parseHandNumber(text: string): number | null {
  const t = text.trim().replace(/^#/, '').replace(/[,_\s]/g, '');
  if (!/^\d{1,9}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 ? n : null;
}

/** "Ana Bose" / "Ana Bose + 1 more" for the winners column. */
export function winnersText(winners: HandListItemDto['winners']): string {
  if (winners.length === 0) return '—';
  const [first, ...rest] = winners;
  return rest.length === 0 ? first!.displayName : `${first!.displayName} + ${rest.length} more`;
}

/** Sum of everything the winners of a hand collected. */
export function totalWon(winners: HandListItemDto['winners']): number {
  return winners.reduce((sum, w) => sum + w.amount, 0);
}
