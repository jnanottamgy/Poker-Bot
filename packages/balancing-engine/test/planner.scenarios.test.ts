import { describe, expect, it } from 'vitest';
import type { TableSummary } from '@jpb/shared-types';
import { completePlan, markPlanInFlight, planAfterHand, planBalance, TableCountIndex } from '../src';
import type { BalancePlan, MoveAction } from '../src';
import { activePlayersOf, DEFAULT_BALANCING, DEFAULT_TABLE_CFG, makeTable, sizes, tableOf } from './fixtures';

function plan(tables: TableSummary[], overrides: Partial<Parameters<typeof planBalance>[0]> = {}): BalancePlan {
  return planBalance({
    tables,
    tableCfg: DEFAULT_TABLE_CFG,
    balancing: DEFAULT_BALANCING,
    activePlayers: activePlayersOf(tables),
    finalTableFormed: false,
    ...overrides,
  });
}

function moves(p: BalancePlan): Array<[string, string, string]> {
  return p.actions.filter((a): a is MoveAction => a.type === 'MOVE').map((m) => [m.fromTableId, m.toTableId, m.reason]);
}

function settle(tables: TableSummary[]): { after: TableSummary[]; p: BalancePlan } {
  const p = plan(tables);
  const after = completePlan(tables, p);
  expect(plan(after).actions).toEqual([]); // idempotent
  expect(plan(markPlanInFlight(tables, p)).actions).toEqual([]);
  return { after, p };
}

