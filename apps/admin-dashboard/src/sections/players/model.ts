import type { MoveReason, PaymentStatus, PlayerListItemDto, TournamentPlayerStatus, TournamentStatus } from '@jpb/shared-types';
import type { IconName, Tone } from '@jpb/ui';
import { formatChips, formatCount, formatOrdinal } from '@jpb/ui';
import type { PlayerSort, PlayersQuery } from '../../api/types';

/**
 * Display model shared by Players (§2.7), Player detail (§2.8) and
 * Registration (§2.9). Everything here re-shapes server data into labels;
 * nothing decides anything about the game.
 */

export interface Meta {
  label: string;
  /** Narrow-column variant of the label (lists). */
  short?: string;
  tone: Tone;
  icon: IconName;
  /** One line for tooltips / screen readers. */
  hint: string;
}

export const PLAYER_STATUS_META: Readonly<Record<TournamentPlayerStatus, Meta>> = {
  PENDING_APPROVAL: { label: 'Pending approval', short: 'Pending', tone: 'warning', icon: 'clock', hint: 'Registered, waiting for staff approval before it counts' },
  REGISTERED: { label: 'Registered', tone: 'info', icon: 'user', hint: 'Registered and approved; seated when the tournament starts' },
  SEATED: { label: 'Seated', tone: 'positive', icon: 'user', hint: 'Playing at a table' },
  IN_TRANSIT: { label: 'In transit', tone: 'info', icon: 'move', hint: 'Changing tables; seated at the destination after the current hand' },
  ELIMINATED: { label: 'Eliminated', tone: 'neutral', icon: 'x-circle', hint: 'Busted out with a finishing position' },
  SUSPENDED: { label: 'Suspended', tone: 'warning', icon: 'pause', hint: 'Sitting out: blinds are posted and every decision is auto-folded' },
  DISQUALIFIED: { label: 'Disqualified', tone: 'danger', icon: 'ban', hint: 'Removed by the tournament director; chips left play' },
  WITHDRAWN: { label: 'Withdrawn', tone: 'neutral', icon: 'log-out', hint: 'Registration withdrawn or rejected' },
};

/** Live connection filters the API accepts besides the stored statuses. */
export type LiveFilter = 'CONNECTED' | 'DISCONNECTED' | 'AWAY';
export type StatusFilter = TournamentPlayerStatus | LiveFilter | '';

export const LIVE_FILTER_META: Readonly<Record<LiveFilter, Meta>> = {
  CONNECTED: { label: 'Connected', tone: 'positive', icon: 'wifi', hint: 'Seated players with a live connection' },
  DISCONNECTED: { label: 'Disconnected', tone: 'danger', icon: 'wifi-off', hint: 'Seated players whose device is offline' },
  AWAY: { label: 'Away', tone: 'warning', icon: 'moon', hint: 'Seated players who timed out several hands in a row' },
};

/** Status filter options in the order operators reach for them. */
export const STATUS_FILTERS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: '', label: 'All players' },
  { value: 'SEATED', label: 'Seated' },
  { value: 'IN_TRANSIT', label: 'In transit' },
  { value: 'CONNECTED', label: 'Connected (live)' },
  { value: 'DISCONNECTED', label: 'Disconnected (live)' },
  { value: 'AWAY', label: 'Away — timing out (live)' },
  { value: 'SUSPENDED', label: 'Suspended' },
  { value: 'PENDING_APPROVAL', label: 'Pending approval' },
  { value: 'REGISTERED', label: 'Registered (not seated yet)' },
  { value: 'ELIMINATED', label: 'Eliminated' },
  { value: 'DISQUALIFIED', label: 'Disqualified' },
  { value: 'WITHDRAWN', label: 'Withdrawn / rejected' },
];

const STATUS_VALUES = new Set<string>(STATUS_FILTERS.map((s) => s.value));

export function isStatusFilter(v: string): v is StatusFilter {
  return STATUS_VALUES.has(v);
}

/** The server sorts in one fixed direction per key (API.md: sort=stack|finish|name|registration). */
export const SORT_META: Readonly<Record<PlayerSort, { label: string; dir: 'ascending' | 'descending' }>> = {
  stack: { label: 'Stack (largest first)', dir: 'descending' },
  finish: { label: 'Finishing position', dir: 'ascending' },
  name: { label: 'Name (A–Z)', dir: 'ascending' },
  registration: { label: 'Registration order', dir: 'ascending' },
};

export const SORTS = Object.keys(SORT_META) as PlayerSort[];

export function isSort(v: string): v is PlayerSort {
  return (SORTS as string[]).includes(v);
}

/** Statuses whose stack is in play (the server ranks these by stack). */
export const ACTIVE_STATUSES: ReadonlySet<TournamentPlayerStatus> = new Set(['SEATED', 'IN_TRANSIT', 'SUSPENDED']);

