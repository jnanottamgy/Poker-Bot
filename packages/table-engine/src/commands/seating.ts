import type { RemovalReason, SeatPositionStats, TableCommand } from '@jpb/shared-types';
import { REMOVAL_REASONS } from '../constants';
import { emit, occupantOf } from '../draft';
import type { Draft } from '../draft';
import { removeOccupant, settle } from '../lifecycle';
import { accept, reject } from '../outcome';
import type { Outcome } from '../outcome';
import { handInProgress, isDealtIn } from '../queries';
import { copyStats, isInt, isNonEmptyString, isSeatIndex, statsProblem } from '../validate';

type Cmd<T extends TableCommand['type']> = Extract<TableCommand, { type: T }>;

const isMoveId = (v: unknown): v is string | null => v === null || typeof v === 'string';

/**
 * SEAT_PLAYER. The seat must be free and the player not already at the table.
 * During a hand the player is marked waitingForNextHand (dealt in from the next hand).
 */
export function seatPlayer(d: Draft, c: Cmd<'SEAT_PLAYER'>): Outcome {
  if (!isNonEmptyString(c.playerId)) return reject('INVALID_COMMAND', 'playerId must be a non-empty string');
  if (typeof c.displayName !== 'string' || typeof c.publicId !== 'string') {
    return reject('INVALID_COMMAND', 'displayName and publicId must be strings');
  }
  if (!isInt(c.stack, 1)) return reject('INVALID_COMMAND', 'stack must be a positive integer');
  const statsBad = statsProblem(c.stats);
  if (statsBad !== null) return reject('INVALID_COMMAND', statsBad);
  if (!isMoveId(c.moveId)) return reject('INVALID_COMMAND', 'moveId must be a string or null');
  if (c.connected !== undefined && typeof c.connected !== 'boolean')
    return reject('INVALID_COMMAND', 'connected must be a boolean');
  if (!isSeatIndex(c.seat, d.s.maxSeats))
    return reject('SEAT_UNAVAILABLE', `seat must be an integer in [0, ${d.s.maxSeats - 1}]`);
  if (d.s.seats[c.seat] !== null) return reject('SEAT_UNAVAILABLE', `seat ${c.seat} is occupied`);
  if (occupantOf(d.s, c.playerId) !== null)
    return reject('PLAYER_ALREADY_SEATED', 'player is already seated at this table');

  d.s.seats[c.seat] = {
    playerId: c.playerId,
    displayName: c.displayName,
    publicId: c.publicId,
    stack: c.stack,
    connected: c.connected ?? true,
    consecutiveTimeouts: 0,
    waitingForNextHand: handInProgress(d.s),
    pendingRemoval: null,
    stats: copyStats(c.stats as SeatPositionStats),
  };
  d.s.counters.playersSeated += 1;
  emit(d, {
    kind: 'PLAYER_SEATED',
    seat: c.seat,
    playerId: c.playerId,
    displayName: c.displayName,
    publicId: c.publicId,
    stack: c.stack,
    moveId: c.moveId,
  });
  settle(d, d.s.timing.betweenHandsDelayMs);
  return accept();
}

/**
 * REMOVE_PLAYER. A player dealt into the hand in progress gets pendingRemoval
 * (applied right after HAND_COMPLETED; a later REMOVE_PLAYER replaces the
 * reason). Otherwise the player leaves now with PLAYER_REMOVED carrying the
 * exact stack.
 */
export function removePlayer(d: Draft, c: Cmd<'REMOVE_PLAYER'>): Outcome {
  if (!isNonEmptyString(c.playerId)) return reject('INVALID_COMMAND', 'playerId must be a non-empty string');
  if (typeof c.reason !== 'string' || !REMOVAL_REASONS.includes(c.reason as RemovalReason)) {
    return reject('INVALID_COMMAND', 'reason is invalid');
  }
  if (!isMoveId(c.moveId)) return reject('INVALID_COMMAND', 'moveId must be a string or null');
  const found = occupantOf(d.s, c.playerId);
  if (found === null) return reject('PLAYER_NOT_SEATED', 'player is not seated at this table');
  if (isDealtIn(d.s, c.playerId)) {
    found.occ.pendingRemoval = { reason: c.reason, moveId: c.moveId };
    return accept('removal pending until the hand completes');
  }
  removeOccupant(d, found.seat, c.reason, c.moveId);
  settle(d, d.s.timing.betweenHandsDelayMs);
  return accept();
}

/** PLAYER_CONNECTION. A reconnect also resets consecutiveTimeouts (the player is back, not away). */
export function playerConnection(d: Draft, c: Cmd<'PLAYER_CONNECTION'>): Outcome {
  if (!isNonEmptyString(c.playerId) || typeof c.connected !== 'boolean') {
    return reject('INVALID_COMMAND', 'playerId and connected are required');
  }
  const found = occupantOf(d.s, c.playerId);
  if (found === null) return reject('PLAYER_NOT_SEATED', 'player is not seated at this table');
  if (found.occ.connected === c.connected) return accept('unchanged');
  found.occ.connected = c.connected;
  if (c.connected) found.occ.consecutiveTimeouts = 0;
  emit(d, { kind: 'PLAYER_CONNECTION_CHANGED', seat: found.seat, playerId: c.playerId, connected: c.connected });
  return accept();
}

/** ADMIN_ADJUST_STACK: between hands only; the new stack must be a positive integer. */
export function adjustStack(d: Draft, c: Cmd<'ADMIN_ADJUST_STACK'>): Outcome {
  if (!isNonEmptyString(c.playerId)) return reject('INVALID_COMMAND', 'playerId must be a non-empty string');
  if (!isInt(c.newStack, 1)) {
    return reject('INVALID_COMMAND', 'newStack must be a positive integer (use REMOVE_PLAYER to take a player out)');
  }
  if (handInProgress(d.s)) return reject('HAND_IN_PROGRESS', 'stacks can only be adjusted between hands');
  const found = occupantOf(d.s, c.playerId);
  if (found === null) return reject('PLAYER_NOT_SEATED', 'player is not seated at this table');
  const before = found.occ.stack;
  found.occ.stack = c.newStack;
  emit(d, { kind: 'STACK_ADJUSTED', seat: found.seat, playerId: c.playerId, before, after: c.newStack });
  return accept();
}
