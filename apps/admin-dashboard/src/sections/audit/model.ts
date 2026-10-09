import type { AuditEntryDto } from '@jpb/shared-types';
import type { IconName } from '@jpb/ui';
import type { AuditQuery } from '../../api/types';

/**
 * Audit log model (§2.16): human names for every action the server (and the
 * mock) writes, URL filters, the date-range rule and the export rows.
 */

export type ActionGroup = 'Tournament' | 'Clock' | 'Tables' | 'Players' | 'Money & fairness' | 'Broadcast' | 'Alerts' | 'Admin & security' | 'Demo';

export interface ActionInfo {
  label: string;
  group: ActionGroup;
  /** Danger level 2 actions are highlighted in the log. */
  danger?: boolean;
}

export const AUDIT_ACTIONS: Readonly<Record<string, ActionInfo>> = {
  TOURNAMENT_CREATED: { label: 'Tournament created', group: 'Tournament' },
  TOURNAMENT_CLONED: { label: 'Tournament cloned', group: 'Tournament' },
  TOURNAMENT_DELETED: { label: 'Draft deleted', group: 'Tournament' },
  CONFIG_UPDATED: { label: 'Configuration saved', group: 'Tournament' },
  CONFIG_EDITED_RUNNING: { label: 'Running configuration edited', group: 'Tournament', danger: true },
  SCHEDULE_EDITED: { label: 'Blind schedule edited', group: 'Tournament', danger: true },
  TIMING_EDITED: { label: 'Timers edited', group: 'Tournament', danger: true },
  POLICIES_EDITED: { label: 'Spectator & feature settings edited', group: 'Tournament', danger: true },
  REGISTRATION_OPENED: { label: 'Registration opened', group: 'Tournament' },
  REGISTRATION_CLOSED: { label: 'Registration closed', group: 'Tournament' },
  REGISTRATION_REOPENED: { label: 'Registration reopened', group: 'Tournament' },
  TOURNAMENT_STARTED: { label: 'Tournament started', group: 'Tournament' },
  TOURNAMENT_PAUSED: { label: 'Paused after hand', group: 'Tournament' },
  TOURNAMENT_RESUMED: { label: 'Tournament resumed', group: 'Tournament' },
  EMERGENCY_FREEZE: { label: 'Emergency freeze', group: 'Tournament', danger: true },
  EMERGENCY_UNFREEZE: { label: 'Emergency freeze lifted', group: 'Tournament', danger: true },
  CANCEL_TOURNAMENT: { label: 'Tournament cancelled', group: 'Tournament', danger: true },
  CLOCK_ADVANCE: { label: 'Level advanced', group: 'Clock' },
  SET_BLIND_LEVEL: { label: 'Blind level set', group: 'Clock', danger: true },
  CLOCK_ADD_TIME: { label: 'Clock time changed', group: 'Clock' },
  BREAK_STARTED: { label: 'Break started', group: 'Clock' },
  BREAK_ENDED: { label: 'Break ended', group: 'Clock' },
  HAND_FOR_HAND: { label: 'Hand-for-hand changed', group: 'Clock' },
  TABLE_HOLD: { label: 'Table held', group: 'Tables' },
  TABLE_RELEASE: { label: 'Table released', group: 'Tables' },
  TABLE_FREEZE: { label: 'Table frozen', group: 'Tables' },
  TABLE_UNFREEZE: { label: 'Table unfrozen', group: 'Tables' },
  FORCE_TIMEOUT: { label: 'Timeout forced', group: 'Tables' },
  TABLE_ADD_TIME: { label: 'Action time added', group: 'Tables' },
  BREAK_TABLE: { label: 'Table broken', group: 'Tables', danger: true },
  REVEAL_HOLE_CARDS: { label: 'Live hole cards revealed', group: 'Tables', danger: true },
  REBALANCE: { label: 'Rebalance requested', group: 'Tables' },
  INTEGRITY_CHECK: { label: 'Integrity check run', group: 'Tables' },
  PLAYER_MOVED: { label: 'Player moved', group: 'Players' },
  PLAYER_SUSPENDED: { label: 'Player suspended', group: 'Players' },
  RESTORE_PLAYER: { label: 'Player restored', group: 'Players', danger: true },
  DISQUALIFY_PLAYER: { label: 'Player disqualified', group: 'Players', danger: true },
  ADJUST_STACK: { label: 'Stack adjusted', group: 'Players', danger: true },
  REVOKE_SESSIONS: { label: 'Player sessions revoked', group: 'Players', danger: true },
  NEW_REJOIN_CODE: { label: 'New rejoin code issued', group: 'Players' },
  PRIVATE_NOTICE: { label: 'Private notice sent', group: 'Players' },
  PLAYER_APPROVED: { label: 'Registration approved', group: 'Players' },
  PLAYER_REJECTED: { label: 'Registration rejected', group: 'Players' },
  MANUAL_REGISTRATION: { label: 'Registered by staff', group: 'Players' },
  PLAYER_REENTERED: { label: 'Player re-entered', group: 'Players' },
  VIEW_PII: { label: 'Personal details viewed', group: 'Players' },
  REVEAL_SEED: { label: 'Server seed revealed', group: 'Money & fairness', danger: true },
  PAYMENT_UPDATED: { label: 'Payment status updated', group: 'Money & fairness' },
  ANNOUNCE: { label: 'Announcement sent', group: 'Broadcast' },
  DISPLAY_SCENE: { label: 'Big screen changed', group: 'Broadcast' },
  ALERT_ACKNOWLEDGED: { label: 'Alert acknowledged', group: 'Alerts' },
  ALERT_RESOLVED: { label: 'Alert resolved', group: 'Alerts' },
  ADMIN_LOGIN: { label: 'Admin signed in', group: 'Admin & security' },
  ADMIN_LOGIN_FAILED: { label: 'Failed sign-in', group: 'Admin & security' },
  ADMIN_BOOTSTRAPPED: { label: 'First admin created', group: 'Admin & security' },
  ADMIN_USER_CREATED: { label: 'Admin user created', group: 'Admin & security' },
  ADMIN_USER_UPDATED: { label: 'Admin user changed', group: 'Admin & security', danger: true },
  ADMIN_PASSWORD_RESET: { label: 'Admin password reset', group: 'Admin & security', danger: true },
  ADMIN_SESSION_REVOKED: { label: 'Admin session revoked', group: 'Admin & security' },
  DEMO_STARTED: { label: 'Demo started', group: 'Demo' },
  DEMO_STOPPED: { label: 'Demo stopped', group: 'Demo' },
};

