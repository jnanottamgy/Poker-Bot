/**
 * Browser-side fairness verification for §2.11. Everything here runs the
 * PORTABLE `@jpb/fairness-engine` entry (pure TypeScript SHA-256 and
 * HMAC-SHA256 from `@jpb/randomness` — no `node:crypto`, no WebCrypto, no
 * call to the server for a verdict). The server only supplies the published
 * records; the verdict is recomputed here from the revealed seed.
 */
import { FAIRNESS_METHOD, commitmentFor, computePublicEntropy, dealPositions, isValidServerSeed, verifyHand } from '@jpb/fairness-engine';
import type { FairnessCheckId, FairnessCheckStatus, FairnessExport, FairnessOverallStatus, HandFairnessRecord, HandVerificationResult } from '@jpb/fairness-engine';
import { HmacDrbgSource, bytesToHex, hexToBytes, uniformInt } from '@jpb/randomness';
import type { BundleCheckId } from '@jpb/shared-types';

export { FAIRNESS_METHOD };

/** The four per-hand checks, in the engine's fixed order. */
export const CHECK_ORDER: readonly FairnessCheckId[] = ['SEED_COMMITMENT', 'DECK_HASH', 'HOLE_CARDS', 'BOARD'];

export const CHECK_LABEL: Readonly<Record<FairnessCheckId, string>> = {
  SEED_COMMITMENT: 'Seed commitment',
  DECK_HASH: 'Deck hash',
  HOLE_CARDS: 'Hole cards',
  BOARD: 'Board',
};

/** What each check proves, in one sentence (docs/FAIRNESS.md §6). */
export const CHECK_MEANING: Readonly<Record<FairnessCheckId, string>> = {
  SEED_COMMITMENT: 'SHA-256 of the revealed seed equals the hash published before registration opened.',
  DECK_HASH: 'The deck derived from the seed hashes to the deck hash recorded for this hand.',
  HOLE_CARDS: 'Every published hole card sits at its dealing position in the derived deck.',
  BOARD: 'The flop, turn, river and burn cards sit at their positions in the derived deck.',
};

export const BUNDLE_CHECK_LABEL: Readonly<Record<BundleCheckId, string>> = {
  FORMAT: 'Export format',
  SEED_COMMITMENT: 'Seed commitment',
  PUBLIC_ENTROPY: 'Public entropy',
  HAND_CONSISTENCY: 'Hand consistency',
};

export const STATUS_LABEL: Readonly<Record<FairnessCheckStatus | FairnessOverallStatus, string>> = {
  VERIFIED: 'VERIFIED',
  FAILED: 'FAILED',
  NOT_AVAILABLE: 'NOT AVAILABLE',
  INCOMPLETE: 'INCOMPLETE',
};

export interface TimedVerification {
  result: HandVerificationResult;
  /** Wall time of the in-browser computation (display only). */
  ms: number;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : 0);

/**
 * verifyHand(record, seed) with the portable engine. `seed` null = not
 * revealed yet (every check reports NOT_AVAILABLE). Never throws.
 */
export function verifyInBrowser(record: HandFairnessRecord, seed: string | null): TimedVerification {
  const t0 = now();
  const result = verifyHand(record, seed);
  return { result, ms: now() - t0 };
}

/** Reason a pasted seed cannot be used, or null. */
export function seedInputProblem(text: string): string | null {
  const t = text.trim();
  if (t === '') return null;
  return isValidServerSeed(t) ? null : 'A server seed is 64 hexadecimal characters (32 bytes).';
}

/** SHA-256 commitment of a seed computed here (null for an invalid seed). */
export function commitmentOf(seed: string): string | null {
  return isValidServerSeed(seed) ? commitmentFor(seed) : null;
}

/** Recomputes the public entropy from its inputs (null when the inputs are invalid). */
export function recomputeEntropy(clientSeeds: string[], adminEntropy: string | null): string | null {
  try {
    return computePublicEntropy({ clientSeeds, adminEntropy });
  } catch {
    return null;
  }
}

