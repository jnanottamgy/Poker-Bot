interface Item {
  releaseAt: number;
  run: () => void;
}

interface Queue {
  items: Item[];
  head: number;
  timer: NodeJS.Timeout | null;
  lastReleaseAt: number;
}

/**
 * Per-key (per-tournament) FIFO delay line for spectator/display frames
 * (`spectators.delaySeconds`, anti-ghosting). Items are released in exactly
 * the order they were pushed: when the delay is lowered mid-tournament a new
 * item is never released before an older one. A zero delay with an empty
 * queue runs the item immediately (no timer, no reordering).
 */
export class DelayQueue {
  private readonly queues = new Map<string, Queue>();

  constructor(
    private readonly now: () => number,
    private readonly onError: (err: unknown) => void = () => undefined,
  ) {}

  push(key: string, delayMs: number, run: () => void): void {
    let q = this.queues.get(key);
    if (delayMs <= 0 && (!q || q.head >= q.items.length)) {
      this.safeRun(run);
      return;
    }
    if (!q) {
      q = { items: [], head: 0, timer: null, lastReleaseAt: 0 };
      this.queues.set(key, q);
    }
    const releaseAt = Math.max(this.now() + Math.max(0, delayMs), q.lastReleaseAt);
    q.lastReleaseAt = releaseAt;
    q.items.push({ releaseAt, run });
    if (!q.timer) this.schedule(key, q);
  }

  pending(key: string): number {
    const q = this.queues.get(key);
    return q ? q.items.length - q.head : 0;
  }

  /** Drops everything queued under `key` (no watchers left). */
  clear(key: string): void {
    const q = this.queues.get(key);
    if (q?.timer) clearTimeout(q.timer);
    this.queues.delete(key);
  }

  close(): void {
    for (const key of [...this.queues.keys()]) this.clear(key);
  }

  private schedule(key: string, q: Queue): void {
    const next = q.items[q.head];
    if (!next) {
      this.queues.delete(key);
      return;
    }
    q.timer = setTimeout(() => this.release(key, q), Math.max(0, next.releaseAt - this.now()));
    q.timer.unref?.();
  }

  private release(key: string, q: Queue): void {
    q.timer = null;
    if (this.queues.get(key) !== q) return;
    const now = this.now();
    while (q.head < q.items.length && (q.items[q.head]?.releaseAt ?? Infinity) <= now) {
      const item = q.items[q.head]!;
      q.head++;
      this.safeRun(item.run);
    }
    if (q.head > 1024 && q.head * 2 > q.items.length) {
      q.items = q.items.slice(q.head);
      q.head = 0;
    }
    this.schedule(key, q);
  }

  private safeRun(run: () => void): void {
    try {
      run();
    } catch (err) {
      this.onError(err);
    }
  }
}
