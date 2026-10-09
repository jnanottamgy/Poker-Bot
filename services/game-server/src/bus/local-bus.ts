import type { BusHandler, MessageBus, Unsubscribe } from './bus';

/**
 * In-process bus. Messages are delivered asynchronously (microtask) but in
 * publish order per channel, mirroring Redis pub/sub semantics so code that
 * works on one node works across many.
 */
export interface LocalBusOptions {
  /**
   * How subscribers are protected from each other and from the publisher.
   * 'none' (production): messages are immutable by contract and shared as is —
   * copying every message was the single largest CPU cost under load.
   * 'freeze' (default, tests): messages are deep-frozen, so any code that
   * mutates a published message fails loudly instead of corrupting others.
   */
  isolation?: 'none' | 'freeze';
}

export class LocalBus implements MessageBus {
  private readonly handlers = new Map<string, Set<BusHandler>>();
  private closed = false;
  private readonly freeze: boolean;

  constructor(opts: LocalBusOptions = {}) {
    this.freeze = (opts.isolation ?? 'freeze') === 'freeze';
  }

  async publish(channel: string, message: unknown): Promise<void> {
    if (this.closed) return;
    const set = this.handlers.get(channel);
    if (!set || set.size === 0) return;
    // Snapshot handlers so (un)subscribing during delivery is safe.
    const targets = [...set];
    const payload = this.freeze ? deepFreeze(message) : message;
    queueMicrotask(() => {
      for (const h of targets) {
        try {
          h(payload);
        } catch (err) {
          queueMicrotask(() => {
            throw err;
          });
        }
      }
    });
  }

  async subscribe(channel: string, handler: BusHandler): Promise<Unsubscribe> {
    let set = this.handlers.get(channel);
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
    }
    set.add(handler);
    return async () => {
      const s = this.handlers.get(channel);
      s?.delete(handler);
      if (s && s.size === 0) this.handlers.delete(channel);
    };
  }

  subscriberCount(channel: string): number {
    return this.handlers.get(channel)?.size ?? 0;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.handlers.clear();
  }
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value) || ArrayBuffer.isView(value)) return value;
  Object.freeze(value);
  for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  return value;
}
