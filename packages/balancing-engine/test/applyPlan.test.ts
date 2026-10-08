import { describe, expect, it } from 'vitest';
import { completePlan, markPlanInFlight, MAX_RECENT_MOVES_KEPT } from '../src';
import type { BalancePlan } from '../src';
import { deepFreeze, makeTable, tableOf } from './fixtures';

const plan: BalancePlan = {
  targetTableCount: 2,
  actions: [
    { type: 'BREAK_TABLE', tableId: 'T3' },
    { type: 'MOVE', reason: 'TABLE_BREAK', playerId: 'T3-s0', fromTableId: 'T3', fromSeat: 0, toTableId: 'T1', toSeat: 7, breakdown: {} },
    { type: 'MOVE', reason: 'BALANCE', playerId: 'T2-s1', fromTableId: 'T2', fromSeat: 1, toTableId: 'T1', toSeat: 8, breakdown: {} },
  ],
};

function state() {
  return deepFreeze([
    tableOf(1, 6),
    makeTable({ number: 2, seats: [0, { seat: 1, stats: { handsPlayedTotal: 33, handsDealtAtTable: 9 }, recentMovesAtHand: [1, 2] }, 2] }),
    tableOf(3, 1),
  ]);
}

describe('markPlanInFlight', () => {
  it('flags movers, reserves seats, marks broken tables; never mutates input', () => {
    const before = state();
    const after = markPlanInFlight(before, plan);
    expect(after[0]?.reservedSeats).toEqual([7, 8]);
    expect(after[1]?.seats.find((s) => s.seat === 1)?.movingOut).toBe(true);
    expect(after[2]?.status).toBe('BREAKING');
    expect(after[2]?.seats[0]?.movingOut).toBe(true);
    expect(before[0]?.reservedSeats).toEqual([]);
  });

  it('rejects inconsistent plans', () => {
    const bad: BalancePlan = { targetTableCount: 1, actions: [{ ...(plan.actions[2] as Extract<BalancePlan['actions'][number], { type: 'MOVE' }>), toSeat: 0 }] };
    expect(() => markPlanInFlight(state(), bad)).toThrow(/not free/);
    const ghost: BalancePlan = { targetTableCount: 1, actions: [{ ...(plan.actions[2] as Extract<BalancePlan['actions'][number], { type: 'MOVE' }>), fromSeat: 5 }] };
    expect(() => markPlanInFlight(state(), ghost)).toThrow(/is not in seat/);
    const twice: BalancePlan = { targetTableCount: 1, actions: [plan.actions[2] as BalancePlan['actions'][number], plan.actions[2] as BalancePlan['actions'][number]] };
    expect(() => markPlanInFlight(state(), twice)).toThrow(/already moving/);
  });
});

describe('completePlan', () => {
  it('moves players into their reserved seats and closes emptied broken tables', () => {
    const after = completePlan(state(), plan);
    expect(after[0]?.seats.map((s) => s.seat)).toEqual([0, 1, 2, 3, 4, 5, 7, 8]);
    expect(after[0]?.reservedSeats).toEqual([]);
    const arrived = after[0]?.seats.find((s) => s.playerId === 'T2-s1');
    expect(arrived?.stats).toMatchObject({ handsPlayedTotal: 33, handsDealtAtTable: 0 });
    expect(arrived?.recentMovesAtHand).toEqual([1, 2, 33]);
    expect(after[1]?.seats.map((s) => s.seat)).toEqual([0, 2]);
    expect(after[2]?.status).toBe('CLOSED');
  });

  it('accepts the in-flight state too', () => {
    expect(completePlan(markPlanInFlight(state(), plan), plan)).toEqual(completePlan(state(), plan));
  });

  it('caps the recent-move history', () => {
    const t = [
      makeTable({ number: 1, seats: [{ seat: 0, recentMovesAtHand: Array.from({ length: 20 }, (_, i) => i) }, 1, 2] }),
      tableOf(2, 2),
    ];
    const move: BalancePlan = {
      targetTableCount: 2,
      actions: [{ type: 'MOVE', reason: 'BALANCE', playerId: 'T1-s0', fromTableId: 'T1', fromSeat: 0, toTableId: 'T2', toSeat: 5, breakdown: {} }],
    };
    expect(completePlan(t, move)[1]?.seats.find((s) => s.seat === 5)?.recentMovesAtHand.length).toBe(MAX_RECENT_MOVES_KEPT);
  });
});
