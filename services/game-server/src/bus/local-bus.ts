import type { BusHandler, MessageBus, Unsubscribe } from './bus';

/**
 * In-process bus. Messages are delivered asynchronously (microtask) but in
 * publish order per channel, mirroring Redis pub/sub semantics so code that
 * works on one node works across many.
 */
export class LocalBus implements MessageBus {
  private readonly handlers = new Map<string, Set<BusHandler>>();
  private closed = false;

  async publish(channel: string, message: unknown): Promise<void> {
    if (this.closed) return;
    const set = this.handlers.get(channel);
    if (!set || set.size === 0) return;
    // Snapshot handlers so (un)subscribing during delivery is safe.
    const targets = [...set];
    // structuredClone isolates subscribers from each other and from the publisher (like serialization would).
    const payload = structuredClone(message);
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
