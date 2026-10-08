import type { TableEvent } from '@jpb/shared-types';
import { TABLE_STATE_SCHEMA } from './constants';
import type { CreateTableInput, TableState } from './types';
import {
  blindsProblem,
  copyBlinds,
  copyTiming,
  isInt,
  isNonEmptyString,
  isSeatIndex,
  maxSeatsProblem,
  timingProblem,
} from './validate';

function inputProblem(input: CreateTableInput): string | null {
  if (!isNonEmptyString(input.tableId)) return 'tableId must be a non-empty string';
  if (!isNonEmptyString(input.tournamentId)) return 'tournamentId must be a non-empty string';
  if (!isInt(input.tableNumber, 0)) return 'tableNumber must be a non-negative integer';
  const seats = maxSeatsProblem(input.maxSeats);
  if (seats !== null) return seats;
  if (input.initialButtonSeat !== null && !isSeatIndex(input.initialButtonSeat, input.maxSeats)) {
    return 'initialButtonSeat must be null or a seat index';
  }
  if (!isInt(input.createdAt, 0)) return 'createdAt must be a non-negative integer';
  return timingProblem(input.timing) ?? blindsProblem(input.blinds);
}

/**
 * A new, empty table in WAITING (not started). Throws RangeError on invalid
 * input (a host bug, never client input). No event is emitted: use
 * `createTable` to also obtain the TABLE_CREATED event (seq 1).
 */
export function createTableState(input: CreateTableInput): TableState {
  const problem = inputProblem(input);
  if (problem !== null) throw new RangeError(`createTableState: ${problem}`);
  return {
    schemaVersion: TABLE_STATE_SCHEMA,
    tableId: input.tableId,
    tournamentId: input.tournamentId,
    tableNumber: input.tableNumber,
    maxSeats: input.maxSeats,
    createdAt: input.createdAt,
    status: 'WAITING',
    started: false,
    holds: [],
    frozen: null,
    seats: Array.from({ length: input.maxSeats }, () => null),
    timing: copyTiming(input.timing),
    blinds: copyBlinds(input.blinds),
    pendingBlinds: null,
    handForHand: false,
    handNumber: 0,
    hand: null,
    handMeta: null,
    buttonSeat: input.initialButtonSeat,
    lastSmallBlindSeat: null,
    lastBigBlindSeat: null,
    turn: null,
    nextHand: null,
    timerSeq: 0,
    version: 0,
    nextEventSeq: 1,
    clock: input.createdAt,
    recentActions: [],
    lastProgressAt: input.createdAt,
    counters: {
      handsPlayed: 0,
      largestPot: 0,
      totalPotChips: 0,
      showdowns: 0,
      timeouts: 0,
      totalHandDurationMs: 0,
      playersSeated: 0,
      playersRemoved: 0,
      eliminations: 0,
    },
    lastHand: null,
    recentHands: [],
  };
}

/** `createTableState` plus the TABLE_CREATED event (seq 1, version 0). */
export function createTable(input: CreateTableInput): { state: TableState; events: TableEvent[] } {
  const base = createTableState(input);
  const event: TableEvent = {
    tableId: base.tableId,
    tournamentId: base.tournamentId,
    seq: base.nextEventSeq,
    version: base.version,
    at: base.createdAt,
    visibility: 'PUBLIC',
    privateTo: null,
    event: { kind: 'TABLE_CREATED', tableNumber: base.tableNumber, maxSeats: base.maxSeats },
  };
  return { state: { ...base, nextEventSeq: base.nextEventSeq + 1 }, events: [event] };
}
