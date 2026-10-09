import type { SpectatorTableView, TableEvent, TournamentEventEnvelope } from '@jpb/shared-types';
import { splashFor, tickerItemFor } from './events';
import type { AdminScene, DisplayAction, DisplayFrame, DisplayState, EliminationItem, ShowdownState, TurnState } from './types';
import { SCENES } from './types';

/**
 * The display's frame reducer: a pure function of (state, action). It never
 * computes game state; it only mirrors what the server sent (the latest
 * server view always replaces what was there) and derives broadcast copy
 * (ticker lines, splashes) from tournament events. Time arrives in actions.
 */

export const MAX_TICKER = 14;
export const MAX_ELIMINATIONS = 12;
export const MAX_SPLASHES = 6;
/** A queued splash older than this is dropped instead of shown late. */
export const SPLASH_MAX_AGE_MS = 30_000;

export const INITIAL_DISPLAY_STATE: DisplayState = {
  connection: 'idle',
  synced: false,
  error: null,
  serverOffsetMs: 0,
  tournament: null,
  featured: null,
  featuredSeq: 0,
  showdown: null,
  turn: null,
  lastTournamentSeq: 0,
  ticker: [],
  eliminations: [],
  splashes: [],
  announcement: null,
  champion: null,
  finalTableId: null,
  pause: null,
  breakMessage: null,
  adminScene: null,
  info: null,
  leaderboard: null,
  finishOrder: null,
};

export function displayReducer(state: DisplayState, action: DisplayAction): DisplayState {
  switch (action.type) {
    case 'connection':
      return action.status === 'open' ? { ...state, connection: 'open' } : { ...state, connection: action.status, synced: false };
    case 'clock':
      return state.serverOffsetMs === action.offsetMs ? state : { ...state, serverOffsetMs: action.offsetMs };
    case 'info':
      return { ...state, info: action.info };
    case 'leaderboard': {
      const lb = { mode: action.data.mode, label: action.data.label, rows: action.data.rows, total: action.data.total, fetchedAt: action.at };
      return action.data.mode === 'finish' ? { ...state, finishOrder: lb } : { ...state, leaderboard: lb };
    }
    case 'splash_done':
      return { ...state, splashes: state.splashes.filter((s) => s.id !== action.id && action.now - s.at <= SPLASH_MAX_AGE_MS) };
    case 'frame':
      return applyFrame(state, action.frame, action.at);
    default:
      return state;
  }
}

function applyFrame(state: DisplayState, frame: DisplayFrame, at: number): DisplayState {
  switch (frame.t) {
    case 'snapshot': {
      const snap = frame.snapshot;
      const featured = snap.audience === 'DISPLAY' ? snap.featured : 'table' in snap ? (snap.table as SpectatorTableView | null) : null;
      const sameTable = !!featured && featured.tableId === state.featured?.tableId;
      const tournament = snap.tournament;
      return withStatus(
        {
          ...state,
          synced: true,
          error: null,
          tournament,
          featured,
          featuredSeq: featured ? featured.lastEventSeq : 0,
          showdown: sameTable ? state.showdown : null,
          turn: turnFrom(featured, sameTable ? state.turn : null, []),
          lastTournamentSeq: Math.max(state.lastTournamentSeq, tournament.lastSeq),
        },
        state,
      );
    }
    case 'table_update': {
      const view = frame.view as SpectatorTableView;
      const cur = state.featured;
      const sameTable = cur?.tableId === frame.tableId;
      if (sameTable && cur && frame.version < cur.version) return state;
      const fresh = sameTable ? frame.events.filter((e) => e.seq > state.featuredSeq) : frame.events;
      const showdown = applyTableEvents(sameTable ? state.showdown : null, fresh);
      return {
        ...state,
        featured: view,
        featuredSeq: Math.max(sameTable ? state.featuredSeq : 0, frame.toSeq),
        showdown,
        turn: turnFrom(view, sameTable ? state.turn : null, fresh),
      };
    }
    case 'table_event': {
      const cur = state.featured;
      if (!cur || frame.event.tableId !== cur.tableId || frame.event.seq <= state.featuredSeq) return state;
      return { ...state, featuredSeq: frame.event.seq, showdown: applyTableEvents(state.showdown, [frame.event]) };
    }
    case 'tournament_event': {
      if (frame.event.seq <= state.lastTournamentSeq) return state;
      const next = { ...state, tournament: frame.summary ?? state.tournament, lastTournamentSeq: frame.event.seq };
      return withStatus(applyTournamentEvent(next, frame.event, at), state);
    }
    case 'tournament_summary': {
      if (state.tournament && state.tournament.lastSeq > frame.summary.lastSeq) return state;
      return withStatus({ ...state, tournament: frame.summary, lastTournamentSeq: Math.max(state.lastTournamentSeq, frame.summary.lastSeq) }, state);
    }
    case 'display_scene':
      return { ...state, adminScene: { scene: parseAdminScene(frame.scene), tableId: frame.tableId, at } };
    case 'error':
      return { ...state, error: { code: frame.code, message: frame.message } };
    default:
      return state;
  }
}

/** Unknown scene names fall back to auto-rotation (forward compatible with new admin scenes). */
export function parseAdminScene(scene: string): AdminScene {
  const s = scene.trim().toUpperCase();
  return (SCENES as readonly string[]).includes(s) ? (s as AdminScene) : 'AUTO';
}