export const ACTION_GROUPS: readonly ActionGroup[] = ['Tournament', 'Clock', 'Tables', 'Players', 'Money & fairness', 'Broadcast', 'Alerts', 'Admin & security', 'Demo'];

export const GROUP_ICON: Readonly<Record<ActionGroup, IconName>> = {
  Tournament: 'layers',
  Clock: 'clock',
  Tables: 'grid',
  Players: 'users',
  'Money & fairness': 'shield',
  Broadcast: 'message',
  Alerts: 'bell',
  'Admin & security': 'key',
  Demo: 'zap',
};

export function actionInfo(action: string): ActionInfo {
  return AUDIT_ACTIONS[action] ?? { label: action.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()), group: 'Tournament' };
}

// ---------------------------------------------------------------- filters

export interface AuditFilters {
  adminId: string;
  action: string;
  /** Substring of the target (server: case-insensitive "contains"). */
  target: string;
  /** Local datetime strings from <input type="datetime-local"> ('' = open). */
  from: string;
  to: string;
  /** 'tournament' = this tournament; 'all' = the whole log (admin users, logins…). */
  scope: 'tournament' | 'all';
}

export const EMPTY_FILTERS: AuditFilters = { adminId: '', action: '', target: '', from: '', to: '', scope: 'tournament' };

