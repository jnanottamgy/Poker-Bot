import { createTableState, reduceTable } from '@jpb/table-engine';
import type { TableState } from '@jpb/table-engine';
import { buildTableIndex, createDirectorState, directorReduce } from '@jpb/tournament-engine';
import type { DirectorState } from '@jpb/tournament-engine';
import { commitmentFor, createDeckProvider, drawSource } from '@jpb/fairness-engine/node';
import { sha256Hex } from '@jpb/randomness';
import type { SimulationHost } from './host';

/**
 * Rebuilds every actor from its recorded inputs alone (no shared state):
 * the director from its input log, each table from its init + envelopes.
 * This is exactly what crash recovery does from the database logs.
 */
export function replayRun(host: SimulationHost, opts: { tournamentId: string; serverSeed: string; startAt: number }): { director: DirectorState; tables: Map<string, TableState> } {
  let director = createDirectorState({ tournamentId: opts.tournamentId, config: host.director.config, createdAt: opts.startAt, serverSeedHash: commitmentFor(opts.serverSeed) });
  // The config may have been edited by admin inputs; start from the original (first logged) config.
  director = { ...director, config: initialConfig(host) };
  const index = buildTableIndex(director);
  for (const { at, input } of host.directorLog) {
    const tr = directorReduce(director, input, {
      now: at,
      index,
      drawSource: (purpose) => drawSource({ serverSeed: opts.serverSeed, tournamentId: opts.tournamentId, purpose, publicEntropy: director.publicEntropy ?? '0'.repeat(64) }),
    });
    if (tr.reply.ok) director = tr.state;
  }
  const tables = new Map<string, TableState>();
  for (const [tableId, init] of host.tableInits) {
    const deckFor = createDeckProvider({ serverSeed: opts.serverSeed, tournamentId: opts.tournamentId, tableId, publicEntropy: director.publicEntropy ?? '0'.repeat(64) });
    let state = createTableState(init);
    for (const env of host.tableLogs.get(tableId) ?? []) state = reduceTable(state, env, { deckFor }).state;
    tables.set(tableId, state);
  }
  return { director, tables };
}

function initialConfig(host: SimulationHost) {
  return host.initialConfig;
}

/** Stable digest of a run's final state (determinism checks). */
export function runDigest(host: SimulationHost): string {
  const tables = [...host.tables.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  return sha256Hex(JSON.stringify({ director: host.director, tables }));
}
