import { ROLE_PERMISSIONS } from '@jpb/shared-types';
import type { AdminRole, AdminUserDto, Permission } from '@jpb/shared-types';
import type { IconName, Tone } from '@jpb/ui';

/**
 * Admin users model (§2.19): role and permission vocabulary, the password
 * and username policy the server enforces (http/routes/admin-users.ts,
 * auth/admin-auth.ts PASSWORD_POLICY), validation and small helpers.
 */

export const ROLES: readonly AdminRole[] = ['SUPER_ADMIN', 'TOURNAMENT_DIRECTOR', 'STAFF', 'VIEWER'];

export const ROLE_META: Readonly<Record<AdminRole, { label: string; tone: Tone; icon: IconName; description: string }>> = {
  SUPER_ADMIN: { label: 'Super admin', tone: 'gold', icon: 'crown', description: 'Everything, including admin users, stack adjustments and live hole cards.' },
  TOURNAMENT_DIRECTOR: { label: 'Tournament director', tone: 'info', icon: 'award', description: 'Runs tournaments end to end. No admin users, stack adjustments or live hole cards.' },
  STAFF: { label: 'Staff', tone: 'neutral', icon: 'user', description: 'Floor staff: approvals, announcements and pause after hand.' },
  VIEWER: { label: 'Viewer', tone: 'neutral', icon: 'eye', description: 'Read-only: tables, players, hands, fairness, payouts and metrics.' },
};

export type PermissionGroup = 'Tournament' | 'Clock & tables' | 'Players' | 'Hands & fairness' | 'Money' | 'Broadcast' | 'Administration';

export const PERMISSION_GROUPS: readonly PermissionGroup[] = ['Tournament', 'Clock & tables', 'Players', 'Hands & fairness', 'Money', 'Broadcast', 'Administration'];

export const PERMISSION_INFO: Readonly<Record<Permission, { group: PermissionGroup; label: string; sensitive?: boolean }>> = {
  TOURNAMENT_CREATE: { group: 'Tournament', label: 'Create, clone and delete draft tournaments' },
  TOURNAMENT_EDIT_CONFIG: { group: 'Tournament', label: 'Edit configuration (running-safe fields while live)' },
  TOURNAMENT_LIFECYCLE: { group: 'Tournament', label: 'Open / close registration and start' },
  TOURNAMENT_PAUSE: { group: 'Tournament', label: 'Pause after hand and resume' },
  TOURNAMENT_FREEZE: { group: 'Tournament', label: 'Emergency freeze', sensitive: true },
  TOURNAMENT_CANCEL: { group: 'Tournament', label: 'Cancel a tournament', sensitive: true },
  CLOCK_CONTROL: { group: 'Clock & tables', label: 'Advance / set level, add time, breaks' },
  TABLE_CONTROL: { group: 'Clock & tables', label: 'Hold, freeze, rebalance, break tables, force timeouts' },
  PLAYER_VIEW: { group: 'Players', label: 'See players, tables and standings' },
  PLAYER_VIEW_PII: { group: 'Players', label: 'See personal details (audited)', sensitive: true },
  PLAYER_MOVE: { group: 'Players', label: 'Move players between tables' },
  PLAYER_SUSPEND: { group: 'Players', label: 'Suspend / restore, sessions and rejoin codes' },
  PLAYER_DISQUALIFY: { group: 'Players', label: 'Disqualify players', sensitive: true },
  PLAYER_APPROVE_REGISTRATION: { group: 'Players', label: 'Approve registrations, register players' },
  STACK_ADJUST: { group: 'Players', label: 'Adjust a stack (extremely restricted)', sensitive: true },
  VIEW_HOLE_CARDS: { group: 'Hands & fairness', label: 'Reveal live hole cards (audited)', sensitive: true },
  HAND_HISTORY_VIEW: { group: 'Hands & fairness', label: 'Hand histories and replays' },
  FAIRNESS_VIEW: { group: 'Hands & fairness', label: 'Fairness records and verification' },
  FAIRNESS_REVEAL_SEED: { group: 'Hands & fairness', label: 'Reveal the server seed after the end', sensitive: true },
  PAYOUT_VIEW: { group: 'Money', label: 'See payouts' },
  PAYOUT_MANAGE: { group: 'Money', label: 'Change payment status' },
  ANNOUNCE: { group: 'Broadcast', label: 'Announcements, notices and the big screen' },
  AUDIT_VIEW: { group: 'Administration', label: 'Read the audit log' },
  ADMIN_USERS_MANAGE: { group: 'Administration', label: 'Manage admin users and sessions', sensitive: true },
  SIMULATION_RUN: { group: 'Administration', label: 'Run demos and simulations' },
  METRICS_VIEW: { group: 'Administration', label: 'System metrics and alerts' },
  ALERTS_MANAGE: { group: 'Administration', label: 'Acknowledge and resolve alerts' },
  EXPORT_DATA: { group: 'Administration', label: 'Exports and reports' },
};

export const ALL_PERMISSIONS = Object.keys(PERMISSION_INFO) as Permission[];

