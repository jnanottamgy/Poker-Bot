import type { PrizePlace, TournamentPlayerStatus, TournamentStatus } from '@jpb/shared-types';
import type { IconName, Tone } from '@jpb/ui';
import { formatCount, formatOrdinal } from '@jpb/ui';

/**
 * Display model of §2.12 Standings. Everything here re-shapes server data
 * into labels; nothing decides anything about the game (finishing positions,
 * ties and prizes are the director's, read from the API).
 */

export type StandingsView = 'stack' | 'finish';

/** Rows per server page (the API caps `limit` at 500). */
export const STANDINGS_PAGE_SIZE = 100;

/** Explicit labels so a stack ranking is never read as a final result (same words as the API). */
export const VIEW_META: Readonly<Record<StandingsView, { label: string; short: string; icon: IconName; description: string }>> = {
  stack: {
    label: 'Current stack ranking',
    short: 'Stack ranking',
    icon: 'activity',
    description: 'Live chip counts of the players still in the tournament, largest first. This is NOT a result — positions change every hand.',
  },
  finish: {
    label: 'Finishing positions',
    short: 'Finishing positions',
    icon: 'award',
    description: 'Final places decided so far, in elimination order (best first). Players busted in the same hand with equal starting stacks share a place (tie) and split the prizes of the places they cover.',
  },
};

export function parseView(v: string | null): StandingsView {
  return v === 'finish' ? 'finish' : 'stack';
}

/** Statuses of players still holding chips (the stack ranking). */
const IN_PLAY: ReadonlySet<TournamentPlayerStatus> = new Set(['SEATED', 'IN_TRANSIT', 'SUSPENDED']);

export function isInPlay(status: TournamentPlayerStatus): boolean {
  return IN_PLAY.has(status);
}

export interface StatusMeta {
  label: string;
  tone: Tone;
  icon: IconName;
}

export const STANDING_STATUS_META: Readonly<Record<TournamentPlayerStatus, StatusMeta>> = {
  SEATED: { label: 'Seated', tone: 'positive', icon: 'user' },
  IN_TRANSIT: { label: 'In transit', tone: 'info', icon: 'move' },
  SUSPENDED: { label: 'Suspended', tone: 'warning', icon: 'pause' },
  ELIMINATED: { label: 'Eliminated', tone: 'neutral', icon: 'x-circle' },
  DISQUALIFIED: { label: 'Disqualified', tone: 'danger', icon: 'ban' },
  WITHDRAWN: { label: 'Withdrawn', tone: 'neutral', icon: 'log-out' },
  REGISTERED: { label: 'Registered', tone: 'info', icon: 'user' },
  PENDING_APPROVAL: { label: 'Pending', tone: 'warning', icon: 'clock' },
};

/** Statuses before any hand is dealt: standings do not exist yet. */
const NOT_STARTED: ReadonlySet<TournamentStatus> = new Set(['DRAFT', 'REGISTRATION', 'REGISTRATION_CLOSED']);

export function hasStarted(status: TournamentStatus | null): boolean {
  return status !== null && !NOT_STARTED.has(status);
}

/** Stack in big blinds, truncated to one decimal (never overstated, like StackDisplay). */
export function stackInBB(stack: number, bigBlind: number): number | null {
  if (!(bigBlind > 0) || !Number.isFinite(stack)) return null;
  return Math.floor((stack * 10) / bigBlind) / 10;
}

export function formatBB(stack: number, bigBlind: number | null): string {
  const bb = bigBlind === null ? null : stackInBB(stack, bigBlind);
  return bb === null ? '—' : `${bb.toLocaleString('en-US', { maximumFractionDigits: 1 })} BB`;
}

/** Share of all chips in play, 0..1 (null when the total is unknown). */
export function chipShare(stack: number, totalChips: number | null | undefined): number | null {
  if (!totalChips || totalChips <= 0) return null;
  return Math.max(0, Math.min(1, stack / totalChips));
}

/** "3rd" / "5th (tied ×2)" — ties always spelled out in text. */
export function placeText(position: number | null, tiedCount = 1): string {
  if (position === null) return '—';
  return tiedCount > 1 ? `${formatOrdinal(position)} (tied ×${tiedCount})` : formatOrdinal(position);
}

/** Positions a tie covers: 5th tied ×2 → "5th–6th". */
export function tieRangeText(position: number, tiedCount: number): string | null {
  if (tiedCount <= 1) return null;
  return `${formatOrdinal(position)}–${formatOrdinal(position + tiedCount - 1)}`;
}

// ---------------------------------------------------------------- money bubble

