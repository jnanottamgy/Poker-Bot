import { ApiError, ClockSync, GameConnection, api, defaultScheduler, websocketUrl } from '@jpb/client-sdk';
import type { Scheduler, SocketFactory } from '@jpb/client-sdk';
import { PROTOCOL_VERSION } from '@jpb/shared-types';
import type { JoinInfoDto, LeaderboardDto, ServerMessage, TournamentOverviewDto, TournamentPublicSummary } from '@jpb/shared-types';
import type { DisplayAction, DisplayFrame, TournamentInfo } from '../model/types';
import type { DisplaySource } from './source';

/** After SNAPSHOT_UNAVAILABLE the server says retrying is safe: ask again after this delay. */
const SNAPSHOT_RETRY_MS = 3_000;
/** Refusals that fast retries will not fix: back off to one attempt per FATAL_RETRY_MS (an admin may enable the display meanwhile). */
const FATAL_ERRORS = new Set(['DISPLAY_NOT_ALLOWED', 'TOURNAMENT_NOT_FOUND', 'FORBIDDEN', 'UNAUTHORIZED']);
const FATAL_RETRY_MS = 30_000;

export interface LiveSourceOptions {
  tournamentId: string;
  url?: string;
  socketFactory?: SocketFactory;
  scheduler?: Scheduler;
}

/**
 * The live feed: one DISPLAY WebSocket (client SDK connection: backoff with
 * jitter, heartbeat, dead-socket detection) plus clock sync. Raw frames are
 * handed to the display reducer (including the display-only `display_scene`
 * frame the SDK store does not know).
 */
export function createLiveSource(opts: LiveSourceOptions): DisplaySource {
  const scheduler = opts.scheduler ?? defaultScheduler;
  const clock = new ClockSync();
  let dispatch: ((a: DisplayAction) => void) | null = null;
  let retryTimer: unknown = null;
  let fatalTimer: unknown = null;
  let connection: GameConnection | null = null;

  const emit = (a: DisplayAction) => dispatch?.(a);
  const send = (m: Parameters<GameConnection['send']>[0]) => connection?.send(m) ?? false;

  const onMessage = (msg: ServerMessage, receivedAt: number) => {
    clock.observeServerTime(msg.st, receivedAt);
    if (msg.t === 'pong') {
      clock.recordPong(msg.ct, msg.st, receivedAt);
      emit({ type: 'clock', offsetMs: clock.offsetMs });
      return;
    }
    const frame = msg as DisplayFrame;
    emit({ type: 'frame', frame, at: receivedAt });
    if (frame.t === 'snapshot') emit({ type: 'clock', offsetMs: clock.offsetMs });
    if (frame.t === 'error' && frame.code === 'SNAPSHOT_UNAVAILABLE' && retryTimer === null) {
      retryTimer = scheduler.setTimeout(() => {
        retryTimer = null;
        send({ t: 'snapshot_request' });
      }, SNAPSHOT_RETRY_MS);
    }
    if (frame.t === 'error' && FATAL_ERRORS.has(frame.code) && fatalTimer === null) {
      const c = connection;
      c?.close();
      fatalTimer = scheduler.setTimeout(() => {
        fatalTimer = null;
        if (connection === c) c?.connect();
      }, FATAL_RETRY_MS);
    }
  };

  return {
    kind: 'live',
    start(d) {
      dispatch = d;
      connection = new GameConnection({
        url: opts.url ?? websocketUrl('/ws'),
        socketFactory: opts.socketFactory ?? ((url: string) => new WebSocket(url) as unknown as ReturnType<SocketFactory>),
        scheduler,
        hello: () => ({ t: 'hello', v: PROTOCOL_VERSION, audience: 'DISPLAY', tournamentId: opts.tournamentId, resume: null }),
        onMessage,
        onStatus: (status) => emit({ type: 'connection', status }),
        onOpen: () => {
          send({ t: 'ping', ct: scheduler.now() });
        },
      });
      connection.connect();
    },
    nudge() {
      connection?.nudge();
    },
    stop() {
      if (retryTimer !== null) scheduler.clearTimeout(retryTimer);
      if (fatalTimer !== null) scheduler.clearTimeout(fatalTimer);
      retryTimer = null;
      fatalTimer = null;
      connection?.close();
      connection = null;
      dispatch = null;
    },
  };
}

