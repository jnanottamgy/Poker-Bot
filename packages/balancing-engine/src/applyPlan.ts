import type { SeatSummary, TableId, TableSummary } from '@jpb/shared-types';
import type { BalancePlan, MoveAction } from './types';

/** recentMovesAtHand entries kept per player by completePlan (older moves are far outside any sane window). */
export const MAX_RECENT_MOVES_KEPT = 16;

function cloneTable(t: TableSummary): TableSummary {
  return { ...t, seats: t.seats.slice(), reservedSeats: t.reservedSeats.slice() };
}

function working(tables: readonly TableSummary[]): { list: TableSummary[]; byId: Map<TableId, TableSummary> } {
  const list = tables.map(cloneTable);
  const byId = new Map<TableId, TableSummary>();
  for (const t of list) {
    if (byId.has(t.tableId)) throw new Error(`duplicate table ${t.tableId}`);
    byId.set(t.tableId, t);
  }
  return { list, byId };
}

function mustGet(byId: Map<TableId, TableSummary>, tableId: TableId): TableSummary {
  const t = byId.get(tableId);
  if (t === undefined) throw new Error(`plan references unknown table ${tableId}`);
  return t;
}

function sourceSeat(source: TableSummary, move: MoveAction): SeatSummary {
  const s = source.seats.find((x) => x.playerId === move.playerId);
  if (s === undefined || s.seat !== move.fromSeat) {
    throw new Error(`player ${move.playerId} is not in seat ${move.fromSeat} of ${source.tableId}`);
  }
  return s;
}

/**
 * The state right after the director issues the plan (moves in flight): each
 * moving player is flagged `movingOut` at the source, each destination seat is
 * reserved, each broken table becomes BREAKING. FORM_FINAL_TABLE is left to
 * the director. Returns new summaries; inputs are not mutated.
 */
export function markPlanInFlight(tables: readonly TableSummary[], plan: BalancePlan): TableSummary[] {
  const { list, byId } = working(tables);
  for (const action of plan.actions) {
    if (action.type === 'BREAK_TABLE') {
      mustGet(byId, action.tableId).status = 'BREAKING';
    } else if (action.type === 'MOVE') {
      const source = mustGet(byId, action.fromTableId);
      const dest = mustGet(byId, action.toTableId);
      const seat = sourceSeat(source, action);
      if (seat.movingOut === true) throw new Error(`player ${action.playerId} is already moving`);
      if (dest.reservedSeats.includes(action.toSeat) || dest.seats.some((s) => s.seat === action.toSeat)) {
        throw new Error(`seat ${action.toSeat} of ${dest.tableId} is not free`);
      }
      source.seats = source.seats.map((s) => (s === seat ? { ...s, movingOut: true } : s));
      dest.reservedSeats = [...dest.reservedSeats, action.toSeat];
    }
  }
  return list;
}

/**
 * The state once every move of the plan has completed: players leave their
 * source seat and sit in the reserved destination seat (stack and stats carried
 * over, handsDealtAtTable reset to 0, the move recorded in recentMovesAtHand
 * at the player's current handsPlayedTotal), broken tables with nobody left
 * become CLOSED. Accepts the pre-plan state or the markPlanInFlight state.
 */
export function completePlan(tables: readonly TableSummary[], plan: BalancePlan): TableSummary[] {
  const { list, byId } = working(tables);
  for (const action of plan.actions) {
    if (action.type === 'BREAK_TABLE') {
      mustGet(byId, action.tableId).status = 'BREAKING';
    } else if (action.type === 'MOVE') {
      const source = mustGet(byId, action.fromTableId);
      const dest = mustGet(byId, action.toTableId);
      const seat = sourceSeat(source, action);
      if (dest.seats.some((s) => s.seat === action.toSeat)) throw new Error(`seat ${action.toSeat} of ${dest.tableId} is occupied`);
      source.seats = source.seats.filter((s) => s !== seat);
      dest.reservedSeats = dest.reservedSeats.filter((r) => r !== action.toSeat);
      const arrived: SeatSummary = {
        seat: action.toSeat,
        playerId: seat.playerId,
        stack: seat.stack,
        stats: { ...seat.stats, handsDealtAtTable: 0 },
        recentMovesAtHand: [...seat.recentMovesAtHand, seat.stats.handsPlayedTotal].slice(-MAX_RECENT_MOVES_KEPT),
      };
      dest.seats = [...dest.seats, arrived].sort((a, b) => a.seat - b.seat);
    }
  }
  for (const t of list) {
    if (t.status === 'BREAKING' && t.seats.length === 0 && t.reservedSeats.length === 0) t.status = 'CLOSED';
  }
  return list;
}
