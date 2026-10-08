import type { PrizePlace, TournamentConfig } from '@jpb/shared-types';
import { applyPreset, defaultTournamentConfig } from '@jpb/validation';
import { computePublicEntropy } from '@jpb/fairness-engine/node';
import { sha256Hex } from '@jpb/randomness';
import { bmValues } from '@jpb/tournament-engine';
import type { DirectorPlayer } from '@jpb/tournament-engine';
import { SimulationHost } from './host';
import { BOT_STRATEGIES } from './bots';
import type { BotStrategy } from './bots';

export interface SimulationOptions {
  players: number;
  config?: TournamentConfig;
  seed?: string;
  strategyMix?: Partial<Record<BotStrategy, number>>;
  maxVirtualMs?: number;
  checkInvariants?: boolean;
  recordEvents?: boolean;
  /** Percentage of the field that is paid (default 15%, at least 1 place). */
  paidPercent?: number;
  /** Asynchronous director↔table delivery latency range (ms); see HostOptions.linkLatencyMs. */
  linkLatencyMs?: [number, number];
  /** Fail on WARNING integrity alerts too (default false). */
  failOnWarnings?: boolean;
}

export interface SimulationResult {
  finished: boolean;
  winnerId: string | null;
  players: DirectorPlayer[];
  handsPlayed: number;
  tablesCreated: number;
  virtualDurationMs: number;
  wallClockMs: number;
  problems: string[];
  host: SimulationHost;
}

export const SIM_T0 = 1_760_000_000_000;
const T0 = SIM_T0;

export function simulationTournamentId(players: number, seed: string): string {
  return `sim-${players}-${seed}`;
}

export function simulationServerSeed(seed: string): string {
  return sha256Hex(`server-seed:${seed}`);
}

/** Prize ladder in minor units for `paid` places (fixed, decreasing; documented test fixture). */
export function testPrizeLadder(paid: number): PrizePlace[] {
  return Array.from({ length: paid }, (_, i) => ({ position: i + 1, amountMinor: Math.max(100, Math.floor(1_000_000 / (i + 1))) }));
}

/** A fast, valid configuration for simulation (SPEED_TEST preset). */
export function simulationConfig(players: number, paidPercent = 15): TournamentConfig {
  const paid = Math.max(1, Math.floor((players * paidPercent) / 100));
  const base = defaultTournamentConfig({
    name: `Simulation ${players}`,
    joinCode: 'SIM0001',
    minPlayers: 2,
    maxPlayers: Math.max(2, players),
    speedMode: true,
  });
  const fast = applyPreset(base, 'SPEED_TEST');
  return { ...fast, prizeStructure: { currency: 'INR', places: testPrizeLadder(paid) } };
}

function strategyFor(i: number, mix: Partial<Record<BotStrategy, number>>): BotStrategy {
  const entries = BOT_STRATEGIES.map((s) => [s, mix[s] ?? 0] as const).filter(([, w]) => w > 0);
  const total = entries.reduce((n, [, w]) => n + w, 0);
  let k = i % total;
  for (const [s, w] of entries) {
    if (k < w) return s;
    k -= w;
  }
  return 'RANDOM_LEGAL_ACTION';
}

export const DEFAULT_MIX: Partial<Record<BotStrategy, number>> = { RANDOM_LEGAL_ACTION: 3, CALL_HEAVY: 2, RAISE_HEAVY: 2, ALL_IN_RANDOMLY: 2, ALWAYS_FOLD: 1 };