describe('balancing scenarios', () => {
  it('8/8/5/8: two moves (T1→T3, T2→T3) give 7/7/7/8', () => {
    const tables = [tableOf(1, 8), tableOf(2, 8), tableOf(3, 5), tableOf(4, 8)];
    const { after, p } = settle(tables);
    expect(p.targetTableCount).toBe(4);
    expect(moves(p)).toEqual([
      ['T1', 'T3', 'BALANCE'],
      ['T2', 'T3', 'BALANCE'],
    ]);
    expect(sizes(after)).toEqual([7, 7, 7, 8]);
    // TDA: the player due the big blind next (seat 1, since seat 0 just posted it) moves.
    const first = p.actions[0] as MoveAction;
    expect(first.playerId).toBe('T1-s1');
    expect(first.breakdown['player.handsUntilBigBlind']).toBe(0);
    expect(first.breakdown['source.count']).toBe(8);
    expect(first.breakdown['destination.count']).toBe(5);
    expect(typeof first.breakdown['seat.score']).toBe('number');
  });

  it('tables of 9 and 6: one move gives 8/7', () => {
    const { after, p } = settle([tableOf(1, 9), tableOf(2, 6)]);
    expect(moves(p)).toEqual([['T1', 'T2', 'BALANCE']]);
    expect(sizes(after)).toEqual([8, 7]);
  });

  it('within tolerance: nothing to do', () => {
    expect(plan([tableOf(1, 8), tableOf(2, 7), tableOf(3, 8)]).actions).toEqual([]);
    const loose = { ...DEFAULT_BALANCING, maxImbalance: 2 };
    expect(plan([tableOf(1, 9), tableOf(2, 7)], { balancing: loose }).actions).toEqual([]);
  });

  it('cascade 9/9/9/5: three moves into the short table', () => {
    const { after, p } = settle([tableOf(1, 9), tableOf(2, 9), tableOf(3, 9), tableOf(4, 5)]);
    expect(moves(p)).toEqual([
      ['T1', 'T4', 'BALANCE'],
      ['T2', 'T4', 'BALANCE'],
      ['T3', 'T4', 'BALANCE'],
    ]);
    expect(sizes(after)).toEqual([8, 8, 8, 8]);
  });

  it('cascade 9/9/9/9/4/4: six moves, never moving a player twice', () => {
    const { after, p } = settle([tableOf(1, 9), tableOf(2, 9), tableOf(3, 9), tableOf(4, 9), tableOf(5, 4), tableOf(6, 4)]);
    expect(moves(p)).toEqual([
      ['T1', 'T5', 'BALANCE'],
      ['T2', 'T6', 'BALANCE'],
      ['T3', 'T5', 'BALANCE'],
      ['T4', 'T6', 'BALANCE'],
      ['T1', 'T5', 'BALANCE'],
      ['T2', 'T6', 'BALANCE'],
    ]);
    expect(sizes(after)).toEqual([7, 7, 8, 8, 7, 7]);
    const ids = p.actions.filter((a): a is MoveAction => a.type === 'MOVE').map((m) => m.playerId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('breaking 10 → 9 tables (72 players): the smallest, highest-numbered table is broken', () => {
    const tables = [tableOf(1, 8), tableOf(2, 8), ...[3, 4, 5, 6, 7, 8, 9, 10].map((n) => tableOf(n, 7))];
    const { after, p } = settle(tables);
    expect(p.targetTableCount).toBe(9);
    expect(p.actions[0]).toEqual({ type: 'BREAK_TABLE', tableId: 'T10' });
    expect(moves(p)).toEqual([3, 4, 5, 6, 7, 8, 9].map((n) => ['T10', `T${n}`, 'TABLE_BREAK']));
    expect(after.find((t) => t.tableId === 'T10')?.status).toBe('CLOSED');
    expect(sizes(after)).toEqual([8, 8, 8, 8, 8, 8, 8, 8, 8]);
    // Broken-table players leave in big-blind order (next BB first).
    expect((p.actions[1] as MoveAction).playerId).toBe('T10-s1');
    expect((p.actions[1] as MoveAction).breakdown['player.breakOrder']).toBe(0);
  });

  it('5/5/5 → two tables: the break fills the smallest tables in turn', () => {
    const { after, p } = settle([tableOf(1, 5), tableOf(2, 5), tableOf(3, 5)]);
    expect(p.actions[0]).toEqual({ type: 'BREAK_TABLE', tableId: 'T3' });
    expect(moves(p).map((m) => m[1])).toEqual(['T1', 'T2', 'T1', 'T2', 'T1']);
    expect(sizes(after)).toEqual([8, 7]);
  });

  it('breaks several surplus tables in one plan (2/2/2/2/2 → 2 tables)', () => {
    const tables = [1, 2, 3, 4, 5].map((n) => tableOf(n, 2));
    const { after, p } = settle(tables);
    expect(p.actions.filter((a) => a.type === 'BREAK_TABLE')).toEqual([
      { type: 'BREAK_TABLE', tableId: 'T5' },
      { type: 'BREAK_TABLE', tableId: 'T4' },
      { type: 'BREAK_TABLE', tableId: 'T3' },
    ]);
    expect(sizes(after)).toEqual([5, 5]);
  });
});

describe('final table', () => {
  it('9 players at 2 tables → FORM_FINAL_TABLE', () => {
    expect(plan([tableOf(1, 5), tableOf(2, 4)])).toEqual({ targetTableCount: 1, actions: [{ type: 'FORM_FINAL_TABLE' }] });
  });

  it('9 players at 3 tables → FORM_FINAL_TABLE', () => {
    expect(plan([tableOf(1, 3), tableOf(2, 3), tableOf(3, 3)]).actions).toEqual([{ type: 'FORM_FINAL_TABLE' }]);
  });

  it('counts BREAKING tables as open tables', () => {
    const tables = [tableOf(1, 6), makeTable({ number: 2, seats: [{ seat: 0, movingOut: true }], status: 'BREAKING' })];
    expect(plan(tables, { activePlayers: 7 }).actions).toEqual([{ type: 'FORM_FINAL_TABLE' }]);
  });

  it('10 players at 2 tables: not yet', () => {
    expect(plan([tableOf(1, 5), tableOf(2, 5)])).toEqual({ targetTableCount: 2, actions: [] });
  });

  it('one table left, or the final table already formed: nothing to do', () => {
    expect(plan([tableOf(1, 9)]).actions).toEqual([]);
    expect(plan([tableOf(1, 5), tableOf(2, 4)], { finalTableFormed: true }).actions).toEqual([]);
    expect(plan([tableOf(1, 1)], { activePlayers: 1 }).actions).toEqual([]);
  });
});

describe('fairness and safety rules', () => {
  it('a recently moved player is not chosen while another candidate exists', () => {
    const t1 = makeTable({
      number: 1,
      seats: [0, { seat: 1, stats: { handsPlayedTotal: 40 }, recentMovesAtHand: [37] }, 2, 3, 4, 5, 6, 7, 8],
      lastBB: 0,
      lastSB: 8,
    });
    const p = plan([t1, tableOf(2, 6)]);
    expect((p.actions[0] as MoveAction).playerId).toBe('T1-s2');
    expect((p.actions[0] as MoveAction).breakdown['player.protected']).toBe(0);
  });

  it('moving players and reserved seats are counted where they will be', () => {
    // T1: 9 seated, 2 already moving out → 7. T2: 5 seated + 2 inbound → 7. Balanced.
    const t1 = makeTable({ number: 1, seats: [0, 1, 2, 3, 4, 5, 6, { seat: 7, movingOut: true }, { seat: 8, movingOut: true }], lastBB: 0, lastSB: 8 });
    const t2 = makeTable({ number: 2, seats: [0, 1, 2, 3, 4], reserved: [6, 7] });
    expect(plan([t1, t2], { activePlayers: 14 }).actions).toEqual([]);
  });

  it('never assigns an occupied, moving-out or reserved seat, and never exceeds maxSize', () => {
    const t1 = tableOf(1, 9);
    const t2 = makeTable({ number: 2, seats: [0, 1, { seat: 2, movingOut: true }], reserved: [3, 4], lastBB: 0, lastSB: 1 });
    const p = plan([t1, t2], { activePlayers: 13 });
    for (const m of p.actions.filter((a): a is MoveAction => a.type === 'MOVE')) {
      expect([0, 1, 2, 3, 4]).not.toContain(m.toSeat);
    }
    expect(sizes(markPlanInFlight([t1, t2], p))).toEqual([7, 6]);
  });

  it('does not move a player out of a table that would be left with fewer than 2 seated players', () => {
    // T1 counts 7 but only 2 players are actually seated (5 inbound).
    const t1 = makeTable({ number: 1, seats: [0, 1], reserved: [2, 3, 4, 5, 6] });
    const t2 = makeTable({ number: 2, seats: [0, 1, 2, 3, 4] });
    expect(plan([t1, t2], { activePlayers: 12 }).actions).toEqual([]);
  });

  it('defers a break that cannot be completed (no physical seats), emitting nothing partial', () => {
    const full = (n: number) =>
      makeTable({ number: n, seats: [0, 1, 2, 3, 4, 5, 6, 7, 8].map((s) => ({ seat: s, movingOut: s < 4 })), lastBB: 4, lastSB: 3 });
    const t3 = makeTable({ number: 3, seats: [0, 1, 2, 3] });
    const t4 = makeTable({ number: 4, seats: [], reserved: [0, 1, 2, 3, 4, 5, 6, 7] });
    const tables = [full(1), full(2), t3, t4];
    expect(activePlayersOf(tables)).toBe(22);
    const p = plan(tables);
    expect(p.targetTableCount).toBe(3);
    expect(p.actions).toEqual([]);
  });

  it('defers a break when every candidate has players in transit to it', () => {
    const t = (n: number) => makeTable({ number: n, seats: [0, 1, 2], reserved: [5, 6] });
    expect(plan([t(1), t(2), t(3)], { activePlayers: 15 }).actions).toEqual([]);
  });

  it('finishes an admin-initiated break (BREAKING table with players still seated)', () => {
    const tables = [tableOf(1, 7), tableOf(2, 6), makeTable({ number: 3, seats: [0, 1, 2, 3], status: 'BREAKING', lastBB: 0, lastSB: 3 })];
    const p = plan(tables);
    expect(p.actions.some((a) => a.type === 'BREAK_TABLE')).toBe(false);
    expect(moves(p)).toEqual([
      ['T3', 'T2', 'TABLE_BREAK'],
      ['T3', 'T1', 'TABLE_BREAK'],
      ['T3', 'T2', 'TABLE_BREAK'],
      ['T3', 'T1', 'TABLE_BREAK'],
    ]);
    const after = completePlan(tables, p);
    expect(sizes(after)).toEqual([9, 8]);
    expect(after[2]?.status).toBe('CLOSED');
  });

  it('in-hand source: moves the player due the BB after the current hand, with projected stats', () => {
    const t1 = tableOf(1, 9, { inHand: true });
    const p = plan([t1, tableOf(2, 6)]);
    const m = p.actions[0] as MoveAction;
    expect(m.playerId).toBe('T1-s2');
    expect(m.breakdown['player.handsUntilBigBlind']).toBe(0);
  });

  it('a player who is due the big blind is seated to post it next at the destination', () => {
    const t1 = makeTable({ number: 1, seats: [0, 1, 2, 3, 4, 5, 6, 7, { seat: 8, stats: { handsSinceBigBlind: 8 } }], lastBB: 7, lastSB: 6 });
    const t2 = makeTable({ number: 2, seats: [0, 2, 4, 6, 8], lastBB: 2, lastSB: 0 });
    const p = plan([t1, t2]);
    const m = p.actions[0] as MoveAction;
    expect(m.playerId).toBe('T1-s8');
    expect(m.toSeat).toBe(3); // between the last BB (2) and the next BB (4)
    expect(m.breakdown['seat.handsUntilBigBlind']).toBe(0);
  });

  it('rejects invalid balancing config', () => {
    const tables = [tableOf(1, 9), tableOf(2, 6)];
    expect(() => plan(tables, { balancing: { ...DEFAULT_BALANCING, maxImbalance: -1 } })).toThrow(RangeError);
    expect(() => plan(tables, { balancing: { ...DEFAULT_BALANCING, recentMoveWindowHands: 1.5 } })).toThrow(RangeError);
    expect(() => plan(tables, { balancing: { ...DEFAULT_BALANCING, weights: { ...DEFAULT_BALANCING.weights, position: -2 } } })).toThrow(RangeError);
    expect(() => plan([tableOf(1, 9), tableOf(1, 6)])).toThrow(/duplicate table/);
  });
});

describe('planAfterHand', () => {
  it('gives the same plan as planBalance and leaves the index untouched', () => {
    const tables = [tableOf(1, 8), tableOf(2, 8), tableOf(3, 5), tableOf(4, 8)];
    const index = TableCountIndex.fromTables(tables);
    const before = index.snapshot();
    const byId = new Map(tables.map((t) => [t.tableId, t]));
    const looked: string[] = [];
    const p = planAfterHand({
      index,
      getTable: (id) => {
        looked.push(id);
        return byId.get(id) as TableSummary;
      },
      tableCfg: DEFAULT_TABLE_CFG,
      balancing: DEFAULT_BALANCING,
      activePlayers: 29,
      finalTableFormed: false,
    });
    expect(p).toEqual(plan(tables));
    expect(index.snapshot()).toEqual(before);
    expect(index.checkInvariants()).toEqual([]);
    expect(new Set(looked)).toEqual(new Set(['T1', 'T2', 'T3'])); // T4 (8 players, never chosen) is not inspected
  });

  it('detects an index that is out of sync with the summaries and restores the index', () => {
    const tables = [tableOf(1, 9), tableOf(2, 6)];
    const index = TableCountIndex.fromTables(tables);
    const before = index.snapshot();
    const stale = new Map(tables.map((t) => [t.tableId, t]));
    stale.set('T2', tableOf(2, 5)); // a bust that was not upserted into the index
    expect(() =>
      planAfterHand({
        index,
        getTable: (id) => stale.get(id) as TableSummary,
        tableCfg: DEFAULT_TABLE_CFG,
        balancing: DEFAULT_BALANCING,
        activePlayers: 14,
        finalTableFormed: false,
      }),
    ).toThrow(/out of sync/);
    expect(index.snapshot()).toEqual(before);
  });
});
