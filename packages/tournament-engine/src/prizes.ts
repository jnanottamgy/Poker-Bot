import type { MoneyMinor, PrizeStructure } from '@jpb/shared-types';

/** Configured prize for one finishing position (0 when unpaid). */
export function prizeAt(structure: PrizeStructure, position: number): MoneyMinor {
  return structure.places.find((p) => p.position === position)?.amountMinor ?? 0;
}

/** Number of paid places (positions with a positive prize). */
export function paidPlaces(structure: PrizeStructure): number {
  return structure.places.filter((p) => p.amountMinor > 0).length;
}

/**
 * TIE SPLIT (normative): players tied for position `pos` (n of them) share the
 * prizes of positions pos..pos+n-1 equally. The remainder in minor units is
 * given one unit each to the tied players in ascending registration order.
 * Returns amounts in the same order as `registrationSeqs` was given.
 */
export function splitTiedPrizes(structure: PrizeStructure, pos: number, registrationSeqs: readonly number[]): MoneyMinor[] {
  const n = registrationSeqs.length;
  let pool = 0;
  for (let i = 0; i < n; i++) pool += prizeAt(structure, pos + i);
  const base = Math.floor(pool / n);
  let remainder = pool - base * n;
  const order = registrationSeqs.map((seq, i) => ({ seq, i })).sort((a, b) => a.seq - b.seq);
  const out = new Array<MoneyMinor>(n).fill(base);
  for (const { i } of order) {
    if (remainder === 0) break;
    out[i] = out[i]! + 1;
    remainder -= 1;
  }
  return out;
}
