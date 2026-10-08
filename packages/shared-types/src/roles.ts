/** Roles (spec §71). Admin roles are separate accounts from players. */
export type Role = 'SUPER_ADMIN' | 'TOURNAMENT_DIRECTOR' | 'STAFF' | 'VIEWER' | 'PLAYER' | 'SPECTATOR';

export type AdminRole = Extract<Role, 'SUPER_ADMIN' | 'TOURNAMENT_DIRECTOR' | 'STAFF' | 'VIEWER'>;

/** Fine-grained permissions checked by every admin API (never by the UI alone). */
export type Permission =
  | 'TOURNAMENT_CREATE'
  | 'TOURNAMENT_EDIT_CONFIG'
  | 'TOURNAMENT_LIFECYCLE' // open/close registration, start
  | 'TOURNAMENT_PAUSE'
  | 'TOURNAMENT_FREEZE'
  | 'TOURNAMENT_CANCEL'
  | 'CLOCK_CONTROL' // advance/set level, add time, start/end break
  | 'TABLE_CONTROL' // rebalance, break table, hold/release, force timeout
  | 'PLAYER_VIEW'
  | 'PLAYER_VIEW_PII' // email/phone etc.
  | 'PLAYER_MOVE'
  | 'PLAYER_SUSPEND'
  | 'PLAYER_DISQUALIFY'
  | 'PLAYER_APPROVE_REGISTRATION'
  | 'STACK_ADJUST' // extremely restricted
  | 'VIEW_HOLE_CARDS' // live hole cards (integrity staff only)
  | 'HAND_HISTORY_VIEW'
  | 'FAIRNESS_VIEW'
  | 'FAIRNESS_REVEAL_SEED'
  | 'AUDIT_VIEW'
  | 'PAYOUT_VIEW'
  | 'PAYOUT_MANAGE'
  | 'ANNOUNCE'
  | 'ADMIN_USERS_MANAGE'
  | 'SIMULATION_RUN'
  | 'METRICS_VIEW'
  | 'ALERTS_MANAGE'
  | 'EXPORT_DATA';

export const ROLE_PERMISSIONS: Readonly<Record<AdminRole, readonly Permission[]>> = {
  SUPER_ADMIN: [
    'TOURNAMENT_CREATE',
    'TOURNAMENT_EDIT_CONFIG',
    'TOURNAMENT_LIFECYCLE',
    'TOURNAMENT_PAUSE',
    'TOURNAMENT_FREEZE',
    'TOURNAMENT_CANCEL',
    'CLOCK_CONTROL',
    'TABLE_CONTROL',
    'PLAYER_VIEW',
    'PLAYER_VIEW_PII',
    'PLAYER_MOVE',
    'PLAYER_SUSPEND',
    'PLAYER_DISQUALIFY',
    'PLAYER_APPROVE_REGISTRATION',
    'STACK_ADJUST',
    'VIEW_HOLE_CARDS',
    'HAND_HISTORY_VIEW',
    'FAIRNESS_VIEW',
    'FAIRNESS_REVEAL_SEED',
    'AUDIT_VIEW',
    'PAYOUT_VIEW',
    'PAYOUT_MANAGE',
    'ANNOUNCE',
    'ADMIN_USERS_MANAGE',
    'SIMULATION_RUN',
    'METRICS_VIEW',
    'ALERTS_MANAGE',
    'EXPORT_DATA',
  ],
  TOURNAMENT_DIRECTOR: [
    'TOURNAMENT_CREATE',
    'TOURNAMENT_EDIT_CONFIG',
    'TOURNAMENT_LIFECYCLE',
    'TOURNAMENT_PAUSE',
    'TOURNAMENT_FREEZE',
    'TOURNAMENT_CANCEL',
    'CLOCK_CONTROL',
    'TABLE_CONTROL',
    'PLAYER_VIEW',
    'PLAYER_VIEW_PII',
    'PLAYER_MOVE',
    'PLAYER_SUSPEND',
    'PLAYER_DISQUALIFY',
    'PLAYER_APPROVE_REGISTRATION',
    'HAND_HISTORY_VIEW',
    'FAIRNESS_VIEW',
    'FAIRNESS_REVEAL_SEED',
    'AUDIT_VIEW',
    'PAYOUT_VIEW',
    'PAYOUT_MANAGE',
    'ANNOUNCE',
    'SIMULATION_RUN',
    'METRICS_VIEW',
    'ALERTS_MANAGE',
    'EXPORT_DATA',
  ],
  STAFF: [
    'TOURNAMENT_PAUSE',
    'PLAYER_VIEW',
    'PLAYER_APPROVE_REGISTRATION',
    'HAND_HISTORY_VIEW',
    'FAIRNESS_VIEW',
    'PAYOUT_VIEW',
    'ANNOUNCE',
    'METRICS_VIEW',
  ],
  VIEWER: ['PLAYER_VIEW', 'HAND_HISTORY_VIEW', 'FAIRNESS_VIEW', 'METRICS_VIEW', 'PAYOUT_VIEW'],
};

export function roleHasPermission(role: AdminRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Operations that must be confirmed twice in the UI AND carry a non-empty reason server-side (spec §146). */
export const DANGEROUS_OPERATIONS = [
  'CANCEL_TOURNAMENT',
  'FORCE_ELIMINATE',
  'DISQUALIFY_PLAYER',
  'SET_BLIND_LEVEL',
  'RESTORE_PLAYER',
  'ADJUST_STACK',
  'EMERGENCY_FREEZE',
  'BREAK_TABLE',
  'REVEAL_SEED',
] as const;

export type DangerousOperation = (typeof DANGEROUS_OPERATIONS)[number];
