import type { Permission } from '@jpb/shared-types';
import type { IconName } from '@jpb/ui';

/**
 * Every screen of docs/ADMIN_CONTROL_ROOM.md §2, as data. The left
 * navigation, the routes (`routes.tsx`), the keyboard shortcuts and the
 * placeholders all derive from this list, so building a section never
 * requires editing the shell.
 */
export type SectionId =
  | 'tournaments'
  | 'setup'
  | 'overview'
  | 'clock'
  | 'tables'
  | 'table-detail'
  | 'players'
  | 'player-detail'
  | 'registration'
  | 'hands'
  | 'hand-detail'
  | 'fairness'
  | 'standings'
  | 'payouts'
  | 'broadcast'
  | 'alerts'
  | 'audit'
  | 'system'
  | 'reports'
  | 'users'
  | 'demo'
  | 'settings';

export interface SectionDef {
  id: SectionId;
  label: string;
  icon: IconName;
  /** Spec reference shown in placeholders and docs. */
  spec: string;
  /** 'tournament': lives under /t/:tournamentId/…; 'global': top-level. */
  scope: 'tournament' | 'global';
  /** Route path relative to its scope root (may contain params). */
  path: string;
  /** Left-navigation group; omitted = not in the navigation (detail screens). */
  group?: 'Event' | 'Play' | 'Integrity' | 'Admin';
  /** Nav item that stays highlighted for detail screens. */
  navParent?: SectionId;
  /** Without it the nav item is hidden (the server enforces it anyway). */
  permission?: Permission;
  /** Keyboard shortcut after `g` (e.g. 'o' → g o). */
  goKey?: string;
}

export const SECTIONS: readonly SectionDef[] = [
  { id: 'tournaments', label: 'Tournaments', icon: 'layers', spec: '§2.1', scope: 'global', path: 'tournaments', group: 'Event', goKey: 'l' },
  { id: 'overview', label: 'Overview', icon: 'activity', spec: '§2.3', scope: 'tournament', path: 'overview', group: 'Event', goKey: 'o' },
  { id: 'clock', label: 'Clock & Structure', icon: 'clock', spec: '§2.4', scope: 'tournament', path: 'clock', group: 'Event', goKey: 'c' },
  { id: 'tables', label: 'Tables', icon: 'grid', spec: '§2.5', scope: 'tournament', path: 'tables', group: 'Event', goKey: 't' },
  { id: 'players', label: 'Players', icon: 'users', spec: '§2.7', scope: 'tournament', path: 'players', group: 'Event', goKey: 'p' },
  { id: 'registration', label: 'Registration', icon: 'user', spec: '§2.9', scope: 'tournament', path: 'registration', group: 'Event', goKey: 'r' },
  { id: 'hands', label: 'Hands', icon: 'list', spec: '§2.10', scope: 'tournament', path: 'hands', group: 'Play', permission: 'HAND_HISTORY_VIEW', goKey: 'h' },
  { id: 'standings', label: 'Standings', icon: 'award', spec: '§2.12', scope: 'tournament', path: 'standings', group: 'Play', goKey: 's' },
  { id: 'payouts', label: 'Payouts', icon: 'trophy', spec: '§2.13', scope: 'tournament', path: 'payouts', group: 'Play', permission: 'PAYOUT_VIEW' },
  { id: 'broadcast', label: 'Broadcast & Announcements', icon: 'message', spec: '§2.14', scope: 'tournament', path: 'broadcast', group: 'Play', goKey: 'b' },
  { id: 'fairness', label: 'Fairness', icon: 'shield', spec: '§2.11', scope: 'tournament', path: 'fairness', group: 'Integrity', permission: 'FAIRNESS_VIEW', goKey: 'f' },
  { id: 'alerts', label: 'Alerts', icon: 'bell', spec: '§2.15', scope: 'tournament', path: 'alerts', group: 'Integrity', permission: 'METRICS_VIEW', goKey: 'a' },
  { id: 'audit', label: 'Audit Log', icon: 'file', spec: '§2.16', scope: 'tournament', path: 'audit', group: 'Integrity', permission: 'AUDIT_VIEW', goKey: 'u' },
  { id: 'system', label: 'System', icon: 'monitor', spec: '§2.17', scope: 'global', path: 'system', group: 'Integrity', permission: 'METRICS_VIEW', goKey: 'y' },
  { id: 'reports', label: 'Reports', icon: 'download', spec: '§2.18', scope: 'tournament', path: 'reports', group: 'Admin', permission: 'EXPORT_DATA' },
  { id: 'users', label: 'Admin Users', icon: 'key', spec: '§2.19', scope: 'global', path: 'users', group: 'Admin', permission: 'ADMIN_USERS_MANAGE' },
  { id: 'demo', label: 'Demo & Simulation', icon: 'zap', spec: '§2.20', scope: 'global', path: 'demo', group: 'Admin', permission: 'SIMULATION_RUN', goKey: 'd' },
  { id: 'settings', label: 'Settings', icon: 'sliders', spec: '§2.21', scope: 'tournament', path: 'settings', group: 'Admin' },
  // Screens reached from other screens (not in the navigation).
  { id: 'setup', label: 'Tournament setup', icon: 'sliders', spec: '§2.2', scope: 'tournament', path: 'setup', navParent: 'overview' },
  { id: 'table-detail', label: 'Table detail', icon: 'grid', spec: '§2.6', scope: 'tournament', path: 'tables/:tableId', navParent: 'tables' },
  { id: 'player-detail', label: 'Player detail', icon: 'user', spec: '§2.8', scope: 'tournament', path: 'players/:playerId', navParent: 'players' },
  { id: 'hand-detail', label: 'Hand detail', icon: 'list', spec: '§2.10', scope: 'tournament', path: 'hands/:handId', navParent: 'hands' },
];

export function sectionById(id: SectionId): SectionDef {
  return SECTIONS.find((s) => s.id === id)!;
}

/** Absolute in-app path (router basename excluded) for a section. */
export function sectionHref(id: SectionId, tournamentId: string | null, params: Record<string, string> = {}): string {
  const def = sectionById(id);
  const path = def.path.replace(/:([A-Za-z]+)/g, (_, k: string) => encodeURIComponent(params[k] ?? ''));
  if (def.scope === 'global') return `/${path}`;
  return tournamentId ? `/t/${encodeURIComponent(tournamentId)}/${path}` : '/tournaments';
}

/** Path for creating a new tournament with the setup wizard (no tournament yet). */
export const NEW_TOURNAMENT_PATH = '/tournaments/new';
