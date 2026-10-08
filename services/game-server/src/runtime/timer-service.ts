import type { Clock, ClockTimer } from './clock';
import { MAX_TIMER_DELAY_MS } from './clock';

/**
 * Actor timers for millions of actors: one binary min-heap ordered by
 * (at, insertion order) and a single clock timer armed for the earliest
 * deadline — never one Node timer per actor.
 *
 * Timers are keyed by (owner, key). Scheduling an existing key replaces the
 * previous timer; replaced/cancelled entries are deleted lazily from the heap
 * (marked dead, skipped when popped) and the heap is compacted when dead
 * entries dominate, so cancel is O(1) and schedule O(log n).
 */
export type TimerFire = (owner: string, key: string, token: string) => void;

interface Entry {
  owner: string;
  key: string;
  at: number;
  token: string;
  order: number;
  live: boolean;
}

const COMPACT_MIN_DEAD = 1024;

export class TimerService {
  private heap: Entry[] = [];
  private readonly byOwner = new Map<string, Map<string, Entry>>();
  private liveCount = 0;
  private order = 0;
  private armed: { timer: ClockTimer; at: number } | null = null;
  private stopped = false;

  constructor(
    private readonly clock: Clock,
    private readonly fire: TimerFire,
  ) {}

  schedule(owner: string, key: string, at: number, token: string): void {
    if (this.stopped) return;
    this.cancel(owner, key);
    const entry: Entry = { owner, key, at, token, order: this.order++, live: true };
    let keys = this.byOwner.get(owner);
    if (!keys) {
      keys = new Map();
      this.byOwner.set(owner, keys);
    }
    keys.set(key, entry);
    this.liveCount++;
    this.push(entry);
    this.arm();
  }

  cancel(owner: string, key: string): void {
    const keys = this.byOwner.get(owner);
    const entry = keys?.get(key);
    if (!keys || !entry) return;
    this.kill(entry, keys);
  }

  cancelAll(owner: string): void {
    const keys = this.byOwner.get(owner);
    if (!keys) return;
    for (const entry of [...keys.values()]) this.kill(entry, keys);
  }

  /** Live timers of one owner (admin internals / tests). */
  timersOf(owner: string): Array<{ key: string; at: number; token: string }> {
    return [...(this.byOwner.get(owner)?.values() ?? [])].map((e) => ({ key: e.key, at: e.at, token: e.token })).sort((a, b) => a.at - b.at);
  }

  get size(): number {
    return this.liveCount;
  }

  /** Heap length including dead entries awaiting compaction (exposed for tests). */
  get heapSize(): number {
    return this.heap.length;
  }

  stop(): void {
    this.stopped = true;
    if (this.armed) this.clock.clearTimeout(this.armed.timer);
    this.armed = null;
    this.heap = [];
    this.byOwner.clear();
    this.liveCount = 0;
  }

  private kill(entry: Entry, keys: Map<string, Entry>): void {
    entry.live = false;
    keys.delete(entry.key);
    if (keys.size === 0) this.byOwner.delete(entry.owner);
    this.liveCount--;
    const dead = this.heap.length - this.liveCount;
    if (dead > COMPACT_MIN_DEAD && dead > this.liveCount) this.compact();
  }

  /** Arms the single clock timer for the earliest live deadline (only when it moved earlier or none is armed). */
  private arm(): void {
    this.dropDeadTop();
    const top = this.heap[0];
    if (!top) {
      if (this.armed) this.clock.clearTimeout(this.armed.timer);
      this.armed = null;
      return;
    }
    if (this.armed && this.armed.at <= top.at) return;
    if (this.armed) this.clock.clearTimeout(this.armed.timer);
    const delay = Math.min(Math.max(0, top.at - this.clock.now()), MAX_TIMER_DELAY_MS);
    const at = this.clock.now() + delay;
    this.armed = { at, timer: this.clock.setTimeout(() => this.onWake(), delay) };
  }

  private onWake(): void {
    this.armed = null;
    if (this.stopped) return;
    const now = this.clock.now();
    for (;;) {
      this.dropDeadTop();
      const top = this.heap[0];
      if (!top || top.at > now) break;
      this.pop();
      const keys = this.byOwner.get(top.owner);
      if (keys) this.kill(top, keys);
      try {
        this.fire(top.owner, top.key, top.token);
      } catch {
        // A failing fire handler must not stop the other timers.
      }
    }
    this.arm();
  }

  private dropDeadTop(): void {
    while (this.heap.length && !this.heap[0]!.live) this.pop();
  }

  private compact(): void {
    this.heap = this.heap.filter((e) => e.live);
    for (let i = (this.heap.length >> 1) - 1; i >= 0; i--) this.down(i);
  }

  private less(a: Entry, b: Entry): boolean {
    return a.at < b.at || (a.at === b.at && a.order < b.order);
  }

  private push(entry: Entry): void {
    this.heap.push(entry);
    let i = this.heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(this.heap[i]!, this.heap[parent]!)) break;
      [this.heap[i], this.heap[parent]] = [this.heap[parent]!, this.heap[i]!];
      i = parent;
    }
  }

  private pop(): Entry | undefined {
    const top = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length && last) {
      this.heap[0] = last;
      this.down(0);
    }
    return top;
  }

  private down(start: number): void {
    const n = this.heap.length;
    let i = start;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < n && this.less(this.heap[l]!, this.heap[m]!)) m = l;
      if (r < n && this.less(this.heap[r]!, this.heap[m]!)) m = r;
      if (m === i) return;
      [this.heap[i], this.heap[m]] = [this.heap[m]!, this.heap[i]!];
      i = m;
    }
  }
}
