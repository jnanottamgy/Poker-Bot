import type { SeatIndex, TableId } from '@jpb/shared-types';
import { initialSeating } from '@jpb/seating-engine';
import { bmValues } from './bucketMap';
import type { Draft } from './draft';
import { currentBlinds, emit, fail, getTable, openTables, putPlayer, putTable, tableCommand, tableTiming, transition, ZERO_STATS } from './draft';
import { startLevel } from './clock';
import type { DirectorTable } from './types';

export function tableIdFor(tournamentId: string, tableNumber: number): TableId {
  return `${tournamentId}:T${tableNumber}`;
}

/** Creates a table actor (CREATE_TABLE effect) and its director summary. */
export function createTable(d: Draft, maxSeats: number, initialButtonSeat: SeatIndex | null, isFinalTable: boolean): DirectorTable {
  const tableNumber = d.s.seq.table + 1;
  d.s.seq = { ...d.s.seq, table: tableNumber };
  const tableId = tableIdFor(d.s.tournamentId, tableNumber);
  const table: DirectorTable = {
    summary: {
      tableId,
      tableNumber,
      maxSeats,
      status: 'ACTIVE',
      seats: [],
      reservedSeats: [],
      buttonSeat: initialButtonSeat,
      lastSmallBlindSeat: null,
      lastBigBlindSeat: null,
      handNumber: 0,
      inHand: false,
    },
    status: 'WAITING',
    holds: [],
    frozen: false,
    isFinalTable,
    chips: 0,
    lastHandAt: null,
    handsCompleted: 0,
  };
  d.effects.push({ type: 'CREATE_TABLE', tableId, tableNumber, maxSeats, initialButtonSeat, blinds: currentBlinds(d), timing: tableTiming(d), isFinalTable });
  putTable(d, table);
  d.s.counters = { ...d.s.counters, tables: d.s.counters.tables + 1 };
  emit(d, { kind: 'TABLE_CREATED', tableId, tableNumber });
  return table;
}

/**
 * START (normative): registration closes, the public entropy is frozen, every
 * REGISTERED player is seated by the seeded draw (seating-engine
 * initialSeating with drawSource('seating') and drawSource('button:{tableId}')),
 * and tables receive START when the countdown ends. With entrants <=
 * finalTableSize the single table is the final table.
 */
export function start(d: Draft, publicEntropy: string): void {
  if (d.s.status === 'REGISTRATION') transition(d, 'REGISTRATION_CLOSED', 'start requested');
  if (d.s.status !== 'REGISTRATION_CLOSED') fail('ILLEGAL_STATE', `Cannot start a tournament in ${d.s.status}.`);
  const registered = bmValues(d.s.players).filter((p) => p.status === 'REGISTERED');
  const cfg = d.s.config;
  if (registered.length < Math.max(2, cfg.minPlayers)) fail('NOT_ENOUGH_PLAYERS', `At least ${Math.max(2, cfg.minPlayers)} registered players are required.`);
  transition(d, 'STARTING', 'seating players');
  d.s.publicEntropy = publicEntropy;
  d.s.startedAt = d.now;

  const seating = initialSeating({
    playerIds: registered.map((p) => p.playerId),
    cfg: cfg.tables,
    consolidateBy: cfg.balancing.consolidateBy,
    rng: d.ctx.drawSource('seating', publicEntropy),
    buttonSource: (n) => d.ctx.drawSource(`button:${tableIdFor(d.s.tournamentId, n)}`, publicEntropy),
  });
  const byId = new Map(registered.map((p) => [p.playerId, p]));
  const single = seating.tables.length === 1 && registered.length <= cfg.tables.finalTableSize;
  for (const t of seating.tables) {
    const table = createTable(d, t.maxSeats, t.buttonSeat, single);
    const stats = { ...ZERO_STATS };
    const seats = t.seats.map(({ seat, playerId }) => ({ seat, playerId, stack: cfg.startingStack, stats, recentMovesAtHand: [] as number[] }));
    putTable(d, { ...table, summary: { ...table.summary, seats }, chips: seats.length * cfg.startingStack });
    for (const { seat, playerId } of t.seats) {
      const p = byId.get(playerId)!;
      putPlayer(d, { ...p, status: 'SEATED', tableId: table.summary.tableId, seat, stack: cfg.startingStack, stats });
      tableCommand(d, table.summary.tableId, {
        type: 'SEAT_PLAYER',
        playerId,
        displayName: p.displayName,
        publicId: p.publicId,
        seat,
        stack: cfg.startingStack,
        stats,
        moveId: null,
      });
      d.effects.push({ type: 'NOTIFY_PLAYER', playerId, notice: { kind: 'TABLE_MOVE', fromTableNumber: null, fromSeat: null, toTableNumber: table.summary.tableNumber, toSeat: seat, stack: cfg.startingStack } });
    }
  }
  const total = registered.length * cfg.startingStack;
  d.s.counters = { ...d.s.counters, active: registered.length, totalChips: total };
  d.s.chipsAtTables = total;
  if (single) d.s.finalTable = { ...d.s.finalTable, formed: true, tableId: tableIdFor(d.s.tournamentId, 1), formedAt: d.now };
  d.s.clock = { ...d.s.clock, startAt: d.now + cfg.timing.startCountdownSeconds * 1000 };
}

/** Countdown over: tables deal, level 1 starts. */
export function goLive(d: Draft): void {
  const single = d.s.finalTable.formed;
  transition(d, single ? 'FINAL_TABLE' : 'RUNNING', 'tournament started');
  d.s.clock = { ...d.s.clock, startAt: null };
  for (const t of openTables(d)) tableCommand(d, t.summary.tableId, { type: 'START' });
  startLevel(d, 0);
  if (single) {
    const t = getTable(d, d.s.finalTable.tableId!);
    if (t) {
      emit(d, {
        kind: 'FINAL_TABLE_FORMED',
        tableId: t.summary.tableId,
        players: t.summary.seats.map((s) => ({ playerId: s.playerId, displayName: s.playerId, seat: s.seat, stack: s.stack })),
      });
    }
  }
}