const STARTED: ReadonlySet<TournamentStatus> = new Set(['STARTING', 'RUNNING', 'BREAK', 'PAUSED', 'FINAL_TABLE', 'COMPLETED', 'CANCELLED']);

export function hasStarted(status: TournamentStatus | null): boolean {
  return status !== null && STARTED.has(status);
}

/** Default sort mirrors the server default: stack once play started, registration order before. */
export function defaultSort(status: TournamentStatus | null): PlayerSort {
  return hasStarted(status) ? 'stack' : 'registration';
}

// ---------------------------------------------------------------- numbers

/** Stack in big blinds, truncated to one decimal (never overstated, like StackDisplay); null without blinds. */
export function stackInBB(stack: number, bigBlind: number | null | undefined): number | null {
  return bigBlind && bigBlind > 0 ? Math.floor((stack / bigBlind) * 10) / 10 : null;
}

export function formatBB(stack: number, bigBlind: number | null | undefined): string {
  const bb = stackInBB(stack, bigBlind);
  return bb === null ? '—' : `${bb.toLocaleString('en-US', { maximumFractionDigits: 1 })} BB`;
}

/** "T12 · seat 4" (seats are 0-based on the wire, 1-based for people). */
export function seatText(tableNumber: number | null, seat: number | null): string {
  if (tableNumber === null) return '—';
  return seat === null ? `Table ${tableNumber}` : `Table ${tableNumber} · seat ${seat + 1}`;
}

/** "3rd" or "3rd (tied ×2)". */
export function finishText(position: number | null, tiedCount = 1): string {
  if (position === null) return '—';
  return tiedCount > 1 ? `${formatOrdinal(position)} (tied ×${formatCount(tiedCount)})` : formatOrdinal(position);
}

export function signedChips(n: number): string {
  return n > 0 ? `+${formatChips(n)}` : n < 0 ? `−${formatChips(-n)}` : '0';
}

// ---------------------------------------------------------------- connection

export interface ConnectionView extends Meta {
  key: 'online' | 'offline' | 'away' | 'none';
}

/** Connection of a player: always icon + text (never colour alone). */
export function connectionOf(p: Pick<PlayerListItemDto, 'connected' | 'consecutiveTimeouts' | 'status'>, awayAfterTimeouts: number | null): ConnectionView {
  if (p.connected === null || !ACTIVE_STATUSES.has(p.status)) return { key: 'none', label: '—', tone: 'neutral', icon: 'dot', hint: 'Not at a table' };
  if (!p.connected) return { key: 'offline', label: 'Offline', tone: 'danger', icon: 'wifi-off', hint: 'The player’s device is disconnected; their actions time out' };
  if (awayAfterTimeouts !== null && p.consecutiveTimeouts >= awayAfterTimeouts) {
    return { key: 'away', label: 'Away', tone: 'warning', icon: 'moon', hint: `Timed out ${p.consecutiveTimeouts} hands in a row: shorter action timer` };
  }
  return { key: 'online', label: 'Online', tone: 'positive', icon: 'wifi', hint: 'Connected' };
}

// ---------------------------------------------------------------- moves, payments

export const MOVE_REASON_LABEL: Readonly<Record<MoveReason, string>> = {
  BALANCE: 'Balancing',
  TABLE_BREAK: 'Table broken',
  FINAL_TABLE: 'Final table',
  ADMIN: 'Moved by an admin',
  INITIAL_SEATING: 'Initial seating',
  LATE_REGISTRATION: 'Late registration',
};

export const PAYMENT_META: Readonly<Record<PaymentStatus, Meta>> = {
  UNPAID: { label: 'Unpaid', tone: 'warning', icon: 'clock', hint: 'Prize not paid yet' },
  PROCESSING: { label: 'Processing', tone: 'info', icon: 'refresh', hint: 'Payment in progress' },
  PAID: { label: 'Paid', tone: 'positive', icon: 'check-circle', hint: 'Prize paid' },
};

/** Labels for the movement score breakdown keys (balancing-engine formula). */
export const SCORE_LABEL: Readonly<Record<string, string>> = {
  position: 'Position',
  blindFairness: 'Blind fairness',
  recentMove: 'Recent move',
  seatCompatibility: 'Seat compatibility',
  total: 'Total',
};

// ---------------------------------------------------------------- query

/** The list query the server receives (status '' = all). */
export function playersQuery(q: string, status: StatusFilter, tableId: string | null, sort: PlayerSort): PlayersQuery {
  return {
    ...(q.trim() ? { q: q.trim() } : {}),
    ...(status ? { status } : {}),
    ...(tableId ? { tableId } : {}),
    sort,
  };
}

/** Very small UA summary for the sessions table ("iPhone · Safari"); the full string stays in the title. */
export function shortUserAgent(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const device = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Macintosh|Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${device} · ${browser}`;
}
