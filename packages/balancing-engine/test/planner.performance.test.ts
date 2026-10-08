import { describe, expect, it } from 'vitest';
import type { SeatSummary, TableSummary } from '@jpb/shared-types';
import { planAfterHand, planBalance, TableCountIndex } from '../src';
import type { MoveAction } from '../src';
import { DEFAULT_BALANCING, DEFAULT_TABLE_CFG } from './fixtures';

const TABLES = 125_000;
const SHARED_STATS = Object.freeze({ handsDealtAtTable: 10, handsSinceBigBlind: 3, handsSinceSmallBlind: 2, handsPlayedTotal: 100 });
const NO_MOVES: number[] = Object.freeze([]) as unknown as number[];

/** A table whose `count` players sit in seats 0..count-1 (memory-light: stats objects are shared). */
function synthTable(i: number, count: number): TableSummary {
  const tableId = `t${i}`;
  const seats: SeatSummary[] = new Array(count);
  for (let s = 0; s < count; s += 1) {
    seats[s] = { seat: s, playerId: `${tableId}:${s}`, stack: 1000, stats: SHARED_STATS, recentMovesAtHand: NO_MOVES };
  }
  return {
    tableId,
    tableNumber: i + 1,
    maxSeats: 9,
    status: 'ACTIVE',
    seats,
    reservedSeats: [],
    buttonSeat: null,
    lastSmallBlindSeat: count > 1 ? count - 1 : null,
    lastBigBlindSeat: count > 0 ? 0 : null,
    handNumber: 100,
    inHand: (i & 1) === 1,
  };
}

/** Deterministic LCG used only to pick which table loses a player. */
function lcg(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x;
  };
}

describe('performance at 1,000,000 players / 125,000 tables', () => {
  it('planBalance on a balanced field is fast and plans nothing', () => {
    const tables = Array.from({ length: TABLES }, (_, i) => synthTable(i, 8));
    const started = performance.now();
    const plan = planBalance({ tables, tableCfg: DEFAULT_TABLE_CFG, balancing: DEFAULT_BALANCING, activePlayers: 1_000_000, finalTableFormed: false });
    const ms = performance.now() - started;
    expect(plan).toEqual({ targetTableCount: 125_000, actions: [] });
    expect(ms).toBeLessThan(5_000);
  }, 60_000);

  it('planBalance rebalances 62,500 tables of 9 against 62,500 tables of 7 (62,500 moves)', () => {
    const tables = Array.from({ length: TABLES }, (_, i) => synthTable(i, i % 2 === 0 ? 9 : 7));
    const started = performance.now();
    const plan = planBalance({ tables, tableCfg: DEFAULT_TABLE_CFG, balancing: DEFAULT_BALANCING, activePlayers: 1_000_000, finalTableFormed: false });
    const ms = performance.now() - started;
    const moves = plan.actions.filter((a): a is MoveAction => a.type === 'MOVE');
    expect(moves.length).toBe(62_500);
    expect(new Set(moves.map((m) => m.playerId)).size).toBe(62_500);
    expect(ms).toBeLessThan(30_000);
  }, 120_000);

  it('1,000 incremental planAfterHand calls stay fast and only touch a handful of tables', () => {
    const counts = new Int8Array(TABLES).fill(8);
    const closed = new Uint8Array(TABLES);
    const index = new TableCountIndex();
    for (let i = 0; i < TABLES; i += 1) index.setActive(`t${i}`, i + 1, 8);
    expect(index.activeTableCount).toBe(TABLES);

    let lookups = 0;
    let maxLookupsPerPlan = 0;
    const getTable = (id: string): TableSummary => {
      lookups += 1;
      return synthTable(Number(id.slice(1)), counts[Number(id.slice(1))] as number);
    };
    let active = 1_000_000;
    let moves = 0;
    let balanceMoves = 0;
    let breaks = 0;
    const next = lcg(12345);
    const HOT = 3_000; // busts concentrate on a region so tables drift apart and need balancing
    const started = performance.now();
    for (let step = 0; step < 1_000; step += 1) {
      // One to three players bust at the same table (high LCG bits: the low bits have short periods).
      let t = (next() >>> 8) % HOT;
      while (closed[t] === 1 || (counts[t] as number) < 5) t = (t + 1) % TABLES;
      const busts = 1 + ((next() >>> 16) % 3);
      counts[t] = (counts[t] as number) - busts;
      active -= busts;
      index.setActive(`t${t}`, t + 1, counts[t] as number);

      const before = lookups;
      const plan = planAfterHand({ index, getTable, tableCfg: DEFAULT_TABLE_CFG, balancing: DEFAULT_BALANCING, activePlayers: active, finalTableFormed: false });
      maxLookupsPerPlan = Math.max(maxLookupsPerPlan, lookups - before);

      // Complete the plan immediately (players re-seated compactly in seats 0..count-1).
      for (const a of plan.actions) {
        if (a.type === 'MOVE') {
          const from = Number(a.fromTableId.slice(1));
          const to = Number(a.toTableId.slice(1));
          counts[from] = (counts[from] as number) - 1;
          counts[to] = (counts[to] as number) + 1;
          moves += 1;
          if (a.reason === 'BALANCE') balanceMoves += 1;
        } else if (a.type === 'BREAK_TABLE') {
          breaks += 1;
        }
      }
      for (const a of plan.actions) {
        if (a.type === 'MOVE') {
          for (const id of [a.fromTableId, a.toTableId]) {
            const i = Number(id.slice(1));
            if (closed[i] === 0 && index.get(id)?.state === 'ACTIVE') index.setActive(id, i + 1, counts[i] as number);
          }
        }
      }
      for (const a of plan.actions) {
        if (a.type === 'BREAK_TABLE') {
          const i = Number(a.tableId.slice(1));
          expect(counts[i]).toBe(0);
          closed[i] = 1;
          index.remove(a.tableId);
        }
      }
      // The field stays balanced and at the target table count after every hand.
      expect((index.maxCount() as number) - (index.minCount() as number)).toBeLessThanOrEqual(1);
      expect(index.activeTableCount).toBe(plan.targetTableCount);
    }
    const ms = performance.now() - started;
    expect(breaks).toBeGreaterThan(100);
    expect(balanceMoves).toBeGreaterThan(100);
    expect(moves).toBeGreaterThan(900);
    expect(index.totalActivePlayers).toBe(active);
    expect(index.checkInvariants()).toEqual([]);
    expect(ms).toBeLessThan(5_000);
    expect(maxLookupsPerPlan).toBeLessThan(64);
  }, 60_000);

  it('TableCountIndex for 125,000 tables stays small', () => {
    const before = process.memoryUsage().heapUsed;
    const index = new TableCountIndex();
    for (let i = 0; i < TABLES; i += 1) index.setActive(`t${i}`, i + 1, 1 + (i % 9));
    const after = process.memoryUsage().heapUsed;
    expect(index.activeTableCount).toBe(TABLES);
    expect(after - before).toBeLessThan(80 * 1024 * 1024);
  });
});