/** Server limits (admin-audit-alerts.ts). */
export const MAX_ID_LENGTH = 80;
export const MAX_TARGET_LENGTH = 120;
const LOCAL_DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

export function parseFilters(p: URLSearchParams): AuditFilters {
  const dt = (k: string) => {
    const v = p.get(k) ?? '';
    return LOCAL_DT.test(v) ? v : '';
  };
  return {
    adminId: (p.get('admin') ?? '').slice(0, MAX_ID_LENGTH),
    action: (p.get('action') ?? '').replace(/[^A-Z_]/g, '').slice(0, MAX_ID_LENGTH),
    target: (p.get('target') ?? '').slice(0, MAX_TARGET_LENGTH),
    from: dt('from'),
    to: dt('to'),
    scope: p.get('scope') === 'all' ? 'all' : 'tournament',
  };
}

export function writeFilters(prev: URLSearchParams, f: AuditFilters): URLSearchParams {
  const next = new URLSearchParams(prev);
  const set = (k: string, v: string) => (v ? next.set(k, v) : next.delete(k));
  set('admin', f.adminId);
  set('action', f.action);
  set('target', f.target);
  set('from', f.from);
  set('to', f.to);
  set('scope', f.scope === 'all' ? 'all' : '');
  return next;
}

export function activeFilterCount(f: AuditFilters): number {
  return [f.adminId, f.action, f.target, f.from, f.to].filter(Boolean).length;
}

/** The server query for these filters (date range excluded: the API has none — see README contract notes). */
export function serverQuery(f: AuditFilters, tournamentId: string): AuditQuery {
  return {
    ...(f.scope === 'all' ? {} : { tournamentId }),
    ...(f.adminId ? { adminId: f.adminId } : {}),
    ...(f.action ? { action: f.action } : {}),
    ...(f.target.trim() ? { target: f.target.trim() } : {}),
  };
}

/** Epoch ms of a datetime-local value in the browser's zone (null = open end). */
export function localToEpoch(v: string): number | null {
  if (!v) return null;
  const ms = new Date(v).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export interface DateRange {
  from: number | null;
  /** Inclusive end; a minute-precision value includes that whole minute. */
  to: number | null;
}

const MINUTE = 60_000;

export function dateRange(f: Pick<AuditFilters, 'from' | 'to'>): DateRange {
  const to = localToEpoch(f.to);
  return { from: localToEpoch(f.from), to: to === null ? null : f.to.length === 16 ? to + MINUTE - 1 : to };
}

export function inRange(e: Pick<AuditEntryDto, 'at'>, r: DateRange): boolean {
  return (r.from === null || e.at >= r.from) && (r.to === null || e.at <= r.to);
}

/**
 * Entries arrive newest first (seq DESC). Once an entry is older than the
 * range start, every later page is older too: scanning can stop.
 */
export function pastRange(e: Pick<AuditEntryDto, 'at'>, r: DateRange): boolean {
  return r.from !== null && e.at < r.from;
}

// ---------------------------------------------------------------- export

export const CSV_HEADER = ['seq', 'at', 'tournament', 'admin_id', 'admin', 'action', 'target', 'reason', 'before', 'after', 'ip', 'prev_hash', 'hash'] as const;

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v);
  // Neutralise spreadsheet formulas (CSV injection) and quote when needed.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Same columns as the server's audit.csv, so both exports read identically. */
export function auditCsv(entries: readonly AuditEntryDto[]): string {
  const rows = entries.map((e) => [e.seq, new Date(e.at).toISOString(), e.tournamentId, e.adminId, e.adminUsername, e.action, e.target, e.reason, e.beforeState, e.afterState, e.ip, e.prevHash, e.hash]);
  return `${[CSV_HEADER as readonly unknown[], ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/** Short hash for tables ("3f9a…c21b"). */
export function shortHash(h: string): string {
  return h.length > 14 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h;
}
