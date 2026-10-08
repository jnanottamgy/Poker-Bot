import { handEventVisibility } from '@jpb/shared-types';
import type {
  EpochMs,
  HandEvent,
  HoldReason,
  PlayerId,
  SeatIndex,
  SeatOccupant,
  TableEvent,
  TableEventPayload,
  TableLevelEvent,
  TableStatus,
  TableTimerKind,
  TableTimerRequest,
} from '@jpb/shared-types';
import type { TableState } from './types';

/**
 * A working copy of the table for one command.
 *
 * Copy-on-write: the top level, the seat occupants and the small mutable
 * records (holds, frozen, turn, nextHand, counters) are copied; large values
 * (hand state, history, recent actions/hands, blinds, timing) are shared with
 * the input and only ever REPLACED, never mutated. The input state is
 * therefore never modified (tests deep-freeze it to prove this).
 */
export interface Draft {
  s: TableState;
  now: EpochMs;
  events: TableEvent[];
  timers: TableTimerRequest[];
  /** (status, holds, frozen) as last announced by TABLE_STATUS_CHANGED. */
  announced: string;
}

function copyOccupant(o: SeatOccupant): SeatOccupant {
  return {
    ...o,
    stats: { ...o.stats },
    pendingRemoval: o.pendingRemoval === null ? null : { ...o.pendingRemoval },
  };
}

export function statusKey(s: Pick<TableState, 'status' | 'holds' | 'frozen'>): string {
  return `${s.status}|${s.holds.join(',')}|${s.frozen !== null}`;
}

/** Starts an accepted command: the draft already carries the incremented version. */
export function beginDraft(state: TableState, now: EpochMs): Draft {
  const s: TableState = {
    ...state,
    seats: state.seats.map((o) => (o === null ? null : copyOccupant(o))),
    holds: [...state.holds],
    frozen: state.frozen === null ? null : { ...state.frozen },
    turn: state.turn === null ? null : { ...state.turn },
    nextHand: state.nextHand === null ? null : { ...state.nextHand },
    counters: { ...state.counters },
    version: state.version + 1,
    clock: now,
  };
  return { s, now, events: [], timers: [], announced: statusKey(state) };
}

function push(d: Draft, event: TableEventPayload, privateTo: PlayerId | null): void {
  d.events.push({
    tableId: d.s.tableId,
    tournamentId: d.s.tournamentId,
    seq: d.s.nextEventSeq,
    version: d.s.version,
    at: d.now,
    visibility: privateTo === null ? 'PUBLIC' : 'PRIVATE',
    privateTo,
    event,
  });
  d.s.nextEventSeq += 1;
}

export function emit(d: Draft, event: TableLevelEvent): void {
  push(d, event, null);
}

/** Hand events keep their poker-engine payload; HOLE_CARDS_DEALT is PRIVATE to its player. */
export function emitHandEvent(d: Draft, event: HandEvent): void {
  const priv = handEventVisibility(event) === 'PRIVATE' && event.kind === 'HOLE_CARDS_DEALT';
  push(d, event, priv ? event.playerId : null);
}

/** Emits TABLE_STATUS_CHANGED when (status, holds, frozen) differ from the last announcement. */
export function announce(d: Draft): void {
  const key = statusKey(d.s);
  if (key === d.announced) return;
  d.announced = key;
  d.s.lastProgressAt = d.now;
  emit(d, { kind: 'TABLE_STATUS_CHANGED', status: d.s.status, holds: [...d.s.holds], frozen: d.s.frozen !== null });
}

export function setStatus(d: Draft, status: TableStatus): void {
  d.s.status = status;
}

/** Mints a deterministic, never-reused timer token. */
export function mintToken(d: Draft, kind: TableTimerKind): string {
  d.s.timerSeq += 1;
  return `${d.s.tableId}/${kind === 'ACTION_TIMEOUT' ? 'A' : 'N'}/${d.s.timerSeq}`;
}

export function requestTimer(d: Draft, kind: TableTimerKind, at: EpochMs, token: string): void {
  d.timers.push({ kind, at, token });
}

export function occupantOf(s: TableState, playerId: PlayerId): { seat: SeatIndex; occ: SeatOccupant } | null {
  for (let seat = 0; seat < s.seats.length; seat += 1) {
    const occ = s.seats[seat];
    if (occ !== null && occ !== undefined && occ.playerId === playerId) return { seat, occ };
  }
  return null;
}

export function addHold(d: Draft, reason: HoldReason): boolean {
  if (d.s.holds.includes(reason)) return false;
  d.s.holds = [...d.s.holds, reason];
  return true;
}

export function removeHold(d: Draft, reason: HoldReason): boolean {
  if (!d.s.holds.includes(reason)) return false;
  d.s.holds = d.s.holds.filter((h) => h !== reason);
  return true;
}
