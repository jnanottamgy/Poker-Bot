import type { TournamentReportDto, TournamentStatus } from '@jpb/shared-types';
import { formatChips, formatCount, formatMoneyMinor, formatPercent } from '@jpb/ui';
import { formatDateTime, formatDuration } from '../../lib/time';
import { fileSlug, fileStamp } from './download';

/**
 * Display model of §2.18 Reports: the server's TournamentReportDto turned
 * into labelled figures. No figure is computed from game state here — only
 * re-expressed (durations, percentages, re-entries = entries − players).
 */

export interface Figure {
  key: string;
  label: string;
  value: string;
  /** Second line (context). */
  sub?: string;
  mono?: boolean;
}

const dash = '—';
const when = (ms: number | null) => (ms === null ? dash : formatDateTime(ms));
const dur = (ms: number | null) => (ms === null ? dash : formatDuration(ms));

/** Average hand duration reads better in seconds below two minutes ("94 s"). */
export function handDuration(ms: number | null): string {
  if (ms === null) return dash;
  return ms < 120_000 ? `${Math.round(ms / 1000)} s` : formatDuration(ms);
}

export function reEntries(r: Pick<TournamentReportDto, 'entries' | 'players'>): number {
  return Math.max(0, r.entries - r.players);
}

/** Final statuses: the report will not change any more. */
export function isFinal(status: TournamentStatus): boolean {
  return status === 'COMPLETED' || status === 'CANCELLED';
}

export function keyFigures(r: TournamentReportDto): Figure[] {
  const re = reEntries(r);
  const pool = r.prizeStructure.places.reduce((a, p) => a + p.amountMinor, 0);
  return [
    { key: 'players', label: 'Players', value: formatCount(r.players), sub: re > 0 ? `${formatCount(r.entries)} entries (${formatCount(re)} re-entries)` : `${formatCount(r.entries)} entries` },
    { key: 'tables', label: 'Tables used', value: formatCount(r.tablesUsed) },
    { key: 'duration', label: 'Duration', value: dur(r.durationMs), sub: r.completedAt === null && r.durationMs !== null ? 'so far' : undefined },
    { key: 'hands', label: 'Hands played', value: formatCount(r.handsPlayed) },
    { key: 'avgHand', label: 'Average hand', value: handDuration(r.averageHandDurationMs) },
    { key: 'finalTable', label: 'Final-table duration', value: dur(r.finalTableDurationMs) },
    { key: 'started', label: 'Started', value: when(r.startedAt) },
    { key: 'completed', label: r.status === 'CANCELLED' ? 'Cancelled' : 'Completed', value: when(r.completedAt) },
    {
      key: 'largestPot',
      label: 'Largest pot',
      value: r.largestPot ? `${formatChips(r.largestPot.amount)} chips` : dash,
      sub: r.largestPot ? `won by ${r.largestPot.winnerName}` : undefined,
    },
    { key: 'pool', label: 'Prize pool', value: formatMoneyMinor(pool, r.prizeStructure.currency), sub: `${formatCount(r.prizeStructure.places.length)} paid places` },
  ];
}

export function paidRatio(t: TournamentReportDto['payouts']): number {
  return t.awardedMinor > 0 ? t.paidMinor / t.awardedMinor : 0;
}

export function payoutFigures(r: TournamentReportDto): Figure[] {
  const c = r.prizeStructure.currency;
  const t = r.payouts;
  return [
    { key: 'configured', label: 'Configured', value: formatMoneyMinor(t.configuredMinor, c) },
    { key: 'awarded', label: 'Awarded', value: formatMoneyMinor(t.awardedMinor, c) },
    { key: 'paid', label: 'Paid', value: formatMoneyMinor(t.paidMinor, c), sub: t.awardedMinor > 0 ? `${formatPercent(paidRatio(t))} of awarded` : undefined },
    { key: 'outstanding', label: 'Outstanding', value: formatMoneyMinor(t.outstandingMinor, c) },
  ];
}

export function reportFilename(r: Pick<TournamentReportDto, 'name' | 'generatedAt'>, ext: 'json' | 'csv'): string {
  return `report-${fileSlug(r.name)}-${fileStamp(r.generatedAt)}.${ext}`;
}

/** Bands of the prize ladder printed in the report (the JSON export always has every place). */
export const MAX_PRINTED_BANDS = 120;

/** Rows of a long table shown on screen before "Show all" (print always shows every row). */
export const SCREEN_ROWS = 20;
