import type { Scheduler, SocketLike } from '../src/connection';

export class FakeScheduler implements Scheduler {
  t = 1_000_000;
  private seq = 0;
  private timers = new Map<number, { at: number; fn: () => void; every: number | null }>();
  now = () => this.t;
  setTimeout = (fn: () => void, ms: number) => {
    const id = ++this.seq;
    this.timers.set(id, { at: this.t + ms, fn, every: null });
    return id;
  };
  clearTimeout = (h: unknown) => void this.timers.delete(h as number);
  setInterval = (fn: () => void, ms: number) => {
    const id = ++this.seq;
    this.timers.set(id, { at: this.t + ms, fn, every: ms });
    return id;
  };
  clearInterval = (h: unknown) => void this.timers.delete(h as number);
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      let next: [number, { at: number; fn: () => void; every: number | null }] | null = null;
      for (const e of this.timers) if (e[1].at <= end && (!next || e[1].at < next[1].at)) next = e;
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

export class FakeSocket implements SocketLike {
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: unknown[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({});
  }
  serverOpen(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  serverSend(msg: unknown): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  serverDrop(): void {
    this.readyState = 3;
    this.onclose?.({});
  }
  static latest(): FakeSocket {
    return FakeSocket.instances[FakeSocket.instances.length - 1]!;
  }
}
