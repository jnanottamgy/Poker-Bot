import { api } from '@jpb/client-sdk';
import type {
  JoinInfoDto,
  LeaderboardDto,
  PlayerHistoryDto,
  PlayerMeDto,
  PlayerSelfSummary,
  RegisterRequest,
  RegisterResponse,
  RejoinRequest,
  RejoinResponse,
  TournamentFairnessDto,
  TournamentPublicSummary,
} from '@jpb/shared-types';

export type LeaderboardMode = 'stack' | 'finish';

/** POST /api/player/reenter (services/game-server/src/http/routes/reentry.ts). */
export interface ReenterResponse {
  ok: true;
  entryId: string;
  entryNumber: number;
  self: PlayerSelfSummary | null;
}

/** Typed REST client for the player app (docs/API.md). */
export interface PlayerApi {
  joinInfo(joinCode: string, signal?: AbortSignal): Promise<JoinInfoDto>;
  register(joinCode: string, body: RegisterRequest): Promise<RegisterResponse>;
  rejoin(joinCode: string, body: RejoinRequest): Promise<RejoinResponse>;
  summary(joinCode: string, signal?: AbortSignal): Promise<TournamentPublicSummary>;
  leaderboard(joinCode: string, q: { mode: LeaderboardMode; offset: number; limit: number }, signal?: AbortSignal): Promise<LeaderboardDto>;
  fairness(joinCode: string, signal?: AbortSignal): Promise<TournamentFairnessDto>;
  me(signal?: AbortSignal): Promise<PlayerMeDto>;
  history(signal?: AbortSignal): Promise<PlayerHistoryDto>;
  /** Eliminated player buys back in (server checks the re-entry rules). */
  reenter(): Promise<ReenterResponse>;
  logout(): Promise<void>;
}

export interface PlayerApiOptions {
  /** Injected in mock mode and tests; defaults to the browser fetch. */
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

const enc = encodeURIComponent;

export function createPlayerApi(opts: PlayerApiOptions = {}): PlayerApi {
  const base = { fetchImpl: opts.fetchImpl, baseUrl: opts.baseUrl };
  const get = <T>(path: string, signal?: AbortSignal) => api<T>(path, { ...base, signal });
  const post = <T>(path: string, body: unknown) => api<T>(path, { ...base, method: 'POST', body });
  const pub = (joinCode: string) => `/api/public/tournaments/${enc(joinCode)}`;
  return {
    joinInfo: (joinCode, signal) => get(pub(joinCode), signal),
    register: (joinCode, body) => post(`${pub(joinCode)}/register`, body),
    rejoin: (joinCode, body) => post(`${pub(joinCode)}/rejoin`, body),
    summary: (joinCode, signal) => get(`${pub(joinCode)}/summary`, signal),
    leaderboard: (joinCode, q, signal) => get(`${pub(joinCode)}/leaderboard?mode=${q.mode}&offset=${q.offset}&limit=${q.limit}`, signal),
    fairness: (joinCode, signal) => get(`${pub(joinCode)}/fairness`, signal),
    me: (signal) => get('/api/player/me', signal),
    history: (signal) => get('/api/player/history', signal),
    reenter: () => post('/api/player/reenter', {}),
    logout: async () => {
      await post('/api/player/logout', {});
    },
  };
}
