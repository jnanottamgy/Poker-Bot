import { Redis } from 'ioredis';
import type { BusHandler, MessageBus, Unsubscribe } from './bus';

/**
 * Redis pub/sub bus for multi-node deployments. One connection publishes, one
 * subscribes (Redis requires a dedicated connection in subscriber mode).
 * Messages are JSON encoded.
 */
export class RedisBus implements MessageBus {
  private readonly pub: Redis;
  private readonly sub: Redis;
  private readonly handlers = new Map<string, Set<BusHandler>>();

  constructor(url: string) {
    this.pub = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 3 });
    this.sub = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: null });
    this.sub.on('message', (channel: string, raw: string) => {
      const set = this.handlers.get(channel);
      if (!set) return;
      let message: unknown;
      try {
        message = JSON.parse(raw);
      } catch {
        return;
      }
      for (const h of [...set]) h(message);
    });
  }

  async publish(channel: string, message: unknown): Promise<void> {
    await this.pub.publish(channel, JSON.stringify(message));
  }

  async subscribe(channel: string, handler: BusHandler): Promise<Unsubscribe> {
    let set = this.handlers.get(channel);
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
      await this.sub.subscribe(channel);
    }
    set.add(handler);
    return async () => {
      const s = this.handlers.get(channel);
      if (!s) return;
      s.delete(handler);
      if (s.size === 0) {
        this.handlers.delete(channel);
        await this.sub.unsubscribe(channel);
      }
    };
  }

  /** Exposes the command connection for leases and shared rate limits. */
  get client(): Redis {
    return this.pub;
  }

  async close(): Promise<void> {
    this.handlers.clear();
    await Promise.allSettled([this.sub.quit(), this.pub.quit()]);
  }
}
