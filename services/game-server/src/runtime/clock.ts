/**
 * Time source and timer scheduling for the runtime shell. Production uses the
 * system clock; tests drive a ManualClock so timer, lease and recovery
 * behaviour is reproducible without sleeping.
 */
export type ClockTimer = { readonly __clockTimer: true };

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, delayMs: number): ClockTimer;
  clearTimeout(timer: ClockTimer): void;
}

/** Node's timers clamp delays above 2^31-1 ms to 1 ms; longer waits are re-armed by callers. */
export const MAX_TIMER_DELAY_MS = 2_147_483_647;

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout(fn, delayMs) {
    const t = setTimeout(fn, Math.min(Math.max(0, delayMs), MAX_TIMER_DELAY_MS));
    // Runtime timers never keep the process alive on their own (the HTTP server does).
    t.unref();
    return t as unknown as ClockTimer;
  },
  clearTimeout(timer) {
    clearTimeout(timer as unknown as NodeJS.Timeout);
  },
};

/** Resolves after `ms` on the given clock. */
export function sleep(clock: Clock, ms: number): Promise<void> {
  return new Promise((resolve) => clock.setTimeout(resolve, ms));
}

interface ManualTimer {
  id: number;
  at: number;
  fn: () => void;
}

/** Deterministic clock for tests: time only moves when `advance`/`set` is called. */
export class ManualClock implements Clock {
  private t: number;
  private nextId = 1;
  private readonly timers = new Map<number, ManualTimer>();

  constructor(start = 1_700_000_000_000) {
    this.t = start;
  }

  now(): number {
    return this.t;
  }

  setTimeout(fn: () => void, delayMs: number): ClockTimer {
    const id = this.nextId++;
    this.timers.set(id, { id, at: this.t + Math.max(0, delayMs), fn });
    return { id } as unknown as ClockTimer;
  }

  clearTimeout(timer: ClockTimer): void {
    this.timers.delete((timer as unknown as { id: number }).id);
  }

  pendingTimers(): number {
    return this.timers.size;
  }

  /**
   * Moves time forward by `ms`, running every due timer in (at, creation)
   * order with time set to its due instant, and letting promise callbacks
   * settle between timers.
   */
  async advance(ms: number): Promise<void> {
    const target = this.t + ms;
    for (;;) {
      let due: ManualTimer | undefined;
      for (const timer of this.timers.values()) {
        if (timer.at <= target && (!due || timer.at < due.at || (timer.at === due.at && timer.id < due.id))) due = timer;
      }
      if (!due) break;
      this.timers.delete(due.id);
      this.t = Math.max(this.t, due.at);
      due.fn();
      await settle();
    }
    this.t = target;
    await settle();
  }
}

/** Lets pending promise callbacks and immediates run. */
export async function settle(rounds = 3): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise<void>((r) => setImmediate(r));
}
