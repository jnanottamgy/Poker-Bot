import type { Permission } from '@jpb/shared-types';

/**
 * Every REST endpoint of docs/API.md ("Public" and "Admin" sections), as data.
 * The typed client (`client.ts`) only calls endpoints through this registry.
 * tests/integration/admin-api-contract.test.ts parses docs/API.md to prove the
 * registry and the document list exactly the same method + path pairs, checks
 * that the real game server serves every one of them, and calls each through
 * this client against the real server.
 *
 * `level` is the danger level of docs/ADMIN_CONTROL_ROOM.md §4 and `word` the
 * confirmation word an L2 endpoint requires in its body (`{ reason, confirm }`).
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type DangerLevel = 0 | 1 | 2;

/** Server-enforced L2 confirmation words (API.md; services/game-server/src/http/danger.ts). */
export const CONFIRM_WORDS = {
  FREEZE: 'FREEZE',
  CANCEL: 'CANCEL',
  LEVEL: 'LEVEL',
  BREAK: 'BREAK',
  REVEAL: 'REVEAL',
  RESTORE: 'RESTORE',
  DISQUALIFY: 'DISQUALIFY',
  ADJUST: 'ADJUST',
  REVOKE: 'REVOKE',
  EDIT: 'EDIT',
  USER: 'USER',
} as const;
export type ConfirmWord = keyof typeof CONFIRM_WORDS;

export interface EndpointDef {
  method: HttpMethod;
  /** Path template with `:param` segments, exactly as written in docs/API.md. */
  path: string;
  /** Required permission (null: public, or any signed-in admin). */
  permission: Permission | null;
  level: DangerLevel;
  word?: ConfirmWord;
  /** Response is not JSON (CSV / SVG): fetch as text or link to it. */
  text?: boolean;
  section: 'Public' | 'Admin';
}

const pub = (method: HttpMethod, path: string): EndpointDef => ({ method, path, permission: null, level: 0, section: 'Public' });
const adm = (method: HttpMethod, path: string, permission: Permission | null, level: DangerLevel = 0, word?: ConfirmWord, text?: boolean): EndpointDef => ({
  method,
  path,
  permission,
  level,
  section: 'Admin',
  ...(word ? { word } : {}),
  ...(text ? { text } : {}),
});

const T = '/api/admin/tournaments/:id';