// ------------------------------------------------------------------ REST

export interface ResolvedTournament {
  tournamentId: string;
  joinCode: string | null;
  info: TournamentInfo | null;
  /** Where prize/name info can be refreshed from: public join info, the admin overview, or nowhere. */
  infoSource: 'join' | 'admin' | null;
}

export function infoFromJoin(j: JoinInfoDto): TournamentInfo {
  return { name: j.name, joinCode: j.joinCode, currency: j.prizes.currency, places: j.prizes.places, startingStack: j.startingStack };
}

export function infoFromOverview(o: TournamentOverviewDto): TournamentInfo {
  return {
    name: o.name,
    joinCode: o.joinCode,
    currency: o.config.prizeStructure.currency,
    places: o.config.prizeStructure.places,
    startingStack: o.config.startingStack,
  };
}

/**
 * Turns the URL's `?code=` / `?t=` into a tournament id and, when possible,
 * the join code (public leaderboard and prize data are keyed by join code).
 * Join info is not published for simulations (admin demo tournaments): the
 * public summary then supplies the id. Prize data comes from the admin
 * overview when an admin is signed in on this screen; otherwise those
 * panels stay hidden. With only `?t=`, the join code also comes from the
 * admin overview.
 */
export async function resolveTournament(params: { tournamentId: string | null; joinCode: string | null }): Promise<ResolvedTournament> {
  if (params.joinCode) {
    const code = encodeURIComponent(params.joinCode);
    const join = await api<JoinInfoDto>(`/api/public/tournaments/${code}`).catch((err: unknown) => {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    });
    const tournamentId = join ? join.tournamentId : (await api<TournamentPublicSummary>(`/api/public/tournaments/${code}/summary`)).tournamentId;
    if (params.tournamentId && params.tournamentId !== tournamentId) throw new ApiError(400, 'MISMATCH', 'The join code belongs to another tournament.');
    const info = join ? infoFromJoin(join) : await adminInfo(tournamentId);
    return { tournamentId, joinCode: params.joinCode, info, infoSource: join ? 'join' : info ? 'admin' : null };
  }
  if (!params.tournamentId) throw new ApiError(400, 'NO_TOURNAMENT', 'Open this page with ?t=<tournament id> or ?code=<join code>.');
  const o = await adminOverview(params.tournamentId);
  return { tournamentId: params.tournamentId, joinCode: o?.joinCode ?? null, info: o ? infoFromOverview(o) : null, infoSource: o ? 'admin' : null };
}

function adminOverview(tournamentId: string): Promise<TournamentOverviewDto | null> {
  return api<TournamentOverviewDto>(`/api/admin/tournaments/${encodeURIComponent(tournamentId)}`).catch(() => null);
}

export async function adminInfo(tournamentId: string): Promise<TournamentInfo | null> {
  const o = await adminOverview(tournamentId);
  return o ? infoFromOverview(o) : null;
}

export function fetchLeaderboard(joinCode: string, mode: 'stack' | 'finish', limit: number): Promise<LeaderboardDto> {
  return api<LeaderboardDto>(`/api/public/tournaments/${encodeURIComponent(joinCode)}/leaderboard?mode=${mode}&offset=0&limit=${limit}`);
}

export function fetchJoinInfo(joinCode: string): Promise<JoinInfoDto> {
  return api<JoinInfoDto>(`/api/public/tournaments/${encodeURIComponent(joinCode)}`);
}
