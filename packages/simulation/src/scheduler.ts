/**
 * Virtual clock + deterministic timer queue. Simulated time advances
 * instantly; timers with equal times fire in insertion order.
 */
export interface Scheduled<T> {
  at: number;
  seq: number;
  item: T;
}

export class VirtualScheduler<T> {
  now: number;
  private heap: Scheduled<T>[] = [];
  private seq = 0;

  constructor(start: number) {
    this.now = start;
  }

  schedule(at: number, item: T): void {
    const entry = { at: Math.max(at, this.now), seq: this.seq++, item };
    this.heap.push(entry);
    let i = this.heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.less(this.heap[i]!, this.heap[p]!)) {
        [this.heap[i], this.heap[p]] = [this.heap[p]!, this.heap[i]!];
        i = p;
      } else break;
    }
  }

  /** Removes and returns the earliest timer, advancing the clock to it. */
  pop(): T | null {
    const top = this.heap[0];
    if (!top) return null;
    const last = this.heap.pop()!;
    if (this.heap.length) {
      this.heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.heap.length && this.less(this.heap[l]!, this.heap[m]!)) m = l;
        if (r < this.heap.length && this.less(this.heap[r]!, this.heap[m]!)) m = r;
        if (m === i) break;
        [this.heap[i], this.heap[m]] = [this.heap[m]!, this.heap[i]!];
        i = m;
      }
    }
    this.now = Math.max(this.now, top.at);
    return top.item;
  }

  get size(): number {
    return this.heap.length;
  }

  private less(a: Scheduled<T>, b: Scheduled<T>): boolean {
    return a.at < b.at || (a.at === b.at && a.seq < b.seq);
  }
}
