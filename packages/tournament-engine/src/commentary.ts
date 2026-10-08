import type { Draft } from './draft';
import { emit } from './draft';
import { paidPlaces } from './prizes';

/**
 * Deterministic commentary (spec §91–92): fixed templates, no AI. Each
 * milestone fires once per tournament.
 */
export const TEMPLATES = {
  playersRemain: (n: number) => `${formatCount(n)} PLAYERS REMAIN`,
  finalN: (n: number) => `FINAL ${formatCount(n)}`,
  finalTable: () => 'FINAL TABLE',
  headsUp: () => 'HEADS-UP',
  bubble: () => 'ON THE BUBBLE — HAND-FOR-HAND',
  inTheMoney: (n: number) => `IN THE MONEY — ${formatCount(n)} PLAYERS PAID`,
  eliminated: (player: string, position: number) => `${player} has been eliminated in ${ordinal(position)} place.`,
  bigPot: (player: string, amount: number) => `${player} wins a ${formatCount(amount)} chip pot.`,
  tablesReduced: (n: number) => `TABLES REDUCED TO ${formatCount(n)}`,
  champion: (player: string) => `${player} IS THE CHAMPION`,
} as const;

const THRESHOLDS = [100_000, 50_000, 10_000, 5_000, 1_000, 500, 250, 100, 50, 27, 18];

function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

function fire(d: Draft, code: string, text: string): void {
  if (d.s.milestonesFired.includes(code)) return;
  d.s.milestonesFired = [...d.s.milestonesFired, code];
  emit(d, { kind: 'MILESTONE', code, text, playersRemaining: d.s.counters.active });
}

/** Checks every milestone rule against the current counters. */
export function fireMilestones(d: Draft): void {
  const active = d.s.counters.active;
  const registered = d.s.counters.registered;
  for (const t of THRESHOLDS) {
    if (active <= t && registered > t) {
      fire(d, `REMAIN_${t}`, t === 100 ? TEMPLATES.finalN(100) : TEMPLATES.playersRemain(t));
      break;
    }
  }
  const paid = paidPlaces(d.s.config.prizeStructure);
  if (paid > 0 && active === paid + 1 && registered > paid + 1) fire(d, 'BUBBLE', TEMPLATES.bubble());
  if (paid > 0 && active === paid && registered > paid) fire(d, 'IN_THE_MONEY', TEMPLATES.inTheMoney(paid));
  if (active === 2 && registered > 2) fire(d, 'HEADS_UP', TEMPLATES.headsUp());
}
