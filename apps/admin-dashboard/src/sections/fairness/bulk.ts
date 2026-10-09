/**
 * Bulk verification (§2.11): every hand, or a reproducible random sample,
 * verified IN THE BROWSER with the portable fairness engine. Records are
 * fetched page by page; verification runs in short time slices so the page
 * stays responsive with millions of hands; progress is reported as it goes
 * and the run can be cancelled at any point.
 */
import { verifyBundle, verifyHand } from '@jpb/fairness-engine';
import type { BundleCheckResult, FairnessExport, FairnessOverallStatus, HandFairnessRecord } from '@jpb/shared-types';
import { formatCount } from '@jpb/ui';
import { friendlyError } from '../../api/errors';
import { CHECK_LABEL, sampleIndices } from './engine';

/** The bundle endpoint returns at most this many hands per request. */
export const BUNDLE_PAGE = 500;
/** Parallel requests in sample mode. */
export const SAMPLE_CONCURRENCY = 6;
/** Longest stretch of verification before yielding to the browser (ms). */
export const SLICE_MS = 12;
/** Problem hands kept in memory for display (the count of the rest is kept). */
export const MAX_ISSUES = 500;
/** Consistency problems listed (the count of the rest is kept). */
export const MAX_PROBLEMS = 50;

export type BulkMode = 'sample' | 'all';
export type BulkPhase = 'idle' | 'preparing' | 'running' | 'done' | 'cancelled' | 'error';

/** Data access needed by a run (the admin API in the app, fakes in tests). */
export interface BulkSource {
  handsTotal(signal: AbortSignal): Promise<number>;
  /** Hands at positions [from, to] (inclusive) in completion order. */
  bundle(from: number, to: number, signal: AbortSignal): Promise<FairnessExport>;
  /** Id of the hand at a list position (newest first). */
  handIdAt(position: number, signal: AbortSignal): Promise<string | null>;
  handRecord(handId: string, signal: AbortSignal): Promise<HandFairnessRecord>;
}

export interface BulkIssue {
  handId: string | null;
  tableId: string | null;
  handNumber: number | null;
  status: FairnessOverallStatus;
  /** First non-verified check (or the consistency problem), in plain words. */
  reason: string;
}

export interface BulkState {
  phase: BulkPhase;
  mode: BulkMode;
  /** Hands this run will verify (fixed when it starts). */
  target: number;
  done: number;
  verified: number;
  failed: number;
  incomplete: number;
  /** FORMAT, SEED_COMMITMENT, PUBLIC_ENTROPY, HAND_CONSISTENCY (empty until prepared). */
  tournamentChecks: BundleCheckResult[];
  issues: BulkIssue[];
  issuesTotal: number;
  /** Overall verdict once finished. */
  status: FairnessOverallStatus | null;
  sampleSeed: string | null;
  /** True when verifying with a seed typed by the operator instead of the revealed one. */
  seedProvided: boolean;
  seedAvailable: boolean;
  startedAt: number;
  finishedAt: number;
  /** Friendly error text (phase 'error'). */
  error: string | null;
}

export const IDLE_BULK: BulkState = {
  phase: 'idle',
  mode: 'sample',
  target: 0,
  done: 0,
  verified: 0,
  failed: 0,
  incomplete: 0,
  tournamentChecks: [],
  issues: [],
  issuesTotal: 0,
  status: null,
  sampleSeed: null,
  seedProvided: false,
  seedAvailable: false,
  startedAt: 0,
  finishedAt: 0,
  error: null,
};

export interface BulkOptions {
  tournamentId: string;
  mode: BulkMode;
  sampleSize: number;
  sampleSeed: string;
  /** Seed typed by the operator; undefined = use the revealed seed from the export. */
  seedOverride?: string;
  signal: AbortSignal;
  onProgress: (s: BulkState) => void;
  /** Wall clock for display (ms). */
  clock: () => number;
  /** Yields to the browser between slices (default: a macrotask). */
  yieldFn?: () => Promise<void>;
}

class Cancelled extends Error {}