export type BubbleState =
  | { kind: 'not-started' }
  | { kind: 'no-prizes' }
  | { kind: 'before-money'; toGo: number; paidPlaces: number }
  | { kind: 'on-bubble'; paidPlaces: number }
  | { kind: 'in-money'; paidPlaces: number; remaining: number }
  | { kind: 'complete'; paidPlaces: number };

/**
 * Where the field stands relative to the paid places. `remaining` counts the
 * players still holding chips (positions 1..remaining are undecided).
 */
export function bubbleState(remaining: number | null, paidPlaces: number, status: TournamentStatus | null): BubbleState {
  if (paidPlaces <= 0) return { kind: 'no-prizes' };
  if (status === 'COMPLETED') return { kind: 'complete', paidPlaces };
  if (!hasStarted(status) || remaining === null) return { kind: 'not-started' };
  if (remaining > paidPlaces + 1) return { kind: 'before-money', toGo: remaining - paidPlaces, paidPlaces };
  if (remaining === paidPlaces + 1) return { kind: 'on-bubble', paidPlaces };
  return { kind: 'in-money', paidPlaces, remaining };
}

export function bubbleText(b: BubbleState): { title: string; detail: string; tone: Tone; icon: IconName } {
  switch (b.kind) {
    case 'not-started':
      return { title: 'Not started', detail: 'The money bubble is tracked once play begins.', tone: 'neutral', icon: 'clock' };
    case 'no-prizes':
      return { title: 'No prize places', detail: 'This tournament has no configured prizes.', tone: 'neutral', icon: 'info' };
    case 'before-money':
      return { title: `${formatCount(b.toGo)} to the money`, detail: `${formatCount(b.toGo)} more ${b.toGo === 1 ? 'elimination' : 'eliminations'} before the top ${formatCount(b.paidPlaces)} are paid.`, tone: 'info', icon: 'users' };
    case 'on-bubble':
      return { title: 'On the bubble', detail: `The next elimination finishes ${formatOrdinal(b.paidPlaces + 1)} — the last place without a prize.`, tone: 'warning', icon: 'flame' };
    case 'in-money':
      return { title: 'In the money', detail: `Every one of the ${formatCount(b.remaining)} remaining players has won at least the ${formatOrdinal(b.remaining)} place prize.`, tone: 'gold', icon: 'trophy' };
    case 'complete':
      return { title: 'Complete', detail: `All ${formatCount(b.paidPlaces)} prize places are decided.`, tone: 'gold', icon: 'trophy' };
  }
}

// ---------------------------------------------------------------- prize ladder

export interface LadderBand {
  /** First and last position of a run of equal prizes (inclusive). */
  from: number;
  to: number;
  amountMinor: number;
  label: string | null;
  /** Total of the band (amount × positions). */
  totalMinor: number;
}

/**
 * Consecutive places with the same prize collapse into one band ("11th–20th,
 * ₹1,000 each"), so even a ladder with 100,000 paid places stays readable.
 * Labelled places are never merged. Input order does not matter.
 */
export function ladderBands(places: readonly PrizePlace[]): LadderBand[] {
  const sorted = [...places].sort((a, b) => a.position - b.position);
  const bands: LadderBand[] = [];
  for (const p of sorted) {
    const prev = bands[bands.length - 1];
    const label = p.label ?? null;
    if (prev && label === null && prev.label === null && prev.amountMinor === p.amountMinor && prev.to + 1 === p.position) {
      prev.to = p.position;
      prev.totalMinor += p.amountMinor;
    } else {
      bands.push({ from: p.position, to: p.position, amountMinor: p.amountMinor, label, totalMinor: p.amountMinor });
    }
  }
  return bands;
}

export type BandState = 'decided' | 'partly' | 'in-play';

/** Positions above `remaining` are decided (those players have finished). */
export function bandState(band: Pick<LadderBand, 'from' | 'to'>, remaining: number | null, completed: boolean): BandState {
  if (completed) return 'decided';
  if (remaining === null) return 'in-play';
  if (band.from > remaining) return 'decided';
  if (band.to > remaining) return 'partly';
  return 'in-play';
}

export function bandPositions(b: Pick<LadderBand, 'from' | 'to'>): string {
  return b.from === b.to ? formatOrdinal(b.from) : `${formatOrdinal(b.from)}–${formatOrdinal(b.to)}`;
}

export function prizePoolMinor(places: readonly PrizePlace[]): number {
  return places.reduce((a, p) => a + p.amountMinor, 0);
}

/** Index of the band containing `position` (or the closest one below it). */
export function bandIndexOf(bands: readonly LadderBand[], position: number): number {
  let lo = 0;
  let hi = bands.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const b = bands[mid]!;
    if (position < b.from) hi = mid - 1;
    else if (position > b.to) lo = mid + 1;
    else return mid;
  }
  return Math.max(0, Math.min(bands.length - 1, lo));
}
