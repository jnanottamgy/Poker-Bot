import type { CardCode, CommandReply, TableCommand, TableCommandEnvelope } from '@jpb/shared-types';
import {
  addTime,
  close,
  forceTimeout,
  freeze,
  hold,
  release,
  setBlinds,
  setHandForHand,
  setTiming,
  start,
  unfreeze,
} from './commands/control';
import { playerAction, timerFired } from './commands/play';
import { adjustStack, playerConnection, removePlayer, seatPlayer } from './commands/seating';
import { RECENT_ACTION_CAPACITY } from './constants';
import { announce, beginDraft } from './draft';
import type { Draft } from './draft';
import { reject, toReply } from './outcome';
import type { Outcome } from './outcome';
import type { RecentAction, TableContext, TableState, TableTransition } from './types';
import { isInt, isNonEmptyString, isObject } from './validate';

const unchanged = (state: TableState, reply: CommandReply | null): TableTransition => ({
  state,
  events: [],
  timers: [],
  reply,
});

const replyOf = (o: Outcome): CommandReply => toReply(o);

function finish(d: Draft, reply: CommandReply | null): TableTransition {
  announce(d);
  return { state: d.s, events: d.events, timers: d.timers, reply };
}

/** Remembers a processed actionId (accepted or rejected), keeping the newest RECENT_ACTION_CAPACITY. */
function remember(list: readonly RecentAction[], entry: RecentAction): RecentAction[] {
  const next = [...list, entry];
  return next.length > RECENT_ACTION_CAPACITY ? next.slice(next.length - RECENT_ACTION_CAPACITY) : next;
}

function envelopeProblem(state: TableState, env: unknown): string | null {
  if (!isObject(env)) return 'envelope must be an object';
  if (env.tableId !== state.tableId) return `envelope is for table ${String(env.tableId)}, not ${state.tableId}`;
  if (!isInt(env.at, 0)) return 'envelope.at must be a non-negative integer (epoch ms)';
  if (!isObject(env.command) || typeof env.command.type !== 'string') return 'envelope.command must have a type';
  return null;
}

function dispatch(d: Draft, c: TableCommand, deckFor: (n: number) => CardCode[]): Outcome {
  switch (c.type) {
    case 'SEAT_PLAYER':
      return seatPlayer(d, c);
    case 'REMOVE_PLAYER':
      return removePlayer(d, c);
    case 'SET_BLINDS':
      return setBlinds(d, c);
    case 'SET_TIMING':
      return setTiming(d, c);
    case 'HOLD':
      return hold(d, c);
    case 'RELEASE':
      return release(d, c);
    case 'SET_HAND_FOR_HAND':
      return setHandForHand(d, c);
    case 'FREEZE':
      return freeze(d);
    case 'UNFREEZE':
      return unfreeze(d);
    case 'PLAYER_ACTION':
      return playerAction(d, c);
    case 'PLAYER_CONNECTION':
      return playerConnection(d, c);
    case 'ADMIN_FORCE_TIMEOUT':
      return forceTimeout(d);
    case 'ADMIN_ADJUST_STACK':
      return adjustStack(d, c);
    case 'ADMIN_ADD_TIME':
      return addTime(d, c);
    case 'START':
      return start(d, deckFor);
    case 'CLOSE':
      return close(d);
    case 'TIMER_FIRED':
      throw new Error('TIMER_FIRED is handled by reduceTable');
    default:
      return reject('INVALID_COMMAND', `unknown command type ${String((c as { type: unknown }).type)}`);
  }
}

/**
 * The table actor reducer (CONTRACTS §4). Pure: never mutates `state`, never
 * reads the clock (time = envelope.at, clamped to be non-decreasing), never
 * throws on bad commands (typed replies), throws only on internal bugs.
 *
 * - Accepted command: version + 1, events with gap-free seqs, timers, reply ok.
 * - Rejected command: state unchanged (except that a PLAYER_ACTION's actionId
 *   and reply are remembered for idempotency), no events, reply with a code.
 * - TIMER_FIRED: reply null; a stale/frozen/closed timer changes nothing.
 */
export function reduceTable(state: TableState, envelope: TableCommandEnvelope, ctx: TableContext): TableTransition {
  const problem = envelopeProblem(state, envelope);
  if (problem !== null) return unchanged(state, replyOf(reject('INVALID_COMMAND', problem)));
  const c = envelope.command;
  const now = Math.max(envelope.at, state.clock);
  const deckFor = (n: number): CardCode[] => ctx.deckFor(n);

  if (c.type === 'TIMER_FIRED') {
    const d = beginDraft(state, now);
    const t = timerFired(d, c, deckFor);
    if (t.kind === 'applied') return finish(d, null);
    if (t.kind === 'premature')
      return { state, events: [], timers: [{ kind: c.kind, at: t.at, token: t.token }], reply: null };
    return unchanged(state, null);
  }

  if (c.type === 'PLAYER_ACTION') {
    if (!isNonEmptyString(c.actionId) || !isNonEmptyString(c.playerId)) {
      return unchanged(state, replyOf(reject('INVALID_COMMAND', 'actionId and playerId must be non-empty strings')));
    }
    const seen = state.recentActions.find((a) => a.actionId === c.actionId && a.playerId === c.playerId);
    if (seen !== undefined) return unchanged(state, { ...seen.reply, duplicate: true });
  }

  let outcome: Outcome;
  let d: Draft | null = null;
  if (state.status === 'CLOSED') {
    outcome = reject('TABLE_CLOSED', 'the table is closed');
  } else {
    d = beginDraft(state, now);
    outcome = dispatch(d, c, deckFor);
  }
  const reply = replyOf(outcome);

  if (c.type === 'PLAYER_ACTION') {
    const entry: RecentAction = { playerId: c.playerId, actionId: c.actionId, reply };
    if (!outcome.ok || d === null) {
      return unchanged({ ...state, recentActions: remember(state.recentActions, entry) }, reply);
    }
    d.s.recentActions = remember(d.s.recentActions, entry);
    return finish(d, reply);
  }
  if (!outcome.ok || d === null) return unchanged(state, reply);
  return finish(d, reply);
}
