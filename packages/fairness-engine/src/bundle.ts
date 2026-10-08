/**
 * Tournament-level verification bundle (JSON export) and its verifier.
 */
import { FAIRNESS_SCHEME } from '@jpb/shared-types';
import type {
  BundleCheckId,
  BundleCheckResult,
  BundleVerificationResult,
  FairnessCheckStatus,
  FairnessExport,
  FairnessMethodDescription,
  FairnessOverallStatus,
  HandFairnessRecord,
  HandVerificationResult,
  PublicEntropyInputs,
  TournamentId,
} from '@jpb/shared-types';
import { commitmentFor, seedMatchesCommitment } from './commitment';
import { computePublicEntropy } from './entropy';
import { recordShapeProblems } from './record';
import { verifyHand } from './verify';
import type { VerifyOptions } from './verify';
import { digestProblem, publicEntropyProblem, serverSeedProblem } from './validate';

export const FAIRNESS_EXPORT_FORMAT = 'JPB-FAIRNESS-EXPORT';
export const FAIRNESS_EXPORT_VERSION = 1;
/** At most this many problems are listed per bundle check (the count of the rest is appended). */
export const MAX_LISTED_PROBLEMS = 50;

/** Fixed statement of every construction, embedded in each export (see docs/FAIRNESS.md). */
export const FAIRNESS_METHOD: FairnessMethodDescription = Object.freeze({
  commitment:
    'serverSeedHash = hex(SHA-256(serverSeedBytes)); serverSeed = 32 CSPRNG bytes, hex encoded; hex output is lowercase',
  publicEntropy:
    'publicEntropy = hex(SHA-256(UTF-8("JPB/v1/entropy|" + sort(clientSeeds).join(",") + "|" + (adminEntropy ?? ""))))',
  deckLabel: 'JPB/v1/deck|{tournamentId}|{tableId}|{handNumber}|{publicEntropy}',
  drawLabel: 'JPB/v1/{purpose}|{tournamentId}|{publicEntropy}',
  stream:
    'block(i) = HMAC-SHA256(key = serverSeedBytes, message = UTF-8(label + "|" + decimal(i))), i = 0,1,2,...; stream = block(0)||block(1)||...; nextUint32 = next 4 stream bytes, big-endian',
  uniformInt: 'uniformInt(n): limit = floor(2^32 / n) * n; repeat u = nextUint32() until u < limit; return u mod n',
  shuffle:
    'Durstenfeld Fisher-Yates on a copy of the canonical deck: for i = 51 down to 1: j = uniformInt(i + 1); swap(deck[i], deck[j])',
  canonicalDeck:
    'index i (0..51) => "23456789TJQKA"[i mod 13] + "cdhs"[floor(i / 13)], i.e. 2c..Ac, 2d..Ad, 2h..Ah, 2s..As',
  deckHash: 'deckHash = hex(SHA-256(ASCII(deck.join("")))), deck[0] = top card',
  dealing:
    'N dealt-in seats ordered clockwise from the first seat after the button; seat k gets deck[k] and deck[N+k]; burn deck[2N], flop deck[2N+1..2N+3], burn deck[2N+4], turn deck[2N+5], burn deck[2N+6], river deck[2N+7]',
});

export interface BuildBundleInput {
  tournamentId: TournamentId;
  serverSeedHash: string;
  /** The revealed seed, or null while it is still secret. */
  serverSeed: string | null;
  publicEntropy: string;
  entropyInputs: PublicEntropyInputs | null;
  hands: readonly HandFairnessRecord[];
}

function cloneRecord(r: HandFairnessRecord): HandFairnessRecord {
  return {
    scheme: r.scheme,
    tournamentId: r.tournamentId,
    tableId: r.tableId,
    handId: r.handId,
    handNumber: r.handNumber,
    publicEntropy: r.publicEntropy,
    serverSeedHash: r.serverSeedHash,
    deckHash: r.deckHash,
    maxSeats: r.maxSeats,
    buttonSeat: r.buttonSeat,
    holeCards: r.holeCards.map((h) => ({
      seat: h.seat,
      playerId: h.playerId,
      cards: h.cards === null ? null : [h.cards[0], h.cards[1]],
    })),
    board: r.board.slice(),
    burns: r.burns === null ? null : r.burns.slice(),
  };
}

