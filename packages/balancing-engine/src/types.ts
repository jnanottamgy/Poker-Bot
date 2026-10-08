import type { BalancingConfig, PlayerId, SeatIndex, TableId, TableSizeConfig, TableSummary } from '@jpb/shared-types';
import type { TableCountIndex } from './tableCountIndex';

export type MoveAction = {
  type: 'MOVE';
  reason: 'BALANCE' | 'TABLE_BREAK';
  playerId: PlayerId;
  fromTableId: TableId;
  /** Seat the player leaves (additive to the contract; useful for PlayerMovement.fromSeat). */
  fromSeat: SeatIndex;
  toTableId: TableId;
  /** Reserved seat at the destination (never occupied, never already reserved). */
  toSeat: SeatIndex;
  /** Auditable score breakdown: `player.*` (who moves), `seat.*` (where), `source.count`, `destination.count`. */
  breakdown: Record<string, number>;
};

export type BalanceAction = { type: 'FORM_FINAL_TABLE' } | { type: 'BREAK_TABLE'; tableId: TableId } | MoveAction;

export interface BalancePlan {
  /** computeTableCount(activePlayers) (1 once the final-table threshold is reached). */
  targetTableCount: number;
  /** In execution order. A BREAK_TABLE precedes the MOVEs that empty that table. */
  actions: BalanceAction[];
}

export interface PlanContext {
  tableCfg: TableSizeConfig;
  balancing: BalancingConfig;
  /** Players still in the tournament (seated + in transit). Drives table count and the final-table rule. */
  activePlayers: number;
  finalTableFormed: boolean;
}

export interface PlanBalanceInput extends PlanContext {
  /** Every table of the tournament (CLOSED tables are ignored). */
  tables: readonly TableSummary[];
}

export interface PlanAfterHandInput extends PlanContext {
  /** Up-to-date index of all open tables. Read-only from the caller's point of view (restored before returning). */
  index: TableCountIndex;
  /** Summary lookup; only called for the few tables the planner inspects. */
  getTable: (tableId: TableId) => TableSummary;
}

export interface PlayerToMove {
  playerId: PlayerId;
  seat: SeatIndex;
  score: number;
  breakdown: Record<string, number>;
}
