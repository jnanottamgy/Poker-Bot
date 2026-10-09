import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HandFairnessRecord, TournamentFairnessDto } from '@jpb/shared-types';
import { useApi } from '../../api/ApiProvider';
import type { AdminApi } from '../../api/client';
import { qk } from '../../api/query/keys';
import { useQuery } from '../../api/query/useQuery';
import type { UseQueryResult } from '../../api/query/useQuery';
import { usePermission } from '../../auth/permissions';
import { IDLE_BULK, runBulkVerification } from './bulk';
import type { BulkMode, BulkSource, BulkState } from './bulk';
import { verifyInBrowser } from './engine';
import type { TimedVerification } from './engine';

/** The tournament's commitment, entropy and seed status (FAIRNESS_VIEW). */
export function useTournamentFairness(tournamentId: string): UseQueryResult<TournamentFairnessDto> {
  const api = useApi();
  const can = usePermission('FAIRNESS_VIEW');
  return useQuery(qk.fairness(tournamentId), (s) => api.fairness.tournament(tournamentId, s), { enabled: can, staleMs: 30_000 });
}

/** Query key of one hand's fairness record (under the hand's own prefix). */
export const handFairnessKey = (handId: string) => [...qk.hand(handId), 'fairness'] as const;

export interface HandVerification {
  record: UseQueryResult<HandFairnessRecord>;
  fairness: UseQueryResult<TournamentFairnessDto>;
  /** Seed used: the operator's, else the revealed one, else null. */
  seed: string | null;
  /** provided: typed by the operator · revealed: from the server · none: still secret · missing: the operator chose to type one but has not (validly) yet. */
  seedSource: 'provided' | 'revealed' | 'none' | 'missing';
  /** Null until both the record and the tournament values are loaded. */
  verification: TimedVerification | null;
}

/**
 * Loads one hand's published fairness record and verifies it IN THE BROWSER
 * with the portable engine against the revealed seed (or a seed the
 * operator pasted). The server is never asked for a verdict.
 */
/**
 * `seedOverride`: undefined = use the revealed seed; a string = verify with
 * that seed instead; null = the operator wants to type a seed but has not
 * entered a valid one yet (nothing is verified with a seed).
 */
export function useHandVerification(tournamentId: string, handId: string | null, seedOverride?: string | null): HandVerification {
  const api = useApi();
  const can = usePermission('FAIRNESS_VIEW');
  const fairness = useTournamentFairness(tournamentId);
  const record = useQuery(handFairnessKey(handId ?? '-'), (s) => api.hands.fairness(handId!, s), { enabled: can && handId !== null, staleMs: 60_000 });
  const revealed = fairness.data?.serverSeed ?? null;
  const seed = seedOverride === undefined ? revealed : seedOverride;
  const seedSource = seedOverride === undefined ? (revealed !== null ? 'revealed' : 'none') : seedOverride === null ? 'missing' : 'provided';
  const ready = record.data !== undefined && fairness.data !== undefined;
  const verification = useMemo(() => (ready ? verifyInBrowser(record.data!, seed) : null), [ready, record.data, seed]);
  return { record, fairness, seed, seedSource, verification };
}

/** The admin API as the bulk runner's data source. */
export function bulkSourceFor(api: AdminApi, tournamentId: string): BulkSource {
  return {
    handsTotal: async (signal) => (await api.hands.list(tournamentId, { offset: 0, limit: 1 }, signal)).total,
    bundle: (from, to, signal) => api.fairness.bundle(tournamentId, { fromHand: from, toHand: to }, signal),
    handIdAt: async (position, signal) => (await api.hands.list(tournamentId, { offset: position, limit: 1 }, signal)).rows[0]?.handId ?? null,
    handRecord: (handId, signal) => api.hands.fairness(handId, signal),
  };
}

export interface BulkStart {
  mode: BulkMode;
  sampleSize: number;
  sampleSeed: string;
  seedOverride?: string;
}

export interface BulkVerify {
  state: BulkState;
  start: (opts: BulkStart) => void;
  cancel: () => void;
  reset: () => void;
  running: boolean;
}

/** Bulk verification state machine; aborts on unmount. */
export function useBulkVerify(tournamentId: string): BulkVerify {
  const api = useApi();
  const [state, setState] = useState<BulkState>(IDLE_BULK);
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => () => ctrl.current?.abort(), []);
  useEffect(() => {
    ctrl.current?.abort();
    setState(IDLE_BULK);
  }, [tournamentId]);

  const start = useCallback(
    (opts: BulkStart) => {
      ctrl.current?.abort();
      const c = new AbortController();
      ctrl.current = c;
      void runBulkVerification(bulkSourceFor(api, tournamentId), {
        tournamentId,
        ...opts,
        signal: c.signal,
        clock: () => Date.now(),
        onProgress: (s) => {
          if (ctrl.current === c) setState(s);
        },
      });
    },
    [api, tournamentId],
  );
  const cancel = useCallback(() => ctrl.current?.abort(), []);
  const reset = useCallback(() => {
    ctrl.current?.abort();
    ctrl.current = null;
    setState(IDLE_BULK);
  }, []);
  return { state, start, cancel, reset, running: state.phase === 'preparing' || state.phase === 'running' };
}