export type DeckRole = { kind: 'hole'; seat: number; card: 1 | 2 } | { kind: 'burn'; street: 'flop' | 'turn' | 'river' } | { kind: 'board'; name: 'Flop 1' | 'Flop 2' | 'Flop 3' | 'Turn' | 'River'; dealt: boolean } | { kind: 'unused' };

/**
 * Role of every deck position for a hand dealt to `seatsInDealingOrder`
 * (docs/FAIRNESS.md §4.7). `boardSize` marks which community positions were
 * actually dealt (0, 3, 4 or 5).
 */
export function deckRoles(seatsInDealingOrder: readonly number[], boardSize: number): DeckRole[] {
  const roles: DeckRole[] = Array.from({ length: 52 }, () => ({ kind: 'unused' }) as DeckRole);
  if (seatsInDealingOrder.length === 0) return roles;
  const pos = dealPositions(seatsInDealingOrder.length);
  pos.holeCards.forEach(([a, b], k) => {
    const seat = seatsInDealingOrder[k]!;
    roles[a] = { kind: 'hole', seat, card: 1 };
    roles[b] = { kind: 'hole', seat, card: 2 };
  });
  const burnStreets = ['flop', 'turn', 'river'] as const;
  const burnsDealt = boardSize >= 5 ? 3 : boardSize === 4 ? 2 : boardSize >= 3 ? 1 : 0;
  pos.burns.forEach((p, i) => {
    if (i < burnsDealt) roles[p] = { kind: 'burn', street: burnStreets[i]! };
  });
  const names = ['Flop 1', 'Flop 2', 'Flop 3', 'Turn', 'River'] as const;
  pos.board.forEach((p, i) => {
    roles[p] = { kind: 'board', name: names[i]!, dealt: i < boardSize };
  });
  return roles;
}

// ------------------------------------------------------------------ sampling

/** Domain-separation label of the reproducible sample draw (not a deck label). */
export const SAMPLE_LABEL_PREFIX = 'JPB/admin-sample';
const SAMPLE_SEED_BYTES = 16;

/** A fresh random sample id (browser CSPRNG); shown so the sample can be reproduced. */
export function newSampleSeed(): string {
  const bytes = new Uint8Array(SAMPLE_SEED_BYTES);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export function isSampleSeed(text: string): boolean {
  return /^[0-9a-f]{2,128}$/i.test(text) && text.length % 2 === 0;
}

/**
 * `n` distinct hand positions in [0, total), drawn with Floyd's algorithm
 * from the HMAC-SHA256 stream keyed by the sample id — so anyone with the
 * sample id gets exactly the same hands. Sorted ascending.
 */
export function sampleIndices(sampleSeedHex: string, tournamentId: string, total: number, n: number): number[] {
  const k = Math.max(0, Math.min(Math.floor(n), total));
  if (k === 0) return [];
  const src = new HmacDrbgSource(hexToBytes(sampleSeedHex), `${SAMPLE_LABEL_PREFIX}|${tournamentId}|${total}`);
  const chosen = new Set<number>();
  for (let j = total - k; j < total; j++) {
    const t = uniformInt(src, j + 1);
    chosen.add(chosen.has(t) ? j : t);
  }
  return [...chosen].sort((a, b) => a - b);
}

// ------------------------------------------------------------------ export

function compareHands(a: HandFairnessRecord, b: HandFairnessRecord): number {
  if (a.tableId !== b.tableId) return a.tableId < b.tableId ? -1 : 1;
  return a.handNumber - b.handNumber;
}

/**
 * Joins consecutive bundle pages into one export, exactly as the server
 * returned them (no field is recomputed or "fixed"); hands sorted by table,
 * then hand number, like the engine's own builder.
 */
export function mergeBundles(pages: readonly FairnessExport[]): FairnessExport | null {
  const first = pages[0];
  if (!first) return null;
  return { ...first, hands: pages.flatMap((p) => p.hands).sort(compareHands) };
}

/** Saves `data` as a pretty-printed JSON file. False when the browser cannot download. */
export function downloadJson(filename: string, data: unknown): boolean {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return true;
}

/** File-name-safe slug. */
export function fileSlug(text: string): string {
  return text.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'tournament';
}
