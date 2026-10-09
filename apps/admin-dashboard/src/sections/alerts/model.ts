import type { AlertCode, AlertDto, AlertSeverity } from '@jpb/shared-types';
import type { IconName, Tone } from '@jpb/ui';

/**
 * Alerts screen model (§2.15): every alert code with a human title, an
 * explanation and the recommended first steps, plus the pure filter / sort
 * logic the screen and its tests share.
 */

export interface AlertCodeInfo {
  title: string;
  description: string;
  /** What the floor should do first, in order. */
  steps: string[];
}

export const ALERT_CODES: Readonly<Record<AlertCode, AlertCodeInfo>> = {
  TABLE_STALLED: {
    title: 'Table stalled',
    description: 'A table made no progress (no deal, action or timer) for longer than the stall threshold.',
    steps: ['Open the table and look at the acting seat and its internals', 'Force a timeout of the current actor if a player is stuck', 'Hold and release the table; break it if it does not recover'],
  },
  CHIP_CONSERVATION_FAILED: {
    title: 'Chip conservation failed',
    description: 'Chips on all tables plus chips in transit no longer add up to the expected total.',
    steps: ['Freeze the affected tables (or the tournament) before more hands are dealt', 'Run a full integrity check from System', 'Compare stacks with the hand history; adjust a stack only with evidence'],
  },
  INVARIANT_VIOLATION: {
    title: 'Invariant violation',
    description: 'A table or tournament state check failed (for example a negative stack or a duplicate seat).',
    steps: ['Freeze the table so nothing else changes', 'Open its internals and raw event log', 'Escalate to engineering with the table id and event sequence'],
  },
  PLAYER_CANNOT_ACT: {
    title: 'Player cannot act',
    description: 'A player keeps timing out or has no working connection; the table slows down for everyone.',
    steps: ['Check the player’s connection and sessions', 'Issue a new rejoin code if they changed device', 'Suspend (sit out) the player if they left the venue'],
  },
  WS_FAILURE_SPIKE: {
    title: 'WebSocket failures spiking',
    description: 'Many clients are disconnecting or failing to receive live updates at the same time.',
    steps: ['Check venue Wi-Fi / network and the System connection counts', 'Consider pausing after the current hands until clients reconnect'],
  },
  DB_ERROR_SPIKE: {
    title: 'Database errors spiking',
    description: 'Writes or reads to the database are failing more than usual. Commands are retried; play may slow down.',
    steps: ['Check database health and latency in System', 'Pause after the current hands if errors keep rising'],
  },
  TOURNAMENT_STALLED: {
    title: 'Tournament stalled',
    description: 'The tournament has not advanced for a long time (for example paused or held for many minutes).',
    steps: ['Check whether a pause, break or hold is still intended', 'Resume, or announce the delay to the players'],
  },
  ACTION_LATENCY_HIGH: {
    title: 'Action latency high',
    description: 'Processing player actions takes longer than the target (p99 above threshold).',
    steps: ['Check node load and DB latency in System', 'Reduce load (pause after hand) if players are timing out'],
  },
  TABLE_CRASHED: {
    title: 'Table crashed',
    description: 'A table process faulted. It is rebuilt from its command log; the hand in progress is replayed exactly.',
    steps: ['Open the table and confirm it is processing again', 'Run an integrity check once it recovers'],
  },
  WORKER_LOST: {
    title: 'Worker lost',
    description: 'A server node stopped heartbeating. Its tables and directors are re-leased to the remaining nodes.',
    steps: ['Check the node list in System', 'Watch for stalled tables while leases move'],
  },
};

export const ALERT_CODE_LIST = Object.keys(ALERT_CODES) as AlertCode[];

export function codeInfo(code: string): AlertCodeInfo {
  return (ALERT_CODES as Record<string, AlertCodeInfo | undefined>)[code] ?? { title: code.replace(/_/g, ' ').toLowerCase(), description: 'An alert raised by the server.', steps: [] };
}

export const SEVERITIES: readonly AlertSeverity[] = ['CRITICAL', 'WARNING', 'INFO'];

export const SEVERITY_META: Readonly<Record<AlertSeverity, { label: string; icon: IconName; tone: Tone; rank: number }>> = {
  CRITICAL: { label: 'Critical', icon: 'critical', tone: 'danger', rank: 0 },
  WARNING: { label: 'Warning', icon: 'warning', tone: 'warning', rank: 1 },
  INFO: { label: 'Info', icon: 'info', tone: 'info', rank: 2 },
};

/** The three lists of the screen. An acknowledged alert stays open until resolved. */
export type AlertTab = 'open' | 'acknowledged' | 'resolved';

export const TAB_META: Readonly<Record<AlertTab, { label: string; icon: IconName; empty: string }>> = {
  open: { label: 'Open', icon: 'bell', empty: 'No open alerts — all clear.' },
  acknowledged: { label: 'Acknowledged', icon: 'eye', empty: 'Nothing acknowledged and still open.' },
  resolved: { label: 'Resolved', icon: 'check-circle', empty: 'No resolved alerts in the loaded history.' },
};

