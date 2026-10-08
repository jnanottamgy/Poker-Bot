import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { TableCountIndex } from '../src';
import { makeTable, tableOf } from './fixtures';

describe('TableCountIndex', () => {
  it('builds from summaries: ACTIVE bucketed by effective count, BREAKING tracked, CLOSED ignored', () => {
    const index = TableCountIndex.fromTables([
      tableOf(1, 8),
      tableOf(2, 6),
      makeTable({ number: 3, seats: [0, 1, { seat: 2, movingOut: true }], reserved: [5, 6] }), // 2 staying + 2 reserved
      tableOf(4, 6),
      makeTable({ number: 5, seats: [0, 1], status: 'BREAKING' }),
      makeTable({ number: 6, seats: [], status: 'CLOSED' }),
    ]);
    expect(index.activeTableCount).toBe(4);
    expect(index.breakingTableCount).toBe(1);
    expect(index.openTableCount).toBe(5);
    expect(index.totalActivePlayers).toBe(8 + 6 + 4 + 6);
    expect(index.minCount()).toBe(4);
    expect(index.maxCount()).toBe(8);
    expect(index.get('T3')).toEqual({ tableId: 'T3', tableNumber: 3, count: 4, state: 'ACTIVE' });
    expect(index.firstWithCount(6)).toBe('T2');
    expect(index.lastWithCount(6)).toBe('T4');
    expect([...index.tablesWithCount(6, 'DESC')]).toEqual(['T4', 'T2']);
    expect([...index.breakingTables()]).toEqual(['T5']);
    expect(index.has('T6')).toBe(false);
    expect(index.checkInvariants()).toEqual([]);
  });

  it('updates in place and keeps min/max correct', () => {
    const index = new TableCountIndex();
    expect(index.minCount()).toBeNull();
    index.setActive('a', 1, 5);
    index.setActive('b', 2, 7);
    index.setActive('a', 1, 8);
    expect([index.minCount(), index.maxCount()]).toEqual([7, 8]);
    index.upsert(makeTable({ id: 'b', number: 2, seats: [], status: 'CLOSED' }));
    expect([index.minCount(), index.maxCount()]).toEqual([8, 8]);
    index.setBreaking('a', 1);
    expect(index.minCount()).toBeNull();
    expect(index.openTableCount).toBe(1);
    expect(index.remove('a')).toBe(true);
    expect(index.remove('a')).toBe(false);
    expect(index.openTableCount).toBe(0);
    expect(index.checkInvariants()).toEqual([]);
  });

  it('rejects duplicate table numbers and absurd counts', () => {
    const index = new TableCountIndex();
    index.setActive('a', 1, 5);
    expect(() => index.setActive('b', 1, 5)).toThrow(/already used/);
    expect(() => index.setActive('c', 2, -1)).toThrow(RangeError);
    expect(() => index.setActive('c', 2, 5000)).toThrow(RangeError);
    expect(() => index.setActive('c', -2, 5)).toThrow(RangeError);
    index.setActive('a', 9, 5); // renumbering frees number 1
    index.setActive('b', 1, 5);
    expect(index.tableIdForNumber(1)).toBe('b');
    expect(index.checkInvariants()).toEqual([]);
  });

  it('clone is independent', () => {
    const index = TableCountIndex.fromTables([tableOf(1, 8), tableOf(2, 7)]);
    const copy = index.clone();
    copy.setActive('T1', 1, 3);
    expect(index.get('T1')?.count).toBe(8);
    expect(copy.minCount()).toBe(3);
    expect(copy.checkInvariants()).toEqual([]);
    expect(index.checkInvariants()).toEqual([]);
  });

  it('matches a naive model under random updates (fast-check)', () => {
    const opArb = fc.record({
      table: fc.integer({ min: 0, max: 40 }),
      kind: fc.constantFrom('active', 'active', 'active', 'breaking', 'remove'),
      count: fc.integer({ min: 0, max: 10 }),
    });
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 150 }), (ops) => {
        const index = new TableCountIndex();
        const model = new Map<string, { n: number; count: number; state: 'ACTIVE' | 'BREAKING' }>();
        for (const op of ops) {
          const id = `t${op.table}`;
          const n = 1000 + op.table * 7;
          if (op.kind === 'active') {
            index.setActive(id, n, op.count);
            model.set(id, { n, count: op.count, state: 'ACTIVE' });
          } else if (op.kind === 'breaking') {
            index.setBreaking(id, n);
            model.set(id, { n, count: 0, state: 'BREAKING' });
          } else {
            expect(index.remove(id)).toBe(model.delete(id));
          }
          const active = [...model.entries()].filter(([, e]) => e.state === 'ACTIVE');
          const counts = active.map(([, e]) => e.count);
          expect(index.minCount()).toBe(counts.length === 0 ? null : Math.min(...counts));
          expect(index.maxCount()).toBe(counts.length === 0 ? null : Math.max(...counts));
          expect(index.activeTableCount).toBe(active.length);
          expect(index.totalActivePlayers).toBe(counts.reduce((a, b) => a + b, 0));
          expect(index.breakingTableCount).toBe(model.size - active.length);
          for (let c = 0; c <= 10; c += 1) {
            const withC = active.filter(([, e]) => e.count === c).sort((a, b) => a[1].n - b[1].n).map(([tid]) => tid);
            expect([...index.tablesWithCount(c)]).toEqual(withC);
            expect(index.firstWithCount(c)).toBe(withC[0] ?? null);
            expect(index.lastWithCount(c)).toBe(withC[withC.length - 1] ?? null);
          }
        }
        expect(index.checkInvariants()).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });
});
