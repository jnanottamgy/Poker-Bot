import { describe, expect, it } from 'vitest';
import { ManualClock } from '../src/runtime/clock';
import { Fifo } from '../src/runtime/mailbox';
import { MemoryMembership, MemoryMembershipRegistry } from '../src/runtime/membership';
import type { MemberInfo } from '../src/runtime/membership';
import { placeActor } from '../src/runtime/placement';
import type { PlacementCandidate } from '../src/runtime/placement';
import { TimerService } from '../src/runtime/timer-service';

function setup() {
  const clock = new ManualClock(0);
  const fired: Array<[string, string, string, number]> = [];
  const timers = new TimerService(clock, (owner, key, token) => fired.push([owner, key, token, clock.now()]));
  return { clock, fired, timers };
}

describe('TimerService', () => {
  it('fires in (deadline, insertion) order at the right time', async () => {
    const { clock, fired, timers } = setup();
    timers.schedule('a', 'k', 300, 't1');
    timers.schedule('b', 'k', 100, 't2');
    timers.schedule('c', 'k', 100, 't3');
    timers.schedule('d', 'k', 200, 't4');
    await clock.advance(99);
    expect(fired).toEqual([]);
    await clock.advance(1000);
    expect(fired).toEqual([
      ['b', 'k', 't2', 100],
      ['c', 'k', 't3', 100],
      ['d', 'k', 't4', 200],
      ['a', 'k', 't1', 300],
    ]);
    expect(timers.size).toBe(0);
  });

  it('scheduling the same (owner, key) replaces the previous timer; cancel and cancelAll remove them', async () => {
    const { clock, fired, timers } = setup();
    timers.schedule('a', 'turn', 100, 'old');
    timers.schedule('a', 'turn', 500, 'new');
    timers.schedule('a', 'other', 50, 'x');
    timers.schedule('b', 'turn', 60, 'y');
    timers.cancel('a', 'other');
    expect(timers.timersOf('a')).toEqual([{ key: 'turn', at: 500, token: 'new' }]);
    await clock.advance(200);
    expect(fired).toEqual([['b', 'turn', 'y', 60]]);
    timers.schedule('b', 'turn', 1000, 'z');
    timers.cancelAll('b');
    await clock.advance(2000);
    expect(fired).toEqual([
      ['b', 'turn', 'y', 60],
      ['a', 'turn', 'new', 500],
    ]);
  });

  it('a deadline in the past fires on the next wake', async () => {
    const { clock, fired, timers } = setup();
    await clock.advance(1000);
    timers.schedule('a', 'k', 10, 'late');
    await clock.advance(0);
    expect(fired).toEqual([['a', 'k', 'late', 1000]]);
  });

  it('uses a single clock timer for 100,000 actors and compacts cancelled entries', async () => {
    const { clock, fired, timers } = setup();
    for (let i = 0; i < 100_000; i++) timers.schedule(`table-${i}`, 'turn', 1000 + (i % 977), `t${i}`);
    expect(clock.pendingTimers()).toBe(1);
    expect(timers.size).toBe(100_000);
    for (let i = 0; i < 90_000; i++) timers.cancel(`table-${i}`, 'turn');
    expect(timers.size).toBe(10_000);
    expect(timers.heapSize).toBeLessThan(25_000);
    await clock.advance(5000);
    expect(fired).toHaveLength(10_000);
    for (let i = 1; i < fired.length; i++) expect(fired[i]![3]).toBeGreaterThanOrEqual(fired[i - 1]![3]);
    expect(clock.pendingTimers()).toBe(0);
  });

  it('re-arms earlier when a sooner deadline is scheduled, and stop() clears everything', async () => {
    const { clock, fired, timers } = setup();
    timers.schedule('a', 'k', 10_000, 'late');
    timers.schedule('b', 'k', 5, 'soon');
    await clock.advance(10);
    expect(fired.map((f) => f[2])).toEqual(['soon']);
    timers.stop();
    await clock.advance(20_000);
    expect(fired.map((f) => f[2])).toEqual(['soon']);
  });
});