function compareHands(a: HandFairnessRecord, b: HandFairnessRecord): number {
  if (a.tableId !== b.tableId) return a.tableId < b.tableId ? -1 : 1;
  return a.handNumber - b.handNumber;
}

/** Problems that make a set of hand records inconsistent with the tournament-level values. */
function handConsistencyProblems(
  tournament: { tournamentId: string; serverSeedHash: string; publicEntropy: string },
  hands: readonly HandFairnessRecord[],
): string[] {
  const problems: string[] = [];
  const keys = new Set<string>();
  const handIds = new Set<string>();
  hands.forEach((h, i) => {
    const where = `hands[${i}] (${h.handId})`;
    if (h.tournamentId !== tournament.tournamentId)
      problems.push(`${where}: tournamentId "${h.tournamentId}" differs from the bundle's`);
    if (h.serverSeedHash.toLowerCase() !== tournament.serverSeedHash.toLowerCase())
      problems.push(`${where}: serverSeedHash differs from the bundle's commitment`);
    if (h.publicEntropy !== tournament.publicEntropy)
      problems.push(`${where}: publicEntropy differs from the bundle's`);
    const key = JSON.stringify([h.tableId, h.handNumber]);
    if (keys.has(key)) problems.push(`${where}: duplicate hand number ${h.handNumber} at table ${h.tableId}`);
    keys.add(key);
    if (handIds.has(h.handId)) problems.push(`${where}: duplicate handId`);
    handIds.add(h.handId);
  });
  return problems;
}

/**
 * Builds the JSON export for independent verification. Throws (programmer
 * error) when the inputs are inconsistent: a revealed seed that does not
 * match the commitment, entropy inputs that do not hash to `publicEntropy`,
 * or hands from another tournament / commitment / entropy, or duplicates.
 * Hands are deep-copied and sorted by tableId, then handNumber.
 */
