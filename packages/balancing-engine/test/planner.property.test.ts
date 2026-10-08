import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { computeTableCount, effectivePlayerCount, stayingPlayers } from '@jpb/seating-engine';
import type { BalancingConfig, TableSummary } from '@jpb/shared-types';
import { completePlan, markPlanInFlight, planAfterHand, planBalance, TableCountIndex } from '../src';
import type { BalancePlan, PlanBalanceInput } from '../src';
import { activePlayersOf, balancingArb, DEFAULT_TABLE_CFG, deepFreeze, stateArb } from './fixtures';

function input(tables: TableSummary[], balancing: BalancingConfig): PlanBalanceInput {
  return { tables, tableCfg: DEFAULT_TABLE_CFG, balancing, activePlayers: activePlayersOf(tables), finalTableFormed: false };
}

/** Replays the plan step by step and checks every safety rule. */
function validatePlan(tables: readonly TableSummary[], plan: BalancePlan, maxSize: number): void {
  const byId = new Map(tables.map((t) => [t.tableId, structuredClone(t)]));
  const get = (id: string): TableSummary => {
    const t = byId.get(id);
    if (t === undefined) throw new Error(`unknown table ${id}`);
    return t;
  };
  const moved = new Set<string>();
  const broken = new Set<string>();
  for (const a of plan.actions) {
    if (a.type === 'FORM_FINAL_TABLE') {
      expect(plan.actions.length).toBe(1);
      continue;
    }
    if (a.type === 'BREAK_TABLE') {
      const t = get(a.tableId);
      expect(t.status).toBe('ACTIVE');
      expect(t.reservedSeats).toEqual([]);
      t.status = 'BREAKING';
      broken.add(a.tableId);
      continue;
    }
    const src = get(a.fromTableId);
    const dst = get(a.toTableId);
    expect(moved.has(a.playerId)).toBe(false);
    moved.add(a.playerId);
    const seat = src.seats.find((s) => s.playerId === a.playerId);
    expect(seat?.seat).toBe(a.fromSeat);
    expect(seat?.movingOut).not.toBe(true);
    expect(dst.status).toBe('ACTIVE');
    expect(a.toSeat).toBeGreaterThanOrEqual(0);
    expect(a.toSeat).toBeLessThan(dst.maxSeats);
    expect(dst.seats.some((s) => s.seat === a.toSeat)).toBe(false);
    expect(dst.reservedSeats).not.toContain(a.toSeat);
    (seat as TableSummary['seats'][number]).movingOut = true;
    dst.reservedSeats.push(a.toSeat);
    expect(effectivePlayerCount(dst)).toBeLessThanOrEqual(maxSize);
    if (a.reason === 'BALANCE') {
      expect(src.status).toBe('ACTIVE');
      expect(stayingPlayers(src).length).toBeGreaterThanOrEqual(2);
    } else {
      expect(src.status).toBe('BREAKING');
    }
  }
  for (const id of broken) expect(stayingPlayers(get(id)).length).toBe(0);
}

function planIncrementally(tables: TableSummary[], balancing: BalancingConfig): { plan: BalancePlan; index: TableCountIndex } {
  const index = TableCountIndex.fromTables(tables);
  const byId = new Map(tables.map((t) => [t.tableId, t]));
  const plan = planAfterHand({
    index,
    getTable: (id) => byId.get(id) as TableSummary,
    tableCfg: DEFAULT_TABLE_CFG,
    balancing,
    activePlayers: activePlayersOf(tables),
    finalTableFormed: false,
  });
  return { plan, index };
}

describe('planner properties on settled states (fast-check)', () => {
  it.each([
    ['sparse fields (mostly table breaks)', stateArb()],
    ['dense fields (mostly balancing moves)', stateArb({ minPlayers: 6, minTables: 2, maxTables: 16 })],
  ])('%s: safe, balanced after completion, idempotent, deterministic, order-independent, equal to planAfterHand', (_label, arb) => {
    fc.assert(
      fc.property(arb, balancingArb, fc.integer(), (raw, balancing, salt) => {
        const tables = deepFreeze(raw);
        const plan = planBalance(input(tables, balancing));
        validatePlan(tables, plan, DEFAULT_TABLE_CFG.maxSize);

        // Determinism and input-order independence.
        expect(planBalance(input(tables, balancing))).toEqual(plan);
        const rotated = [...tables.slice(Math.abs(salt) % tables.length), ...tables.slice(0, Math.abs(salt) % tables.length)];
        expect(planBalance(input(rotated, balancing))).toEqual(plan);

        // Incremental planner: identical plan, index unchanged.
        const { plan: incremental, index } = planIncrementally(tables, balancing);
        expect(incremental).toEqual(plan);
        expect(index.checkInvariants()).toEqual([]);
        expect(index.snapshot()).toEqual(TableCountIndex.fromTables(tables).snapshot());

        const active = activePlayersOf(tables);
        if (active <= DEFAULT_TABLE_CFG.finalTableSize) {
          expect(plan.actions).toEqual(active >= 2 && tables.length > 1 ? [{ type: 'FORM_FINAL_TABLE' }] : []);
          return;
        }
        const target = computeTableCount(active, DEFAULT_TABLE_CFG, balancing.consolidateBy);
        expect(plan.targetTableCount).toBe(target);

        // Settled outcome.
        const after = completePlan(tables, plan);
        const open = after.filter((t) => t.status !== 'CLOSED');
        expect(open.every((t) => t.status === 'ACTIVE')).toBe(true);
        expect(open.length).toBe(Math.min(tables.length, target));
        const counts = open.map(effectivePlayerCount);
        expect(counts.reduce((a, b) => a + b, 0)).toBe(active);
        expect(Math.max(...counts)).toBeLessThanOrEqual(DEFAULT_TABLE_CFG.maxSize);
        expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(Math.max(1, balancing.maxImbalance));

        // Idempotency: re-planning after completion, or while the moves are in flight, does nothing.
        expect(planBalance(input(after, balancing)).actions).toEqual([]);
        expect(planBalance(input(markPlanInFlight(tables, plan), balancing)).actions).toEqual([]);
      }),
      { numRuns: 400 },
    );
  });
});

describe('planner properties on in-flight states (fast-check)', () => {
  it('safe and identical between planBalance and planAfterHand, inputs untouched', () => {
    fc.assert(
      fc.property(stateArb({ inFlight: true, breaking: true }), balancingArb, (raw, balancing) => {
        const tables = deepFreeze(raw);
        const plan = planBalance(input(tables, balancing));
        validatePlan(tables, plan, DEFAULT_TABLE_CFG.maxSize);
        const { plan: incremental, index } = planIncrementally(tables, balancing);
        expect(incremental).toEqual(plan);
        expect(index.checkInvariants()).toEqual([]);
        // Re-planning on the in-flight result never moves anyone already moving.
        const next = planBalance(input(markPlanInFlight(tables, plan), balancing));
        validatePlan(markPlanInFlight(tables, plan), next, DEFAULT_TABLE_CFG.maxSize);
      }),
      { numRuns: 400 },
    );
  });
});
