import type { DemoRequest, DemoStatusDto, TournamentStatus } from '@jpb/shared-types';
import type { IconName } from '@jpb/ui';

/**
 * Demo & simulation model (§2.20). Bots are deterministic rule-based
 * strategies from @jpb/simulation (no AI). The strategy assignment below is
 * the server's (game/demo.ts assignStrategies), reproduced so the form shows
 * the exact number of bots per strategy before anything is created.
 */

export type Strategy = keyof DemoRequest['strategyMix'];

export const STRATEGIES: readonly Strategy[] = ['RANDOM_LEGAL_ACTION', 'CALL_HEAVY', 'RAISE_HEAVY', 'ALL_IN_RANDOMLY', 'ALWAYS_FOLD', 'TIMEOUT_ALWAYS', 'FLAKY'];

export const STRATEGY_META: Readonly<Record<Strategy, { label: string; icon: IconName; description: string }>> = {
  RANDOM_LEGAL_ACTION: { label: 'Random legal action', icon: 'refresh', description: 'Any legal action, uniformly (seeded per bot).' },
  CALL_HEAVY: { label: 'Call-heavy', icon: 'check', description: 'Mostly checks and calls; rarely raises.' },
  RAISE_HEAVY: { label: 'Raise-heavy', icon: 'arrow-up', description: 'Bets and raises often — big pots, fast eliminations.' },
  ALL_IN_RANDOMLY: { label: 'All-in randomly', icon: 'flame', description: 'Shoves at random moments: side pots and bust-outs.' },
  ALWAYS_FOLD: { label: 'Always fold', icon: 'x', description: 'Folds whenever it can (checks when free).' },
  TIMEOUT_ALWAYS: { label: 'Always times out', icon: 'clock', description: 'Never acts: exercises timers, auto-fold and “away”.' },
  FLAKY: { label: 'Flaky connection', icon: 'wifi-off', description: 'Disconnects and reconnects: exercises resume and grace.' },
};

export type Mix = Record<Strategy, number>;

export const WEIGHT_MAX = 10;

const mix = (m: Partial<Mix>): Mix => Object.fromEntries(STRATEGIES.map((s) => [s, m[s] ?? 0])) as Mix;

/** The server's default mix (used when every weight is 0). */
export const DEFAULT_MIX: Mix = mix({ RANDOM_LEGAL_ACTION: 4, CALL_HEAVY: 2, RAISE_HEAVY: 2, ALL_IN_RANDOMLY: 1, ALWAYS_FOLD: 1 });

export const MIX_PRESETS: ReadonlyArray<{ id: string; label: string; hint: string; mix: Mix }> = [
  { id: 'balanced', label: 'Balanced', hint: 'The server default: a realistic field', mix: DEFAULT_MIX },
  { id: 'passive', label: 'Passive', hint: 'Long hands, few eliminations', mix: mix({ CALL_HEAVY: 6, RANDOM_LEGAL_ACTION: 2, ALWAYS_FOLD: 2 }) },
  { id: 'aggressive', label: 'Aggressive', hint: 'Big pots, fast bust-outs, many table breaks', mix: mix({ RAISE_HEAVY: 5, ALL_IN_RANDOMLY: 3, RANDOM_LEGAL_ACTION: 2 }) },
  { id: 'chaos', label: 'Chaos', hint: 'All-ins, timeouts and flaky connections together', mix: mix({ ALL_IN_RANDOMLY: 3, RANDOM_LEGAL_ACTION: 3, TIMEOUT_ALWAYS: 2, FLAKY: 2 }) },
  { id: 'timeouts', label: 'Timeout drill', hint: 'Stress timers, away status and reconnects', mix: mix({ TIMEOUT_ALWAYS: 4, FLAKY: 4, RANDOM_LEGAL_ACTION: 2 }) },
  { id: 'even', label: 'Even', hint: 'One of everything', mix: mix(Object.fromEntries(STRATEGIES.map((s) => [s, 1]))) },
];

