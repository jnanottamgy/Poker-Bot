import type { EpochMs, TournamentConfig, TournamentId } from '@jpb/shared-types';
import { emptyBucketMap } from './bucketMap';
import type { DirectorState } from './types';

export interface CreateDirectorInput {
  tournamentId: TournamentId;
  /** Must already be validated by @jpb/validation. */
  config: TournamentConfig;
  createdAt: EpochMs;
  serverSeedHash: string;
}

/** A tournament in DRAFT. */
export function createDirectorState(input: CreateDirectorInput): DirectorState {
  return {
    version: 1,
    tournamentId: input.tournamentId,
    config: input.config,
    serverSeedHash: input.serverSeedHash,
    publicEntropy: null,
    createdAt: input.createdAt,
    startedAt: null,
    completedAt: null,
    status: 'DRAFT',
    resumeTo: null,
    pausedFrom: null,
    frozen: false,
    clock: {
      levelIndex: 0,
      levelStartedAt: null,
      levelEndsAt: null,
      pausedRemainingMs: null,
      breakEndsAt: null,
      pendingBreakAfterLevel: null,
      startAt: null,
      pausedBreakRemainingMs: null,
      pausedTotalMs: 0,
      pausedAt: null,
    },
    players: emptyBucketMap(),
    tables: emptyBucketMap(),
    pendingMoves: {},
    counters: { registered: 0, active: 0, eliminated: 0, inTransit: 0, tables: 0, handsCompleted: 0, totalChips: 0, largestPot: 0 },
    chipsAtTables: 0,
    chipsRemoved: 0,
    chipsAdjusted: 0,
    handForHand: { enabled: false, manual: false, phase: 'OFF', round: 0, awaiting: [], roundBusts: [] },
    finalTable: { formed: false, forming: false, tableId: null, formedAt: null, pool: [] },
    integrity: { ok: true, expectedTotal: 0, actualTotal: 0, checkedAt: null, offendingTables: [] },
    bustSeq: 0,
    seq: { table: 0, move: 0, batch: 0, effect: 0 },
    milestonesFired: [],
    winnerId: null,
    featuredTableId: null,
  };
}