const defaultYield = () => new Promise<void>((r) => setTimeout(r, 0));
const perfNow = (): number => (typeof performance !== 'undefined' ? performance.now() : 0);

function issueOf(record: HandFairnessRecord, status: FairnessOverallStatus, reason: string): BulkIssue {
  return { handId: record.handId ?? null, tableId: record.tableId ?? null, handNumber: typeof record.handNumber === 'number' ? record.handNumber : null, status, reason };
}

function overall(checks: readonly BundleCheckResult[], s: Pick<BulkState, 'failed' | 'verified' | 'done'>): FairnessOverallStatus {
  if (checks.some((c) => c.status === 'FAILED') || s.failed > 0) return 'FAILED';
  return checks.every((c) => c.status === 'VERIFIED') && s.verified === s.done ? 'VERIFIED' : 'INCOMPLETE';
}

/** Runs one bulk verification. Resolves with the final state (also on cancel / error). */
export async function runBulkVerification(source: BulkSource, o: BulkOptions): Promise<BulkState> {
  const yieldFn = o.yieldFn ?? defaultYield;
  let state: BulkState = { ...IDLE_BULK, phase: 'preparing', mode: o.mode, sampleSeed: o.mode === 'sample' ? o.sampleSeed : null, seedProvided: o.seedOverride !== undefined, startedAt: o.clock() };
  const emit = (patch: Partial<BulkState>) => {
    state = { ...state, ...patch };
    o.onProgress(state);
  };
  const check = () => {
    if (o.signal.aborted) throw new Cancelled();
  };
  emit({});

  try {
    const total = await source.handsTotal(o.signal);
    check();
    if (total === 0) {
      emit({ phase: 'done', target: 0, status: 'INCOMPLETE', finishedAt: o.clock(), tournamentChecks: [] });
      return state;
    }
    const first = await source.bundle(0, o.mode === 'all' ? Math.min(BUNDLE_PAGE, total) - 1 : 0, o.signal);
    check();
    const seed = o.seedOverride !== undefined ? o.seedOverride : first.serverSeed;
    // Tournament-level checks once (format, commitment, public entropy recomputed from its inputs).
    const head = verifyBundle({ ...first, hands: [] }, { serverSeed: seed });
    const tournamentChecks = head.checks
      .filter((c) => c.check !== 'HAND_CONSISTENCY')
      .map((c) => (c.check === 'FORMAT' && c.status === 'VERIFIED' ? { ...c, detail: `The export has the expected ${first.format} v${first.formatVersion} structure.` } : c));
    const target = o.mode === 'all' ? total : Math.min(o.sampleSize, total);
    emit({ phase: 'running', target, tournamentChecks, seedAvailable: seed !== null });
    if (tournamentChecks[0]?.status === 'FAILED') {
      emit({ phase: 'done', status: 'FAILED', finishedAt: o.clock(), tournamentChecks: [...tournamentChecks, { check: 'HAND_CONSISTENCY', status: 'NOT_AVAILABLE', detail: 'Not checked: the export is malformed.', problems: [] }] });
      return state;
    }

    const problems: string[] = [];
    let problemCount = 0;
    const keys = new Set<string>();
    const ids = new Set<string>();
    const counts = { done: 0, verified: 0, failed: 0, incomplete: 0 };
    const issues: BulkIssue[] = [];
    let issuesTotal = 0;
    const addIssue = (i: BulkIssue) => {
      issuesTotal += 1;
      if (issues.length < MAX_ISSUES) issues.push(i);
    };
    const problem = (p: string) => {
      problemCount += 1;
      if (problems.length < MAX_PROBLEMS) problems.push(p);
    };
    const publish = () => emit({ ...counts, issues: issues.slice(), issuesTotal });

    let sliceStart = perfNow();
    const verifyRecords = async (records: readonly HandFairnessRecord[]) => {
      for (const r of records) {
        if (perfNow() - sliceStart > SLICE_MS) {
          publish();
          await yieldFn();
          check();
          sliceStart = perfNow();
        }
        const where = `hand ${r.handId}`;
        let inconsistent: string | null = null;
        if (r.tournamentId !== first.tournamentId) inconsistent = `${where}: belongs to another tournament`;
        else if (String(r.serverSeedHash).toLowerCase() !== first.serverSeedHash.toLowerCase()) inconsistent = `${where}: carries a different seed commitment`;
        else if (r.publicEntropy !== first.publicEntropy) inconsistent = `${where}: carries a different public entropy`;
        const key = JSON.stringify([r.tableId, r.handNumber]);
        if (inconsistent === null && keys.has(key)) inconsistent = `${where}: duplicate hand number ${r.handNumber} at the same table`;
        if (inconsistent === null && ids.has(r.handId)) inconsistent = `${where}: listed twice`;
        keys.add(key);
        ids.add(r.handId);
        if (inconsistent) problem(inconsistent);

        const result = verifyHand(r, seed);
        counts.done += 1;
        if (result.status === 'VERIFIED') counts.verified += 1;
        else if (result.status === 'FAILED') counts.failed += 1;
        else counts.incomplete += 1;
        if (result.status !== 'VERIFIED') {
          const c = result.checks.find((x) => x.status === 'FAILED') ?? result.checks.find((x) => x.status !== 'VERIFIED');
          addIssue(issueOf(r, result.status, c ? `${CHECK_LABEL[c.check]}: ${c.detail}` : 'Not verified.'));
        } else if (inconsistent) {
          addIssue(issueOf(r, 'FAILED', inconsistent));
        }
      }
    };

    if (o.mode === 'all') {
      let page: FairnessExport = first;
      for (let from = 0; from < total; from += BUNDLE_PAGE) {
        const nextFrom = from + BUNDLE_PAGE;
        // Prefetch the next page while this one is verified.
        const next = nextFrom < total ? source.bundle(nextFrom, Math.min(nextFrom + BUNDLE_PAGE, total) - 1, o.signal) : null;
        next?.catch(() => undefined);
        if (page.tournamentId !== first.tournamentId || page.serverSeedHash !== first.serverSeedHash || page.publicEntropy !== first.publicEntropy || page.serverSeed !== first.serverSeed) {
          problem(`hands ${from + 1}–${from + page.hands.length}: the export page carries different tournament values`);
        }
        await verifyRecords(page.hands);
        check();
        if (!next) break;
        page = await next;
        check();
      }
    } else {
      const positions = sampleIndices(o.sampleSeed, o.tournamentId, total, target);
      for (let i = 0; i < positions.length; i += SAMPLE_CONCURRENCY) {
        const batch = positions.slice(i, i + SAMPLE_CONCURRENCY);
        const records = await Promise.all(
          batch.map(async (pos) => {
            const id = await source.handIdAt(pos, o.signal);
            return id === null ? null : source.handRecord(id, o.signal);
          }),
        );
        check();
        await verifyRecords(records.filter((r): r is HandFairnessRecord => r !== null));
      }
    }

    const consistency: BundleCheckResult =
      problemCount > 0
        ? { check: 'HAND_CONSISTENCY', status: 'FAILED', detail: `${formatCount(problemCount)} inconsistency(ies) between hands and the tournament.`, problems: problemCount > problems.length ? [...problems, `… and ${problemCount - problems.length} more`] : problems }
        : { check: 'HAND_CONSISTENCY', status: 'VERIFIED', detail: `All ${formatCount(counts.done)} hand(s) carry this tournament's id, commitment and public entropy; no duplicates.`, problems: [] };
    const allChecks = [...tournamentChecks, consistency];
    publish();
    emit({ phase: 'done', tournamentChecks: allChecks, status: overall(allChecks, counts), finishedAt: o.clock() });
    return state;
  } catch (err) {
    if (err instanceof Cancelled || o.signal.aborted) {
      emit({ phase: 'cancelled', finishedAt: o.clock() });
      return state;
    }
    const f = friendlyError(err);
    emit({ phase: 'error', error: `${f.title}. The hand records could not be loaded, so nothing past this point was verified. ${f.description}`, finishedAt: o.clock() });
    return state;
  }
}