export function alertTab(a: AlertDto): AlertTab {
  if (a.resolvedAt !== null) return 'resolved';
  return a.acknowledgedAt !== null ? 'acknowledged' : 'open';
}

export type AlertSort = 'severity' | 'newest' | 'oldest';

export const SORT_LABELS: Readonly<Record<AlertSort, string>> = {
  severity: 'Most severe first',
  newest: 'Newest first',
  oldest: 'Oldest first',
};

export function sortAlerts(list: readonly AlertDto[], sort: AlertSort): AlertDto[] {
  const out = [...list];
  if (sort === 'newest') return out.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
  if (sort === 'oldest') return out.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  // Most severe first; within a severity the longest-waiting alert first.
  return out.sort((a, b) => SEVERITY_META[a.severity].rank - SEVERITY_META[b.severity].rank || a.at - b.at || a.id.localeCompare(b.id));
}

export interface AlertFilters {
  tab: AlertTab;
  severity: AlertSeverity | '';
  code: AlertCode | '';
  q: string;
  sort: AlertSort;
  /** 'tournament' = this tournament only; 'all' = every tournament plus system-wide alerts. */
  scope: 'tournament' | 'all';
}

export const DEFAULT_FILTERS: AlertFilters = { tab: 'open', severity: '', code: '', q: '', sort: 'severity', scope: 'tournament' };

const isTab = (v: string): v is AlertTab => v === 'open' || v === 'acknowledged' || v === 'resolved';
const isSeverity = (v: string): v is AlertSeverity => (SEVERITIES as readonly string[]).includes(v);
const isCode = (v: string): v is AlertCode => (ALERT_CODE_LIST as readonly string[]).includes(v);
const isSort = (v: string): v is AlertSort => v === 'severity' || v === 'newest' || v === 'oldest';

export const MAX_SEARCH = 80;

export function parseFilters(p: URLSearchParams): AlertFilters {
  const tab = p.get('tab') ?? '';
  const sev = p.get('severity') ?? '';
  const code = p.get('code') ?? '';
  const sort = p.get('sort') ?? '';
  return {
    tab: isTab(tab) ? tab : DEFAULT_FILTERS.tab,
    severity: isSeverity(sev) ? sev : '',
    code: isCode(code) ? code : '',
    q: (p.get('q') ?? '').slice(0, MAX_SEARCH),
    sort: isSort(sort) ? sort : DEFAULT_FILTERS.sort,
    scope: p.get('scope') === 'all' ? 'all' : 'tournament',
  };
}

export function writeFilters(prev: URLSearchParams, f: AlertFilters): URLSearchParams {
  const next = new URLSearchParams(prev);
  const set = (k: string, v: string, def: string) => (v && v !== def ? next.set(k, v) : next.delete(k));
  set('tab', f.tab, DEFAULT_FILTERS.tab);
  set('severity', f.severity, '');
  set('code', f.code, '');
  set('q', f.q, '');
  set('sort', f.sort, DEFAULT_FILTERS.sort);
  set('scope', f.scope, 'tournament');
  return next;
}

function matchesText(a: AlertDto, q: string): boolean {
  if (!q) return true;
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [a.message, a.code, codeInfo(a.code).title, a.target ?? '', a.id].some((s) => s.toLowerCase().includes(needle));
}

/** Alerts of one tab matching severity / code / text (counts per tab ignore the tab itself). */
export function filterAlerts(list: readonly AlertDto[], f: AlertFilters): AlertDto[] {
  return sortAlerts(
    list.filter((a) => alertTab(a) === f.tab && (!f.severity || a.severity === f.severity) && (!f.code || a.code === f.code) && matchesText(a, f.q)),
    f.sort,
  );
}

export interface AlertCounts {
  tabs: Record<AlertTab, number>;
  /** Within the current tab (other filters ignored). */
  severity: Record<AlertSeverity, number>;
}

export function countAlerts(list: readonly AlertDto[], tab: AlertTab): AlertCounts {
  const tabs: Record<AlertTab, number> = { open: 0, acknowledged: 0, resolved: 0 };
  const severity: Record<AlertSeverity, number> = { CRITICAL: 0, WARNING: 0, INFO: 0 };
  for (const a of list) {
    const t = alertTab(a);
    tabs[t] += 1;
    if (t === tab) severity[a.severity] += 1;
  }
  return { tabs, severity };
}

/** Merge open alerts (complete) with the recent history (may overlap); newest copy wins. */
export function mergeAlerts(open: readonly AlertDto[], history: readonly AlertDto[]): AlertDto[] {
  const byId = new Map<string, AlertDto>();
  for (const a of history) byId.set(a.id, a);
  for (const a of open) {
    const prev = byId.get(a.id);
    // A resolved copy in the history is newer than an "open" copy fetched earlier.
    if (!prev || prev.resolvedAt === null) byId.set(a.id, a);
  }
  return [...byId.values()];
}
