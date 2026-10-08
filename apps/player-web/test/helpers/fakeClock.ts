/** Deterministic timer queue for tests (mock server and client scheduler). */
export class FakeClock {
  t = 1_700_000_000_000;
  private seq = 0;
  private readonly timers = new Map<number, { at: number; fn: () => void; every: number | null }>();

  now = (): number => this.t;

  setTimeout = (fn: () => void, ms: number): number => {
    const id = ++this.seq;
    this.timers.set(id, { at: this.t + Math.max(0, ms), fn, every: null });
    return id;
  };

  clearTimeout = (h: unknown): void => {
    this.timers.delete(h as number);
  };

  setInterval = (fn: () => void, ms: number): number => {
    const id = ++this.seq;
    this.timers.set(id, { at: this.t + ms, fn, every: ms });
    return id;
  };

  clearInterval = (h: unknown): void => {
    this.timers.delete(h as number);
  };

  get pending(): number {
    return this.timers.size;
  }

  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      let next: [number, { at: number; fn: () => void; every: number | null }] | null = null;
      for (const e of this.timers) if (e[1].at <= end && (!next || e[1].at < next[1].at || (e[1].at === next[1].at && e[0] < next[0]))) next = e;
      if (!next) break;
      const [id, timer] = next;
      this.t = timer.at;
      if (timer.every !== null) timer.at += timer.every;
      else this.timers.delete(id);
      timer.fn();
    }
    this.t = end;
  }
}
