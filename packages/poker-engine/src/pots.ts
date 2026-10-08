import type { Chips, SeatIndex } from '@jpb/shared-types';
import type { Pot } from './types';

export interface PotContribution {
  seat: SeatIndex;
  /** Total chips this player put in at contribution level (antes in level, blinds, bets). */
  amount: Chips;
  folded: boolean;
}

export interface BuildPotsOptions {
  /**
   * Dead money that belongs to the main pot regardless of contribution levels
   * (the big-blind ante under BB_ANTE). Never returned as uncalled.
   */
  deadMoney?: Chips;
}

export interface BuildPotsResult {
  pots: Pot[];
  /** Portion of the single highest contribution that nobody matched (rule 9). */
  uncalled: { seat: SeatIndex; amount: Chips } | null;
}

function assertChips(n: unknown, what: string): asserts n is number {
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0) {
    throw new RangeError(`${what} must be a non-negative safe integer, got ${String(n)}`);
  }
}

/**
 * Uncalled bet (rule 9): if exactly one player has the highest contribution,
 * the excess over the second-highest contribution (0 if nobody else
 * contributed) is returned to them. Applies even if that player folded.
 */
export function findUncalled(contribs: readonly PotContribution[]): { seat: SeatIndex; amount: Chips } | null {
  let top: PotContribution | null = null;
  let topCount = 0;
  let second = 0;
  for (const c of contribs) {
    if (top === null || c.amount > top.amount) {
      if (top !== null) second = Math.max(second, top.amount);
      top = c;
      topCount = 1;
    } else if (c.amount === top.amount) {
      topCount++;
    } else {
      second = Math.max(second, c.amount);
    }
  }
  if (top === null || topCount > 1 || top.amount <= second) return null;
  return { seat: top.seat, amount: top.amount - second };
}

function sameSeats(a: readonly SeatIndex[], b: readonly SeatIndex[]): boolean {
  return a.length === b.length && a.every((s, i) => s === b[i]);
}

/**
 * Builds pots from total contributions (rule 10).
 *
 * 1. The uncalled excess (see `findUncalled`) is removed first.
 * 2. Distinct contribution levels L1 < L2 < ... cut the contributions into
 *    layers; layer i holds sum(min(a, Li) - min(a, Li-1)) over all players.
 *    Eligible = non-folded players with a >= Li.
 * 3. A layer with no eligible player (all its contributors folded) is merged
 *    into the next lower layer. Adjacent layers with identical eligible sets
 *    are merged into one pot (they would always be won by the same players).
 * 4. `deadMoney` is added to the main pot (index 0).
 *
 * Throws RangeError on malformed input or when chips exist but no
 * non-folded player can win them (impossible in a valid hand).
 */
export function buildPots(contribs: ReadonlyArray<PotContribution>, opts: BuildPotsOptions = {}): BuildPotsResult {
  const deadMoney = opts.deadMoney ?? 0;
  assertChips(deadMoney, 'deadMoney');
  const seen = new Set<SeatIndex>();
  for (const c of contribs) {
    assertChips(c.amount, `contribution of seat ${c.seat}`);
    if (seen.has(c.seat)) throw new RangeError(`Duplicate seat ${c.seat} in contributions`);
    seen.add(c.seat);
  }

  const uncalled = findUncalled(contribs);
  const amounts = contribs.map((c) => ({
    seat: c.seat,
    folded: c.folded,
    amount: uncalled !== null && c.seat === uncalled.seat ? c.amount - uncalled.amount : c.amount,
  }));
  const levels = [...new Set(amounts.map((a) => a.amount).filter((a) => a > 0))].sort((x, y) => x - y);

  const pots: Array<{ amount: Chips; eligibleSeats: SeatIndex[]; contributorSeats: SeatIndex[] }> = [];
  let pending = 0;
  let pendingContributors: SeatIndex[] = [];
  let prev = 0;
  for (const level of levels) {
    let layerAmount = 0;
    const contributors: SeatIndex[] = [];
    const eligible: SeatIndex[] = [];
    for (const a of amounts) {
      const part = Math.min(a.amount, level) - Math.min(a.amount, prev);
      if (part > 0) {
        layerAmount += part;
        contributors.push(a.seat);
      }
      if (!a.folded && a.amount >= level) eligible.push(a.seat);
    }
    prev = level;
    eligible.sort((x, y) => x - y);
    const last = pots[pots.length - 1];
    if (eligible.length === 0 || (last !== undefined && sameSeats(last.eligibleSeats, eligible))) {
      if (last === undefined) {
        pending += layerAmount;
        pendingContributors = [...pendingContributors, ...contributors];
      } else {
        last.amount += layerAmount;
        last.contributorSeats = [...new Set([...last.contributorSeats, ...contributors])].sort((x, y) => x - y);
      }
      continue;
    }
    pots.push({
      amount: layerAmount + pending,
      eligibleSeats: eligible,
      contributorSeats: [...new Set([...pendingContributors, ...contributors])].sort((x, y) => x - y),
    });
    pending = 0;
    pendingContributors = [];
  }

  if (pending > 0) throw new RangeError('Chips in the pot but no non-folded player is eligible');
  if (deadMoney > 0) {
    const main = pots[0];
    if (main !== undefined) {
      main.amount += deadMoney;
    } else {
      const live = amounts
        .filter((a) => !a.folded)
        .map((a) => a.seat)
        .sort((x, y) => x - y);
      if (live.length === 0) throw new RangeError('Dead money but no non-folded player');
      pots.push({ amount: deadMoney, eligibleSeats: live, contributorSeats: [] });
    }
  }

  return {
    pots: pots.map((p, index) => ({ index, type: index === 0 ? 'MAIN' : 'SIDE', ...p })),
    uncalled,
  };
}