/** Runs a complete tournament through the real engines and checks the outcome. */
export function runSimulatedTournament(opts: SimulationOptions): SimulationResult {
  const started = performance.now();
  const seed = opts.seed ?? 'johnny';
  const config = opts.config ?? simulationConfig(opts.players, opts.paidPercent);
  const host = new SimulationHost({
    tournamentId: simulationTournamentId(opts.players, seed),
    config,
    serverSeed: simulationServerSeed(seed),
    startAt: T0,
    checkInvariants: opts.checkInvariants ?? true,
    ...(opts.linkLatencyMs ? { linkLatencyMs: opts.linkLatencyMs } : {}),
  });
  host.recordEvents = opts.recordEvents ?? true;
  const mix = opts.strategyMix ?? DEFAULT_MIX;
  must(host.submitDirector({ type: 'OPEN_REGISTRATION' }));
  for (let i = 0; i < opts.players; i++) {
    const playerId = `p${String(i + 1).padStart(7, '0')}`;
    must(
      host.submitDirector({
        type: 'REGISTER_PLAYER',
        playerId,
        entryId: `e-${playerId}`,
        displayName: `Bot ${i + 1}`,
        publicId: `JPN-${(i + 1).toString(36).toUpperCase().padStart(5, '0')}`,
        registrationSeq: i + 1,
        clientSeed: null,
        approved: true,
      }),
    );
    host.addBot(playerId, strategyFor(i, mix));
  }
  must(host.submitDirector({ type: 'START', publicEntropy: computePublicEntropy({ clientSeeds: [], adminEntropy: seed }) }));
  const finished = host.run(opts.maxVirtualMs ?? 400 * 3_600_000);
  const players = bmValues(host.director.players);
  return {
    finished,
    winnerId: host.director.winnerId,
    players,
    handsPlayed: host.stats.handsCompleted,
    tablesCreated: host.director.seq.table,
    virtualDurationMs: host.now - T0,
    wallClockMs: performance.now() - started,
    problems: finalChecks(host, players),
    host,
  };
}

function must(reply: { ok: boolean; code: string | null; message: string | null }): void {
  if (!reply.ok) throw new Error(`director rejected: ${reply.code} ${reply.message}`);
}

/** Outcome invariants for a completed tournament. Empty array = all good. */
export function finalChecks(host: SimulationHost, players: DirectorPlayer[]): string[] {
  const problems: string[] = [];
  const d = host.director;
  if (d.status !== 'COMPLETED') problems.push(`status is ${d.status}, not COMPLETED`);
  const winners = players.filter((p) => p.finishPosition === 1);
  if (winners.length !== 1) problems.push(`expected exactly one champion, found ${winners.length}`);
  if (d.winnerId !== winners[0]?.playerId) problems.push('winnerId does not match the 1st-place player');
  const unranked = players.filter((p) => p.status !== 'WITHDRAWN' && p.finishPosition === null);
  if (unranked.length) problems.push(`${unranked.length} players have no finishing position`);
  // Positions 1..N are covered exactly once, counting ties.
  const n = players.filter((p) => p.finishPosition !== null).length;
  const covered = new Array<number>(n + 1).fill(0);
  for (const p of players) {
    if (p.finishPosition === null) continue;
    if (p.finishPosition < 1 || p.finishPosition > n) problems.push(`position ${p.finishPosition} out of range`);
    else covered[p.finishPosition] = (covered[p.finishPosition] ?? 0) + 1;
  }
  for (let pos = 1; pos <= n; ) {
    const count = covered[pos] ?? 0;
    if (count === 0) {
      problems.push(`position ${pos} not assigned`);
      pos += 1;
    } else pos += count;
  }
  const winnerTable = d.winnerId ? [...host.tables.values()].find((t) => t.seats.some((s) => s?.playerId === d.winnerId)) : undefined;
  const winnerStack = winnerTable?.seats.find((s) => s?.playerId === d.winnerId)?.stack;
  if (winnerStack !== undefined && winnerStack !== d.counters.totalChips) problems.push(`champion holds ${winnerStack} chips but ${d.counters.totalChips} are in play`);
  if (!d.integrity.ok) problems.push(`integrity: expected ${d.integrity.expectedTotal}, actual ${d.integrity.actualTotal}`);
  const awarded = players.reduce((s, p) => s + p.prizeMinor, 0);
  const configured = d.config.prizeStructure.places.filter((pl) => pl.position <= n).reduce((s, pl) => s + pl.amountMinor, 0);
  if (awarded !== configured) problems.push(`prizes awarded ${awarded} differ from configured ${configured}`);
  if (host.alerts.some((a) => a.type === 'INTEGRITY_ALERT' && a.severity === 'CRITICAL')) problems.push('critical integrity alerts were raised');
  return problems;
}
