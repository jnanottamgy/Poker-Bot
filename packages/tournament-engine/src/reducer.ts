import type { Draft } from './draft';
import { beginDraft, DirectorError, flushDraft, OK } from './draft';
import type { DirectorContext, DirectorInput, DirectorReply, DirectorState, DirectorTransition } from './types';
import { advanceClockIfDue, nextTickAt } from './clock';
import { approve, closeRegistration, openRegistration, register, reopenRegistration, withdraw } from './registration';
import { goLive, start } from './start';
import { onCommandFailed, onHandResult, onPlayerRemoved, onPlayerSeated, onStackAdjusted, onStatusChanged } from './reports';
import * as admin from './admin';
import { lateRegister, reenter } from './late';
import { assignDeferredPositions } from './eliminations';
import { ensureProgress } from './balance';

/**
 * Johnny — the algorithmic Tournament Director. A pure reducer: the same
 * state + input + context always yields the same transition. Illegal inputs
 * are answered with a reply code and change nothing.
 */
export function directorReduce(state: DirectorState, input: DirectorInput, ctx: DirectorContext): DirectorTransition {
  const tickBefore = nextTickAt(state);
  const d = beginDraft(state, ctx);
  try {
    dispatch(d, input);
    ensureProgress(d);
  } catch (err) {
    if (err instanceof DirectorError) {
      return { state, effects: [], events: [], reply: { ok: false, code: err.code, message: err.message } };
    }
    throw err;
  }
  const next = flushDraft(d);
  const tickAfter = nextTickAt(next);
  if (tickAfter !== tickBefore) d.effects.push({ type: 'SCHEDULE_TICK', at: tickAfter });
  return { state: next, effects: d.effects, events: d.events, reply: OK satisfies DirectorReply };
}

function dispatch(d: Draft, i: DirectorInput): void {
  switch (i.type) {
    case 'OPEN_REGISTRATION':
      return openRegistration(d);
    case 'CLOSE_REGISTRATION':
      return closeRegistration(d);
    case 'REOPEN_REGISTRATION':
      return reopenRegistration(d);
    case 'REGISTER_PLAYER':
      if (d.s.status === 'REGISTRATION') return register(d, i);
      return lateRegister(d, i);
    case 'APPROVE_PLAYER':
      return approve(d, i.playerId);
    case 'REJECT_PLAYER':
    case 'WITHDRAW_PLAYER':
      return withdraw(d, i.playerId);
    case 'REENTER_PLAYER':
      return reenter(d, i.playerId, i.entryId);
    case 'START':
      return start(d, i.publicEntropy);
    case 'TICK':
      return tick(d);
    case 'TABLE_HAND_RESULT':
      return onHandResult(d, i.report);
    case 'TABLE_PLAYER_REMOVED':
      return onPlayerRemoved(d, i);
    case 'TABLE_PLAYER_SEATED':
      return onPlayerSeated(d, i);
    case 'TABLE_STATUS_CHANGED':
      return onStatusChanged(d, i);
    case 'TABLE_STACK_ADJUSTED':
      return onStackAdjusted(d, i);
    case 'TABLE_COMMAND_FAILED':
      return onCommandFailed(d, i);
    case 'PAUSE':
      return admin.pause(d);
    case 'RESUME':
      return admin.resume(d);
    case 'FREEZE':
      return admin.freeze(d);
    case 'UNFREEZE':
      return admin.unfreeze(d);
    case 'ADVANCE_LEVEL':
      return admin.advanceLevel(d);
    case 'SET_LEVEL':
      return admin.setLevel(d, i.level);
    case 'ADD_TIME':
      return admin.addTime(d, i.ms);
    case 'START_BREAK':
      return admin.adminStartBreak(d, i.durationSeconds);
    case 'END_BREAK':
      return admin.adminEndBreak(d);
    case 'SET_HAND_FOR_HAND':
      return admin.setHandForHand(d, i.enabled);
    case 'MOVE_PLAYER':
      return admin.movePlayer(d, i.playerId, i.toTableId, i.toSeat);
    case 'REBALANCE':
      return admin.adminRebalance(d);
    case 'BREAK_TABLE':
      return admin.breakTable(d, i.tableId);
    case 'HOLD_TABLE':
      return admin.tableAdmin(d, i.tableId, 'HOLD');
    case 'RELEASE_TABLE':
      return admin.tableAdmin(d, i.tableId, 'RELEASE');
    case 'FREEZE_TABLE':
      return admin.tableAdmin(d, i.tableId, 'FREEZE');
    case 'UNFREEZE_TABLE':
      return admin.tableAdmin(d, i.tableId, 'UNFREEZE');
    case 'FORCE_TIMEOUT':
      return admin.forceTimeout(d, i.tableId, i.turnVersion);
    case 'TABLE_ADD_TIME':
      return admin.tableAddTime(d, i.tableId, i.ms);
    case 'SUSPEND_PLAYER':
      return admin.suspend(d, i.playerId, true);
    case 'RESTORE_PLAYER':
      return admin.suspend(d, i.playerId, false);
    case 'DISQUALIFY_PLAYER':
      return admin.disqualify(d, i.playerId);
    case 'ADJUST_STACK':
      return admin.adjustStack(d, i.playerId, i.newStack);
    case 'ANNOUNCE':
      return admin.announce(d, i.text);
    case 'SET_FEATURED_TABLE':
      return admin.setFeatured(d, i.tableId);
    case 'UPDATE_SCHEDULE':
      return admin.updateSchedule(d, i.blindSchedule, i.breaks);
    case 'UPDATE_TIMING':
      return admin.updateTiming(d, i.timing);
    case 'SET_CONFIG':
      return admin.setConfig(d, i.config);
    case 'SET_POLICIES':
      return admin.setPolicies(d, i.spectators, i.features);
    case 'CANCEL':
      return admin.cancel(d);
    default: {
      const never: never = i;
      throw new DirectorError('UNKNOWN_INPUT', `Unknown input ${(never as { type: string }).type}`);
    }
  }
}

function tick(d: Draft): void {
  const s = d.s;
  if (s.status === 'STARTING' && s.clock.startAt !== null && d.now >= s.clock.startAt) goLive(d);
  if (s.status === 'REGISTRATION' && s.config.registrationDeadline !== null && d.now >= s.config.registrationDeadline) closeRegistration(d);
  const levelBefore = d.s.clock.levelIndex;
  advanceClockIfDue(d);
  if (d.s.clock.levelIndex !== levelBefore) assignDeferredPositions(d);
}