/** The server's matrix when present, else the shared one (identical by construction). */
export function rolePermissionsOf(fromServer: Partial<Record<AdminRole, Permission[]>> | undefined): Record<AdminRole, readonly Permission[]> {
  return Object.fromEntries(ROLES.map((r) => [r, fromServer?.[r] ?? ROLE_PERMISSIONS[r]])) as Record<AdminRole, readonly Permission[]>;
}

export function permissionDiff(matrix: Record<AdminRole, readonly Permission[]>, from: AdminRole, to: AdminRole): { gains: Permission[]; loses: Permission[] } {
  const a = new Set(matrix[from]);
  const b = new Set(matrix[to]);
  return { gains: [...b].filter((p) => !a.has(p)), loses: [...a].filter((p) => !b.has(p)) };
}

// ---------------------------------------------------------------- policy & validation

/** Mirrors PASSWORD_POLICY (auth/admin-auth.ts). */
export const PASSWORD_POLICY = { minLength: 12, maxLength: 256 } as const;
/** Mirrors the create-user schema (http/routes/admin-users.ts). */
export const USERNAME_RULE = { min: 3, max: 64, pattern: /^[a-zA-Z0-9._-]+$/ } as const;
export const DISPLAY_NAME_MAX = 80;

export function passwordProblem(pw: string, confirm: string): string | null {
  if (pw.length < PASSWORD_POLICY.minLength) return `Use at least ${PASSWORD_POLICY.minLength} characters (${pw.length} so far).`;
  if (pw.length > PASSWORD_POLICY.maxLength) return `Use at most ${PASSWORD_POLICY.maxLength} characters.`;
  if (pw !== confirm) return 'The two passwords do not match.';
  return null;
}

export function usernameProblem(u: string, taken: readonly string[]): string | null {
  const v = u.trim();
  if (v.length < USERNAME_RULE.min) return `Use at least ${USERNAME_RULE.min} characters.`;
  if (v.length > USERNAME_RULE.max) return `Use at most ${USERNAME_RULE.max} characters.`;
  if (!USERNAME_RULE.pattern.test(v)) return 'Use letters, digits, dot, dash or underscore only.';
  if (taken.some((t) => t.toLowerCase() === v.toLowerCase())) return 'That username is already in use.';
  return null;
}

export function displayNameProblem(n: string): string | null {
  const v = n.trim();
  if (!v) return 'Enter the name shown in the control room and the audit log.';
  if (v.length > DISPLAY_NAME_MAX) return `Use at most ${DISPLAY_NAME_MAX} characters.`;
  return null;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_!@#%+=';
export const GENERATED_LENGTH = 20;

/**
 * A strong random password from the browser CSPRNG (crypto.getRandomValues,
 * rejection sampling: no modulo bias). Ambiguous characters (0/O, 1/l/I) are
 * left out so it can be read out loud.
 */
export function generatePassword(length = GENERATED_LENGTH, rng: (buf: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  const limit = 256 - (256 % ALPHABET.length);
  let out = '';
  while (out.length < length) {
    for (const byte of rng(new Uint8Array(length * 2))) {
      if (byte < limit) out += ALPHABET[byte % ALPHABET.length];
      if (out.length === length) break;
    }
  }
  return out;
}

// ---------------------------------------------------------------- status & display

export type UserStatus = 'active' | 'disabled' | 'locked';

export function userStatus(u: AdminUserDto): UserStatus {
  if (u.disabled) return 'disabled';
  return u.locked ? 'locked' : 'active';
}

export const STATUS_META: Readonly<Record<UserStatus, { label: string; tone: Tone; icon: IconName; hint: string }>> = {
  active: { label: 'Active', tone: 'positive', icon: 'check-circle', hint: 'Can sign in' },
  locked: { label: 'Locked', tone: 'warning', icon: 'lock', hint: 'Too many failed sign-ins; unlocks automatically' },
  disabled: { label: 'Disabled', tone: 'danger', icon: 'ban', hint: 'Cannot sign in until re-enabled' },
};

export function scopeLabel(scope: string[] | null, names: (id: string) => string): string {
  if (scope === null) return 'All tournaments';
  if (scope.length === 0) return 'No tournaments';
  if (scope.length === 1) return names(scope[0]!);
  return `${scope.length} tournaments`;
}

export function sameScope(a: string[] | null, b: string[] | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && [...a].sort().join('\u0000') === [...b].sort().join('\u0000');
}

/** "Chrome · macOS" from a user agent (display only). */
export function deviceLabel(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /curl|node|undici/i.test(ua) ? 'Script' : 'Browser';
  const os = /iPad/.test(ua) ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} · ${os}` : browser;
}

export interface UserFilters {
  q: string;
  role: AdminRole | '';
  status: UserStatus | '';
}

export function filterUsers(users: readonly AdminUserDto[], f: UserFilters): AdminUserDto[] {
  const q = f.q.trim().toLowerCase();
  return users
    .filter((u) => (!f.role || u.role === f.role) && (!f.status || userStatus(u) === f.status) && (!q || u.username.toLowerCase().includes(q) || u.displayName.toLowerCase().includes(q)))
    .sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || a.displayName.localeCompare(b.displayName));
}