/** Keeps pause / champion state consistent with the authoritative tournament status. */
function withStatus(next: DisplayState, prev: DisplayState): DisplayState {
  const status = next.tournament?.status;
  let out = next;
  if (status !== 'PAUSED' && out.pause) out = { ...out, pause: null };
  if (status === 'PAUSED' && !out.pause) out = { ...out, pause: { mode: 'AFTER_HAND', reason: null } };
  if (status === 'FINAL_TABLE' && !out.finalTableId && out.featured) out = { ...out, finalTableId: out.featured.tableId };
  if (status === 'COMPLETED' && prev.tournament?.status !== 'COMPLETED' && out.adminScene) out = { ...out, adminScene: null };
  return out;
}

function applyTournamentEvent(state: DisplayState, env: TournamentEventEnvelope, at: number): DisplayState {
  const e = env.event;
  const ticker = tickerItemFor(env);
  const paid = state.info?.places.length ?? 0;
  const splash = splashFor(env, at, paid);
  let s: DisplayState = {
    ...state,
    ticker: ticker ? [...state.ticker, ticker].slice(-MAX_TICKER) : state.ticker,
    splashes: splash ? queueSplash(state.splashes, splash) : state.splashes,
  };
  switch (e.kind) {
    case 'PLAYER_ELIMINATED': {
      const elim: EliminationItem = {
        id: `e${env.seq}`,
        playerId: e.record.playerId,
        displayName: e.displayName,
        finishPosition: e.record.finishPosition,
        tiedCount: e.record.tiedCount,
        playersRemaining: e.playersRemaining,
        at: env.at,
      };
      s = { ...s, eliminations: [elim, ...s.eliminations].slice(0, MAX_ELIMINATIONS) };
      break;
    }
    case 'TOURNAMENT_PAUSED':
      s = { ...s, pause: { mode: e.mode, reason: e.reason } };
      break;
    case 'TOURNAMENT_RESUMED':
      s = { ...s, pause: null };
      break;
    case 'BREAK_STARTED':
      s = { ...s, breakMessage: e.message };
      break;
    case 'BREAK_ENDED':
      s = { ...s, breakMessage: null };
      break;
    case 'FINAL_TABLE_FORMED':
      s = { ...s, finalTableId: e.tableId };
      break;
    case 'ANNOUNCEMENT':
      s = { ...s, announcement: { id: `a${env.seq}`, text: e.text, from: e.from, at } };
      break;
    case 'TOURNAMENT_COMPLETED':
      s = { ...s, champion: { playerId: e.winnerId, name: e.winnerName } };
      break;
    default:
      break;
  }
  return s;
}

/** Hand-for-hand is announced twice on the bubble (milestone + switch): one splash is enough. */
function queueSplash(queue: DisplayState['splashes'], splash: DisplayState['splashes'][number]): DisplayState['splashes'] {
  if (splash.kind === 'HAND_FOR_HAND' && queue.some((q) => q.tone === 'warning')) return queue;
  return [...queue, splash].slice(-MAX_SPLASHES);
}

/** Showdown reveals and pot winners of the featured table's current/last hand. */
export function applyTableEvents(showdown: ShowdownState | null, events: TableEvent[]): ShowdownState | null {
  let s = showdown;
  for (const te of events) {
    const e = te.event;
    switch (e.kind) {
      case 'HAND_STARTED':
        s = null;
        break;
      case 'SHOWDOWN': {
        const reveals: Record<number, string> = { ...(s?.reveals ?? {}) };
        for (const r of e.reveals) if (r.hand && !r.mucked) reveals[r.seat] = r.hand.description;
        s = { ...(s ?? emptyShowdown()), reveals };
        break;
      }
      case 'POT_AWARDED': {
        const base = s ?? emptyShowdown();
        const winners = { ...base.winners };
        for (const w of e.winners) winners[w.seat] = (winners[w.seat] ?? 0) + w.amount;
        const first = e.potIndex === 0 || base.bestFive.length === 0;
        s = {
          ...base,
          winners,
          bestFive: first && e.winningHand ? e.winningHand.bestFive : base.bestFive,
          description: first && e.winningHand ? e.winningHand.description : base.description,
        };
        break;
      }
      case 'HAND_COMPLETED':
        s = { ...(s ?? emptyShowdown()), handNumber: e.handNumber, board: e.board, complete: true };
        break;
      default:
        break;
    }
  }
  return s;
}

function emptyShowdown(): ShowdownState {
  return { handNumber: 0, board: [], winners: {}, bestFive: [], description: null, reveals: {}, complete: false };
}

/**
 * The acting seat's timer: deadline from the view, total from the latest
 * ACTION_REQUESTED (timerMs), else from the first time this turn was seen.
 */
export function turnFrom(view: SpectatorTableView | null, prev: TurnState | null, events: TableEvent[]): TurnState | null {
  const hand = view?.hand;
  if (!view || !hand || hand.actingSeat === null || hand.actionDeadline === null) return null;
  let requested: number | null = null;
  for (const te of events) {
    if (te.event.kind === 'ACTION_REQUESTED' && te.event.seat === hand.actingSeat) requested = te.event.timerMs;
  }
  if (requested !== null) return { seat: hand.actingSeat, deadline: hand.actionDeadline, totalMs: Math.max(1, requested) };
  if (prev && prev.seat === hand.actingSeat && prev.deadline === hand.actionDeadline) return prev;
  if (prev && prev.seat === hand.actingSeat) return { ...prev, deadline: hand.actionDeadline };
  return { seat: hand.actingSeat, deadline: hand.actionDeadline, totalMs: Math.max(1, hand.actionDeadline - view.serverTime) };
}