describe('Fifo mailbox', () => {
  it('preserves order across compaction', () => {
    const q = new Fifo<number>();
    const out: number[] = [];
    for (let i = 0; i < 5000; i++) {
      q.push(i);
      if (i % 3 === 0) out.push(q.shift()!);
    }
    while (q.length) out.push(q.shift()!);
    expect(out).toEqual(Array.from({ length: 5000 }, (_, i) => i));
    expect(q.shift()).toBeUndefined();
  });
});

describe('rendezvous placement', () => {
  const nodes = (n: number, role: PlacementCandidate['role'] = 'worker'): PlacementCandidate[] =>
    Array.from({ length: n }, (_, i) => ({ nodeId: `node-${i}`, role, capacity: 1 }));
  const keys = Array.from({ length: 20_000 }, (_, i) => `table:trn_1:T${i}`);

  it('is deterministic, balanced, and independent of member order', () => {
    const four = nodes(4);
    const counts = new Map<string, number>();
    for (const k of keys) {
      const owner = placeActor(k, 'worker', four)!;
      expect(placeActor(k, 'worker', [...four].reverse())).toBe(owner);
      counts.set(owner, (counts.get(owner) ?? 0) + 1);
    }
    for (const c of counts.values()) expect(Math.abs(c - 5000)).toBeLessThan(400);
  });

  it('a joining node takes ~1/n of the actors, all from others to itself', () => {
    const four = nodes(4);
    const five = nodes(5);
    let moved = 0;
    for (const k of keys) {
      const before = placeActor(k, 'worker', four);
      const after = placeActor(k, 'worker', five);
      if (before !== after) {
        moved++;
        expect(after).toBe('node-4');
      }
    }
    expect(moved / keys.length).toBeGreaterThan(0.17);
    expect(moved / keys.length).toBeLessThan(0.23);
  });

  it('respects roles and capacity', () => {
    const mixed: PlacementCandidate[] = [
      { nodeId: 'gw', role: 'gateway', capacity: 1 },
      { nodeId: 'w1', role: 'worker', capacity: 1 },
      { nodeId: 'w2', role: 'worker', capacity: 2 },
      { nodeId: 'orch', role: 'orchestrator', capacity: 1 },
    ];
    const tables = new Map<string, number>();
    for (const k of keys) {
      const owner = placeActor(k, 'worker', mixed)!;
      tables.set(owner, (tables.get(owner) ?? 0) + 1);
      expect(placeActor(k, 'orchestrator', mixed)).toBe('orch');
    }
    expect([...tables.keys()].sort()).toEqual(['w1', 'w2']);
    const ratio = tables.get('w2')! / tables.get('w1')!;
    expect(ratio).toBeGreaterThan(1.8);
    expect(ratio).toBeLessThan(2.2);
    expect(placeActor('x', 'orchestrator', nodes(3, 'worker'))).toBeNull();
    expect(placeActor('x', 'orchestrator', [{ nodeId: 'solo', role: 'all', capacity: 1 }])).toBe('solo');
  });
});

describe('MemoryMembership', () => {
  it('tracks joins, TTL expiry of silent nodes and graceful leaves', async () => {
    const clock = new ManualClock(0);
    const registry = new MemoryMembershipRegistry();
    const info = (nodeId: string): MemberInfo => ({ nodeId, role: 'worker', startedAt: 0, capacity: 1 });
    const a = new MemoryMembership(info('a'), registry, clock, { heartbeatMs: 100, ttlMs: 300 });
    const b = new MemoryMembership(info('b'), registry, clock, { heartbeatMs: 100, ttlMs: 300 });
    const changes: string[][] = [];
    a.onChange((ms) => changes.push(ms.map((m) => m.nodeId)));
    await a.start();
    await b.start();
    await clock.advance(100);
    expect(a.members().map((m) => m.nodeId)).toEqual(['a', 'b']);
    b.halt();
    await clock.advance(500);
    expect(a.members().map((m) => m.nodeId)).toEqual(['a']);
    const c = new MemoryMembership(info('c'), registry, clock, { heartbeatMs: 100, ttlMs: 300 });
    await c.start();
    await clock.advance(100);
    await c.stop();
    await clock.advance(100);
    expect(changes).toEqual([['a'], ['a', 'b'], ['a'], ['a', 'c'], ['a']]);
    await a.stop();
  });
});
