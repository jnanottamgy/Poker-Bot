import type { PrizePlace } from '@jpb/shared-types';
import { CONFIG_LIMITS } from '@jpb/validation';
import { isNum } from './format';

/**
 * Prize table helpers. Money is integer minor units (never chips, never
 * floating point): percentages are handled as basis points (1 bp = 0.01 %)
 * and every split uses exact BigInt arithmetic.
 */

export const BP_TOTAL = 10_000;
const BP_PER_PERCENT = 100;

export interface PercentPreset {
  id: string;
  label: string;
  /** Basis points per place, summing to BP_TOTAL, never increasing. */
  bp: readonly number[];
}

export const PERCENT_PRESETS: readonly PercentPreset[] = [
  { id: 'wta', label: 'Winner takes all', bp: [10_000] },
  { id: 'top2', label: 'Top 2 · 65 / 35', bp: [6_500, 3_500] },
  { id: 'top3', label: 'Top 3 · 50 / 30 / 20', bp: [5_000, 3_000, 2_000] },
  { id: 'top5', label: 'Top 5 · 40 / 25 / 15 / 12 / 8', bp: [4_000, 2_500, 1_500, 1_200, 800] },
  { id: 'top9', label: 'Final table (9) · 30 / 20 / 14 / 10 / 8 / 6 / 5 / 4 / 3', bp: [3_000, 2_000, 1_400, 1_000, 800, 600, 500, 400, 300] },
];

export function renumberPlaces(places: readonly PrizePlace[]): PrizePlace[] {
  return places.map((p, i) => (p.position === i + 1 ? p : { ...p, position: i + 1 }));
}

/** A new last place paying the same as the current last one (keeps amounts non-increasing). */
export function appendPlace(places: readonly PrizePlace[]): PrizePlace[] {
  const last = places[places.length - 1];
  return [...places, { position: places.length + 1, amountMinor: isNum(last?.amountMinor) ? last.amountMinor : 0 }];
}

export function insertPlaceAfter(places: readonly PrizePlace[], index: number): PrizePlace[] {
  const src = places[index];
  if (!src) return [...places];
  const copy: PrizePlace = { position: src.position, amountMinor: src.amountMinor };
  return renumberPlaces([...places.slice(0, index + 1), copy, ...places.slice(index + 1)]);
}

export function removePlace(places: readonly PrizePlace[], index: number): PrizePlace[] {
  return renumberPlaces(places.filter((_, i) => i !== index));
}

export function setPlace(places: readonly PrizePlace[], index: number, patch: Partial<Pick<PrizePlace, 'amountMinor' | 'label'>>): PrizePlace[] {
  return places.map((p, i) => {
    if (i !== index) return p;
    const next: PrizePlace = { ...p, ...patch };
    if (next.label === undefined || next.label === '') delete next.label;
    return next;
  });
}

/** Σ amounts, exact; null when an amount is not a number yet or the sum is not a safe integer. */
export function totalMinor(places: readonly PrizePlace[]): number | null {
  let total = 0n;
  for (const p of places) {
    if (!isNum(p.amountMinor) || !Number.isSafeInteger(p.amountMinor)) return null;
    total += BigInt(p.amountMinor);
  }
  return total > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(total);
}

export interface PercentParse {
  bp: number[];
  problems: string[];
}

/**
 * "50, 30, 20" / "50/30/20" / one per line → basis points. Up to two
 * decimals ("12.5"); must total exactly 100 % and must not increase.
 */
export function parsePercentages(text: string): PercentParse {
  const parts = text
    .split(/[\s,;/|]+/)
    .map((p) => p.replace(/%$/, ''))
    .filter((p) => p !== '');
  const problems: string[] = [];
  const bp: number[] = [];
  for (const p of parts) {
    const m = p.match(/^(\d{1,3})(?:\.(\d{1,2}))?$/);
    if (!m) {
      problems.push(`“${p.slice(0, 12)}” is not a percentage (use numbers like 50 or 12.5).`);
      continue;
    }
    bp.push(Number(m[1]) * BP_PER_PERCENT + Number((m[2] ?? '').padEnd(2, '0')));
  }
  if (parts.length === 0) problems.push('Enter at least one percentage.');
  if (bp.some((v) => v <= 0)) problems.push('Every paid place needs more than 0 %.');
  const sum = bp.reduce((a, b) => a + b, 0);
  if (problems.length === 0 && sum !== BP_TOTAL) problems.push(`The percentages add up to ${formatBp(sum)}; they must total exactly 100 %.`);
  if (bp.some((v, i) => i > 0 && v > bp[i - 1]!)) problems.push('Percentages must not increase from one place to the next.');
  if (bp.length > CONFIG_LIMITS.MAX_PRIZE_PLACES) problems.push(`At most ${CONFIG_LIMITS.MAX_PRIZE_PLACES.toLocaleString('en-US')} paid places.`);
  return { bp, problems };
}

/** 1250 → "12.5 %". */
export function formatBp(bp: number): string {
  const whole = Math.trunc(bp / BP_PER_PERCENT);
  const frac = Math.abs(bp % BP_PER_PERCENT);
  return `${whole}${frac ? `.${String(frac).padStart(2, '0').replace(/0$/, '')}` : ''} %`;
}

export function percentText(bp: readonly number[]): string {
  return bp.map((v) => formatBp(v).replace(' %', '')).join(' / ');
}

/**
 * Splits `poolMinor` by basis points:
 *   amount_i = floor(pool × bp_i / 10,000 / round) × round
 *   the remainder (pool − Σ amount_i) goes to 1st place
 * so the total is exactly the pool and amounts never increase when the
 * percentages do not. `roundMinor` = 1 keeps every minor unit.
 */
export function distributePool(poolMinor: number, bp: readonly number[], roundMinor = 1): PrizePlace[] {
  if (!Number.isSafeInteger(poolMinor) || poolMinor <= 0 || bp.length === 0) return [];
  const pool = BigInt(poolMinor);
  const round = BigInt(Math.max(1, Math.trunc(roundMinor)));
  const amounts = bp.map((v) => ((pool * BigInt(v)) / BigInt(BP_TOTAL) / round) * round);
  const used = amounts.reduce((a, b) => a + b, 0n);
  amounts[0] = amounts[0]! + (pool - used);
  return amounts.map((a, i) => ({ position: i + 1, amountMinor: Number(a) }));
}

/** Share of the pool each place takes (display), in basis points; null when the total is 0 or unknown. */
export function shareBp(amountMinor: number, total: number | null): number | null {
  if (total === null || total <= 0 || !isNum(amountMinor)) return null;
  return Number((BigInt(Math.trunc(amountMinor)) * BigInt(BP_TOTAL)) / BigInt(total));
}
