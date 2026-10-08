import type { SeatIndex, SeatSummary, TableSummary } from '@jpb/shared-types';

/**
 * Derived views of a TableSummary shared by seating and balancing.
 *
 *  - seated:        every SeatSummary (the seat is physically taken).
 *  - staying:       seated players without `movingOut`.
 *  - participants:  seats expected to be dealt into the next hand =
 *                   staying seats ∪ reservedSeats (players in transit here are
 *                   assumed to arrive before that hand).
 *  - effective size = |staying| + |reservedSeats| (what balancing counts).
 */

export function isMovingOut(seat: SeatSummary): boolean {
  return seat.movingOut === true;
}

/** Seated players that are not already on their way out (candidates to move). */
export function stayingPlayers(table: TableSummary): SeatSummary[] {
  return table.seats.filter((s) => !isMovingOut(s));
}

/** Players this table will have once in-flight moves complete. */
export function effectivePlayerCount(table: TableSummary): number {
  let staying = 0;
  for (const s of table.seats) if (!isMovingOut(s)) staying += 1;
  return staying + table.reservedSeats.length;
}

/** Sorted, de-duplicated seats expected to be dealt into the next hand. */
export function nextHandParticipants(table: TableSummary): SeatIndex[] {
  const set = new Set<SeatIndex>(table.reservedSeats);
  for (const s of table.seats) if (!isMovingOut(s)) set.add(s.seat);
  return [...set].sort((a, b) => a - b);
}

/** Sorted seats that are taken right now (all seated players, including those moving out). */
export function seatedSeats(table: TableSummary): SeatIndex[] {
  return table.seats.map((s) => s.seat).sort((a, b) => a - b);
}

/** Seats that may be assigned to an incoming player: not occupied (by anyone) and not reserved. */
export function freeSeats(table: TableSummary): SeatIndex[] {
  const taken = new Array<boolean>(table.maxSeats).fill(false);
  for (const s of table.seats) if (s.seat >= 0 && s.seat < table.maxSeats) taken[s.seat] = true;
  for (const r of table.reservedSeats) if (r >= 0 && r < table.maxSeats) taken[r] = true;
  const free: SeatIndex[] = [];
  for (let seat = 0; seat < table.maxSeats; seat += 1) if (!taken[seat]) free.push(seat);
  return free;
}

export function hasFreeSeat(table: TableSummary): boolean {
  return freeSeats(table).length > 0;
}

function isSeatIndex(seat: unknown, maxSeats: number): boolean {
  return typeof seat === 'number' && Number.isSafeInteger(seat) && seat >= 0 && seat < maxSeats;
}

function isCount(n: unknown): boolean {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
}

/**
 * Structural invariants of a TableSummary (empty when healthy): seat indices in
 * range, no seat or player listed twice, reserved seats unique and not
 * occupied, blind seats null or in range, stats non-negative integers.
 */
export function checkTableSummary(table: TableSummary): string[] {
  const problems: string[] = [];
  const id = table.tableId;
  if (!Number.isSafeInteger(table.maxSeats) || table.maxSeats < 1) {
    problems.push(`${id}: maxSeats ${table.maxSeats} is not a positive integer`);
    return problems;
  }
  const seatSeen = new Set<SeatIndex>();
  const playerSeen = new Set<string>();
  for (const s of table.seats) {
    if (!isSeatIndex(s.seat, table.maxSeats)) problems.push(`${id}: seat ${s.seat} out of range`);
    if (seatSeen.has(s.seat)) problems.push(`${id}: seat ${s.seat} listed twice`);
    seatSeen.add(s.seat);
    if (playerSeen.has(s.playerId)) problems.push(`${id}: player ${s.playerId} seated twice`);
    playerSeen.add(s.playerId);
    if (!isCount(s.stack)) problems.push(`${id}: player ${s.playerId} has invalid stack ${s.stack}`);
    const st = s.stats;
    for (const [key, value] of Object.entries(st)) {
      if (!isCount(value)) problems.push(`${id}: player ${s.playerId} stats.${key} invalid (${String(value)})`);
    }
    for (const m of s.recentMovesAtHand) {
      if (!isCount(m)) problems.push(`${id}: player ${s.playerId} recentMovesAtHand entry ${m} invalid`);
    }
  }
  const reservedSeen = new Set<SeatIndex>();
  for (const r of table.reservedSeats) {
    if (!isSeatIndex(r, table.maxSeats)) problems.push(`${id}: reserved seat ${r} out of range`);
    if (reservedSeen.has(r)) problems.push(`${id}: reserved seat ${r} listed twice`);
    if (seatSeen.has(r)) problems.push(`${id}: reserved seat ${r} is occupied`);
    reservedSeen.add(r);
  }
  for (const key of ['buttonSeat', 'lastSmallBlindSeat', 'lastBigBlindSeat'] as const) {
    const v = table[key];
    if (v !== null && !isSeatIndex(v, table.maxSeats)) problems.push(`${id}: ${key} ${v} out of range`);
  }
  return problems;
}