export const ENDPOINTS = {
  // ---------------------------------------------------------------- public
  publicJoinInfo: pub('GET', '/api/public/tournaments/:joinCode'),
  publicRegister: pub('POST', '/api/public/tournaments/:joinCode/register'),
  publicRejoin: pub('POST', '/api/public/tournaments/:joinCode/rejoin'),
  publicSummary: pub('GET', '/api/public/tournaments/:joinCode/summary'),
  publicLeaderboard: pub('GET', '/api/public/tournaments/:joinCode/leaderboard'),
  publicFairness: pub('GET', '/api/public/tournaments/:joinCode/fairness'),
  publicHandFairness: pub('GET', '/api/public/hands/:handId/fairness'),

  // ---------------------------------------------------------------- auth
  authLogin: adm('POST', '/api/admin/auth/login', null),
  authLogout: adm('POST', '/api/admin/auth/logout', null),
  authMe: adm('GET', '/api/admin/auth/me', null),

  // ---------------------------------------------------------------- tournaments & lifecycle
  tournamentsList: adm('GET', '/api/admin/tournaments', 'PLAYER_VIEW'),
  tournamentCreate: adm('POST', '/api/admin/tournaments', 'TOURNAMENT_CREATE'),
  tournamentOverview: adm('GET', T, 'PLAYER_VIEW'),
  tournamentPutConfig: adm('PUT', `${T}/config`, 'TOURNAMENT_EDIT_CONFIG', 1),
  tournamentPatchRunningConfig: adm('PATCH', `${T}/config/running`, 'TOURNAMENT_EDIT_CONFIG', 2, 'EDIT'),
  tournamentClone: adm('POST', `${T}/clone`, 'TOURNAMENT_CREATE'),
  tournamentDelete: adm('DELETE', T, 'TOURNAMENT_CREATE', 1),
  registrationOpen: adm('POST', `${T}/registration/open`, 'TOURNAMENT_LIFECYCLE', 1),
  registrationClose: adm('POST', `${T}/registration/close`, 'TOURNAMENT_LIFECYCLE', 1),
  registrationReopen: adm('POST', `${T}/registration/reopen`, 'TOURNAMENT_LIFECYCLE', 1),
  tournamentStart: adm('POST', `${T}/start`, 'TOURNAMENT_LIFECYCLE', 1),
  tournamentPause: adm('POST', `${T}/pause`, 'TOURNAMENT_PAUSE', 1),
  tournamentResume: adm('POST', `${T}/resume`, 'TOURNAMENT_PAUSE', 1),
  tournamentFreeze: adm('POST', `${T}/freeze`, 'TOURNAMENT_FREEZE', 2, 'FREEZE'),
  tournamentUnfreeze: adm('POST', `${T}/unfreeze`, 'TOURNAMENT_FREEZE', 2, 'FREEZE'),
  tournamentCancel: adm('POST', `${T}/cancel`, 'TOURNAMENT_CANCEL', 2, 'CANCEL'),

  // ---------------------------------------------------------------- clock
  clockAdvance: adm('POST', `${T}/clock/advance`, 'CLOCK_CONTROL', 1),
  clockSetLevel: adm('POST', `${T}/clock/set-level`, 'CLOCK_CONTROL', 2, 'LEVEL'),
  clockAddTime: adm('POST', `${T}/clock/add-time`, 'CLOCK_CONTROL', 1),
  breakStart: adm('POST', `${T}/break/start`, 'CLOCK_CONTROL', 1),
  breakEnd: adm('POST', `${T}/break/end`, 'CLOCK_CONTROL', 1),
  handForHand: adm('POST', `${T}/hand-for-hand`, 'TABLE_CONTROL', 1),

  // ---------------------------------------------------------------- tables
  tablesList: adm('GET', `${T}/tables`, 'PLAYER_VIEW'),
  tableDetail: adm('GET', '/api/admin/tables/:tableId', 'PLAYER_VIEW'),
  tableEvents: adm('GET', '/api/admin/tables/:tableId/events', 'HAND_HISTORY_VIEW'),
  tableHold: adm('POST', '/api/admin/tables/:tableId/hold', 'TABLE_CONTROL', 1),
  tableRelease: adm('POST', '/api/admin/tables/:tableId/release', 'TABLE_CONTROL', 1),
  tableFreeze: adm('POST', '/api/admin/tables/:tableId/freeze', 'TABLE_CONTROL', 1),
  tableUnfreeze: adm('POST', '/api/admin/tables/:tableId/unfreeze', 'TABLE_CONTROL', 1),
  tableForceTimeout: adm('POST', '/api/admin/tables/:tableId/force-timeout', 'TABLE_CONTROL', 1),
  tableAddTime: adm('POST', '/api/admin/tables/:tableId/add-time', 'TABLE_CONTROL', 1),
  tableSeatScores: adm('GET', '/api/admin/tables/:tableId/seat-scores', 'PLAYER_MOVE'),
  tableBreak: adm('POST', '/api/admin/tables/:tableId/break', 'TABLE_CONTROL', 2, 'BREAK'),
  tableRevealHoleCards: adm('POST', '/api/admin/tables/:tableId/reveal-hole-cards', 'VIEW_HOLE_CARDS', 2, 'REVEAL'),
  tournamentRebalance: adm('POST', `${T}/rebalance`, 'TABLE_CONTROL', 1),
  tournamentIntegrityCheck: adm('POST', `${T}/integrity-check`, 'TABLE_CONTROL'),

  // ---------------------------------------------------------------- players & registration
  playersList: adm('GET', `${T}/players`, 'PLAYER_VIEW'),
  playerDetail: adm('GET', '/api/admin/players/:playerId', 'PLAYER_VIEW'),
  playerPii: adm('GET', '/api/admin/players/:playerId/pii', 'PLAYER_VIEW_PII'),
  playerMove: adm('POST', '/api/admin/players/:playerId/move', 'PLAYER_MOVE', 1),
  playerSuspend: adm('POST', '/api/admin/players/:playerId/suspend', 'PLAYER_SUSPEND', 1),
  playerRestore: adm('POST', '/api/admin/players/:playerId/restore', 'PLAYER_SUSPEND', 2, 'RESTORE'),
  playerDisqualify: adm('POST', '/api/admin/players/:playerId/disqualify', 'PLAYER_DISQUALIFY', 2, 'DISQUALIFY'),
  playerAdjustStack: adm('POST', '/api/admin/players/:playerId/adjust-stack', 'STACK_ADJUST', 2, 'ADJUST'),
  playerRevokeSessions: adm('POST', '/api/admin/players/:playerId/revoke-sessions', 'PLAYER_SUSPEND', 2, 'REVOKE'),
  playerRejoinCode: adm('POST', '/api/admin/players/:playerId/rejoin-code', 'PLAYER_SUSPEND', 1),
  playerNotice: adm('POST', '/api/admin/players/:playerId/notice', 'ANNOUNCE', 1),
  playerApprove: adm('POST', '/api/admin/players/:playerId/approve', 'PLAYER_APPROVE_REGISTRATION', 1),
  playerReject: adm('POST', '/api/admin/players/:playerId/reject', 'PLAYER_APPROVE_REGISTRATION', 1),
  playerReenter: adm('POST', '/api/admin/players/:playerId/reenter', 'PLAYER_APPROVE_REGISTRATION', 1),
  registrationManual: adm('POST', `${T}/registrations/manual`, 'PLAYER_APPROVE_REGISTRATION', 1),
  tournamentQrSvg: adm('GET', `${T}/qr.svg`, 'PLAYER_VIEW', 0, undefined, true),

  // ---------------------------------------------------------------- hands, fairness, standings, payouts
  handsList: adm('GET', `${T}/hands`, 'HAND_HISTORY_VIEW'),
  handDetail: adm('GET', '/api/admin/hands/:handId', 'HAND_HISTORY_VIEW'),
  handFairness: adm('GET', '/api/admin/hands/:handId/fairness', 'FAIRNESS_VIEW'),
  tournamentFairness: adm('GET', `${T}/fairness`, 'FAIRNESS_VIEW'),
  tournamentFairnessBundle: adm('GET', `${T}/fairness/bundle`, 'FAIRNESS_VIEW'),
  tournamentRevealSeed: adm('POST', `${T}/fairness/reveal-seed`, 'FAIRNESS_REVEAL_SEED', 2, 'REVEAL'),
  standings: adm('GET', `${T}/standings`, 'PLAYER_VIEW'),
  standingsCsv: adm('GET', `${T}/standings.csv`, 'PLAYER_VIEW', 0, undefined, true),
  payouts: adm('GET', `${T}/payouts`, 'PAYOUT_VIEW'),
  payoutsCsv: adm('GET', `${T}/payouts.csv`, 'PAYOUT_VIEW', 0, undefined, true),
  entryPayment: adm('PATCH', '/api/admin/entries/:entryId/payment', 'PAYOUT_MANAGE', 1),

  // ---------------------------------------------------------------- broadcast, alerts, audit, system, reports, users, demo
  announce: adm('POST', `${T}/announce`, 'ANNOUNCE', 1),
  display: adm('POST', `${T}/display`, 'ANNOUNCE'),
  alertsList: adm('GET', '/api/admin/alerts', 'METRICS_VIEW'),
  alertAck: adm('POST', '/api/admin/alerts/:id/ack', 'ALERTS_MANAGE', 1),
  alertResolve: adm('POST', '/api/admin/alerts/:id/resolve', 'ALERTS_MANAGE', 1),
  auditList: adm('GET', '/api/admin/audit', 'AUDIT_VIEW'),
  auditCsv: adm('GET', '/api/admin/audit.csv', 'AUDIT_VIEW', 0, undefined, true),
  auditVerify: adm('GET', '/api/admin/audit/verify', 'AUDIT_VIEW'),
  system: adm('GET', '/api/admin/system', 'METRICS_VIEW'),
  metricsLive: adm('GET', `${T}/metrics/live`, 'METRICS_VIEW'),
  report: adm('GET', `${T}/report`, 'EXPORT_DATA'),
  reportCsv: adm('GET', `${T}/report.csv`, 'EXPORT_DATA', 0, undefined, true),
  usersList: adm('GET', '/api/admin/users', 'ADMIN_USERS_MANAGE'),
  userCreate: adm('POST', '/api/admin/users', 'ADMIN_USERS_MANAGE', 1),
  userUpdate: adm('PATCH', '/api/admin/users/:id', 'ADMIN_USERS_MANAGE', 2, 'USER'),
  userResetPassword: adm('POST', '/api/admin/users/:id/reset-password', 'ADMIN_USERS_MANAGE', 2, 'USER'),
  sessionsList: adm('GET', '/api/admin/sessions', 'ADMIN_USERS_MANAGE'),
  sessionRevoke: adm('POST', '/api/admin/sessions/:id/revoke', 'ADMIN_USERS_MANAGE', 1),
  demoCreate: adm('POST', '/api/admin/demo', 'SIMULATION_RUN'),
  demoStatus: adm('GET', '/api/admin/demo/:id', 'SIMULATION_RUN'),
  demoStop: adm('POST', '/api/admin/demo/:id/stop', 'SIMULATION_RUN'),
} as const satisfies Record<string, EndpointDef>;

export type EndpointKey = keyof typeof ENDPOINTS;

export type QueryValue = string | number | boolean | null | undefined;

/** Fills `:param` segments (URI-encoded) and appends defined query values. */
export function buildPath(template: string, params: Record<string, string | number> = {}, query: Record<string, QueryValue> = {}): string {
  const path = template.replace(/:([A-Za-z]+)/g, (_, name: string) => {
    const v = params[name];
    if (v === undefined) throw new Error(`Missing path parameter "${name}" for ${template}`);
    return encodeURIComponent(String(v));
  });
  const qs = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return qs ? `${path}?${qs}` : path;
}
