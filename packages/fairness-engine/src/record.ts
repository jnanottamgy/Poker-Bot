/**
 * HandFairnessRecord helpers: structural validation of untrusted JSON and
 * redaction of private cards before publication.
 */
import type { HandFairnessRecord, HandFairnessSeat, SeatIndex } from '@jpb/shared-types';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

function seatEntryProblem(entry: unknown, index: number): string | null {
  const where = `holeCards[${index}]`;
  if (!isObject(entry)) return `${where} must be an object`;
  if (typeof entry.seat !== 'number') return `${where}.seat must be a number`;
  if (typeof entry.playerId !== 'string') return `${where}.playerId must be a string`;
  if (entry.cards !== null && !(isStringArray(entry.cards) && entry.cards.length === 2))
    return `${where}.cards must be null or two card codes`;
  return null;
}

/**
 * Structural (type-level) problems of an untrusted value claimed to be a
 * HandFairnessRecord. Value-level rules (hex formats, seat ranges, card
 * validity, dealing order) are judged by `verifyHand` as check results.
 */
export function recordShapeProblems(value: unknown): string[] {
  if (!isObject(value)) return ['record must be an object'];
  const problems: string[] = [];
  for (const key of [
    'scheme',
    'tournamentId',
    'tableId',
    'handId',
    'publicEntropy',
    'serverSeedHash',
    'deckHash',
  ] as const) {
    if (typeof value[key] !== 'string') problems.push(`${key} must be a string`);
  }
  for (const key of ['handNumber', 'maxSeats', 'buttonSeat'] as const) {
    if (typeof value[key] !== 'number') problems.push(`${key} must be a number`);
  }
  if (!Array.isArray(value.holeCards)) {
    problems.push('holeCards must be an array');
  } else {
    value.holeCards.forEach((entry, i) => {
      const p = seatEntryProblem(entry, i);
      if (p !== null) problems.push(p);
    });
  }
  if (!isStringArray(value.board)) problems.push('board must be an array of card codes');
  if (value.burns !== null && !isStringArray(value.burns))
    problems.push('burns must be null or an array of card codes');
  return problems;
}

/** Type guard: structurally a HandFairnessRecord (values not yet verified). */
export function isHandFairnessRecord(value: unknown): value is HandFairnessRecord {
  return recordShapeProblems(value).length === 0;
}

export interface RedactionPolicy {
  /** Seats whose hole cards stay visible: all, none, or the listed seats (e.g. the viewer's own seat and cards shown at showdown). */
  revealSeats: 'ALL' | 'NONE' | readonly SeatIndex[];
  /** Keep the burn cards (otherwise `burns` becomes null). */
  includeBurns: boolean;
}

/**
 * A deep copy of `record` with private data withheld according to `policy`.
 * Withheld hole cards become `cards: null`; the seat list itself is never
 * removed because the board positions depend on the number of dealt-in seats.
 */
export function redactHandFairnessRecord(record: HandFairnessRecord, policy: RedactionPolicy): HandFairnessRecord {
  const keep = (seat: SeatIndex): boolean =>
    policy.revealSeats === 'ALL' ? true : policy.revealSeats === 'NONE' ? false : policy.revealSeats.includes(seat);
  const holeCards: HandFairnessSeat[] = record.holeCards.map((h) => ({
    seat: h.seat,
    playerId: h.playerId,
    cards: h.cards !== null && keep(h.seat) ? [h.cards[0], h.cards[1]] : null,
  }));
  return {
    ...record,
    holeCards,
    board: record.board.slice(),
    burns: policy.includeBurns && record.burns !== null ? record.burns.slice() : null,
  };
}
