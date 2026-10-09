import { ApiError, api } from '@jpb/client-sdk';
import type {
  AdminMeDto,
  DemoRequest,
  DemoStatusDto,
  FairnessExport,
  HandDetailDto,
  HandFairnessRecord,
  HandListItemDto,
  JoinInfoDto,
  LeaderboardDto,
  LiveMetricsDto,
  Paginated,
  PayoutsDto,
  PlayerDetailDto,
  PlayerListItemDto,
  PlayerPiiDto,
  RegisterRequest,
  RegisterResponse,
  RejoinRequest,
  RejoinResponse,
  SystemDto,
  TableDetailDto,
  TableListItemDto,
  TournamentConfig,
  TournamentFairnessDto,
  TournamentOverviewDto,
  TournamentPublicSummary,
  TournamentReportDto,
} from '@jpb/shared-types';
import { ENDPOINTS, buildPath } from './endpoints';
import type { EndpointKey, QueryValue } from './endpoints';
import type {
  AdjustStackRequest,
  AlertResponse,
  AlertsQuery,
  AlertsResponse,
  AnnounceRequest,
  AuditListResponse,
  AuditQuery,
  AuditVerifyResponse,
  CreateUserRequest,
  DangerBody,
  DisplayRequest,
  ForceTimeoutRequest,
  HandsQuery,
  HoleCardsRevealResponse,
  IntegrityCheckResponse,
  LoginRequest,
  LoginResponse,
  ManualRegistrationRequest,
  ManualRegistrationResponse,
  MovePlayerRequest,
  OkResponse,
  PaymentUpdateRequest,
  PaymentUpdateResponse,
  PlayersQuery,
  PutConfigRequest,
  ReasonBody,
  RebalanceResponse,
  ReentryResponse,
  RejoinCodeResponse,
  ResetPasswordRequest,
  RevealSeedResponse,
  RevokeSessionRequest,
  RevokeSessionsResponse,
  RunningConfigRequest,
  SeatScoresResponse,
  SessionsResponse,
  StandingsQuery,
  StartRequest,
  StartResponse,
  TableAddTimeRequest,
  TableEventsResponse,
  TablesQuery,
  TournamentCreatedResponse,
  TournamentListQuery,
  TournamentListResponse,
  UpdateUserRequest,
  UserResponse,
  UsersResponse,
} from './types';

