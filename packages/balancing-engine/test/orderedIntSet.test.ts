import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAX_ORDERED_INT, OrderedIntSet } from '../src';

type Op = { kind: 'add' | 'delete'; value: number } | { kind: 'query'; value: number };

function modelNext(sorted: number[], v: number): number {
  for (const x of sorted) if (x > v) return x;
  return -1;
}

function modelPrev(sorted: number[], v: number): number {
  for (let i = sorted.length - 1; i >= 0; i -= 1) if ((sorted[i] as number) < v) return sorted[i] as number;
  return -1;
}

describe('OrderedIntSet', () => {
  it('basic operations', () => {
    const s = new OrderedIntSet();
    expect(s.first()).toBe(-1);
    expect(s.last()).toBe(-1);
    expect(s.add(5)).toBe(true);
    expect(s.add(5)).toBe(false);
    s.add(0);
    s.add(31);
    s.add(32);
    s.add(1023);
    s.add(1024); // forces growth
    s.add(70_000);
    expect([...s.ascending()]).toEqual([0, 5, 31, 32, 1023, 1024, 70_000]);
    expect([...s.descending()]).toEqual([70_000, 1024, 1023, 32, 31, 5, 0]);
    expect(s.next(5)).toBe(31);
    expect(s.prev(32)).toBe(31);
    expect(s.next(70_000)).toBe(-1);
    expect(s.prev(0)).toBe(-1);
    expect(s.prev(10_000_000)).toBe(70_000);
    expect(s.delete(31)).toBe(true);
    expect(s.delete(31)).toBe(false);
    expect(s.has(31)).toBe(false);
    expect(s.has(-3)).toBe(false);
    expect(s.size).toBe(6);
    const c = s.clone();
    c.add(7);
    expect(s.has(7)).toBe(false);
    expect(c.has(7)).toBe(true);
  });

  it('supports the full value range and rejects values outside it', () => {
    const s = new OrderedIntSet();
    s.add(MAX_ORDERED_INT);
    s.add(0);
    expect(s.last()).toBe(MAX_ORDERED_INT);
    expect(s.prev(MAX_ORDERED_INT)).toBe(0);
    expect(() => s.add(MAX_ORDERED_INT + 1)).toThrow(RangeError);
    expect(() => s.add(-1)).toThrow(RangeError);
    expect(() => s.add(1.5)).toThrow(RangeError);
  });

  it('behaves like a sorted array under random operations (fast-check)', () => {
    const valueArb = fc.oneof(fc.integer({ min: 0, max: 70 }), fc.integer({ min: 0, max: 5000 }), fc.integer({ min: 0, max: 200_000 }));
    const opArb: fc.Arbitrary<Op> = fc.record({ kind: fc.constantFrom('add' as const, 'add' as const, 'delete' as const, 'query' as const), value: valueArb });
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 200 }), (ops) => {
        const set = new OrderedIntSet(32);
        const model = new Set<number>();
        for (const op of ops) {
          if (op.kind === 'add') expect(set.add(op.value)).toBe(!model.has(op.value));
          if (op.kind === 'add') model.add(op.value);
          if (op.kind === 'delete') expect(set.delete(op.value)).toBe(model.delete(op.value));
          const sorted = [...model].sort((a, b) => a - b);
          expect(set.size).toBe(sorted.length);
          expect(set.first()).toBe(sorted[0] ?? -1);
          expect(set.last()).toBe(sorted[sorted.length - 1] ?? -1);
          expect(set.has(op.value)).toBe(model.has(op.value));
          expect(set.next(op.value)).toBe(modelNext(sorted, op.value));
          expect(set.prev(op.value)).toBe(modelPrev(sorted, op.value));
        }
        expect([...set.ascending()]).toEqual([...model].sort((a, b) => a - b));
        expect([...set.descending()]).toEqual([...model].sort((a, b) => b - a));
      }),
      { numRuns: 300 },
    );
  });
});
