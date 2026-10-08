import type { MessageBus, Unsubscribe } from '../bus/bus';

interface Entry {
  refs: number;
  unsub: Unsubscribe | null;
  /** Serializes subscribe/unsubscribe for this channel. */
  op: Promise<void>;
}

/**
 * Reference-counted bus subscriptions: one bus subscription per channel per
 * node, however many local sockets need it. With 10,000 spectators on one
 * table a node still receives each table update exactly once and fans it
 * out locally. Subscribe/unsubscribe for a channel are serialized so a
 * release racing an acquire can never leave a needed channel unsubscribed.
 */
export class SubscriptionHub {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly bus: MessageBus,
    private readonly route: (channel: string, message: unknown) => void,
    private readonly onError: (err: unknown, channel: string) => void = () => undefined,
  ) {}

  /** Resolves once the bus subscription is active. Every acquire must be paired with a release. */
  acquire(channel: string): Promise<void> {
    let entry = this.entries.get(channel);
    if (!entry) {
      entry = { refs: 0, unsub: null, op: Promise.resolve() };
      this.entries.set(channel, entry);
    }
    entry.refs++;
    const e = entry;
    const step = e.op.then(async () => {
      if (e.refs > 0 && !e.unsub) e.unsub = await this.bus.subscribe(channel, (m) => this.dispatch(channel, m));
    });
    e.op = step.catch(() => undefined);
    return step;
  }

  release(channel: string): void {
    const e = this.entries.get(channel);
    if (!e || e.refs === 0) return;
    e.refs--;
    e.op = e.op
      .then(async () => {
        if (e.refs > 0) return;
        const unsub = e.unsub;
        e.unsub = null;
        if (unsub) await unsub();
        if (e.refs === 0 && this.entries.get(channel) === e) this.entries.delete(channel);
      })
      .catch((err: unknown) => this.onError(err, channel));
  }

  refs(channel: string): number {
    return this.entries.get(channel)?.refs ?? 0;
  }

  /** Resolves when all pending (un)subscribe operations have settled. */
  async idle(): Promise<void> {
    await Promise.all([...this.entries.values()].map((e) => e.op));
  }

  private dispatch(channel: string, message: unknown): void {
    try {
      this.route(channel, message);
    } catch (err) {
      this.onError(err, channel);
    }
  }
}