export interface AdminApiOptions {
  /** Real `fetch` (default) or the mock backend's fetch. */
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

type Params = Record<string, string | number>;
type Query = Record<string, QueryValue>;

interface CallArgs {
  params?: Params;
  query?: Query;
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * Typed client for every Admin + Public endpoint of docs/API.md. All calls
 * go through `api()` from @jpb/client-sdk (same-origin cookies, automatic
 * `x-csrf-token` on writes, friendly `ApiError`s). Level-2 calls take a
 * `DangerBody` (`{ reason, confirm }`) — use `useDangerousAction()` rather
 * than calling them directly from a button.
 */
export function createAdminApi(opts: AdminApiOptions = {}) {
  const baseUrl = opts.baseUrl ?? '';

  function call<T>(key: EndpointKey, args: CallArgs = {}): Promise<T> {
    const def = ENDPOINTS[key];
    return api<T>(buildPath(def.path, args.params, args.query), {
      method: def.method,
      body: args.body,
      signal: args.signal,
      baseUrl,
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    });
  }

  /** Absolute-path URL for links/downloads (CSV, SVG). */
  function url(key: EndpointKey, params?: Params, query?: Query): string {
    return baseUrl + buildPath(ENDPOINTS[key].path, params, query);
  }

  /** GET a non-JSON resource (CSV / SVG) as text. Failures are `ApiError`s like every other call. */
  async function text(key: EndpointKey, params?: Params, query?: Query, signal?: AbortSignal): Promise<string> {
    const f = opts.fetchImpl ?? fetch;
    let res: Response;
    try {
      res = await f(url(key, params, query), { method: 'GET', credentials: 'same-origin', signal });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      throw new ApiError(0, 'NETWORK', 'Unable to connect. Check your connection and try again.');
    }
    const body = await res.text();
    if (!res.ok) {
      const error = parseErrorBody(body);
      throw new ApiError(res.status, error?.code ?? 'ERROR', error?.message ?? `Download failed (${res.status}).`, error?.details ?? null);
    }
    return body;
  }

  const t = (id: string): Params => ({ id });

  return {
    url,
    text,

    auth: {
      login: (body: LoginRequest) => call<LoginResponse>('authLogin', { body }),
      logout: () => call<OkResponse>('authLogout', { body: {} }),
      me: (signal?: AbortSignal) => call<AdminMeDto>('authMe', { signal }),
    },

    tournaments: {
      list: (query: TournamentListQuery = {}, signal?: AbortSignal) =>
        call<TournamentListResponse>('tournamentsList', { query: { status: query.status, simulations: query.simulations }, signal }),
      create: (config: TournamentConfig) => call<TournamentCreatedResponse>('tournamentCreate', { body: { config } }),
      overview: (id: string, signal?: AbortSignal) => call<TournamentOverviewDto>('tournamentOverview', { params: t(id), signal }),
      putConfig: (id: string, body: PutConfigRequest) => call<OkResponse>('tournamentPutConfig', { params: t(id), body }),
      patchRunningConfig: (id: string, body: RunningConfigRequest) => call<OkResponse>('tournamentPatchRunningConfig', { params: t(id), body }),
      clone: (id: string) => call<TournamentCreatedResponse>('tournamentClone', { params: t(id), body: {} }),
      remove: (id: string, body?: ReasonBody) => call<OkResponse>('tournamentDelete', { params: t(id), ...(body ? { body } : {}) }),
    },

    lifecycle: {
      openRegistration: (id: string, body: ReasonBody = {}) => call<OkResponse>('registrationOpen', { params: t(id), body }),
      closeRegistration: (id: string, body: ReasonBody = {}) => call<OkResponse>('registrationClose', { params: t(id), body }),
      reopenRegistration: (id: string, body: ReasonBody = {}) => call<OkResponse>('registrationReopen', { params: t(id), body }),
      start: (id: string, body: StartRequest = {}) => call<StartResponse>('tournamentStart', { params: t(id), body }),
      pause: (id: string, body: ReasonBody = {}) => call<OkResponse>('tournamentPause', { params: t(id), body }),
      resume: (id: string, body: ReasonBody = {}) => call<OkResponse>('tournamentResume', { params: t(id), body }),
      freeze: (id: string, body: DangerBody<'FREEZE'>) => call<OkResponse>('tournamentFreeze', { params: t(id), body }),
      unfreeze: (id: string, body: DangerBody<'FREEZE'>) => call<OkResponse>('tournamentUnfreeze', { params: t(id), body }),
      cancel: (id: string, body: DangerBody<'CANCEL'>) => call<OkResponse>('tournamentCancel', { params: t(id), body }),
    },

    clock: {
      advance: (id: string, body: ReasonBody = {}) => call<OkResponse>('clockAdvance', { params: t(id), body }),
      setLevel: (id: string, body: DangerBody<'LEVEL'> & { level: number }) => call<OkResponse>('clockSetLevel', { params: t(id), body }),
      addTime: (id: string, body: ReasonBody & { ms: number }) => call<OkResponse>('clockAddTime', { params: t(id), body }),
      startBreak: (id: string, body: ReasonBody & { durationSeconds: number }) => call<OkResponse>('breakStart', { params: t(id), body }),
      endBreak: (id: string, body: ReasonBody = {}) => call<OkResponse>('breakEnd', { params: t(id), body }),
      handForHand: (id: string, body: ReasonBody & { enabled: boolean }) => call<OkResponse>('handForHand', { params: t(id), body }),
    },

    tables: {
      list: (id: string, q: TablesQuery = {}, signal?: AbortSignal) =>
        call<Paginated<TableListItemDto>>('tablesList', {
          params: t(id),
          query: { status: q.status, minPlayers: q.minPlayers, maxPlayers: q.maxPlayers, stalled: q.stalled, q: q.q, sort: q.sort, offset: q.offset, limit: q.limit },
          signal,
        }),
      detail: (tableId: string, signal?: AbortSignal) => call<TableDetailDto>('tableDetail', { params: { tableId }, signal }),
      events: (tableId: string, q: { after?: number; limit?: number } = {}, signal?: AbortSignal) =>
        call<TableEventsResponse>('tableEvents', { params: { tableId }, query: { after: q.after, limit: q.limit }, signal }),
      hold: (tableId: string, body: ReasonBody = {}) => call<OkResponse>('tableHold', { params: { tableId }, body }),
      release: (tableId: string, body: ReasonBody = {}) => call<OkResponse>('tableRelease', { params: { tableId }, body }),
      freeze: (tableId: string, body: ReasonBody = {}) => call<OkResponse>('tableFreeze', { params: { tableId }, body }),
      unfreeze: (tableId: string, body: ReasonBody = {}) => call<OkResponse>('tableUnfreeze', { params: { tableId }, body }),
      forceTimeout: (tableId: string, body: ForceTimeoutRequest) => call<OkResponse>('tableForceTimeout', { params: { tableId }, body }),
      addTime: (tableId: string, body: TableAddTimeRequest = {}) => call<OkResponse>('tableAddTime', { params: { tableId }, body }),
      seatScores: (tableId: string, playerId: string, signal?: AbortSignal) => call<SeatScoresResponse>('tableSeatScores', { params: { tableId }, query: { playerId }, signal }),
      breakTable: (tableId: string, body: DangerBody<'BREAK'>) => call<OkResponse>('tableBreak', { params: { tableId }, body }),
      revealHoleCards: (tableId: string, body: DangerBody<'REVEAL'>) => call<HoleCardsRevealResponse>('tableRevealHoleCards', { params: { tableId }, body }),
      rebalance: (id: string, body: ReasonBody = {}) => call<RebalanceResponse>('tournamentRebalance', { params: t(id), body }),
      integrityCheck: (id: string) => call<IntegrityCheckResponse>('tournamentIntegrityCheck', { params: t(id), body: {} }),
    },

    players: {
      list: (id: string, q: PlayersQuery = {}, signal?: AbortSignal) =>
        call<Paginated<PlayerListItemDto>>('playersList', {
          params: t(id),
          query: { q: q.q, status: q.status, tableId: q.tableId, sort: q.sort, offset: q.offset, limit: q.limit },
          signal,
        }),
      detail: (playerId: string, signal?: AbortSignal) => call<PlayerDetailDto>('playerDetail', { params: { playerId }, signal }),
      pii: (playerId: string, signal?: AbortSignal) => call<PlayerPiiDto>('playerPii', { params: { playerId }, signal }),
      move: (playerId: string, body: MovePlayerRequest) => call<OkResponse>('playerMove', { params: { playerId }, body }),
      suspend: (playerId: string, body: ReasonBody = {}) => call<OkResponse>('playerSuspend', { params: { playerId }, body }),
      restore: (playerId: string, body: DangerBody<'RESTORE'>) => call<OkResponse>('playerRestore', { params: { playerId }, body }),
      disqualify: (playerId: string, body: DangerBody<'DISQUALIFY'>) => call<OkResponse>('playerDisqualify', { params: { playerId }, body }),
      adjustStack: (playerId: string, body: AdjustStackRequest) => call<OkResponse>('playerAdjustStack', { params: { playerId }, body }),
      revokeSessions: (playerId: string, body: DangerBody<'REVOKE'>) => call<RevokeSessionsResponse>('playerRevokeSessions', { params: { playerId }, body }),
      newRejoinCode: (playerId: string, body: ReasonBody = {}) => call<RejoinCodeResponse>('playerRejoinCode', { params: { playerId }, body }),
      notice: (playerId: string, body: { text: string }) => call<OkResponse>('playerNotice', { params: { playerId }, body }),
      approve: (playerId: string, body: ReasonBody = {}) => call<OkResponse>('playerApprove', { params: { playerId }, body }),
      reject: (playerId: string, body: ReasonBody = {}) => call<OkResponse>('playerReject', { params: { playerId }, body }),
      reenter: (playerId: string, body: ReasonBody = {}) => call<ReentryResponse>('playerReenter', { params: { playerId }, body }),
    },

    registration: {
      manual: (id: string, body: ManualRegistrationRequest) => call<ManualRegistrationResponse>('registrationManual', { params: t(id), body }),
      qrSvgUrl: (id: string, size?: number) => url('tournamentQrSvg', t(id), { size }),
      qrSvg: (id: string, size?: number) => text('tournamentQrSvg', t(id), { size }),
    },

    hands: {
      list: (id: string, q: HandsQuery = {}, signal?: AbortSignal) =>
        call<Paginated<HandListItemDto>>('handsList', {
          params: t(id),
          query: { tableId: q.tableId, playerId: q.playerId, handNumber: q.handNumber, minPot: q.minPot, showdown: q.showdown, allIn: q.allIn, offset: q.offset, limit: q.limit },
          signal,
        }),
      detail: (handId: string, signal?: AbortSignal) => call<HandDetailDto>('handDetail', { params: { handId }, signal }),
      fairness: (handId: string, signal?: AbortSignal) => call<HandFairnessRecord>('handFairness', { params: { handId }, signal }),
    },

    fairness: {
      tournament: (id: string, signal?: AbortSignal) => call<TournamentFairnessDto>('tournamentFairness', { params: t(id), signal }),
      bundle: (id: string, q: { fromHand?: number; toHand?: number } = {}, signal?: AbortSignal) =>
        call<FairnessExport>('tournamentFairnessBundle', { params: t(id), query: { fromHand: q.fromHand, toHand: q.toHand }, signal }),
      revealSeed: (id: string, body: DangerBody<'REVEAL'>) => call<RevealSeedResponse>('tournamentRevealSeed', { params: t(id), body }),
    },

    standings: {
      get: (id: string, q: StandingsQuery, signal?: AbortSignal) =>
        call<LeaderboardDto>('standings', { params: t(id), query: { mode: q.mode, offset: q.offset, limit: q.limit }, signal }),
      csvUrl: (id: string, mode: 'stack' | 'finish') => url('standingsCsv', t(id), { mode }),
    },

    payouts: {
      get: (id: string, signal?: AbortSignal) => call<PayoutsDto>('payouts', { params: t(id), signal }),
      csvUrl: (id: string) => url('payoutsCsv', t(id)),
      updatePayment: (entryId: string, body: PaymentUpdateRequest) => call<PaymentUpdateResponse>('entryPayment', { params: { entryId }, body }),
    },

    broadcast: {
      announce: (id: string, body: AnnounceRequest) => call<OkResponse>('announce', { params: t(id), body }),
      display: (id: string, body: DisplayRequest) => call<OkResponse>('display', { params: t(id), body }),
    },

    alerts: {
      list: (q: AlertsQuery = {}, signal?: AbortSignal) =>
        call<AlertsResponse>('alertsList', { query: { tournamentId: q.tournamentId, open: q.open, limit: q.limit }, signal }),
      ack: (alertId: string, body: ReasonBody = {}) => call<AlertResponse>('alertAck', { params: { id: alertId }, body }),
      resolve: (alertId: string, body: ReasonBody = {}) => call<OkResponse>('alertResolve', { params: { id: alertId }, body }),
    },

    audit: {
      list: (q: AuditQuery = {}, signal?: AbortSignal) =>
        call<AuditListResponse>('auditList', {
          query: { tournamentId: q.tournamentId, adminId: q.adminId, action: q.action, target: q.target, beforeSeq: q.beforeSeq, limit: q.limit },
          signal,
        }),
      csvUrl: (q: AuditQuery = {}) => url('auditCsv', undefined, { tournamentId: q.tournamentId, adminId: q.adminId, action: q.action, target: q.target }),
      verify: (signal?: AbortSignal) => call<AuditVerifyResponse>('auditVerify', { signal }),
    },

    system: {
      get: (signal?: AbortSignal) => call<SystemDto>('system', { signal }),
      liveMetrics: (id: string, signal?: AbortSignal) => call<LiveMetricsDto>('metricsLive', { params: t(id), signal }),
    },

    reports: {
      get: (id: string, signal?: AbortSignal) => call<TournamentReportDto>('report', { params: t(id), signal }),
      csvUrl: (id: string) => url('reportCsv', t(id)),
    },

    users: {
      list: (signal?: AbortSignal) => call<UsersResponse>('usersList', { signal }),
      create: (body: CreateUserRequest) => call<UserResponse>('userCreate', { body }),
      update: (userId: string, body: UpdateUserRequest) => call<UserResponse>('userUpdate', { params: { id: userId }, body }),
      resetPassword: (userId: string, body: ResetPasswordRequest) => call<OkResponse>('userResetPassword', { params: { id: userId }, body }),
      sessions: (signal?: AbortSignal) => call<SessionsResponse>('sessionsList', { signal }),
      revokeSession: (sessionId: string, body: RevokeSessionRequest) => call<OkResponse>('sessionRevoke', { params: { id: sessionId }, body }),
    },

    demo: {
      create: (body: DemoRequest) => call<DemoStatusDto>('demoCreate', { body }),
      status: (demoId: string, signal?: AbortSignal) => call<DemoStatusDto>('demoStatus', { params: { id: demoId }, signal }),
      stop: (demoId: string) => call<DemoStatusDto>('demoStop', { params: { id: demoId }, body: {} }),
    },

    public: {
      joinInfo: (joinCode: string, signal?: AbortSignal) => call<JoinInfoDto>('publicJoinInfo', { params: { joinCode }, signal }),
      register: (joinCode: string, body: RegisterRequest) => call<RegisterResponse>('publicRegister', { params: { joinCode }, body }),
      rejoin: (joinCode: string, body: RejoinRequest) => call<RejoinResponse>('publicRejoin', { params: { joinCode }, body }),
      summary: (joinCode: string, signal?: AbortSignal) => call<TournamentPublicSummary>('publicSummary', { params: { joinCode }, signal }),
      leaderboard: (joinCode: string, q: StandingsQuery, signal?: AbortSignal) =>
        call<LeaderboardDto>('publicLeaderboard', { params: { joinCode }, query: { mode: q.mode, offset: q.offset, limit: q.limit }, signal }),
      fairness: (joinCode: string, signal?: AbortSignal) => call<TournamentFairnessDto>('publicFairness', { params: { joinCode }, signal }),
      handFairness: (handId: string, signal?: AbortSignal) => call<HandFairnessRecord>('publicHandFairness', { params: { handId }, signal }),
    },
  };
}

export type AdminApi = ReturnType<typeof createAdminApi>;

function parseErrorBody(text: string): { code?: string; message?: string; details?: unknown } | null {
  try {
    return (JSON.parse(text) as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error ?? null;
  } catch {
    return null;
  }
}
