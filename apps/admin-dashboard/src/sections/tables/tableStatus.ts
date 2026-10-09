import type { HoldReason, TableListItemDto, TableStatus } from '@jpb/shared-types';
import type { IconName, Tone } from '@jpb/ui';

/**
 * What an operator sees for a table (docs/ADMIN_CONTROL_ROOM.md §2.5). It is a
 * pure display projection of the server's row — never game state:
 *
 *   CLOSED   status CLOSED (broken / tournament finished)
 *   FROZEN   emergency table freeze (orthogonal to the status, shown first)
 *   STALLED  the server flagged no progress past its stall threshold
 *   BREAKING the director is emptying the table (see Contract notes)
 *   HELD     no new hand starts (reason(s) in `holds`)
 *   IN_HAND / BETWEEN_HANDS / WAITING  normal play
 */
export type TableDisplayStatus = 'IN_HAND' | 'BETWEEN_HANDS' | 'WAITING' | 'HELD' | 'BREAKING' | 'STALLED' | 'FROZEN' | 'CLOSED';

export interface StatusMeta {
  label: string;
  /** Short form for compact tiles. */
  short: string;
  tone: Tone;
  icon: IconName;
  description: string;
}

/** Normal play is neutral so the one STALLED table never hides in a green wall. */
export const DISPLAY_STATUS_META: Readonly<Record<TableDisplayStatus, StatusMeta>> = {
  IN_HAND: { label: 'Active', short: 'Active', tone: 'neutral', icon: 'play', description: 'A hand is being played' },
  BETWEEN_HANDS: { label: 'Between hands', short: 'Between', tone: 'neutral', icon: 'skip-forward', description: 'The next hand is about to be dealt' },
  WAITING: { label: 'Waiting', short: 'Waiting', tone: 'neutral', icon: 'moon', description: 'Fewer than two players, or the tournament has not started' },
  HELD: { label: 'Held', short: 'Held', tone: 'warning', icon: 'pause', description: 'No new hand starts until every hold is released' },
  BREAKING: { label: 'Breaking', short: 'Breaking', tone: 'info', icon: 'split', description: 'Players are being moved out; the table closes when empty' },
  STALLED: { label: 'Stalled', short: 'Stalled', tone: 'danger', icon: 'warning', description: 'No hand progress past the stall threshold' },
  FROZEN: { label: 'Frozen', short: 'Frozen', tone: 'info', icon: 'freeze', description: 'No action or timer is processed; remaining action time is preserved' },
  CLOSED: { label: 'Closed', short: 'Closed', tone: 'neutral', icon: 'lock', description: 'Broken or finished' },
};

/** Order of the summary bar and the legend. */
export const DISPLAY_STATUS_ORDER: readonly TableDisplayStatus[] = ['IN_HAND', 'BETWEEN_HANDS', 'WAITING', 'HELD', 'BREAKING', 'STALLED', 'FROZEN', 'CLOSED'];

export const HOLD_REASON_LABEL: Readonly<Record<HoldReason, string>> = {
  PAUSE: 'Tournament paused',
  BREAK: 'Break',
  HAND_FOR_HAND: 'Hand-for-hand',
  CONSOLIDATION: 'Consolidation',
  FINAL_TABLE: 'Final table forming',
  ADMIN: 'Admin hold',
  INTEGRITY: 'Integrity check',
};

/** Short hold reasons for compact pills ("HELD · ADMIN"). */
export const HOLD_REASON_SHORT: Readonly<Record<HoldReason, string>> = {
  PAUSE: 'Pause',
  BREAK: 'Break',
  HAND_FOR_HAND: 'H4H',
  CONSOLIDATION: 'Consol.',
  FINAL_TABLE: 'Final',
  ADMIN: 'Admin',
  INTEGRITY: 'Integrity',
};

/**
 * The row fields the status depends on. `breaking` is accepted when the server
 * sends it (not yet part of TableListItemDto — see the README Contract notes);
 * until then a CONSOLIDATION hold reads as BREAKING.
 */
export interface StatusInput {
  status: TableStatus | 'STALLED';
  frozen: boolean;
  holds: readonly HoldReason[];
  breaking?: boolean;
}

export function displayStatus(row: StatusInput): TableDisplayStatus {
  if (row.status === 'CLOSED') return 'CLOSED';
  if (row.frozen) return 'FROZEN';
  if (row.status === 'STALLED') return 'STALLED';
  if (row.breaking === true || row.holds.includes('CONSOLIDATION')) return 'BREAKING';
  if (row.status === 'HELD') return 'HELD';
  return row.status;
}

/** "Admin hold · Break" (empty when nothing holds the table). */
export function holdsText(holds: readonly HoldReason[]): string {
  return holds.map((h) => HOLD_REASON_LABEL[h] ?? h).join(' · ');
}

/** A hold is pending while a hand still finishes (status not yet HELD). */
export function holdPending(row: StatusInput): boolean {
  return row.holds.length > 0 && row.status !== 'HELD' && row.status !== 'CLOSED';
}

/** Full status sentence for labels and tooltips: "Held (Admin hold)", "Active — holds after this hand (Break)". */
export function statusText(row: StatusInput): string {
  const s = displayStatus(row);
  const meta = DISPLAY_STATUS_META[s];
  const holds = holdsText(row.holds);
  if (s === 'HELD' && holds) return `${meta.label} (${holds})`;
  if (s === 'FROZEN') return `${meta.label}${row.status === 'STALLED' ? ' (was stalled)' : ''}`;
  if (holdPending(row) && s !== 'BREAKING') return `${meta.label} — holds after this hand (${holds})`;
  return meta.label;
}

/** Compact pill text: "Held · Admin", "Stalled"… */
export function pillText(row: StatusInput): string {
  const s = displayStatus(row);
  const meta = DISPLAY_STATUS_META[s];
  if (s === 'HELD' && row.holds.length > 0) return `${meta.short} · ${row.holds.map((h) => HOLD_REASON_SHORT[h] ?? h).join('+')}`;
  return meta.short;
}

/** Forward-compatible read of the optional `breaking` flag. */
export function rowBreaking(row: TableListItemDto): boolean | undefined {
  const b = (row as TableListItemDto & { breaking?: unknown }).breaking;
  return typeof b === 'boolean' ? b : undefined;
}

export function rowStatusInput(row: TableListItemDto): StatusInput {
  return { status: row.status, frozen: row.frozen, holds: row.holds, breaking: rowBreaking(row) };
}