export const PLAYER_PRESETS = [8, 16, 32, 100, 1_000, 10_000] as const;
export const MIN_BOTS = 2;
/** The server's development cap (production allows 20,000; the server's answer is authoritative). */
export const MAX_BOTS = 100_000;
/** Ask for a confirmation before starting a field this large (it loads the server like a real event). */
export const LARGE_DEMO = 1_000;
/** Table size and paid share of the demo configuration (game/demo.ts demoConfig). */
export const DEMO_TABLE_SIZE = 8;
export const DEMO_PAID_SHARE = 0.15;
export const NAME_MAX = 80;

export function sameMix(a: Mix, b: Mix): boolean {
  return STRATEGIES.every((s) => a[s] === b[s]);
}

/** Weights actually used: the server falls back to its default when every weight is 0. */
export function effectiveMix(m: Mix): Mix {
  return STRATEGIES.some((s) => m[s] > 0) ? m : DEFAULT_MIX;
}

/** Exact bots per strategy — same weighted, evenly interleaved assignment as the server. */
export function strategyCounts(n: number, m: Mix): Mix {
  const use = STRATEGIES.filter((s) => m[s] > 0).map((s) => [s, m[s]] as const);
  const total = use.reduce((a, [, w]) => a + w, 0);
  const counts = mix({});
  if (total <= 0) return counts;
  for (let i = 0; i < n; i++) {
    let k = (i * 7919) % total;
    for (const [s, w] of use) {
      if (k < w) {
        counts[s] += 1;
        break;
      }
      k -= w;
    }
  }
  return counts;
}

export function botsProblem(n: number): string | null {
  if (!Number.isInteger(n)) return 'Enter a whole number of bots.';
  if (n < MIN_BOTS) return `At least ${MIN_BOTS} bots.`;
  if (n > MAX_BOTS) return `At most ${MAX_BOTS.toLocaleString('en-US')} bots.`;
  return null;
}

export function toRequest(n: number, m: Mix, speedMode: boolean, name: string): DemoRequest {
  const strategyMix = Object.fromEntries(STRATEGIES.filter((s) => m[s] > 0).map((s) => [s, m[s]])) as DemoRequest['strategyMix'];
  return { players: n, strategyMix, speedMode, ...(name.trim() ? { name: name.trim().slice(0, NAME_MAX) } : {}) };
}

export function projection(n: number): { tables: number; paid: number } {
  return { tables: Math.ceil(n / DEMO_TABLE_SIZE), paid: Math.max(1, Math.floor(n * DEMO_PAID_SHARE)) };
}

const TERMINAL: readonly TournamentStatus[] = ['COMPLETED', 'CANCELLED'];
export const isTerminal = (s: TournamentStatus) => TERMINAL.includes(s);

export interface Throughput {
  elapsedMs: number;
  handsPerMinute: number;
  actionsPerSecond: number;
  eliminated: number;
  /** 0..1 of the field eliminated. */
  progress: number;
}

export function throughput(d: Pick<DemoStatusDto, 'startedAt' | 'handsCompleted' | 'actionsSubmitted' | 'players' | 'playersRemaining'>, now: number): Throughput {
  const elapsedMs = Math.max(0, now - d.startedAt);
  const min = elapsedMs / 60_000;
  const eliminated = Math.max(0, d.players - d.playersRemaining);
  return {
    elapsedMs,
    handsPerMinute: min > 0 ? d.handsCompleted / min : 0,
    actionsPerSecond: elapsedMs > 0 ? d.actionsSubmitted / (elapsedMs / 1000) : 0,
    eliminated,
    progress: d.players > 1 ? Math.min(1, eliminated / (d.players - 1)) : 1,
  };
}

/** Public big-screen URL of a tournament (apps/broadcast-display, base /display/). */
export function displayUrl(joinCode: string, origin: string = typeof location === 'undefined' ? '' : location.origin): string {
  return `${origin}/display/${encodeURIComponent(joinCode)}`;
}