export function buildVerificationBundle(input: BuildBundleInput): FairnessExport {
  const fail = (msg: string): never => {
    throw new RangeError(`buildVerificationBundle: ${msg}`);
  };
  if (
    digestProblem('serverSeedHash', input.serverSeedHash) !== null ||
    input.serverSeedHash !== input.serverSeedHash.toLowerCase()
  ) {
    fail('serverSeedHash must be 64 lowercase hexadecimal characters');
  }
  const p = publicEntropyProblem(input.publicEntropy);
  if (p !== null) fail(p);
  if (input.serverSeed !== null) {
    if (serverSeedProblem(input.serverSeed) !== null) fail('serverSeed must be 64 hexadecimal characters');
    if (commitmentFor(input.serverSeed) !== input.serverSeedHash) fail('serverSeed does not match serverSeedHash');
  }
  if (input.entropyInputs !== null && computePublicEntropy(input.entropyInputs) !== input.publicEntropy) {
    fail('entropyInputs do not hash to publicEntropy');
  }
  input.hands.forEach((h, i) => {
    const shape = recordShapeProblems(h);
    if (shape.length > 0) fail(`hands[${i}]: ${shape[0]}`);
  });
  const problems = handConsistencyProblems(input, input.hands);
  if (problems.length > 0) fail(problems[0] as string);
  return {
    format: FAIRNESS_EXPORT_FORMAT,
    formatVersion: FAIRNESS_EXPORT_VERSION,
    scheme: FAIRNESS_SCHEME,
    method: { ...FAIRNESS_METHOD },
    tournamentId: input.tournamentId,
    serverSeedHash: input.serverSeedHash,
    serverSeed: input.serverSeed === null ? null : input.serverSeed.toLowerCase(),
    publicEntropy: input.publicEntropy,
    entropyInputs:
      input.entropyInputs === null
        ? null
        : {
            clientSeeds: input.entropyInputs.clientSeeds.slice(),
            adminEntropy: input.entropyInputs.adminEntropy ?? null,
          },
    hands: input.hands.map(cloneRecord).sort(compareHands),
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Structural problems of an untrusted export. */
export function bundleShapeProblems(value: unknown): string[] {
  if (!isObject(value)) return ['the bundle must be a JSON object'];
  const problems: string[] = [];
  if (value.format !== FAIRNESS_EXPORT_FORMAT) problems.push(`format must be "${FAIRNESS_EXPORT_FORMAT}"`);
  if (value.formatVersion !== FAIRNESS_EXPORT_VERSION)
    problems.push(`formatVersion must be ${FAIRNESS_EXPORT_VERSION}`);
  if (value.scheme !== FAIRNESS_SCHEME) problems.push(`scheme must be "${FAIRNESS_SCHEME}"`);
  for (const key of ['tournamentId', 'serverSeedHash', 'publicEntropy'] as const) {
    if (typeof value[key] !== 'string') problems.push(`${key} must be a string`);
  }
  if (value.serverSeed !== null && typeof value.serverSeed !== 'string')
    problems.push('serverSeed must be a string or null');
  const inputs = value.entropyInputs;
  if (inputs !== null) {
    const ok =
      isObject(inputs) &&
      Array.isArray(inputs.clientSeeds) &&
      inputs.clientSeeds.every((s) => typeof s === 'string') &&
      (inputs.adminEntropy === null || typeof inputs.adminEntropy === 'string');
    if (!ok) problems.push('entropyInputs must be null or { clientSeeds: string[], adminEntropy: string | null }');
  }
  if (!Array.isArray(value.hands)) {
    problems.push('hands must be an array');
  } else {
    value.hands.forEach((h, i) => recordShapeProblems(h).forEach((p) => problems.push(`hands[${i}]: ${p}`)));
  }
  return problems;
}

function listed(problems: readonly string[]): string[] {
  if (problems.length <= MAX_LISTED_PROBLEMS) return problems.slice();
  return [...problems.slice(0, MAX_LISTED_PROBLEMS), `... and ${problems.length - MAX_LISTED_PROBLEMS} more`];
}

function bundleCheck(
  check: BundleCheckId,
  status: FairnessCheckStatus,
  detail: string,
  problems: readonly string[] = [],
): BundleCheckResult {
  return { check, status, detail, problems: listed(problems) };
}

export interface VerifyBundleOptions extends VerifyOptions {
  /** Seed to verify with instead of `bundle.serverSeed` (e.g. pasted by the user); null = treat as unrevealed. */
  serverSeed?: string | null;
}

function seedCheck(bundle: FairnessExport, seed: string | null): BundleCheckResult {
  if (seed === null)
    return bundleCheck('SEED_COMMITMENT', 'NOT_AVAILABLE', 'The server seed has not been revealed yet.');
  if (seedMatchesCommitment(seed, bundle.serverSeedHash)) {
    return bundleCheck(
      'SEED_COMMITMENT',
      'VERIFIED',
      'SHA-256 of the revealed seed bytes equals the published commitment.',
    );
  }
  return bundleCheck(
    'SEED_COMMITMENT',
    'FAILED',
    'The revealed seed is invalid or does not hash to the published commitment.',
  );
}

function entropyCheck(bundle: FairnessExport): BundleCheckResult {
  if (bundle.entropyInputs === null) {
    return bundleCheck(
      'PUBLIC_ENTROPY',
      'NOT_AVAILABLE',
      'The public entropy inputs are not included, so publicEntropy cannot be recomputed.',
    );
  }
  let recomputed: string;
  try {
    recomputed = computePublicEntropy(bundle.entropyInputs);
  } catch (e) {
    return bundleCheck('PUBLIC_ENTROPY', 'FAILED', 'The public entropy inputs are invalid.', [
      e instanceof Error ? e.message : String(e),
    ]);
  }
  if (recomputed === bundle.publicEntropy) {
    return bundleCheck(
      'PUBLIC_ENTROPY',
      'VERIFIED',
      `publicEntropy equals SHA-256 of the ${bundle.entropyInputs.clientSeeds.length} published client seed(s) and admin entropy.`,
    );
  }
  return bundleCheck('PUBLIC_ENTROPY', 'FAILED', 'publicEntropy does not equal the hash of the published inputs.', [
    `published ${bundle.publicEntropy}`,
    `derived ${recomputed}`,
  ]);
}

function overall(
  checks: readonly BundleCheckResult[],
  hands: readonly HandVerificationResult[],
): FairnessOverallStatus {
  if (checks.some((c) => c.status === 'FAILED') || hands.some((h) => h.status === 'FAILED')) return 'FAILED';
  return checks.every((c) => c.status === 'VERIFIED') && hands.every((h) => h.status === 'VERIFIED')
    ? 'VERIFIED'
    : 'INCOMPLETE';
}

/**
 * Verifies an untrusted export (e.g. a JSON file uploaded to the public
 * verify page). Never throws. Bundle-level checks, in order:
 *
 * - FORMAT: the JSON has the expected structure (otherwise nothing else runs).
 * - SEED_COMMITMENT: the revealed seed hashes to the tournament commitment.
 * - PUBLIC_ENTROPY: publicEntropy is the hash of the published inputs.
 * - HAND_CONSISTENCY: every hand carries the tournament's id, commitment and
 *   entropy, with no duplicate hands.
 *
 * Every hand is then verified with `verifyHand`.
 */
export function verifyBundle(bundle: unknown, opts: VerifyBundleOptions = {}): BundleVerificationResult {
  const shape = bundleShapeProblems(bundle);
  if (shape.length > 0) {
    const skipped = 'Not checked: the bundle is malformed.';
    const tournamentId = isObject(bundle) && typeof bundle.tournamentId === 'string' ? bundle.tournamentId : null;
    const checks = [
      bundleCheck('FORMAT', 'FAILED', 'The bundle is not a valid JPB fairness export.', shape),
      bundleCheck('SEED_COMMITMENT', 'NOT_AVAILABLE', skipped),
      bundleCheck('PUBLIC_ENTROPY', 'NOT_AVAILABLE', skipped),
      bundleCheck('HAND_CONSISTENCY', 'NOT_AVAILABLE', skipped),
    ];
    return {
      status: 'FAILED',
      tournamentId,
      checks,
      hands: [],
      counts: { hands: 0, verified: 0, failed: 0, incomplete: 0 },
    };
  }
  const b = bundle as FairnessExport;
  const seed = opts.serverSeed !== undefined ? opts.serverSeed : b.serverSeed;
  const consistency = handConsistencyProblems(b, b.hands);
  const checks = [
    bundleCheck(
      'FORMAT',
      'VERIFIED',
      `Valid ${FAIRNESS_EXPORT_FORMAT} v${FAIRNESS_EXPORT_VERSION} with ${b.hands.length} hand(s).`,
    ),
    seedCheck(b, seed),
    entropyCheck(b),
    b.hands.length === 0
      ? bundleCheck('HAND_CONSISTENCY', 'NOT_AVAILABLE', 'The bundle contains no hands.')
      : consistency.length > 0
        ? bundleCheck(
            'HAND_CONSISTENCY',
            'FAILED',
            `${consistency.length} inconsistency(ies) between hands and the tournament.`,
            consistency,
          )
        : bundleCheck(
            'HAND_CONSISTENCY',
            'VERIFIED',
            `All ${b.hands.length} hand(s) carry this tournament's id, commitment and public entropy; no duplicates.`,
          ),
  ];
  const hands = b.hands.map((h) => verifyHand(h, seed, opts));
  const count = (s: FairnessOverallStatus): number => hands.filter((h) => h.status === s).length;
  return {
    status: overall(checks, hands),
    tournamentId: b.tournamentId,
    checks,
    hands,
    counts: {
      hands: hands.length,
      verified: count('VERIFIED'),
      failed: count('FAILED'),
      incomplete: count('INCOMPLETE'),
    },
  };
}
