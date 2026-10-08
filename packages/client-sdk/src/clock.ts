/**
 * Estimates the offset between this device's clock and the server clock
 * (NTP-style, keeping the sample with the smallest round trip). Used ONLY to
 * draw countdowns; the server alone decides whether an action was in time.
 */
export interface ClockSample {
  offsetMs: number;
  rttMs: number;
  at: number;
}

export class ClockSync {
  private samples: ClockSample[] = [];
  private roughOffset: number | null = null;

  constructor(private readonly maxSamples = 8) {}

  /** A pong for a ping sent at client time `ct`, received at client time `receivedAt`, carrying server time `st`. */
  recordPong(ct: number, st: number, receivedAt: number): void {
    const rtt = Math.max(0, receivedAt - ct);
    const offsetMs = st + rtt / 2 - receivedAt;
    this.samples.push({ offsetMs, rttMs: rtt, at: receivedAt });
    if (this.samples.length > this.maxSamples) this.samples.shift();
  }

  /** Any server frame carries `st`; before the first pong it bounds the offset. */
  observeServerTime(st: number, receivedAt: number): void {
    if (this.roughOffset === null) this.roughOffset = st - receivedAt;
  }

  get offsetMs(): number {
    if (this.samples.length === 0) return this.roughOffset ?? 0;
    let best = this.samples[0]!;
    for (const s of this.samples) if (s.rttMs < best.rttMs) best = s;
    return Math.round(best.offsetMs);
  }

  get rttMs(): number | null {
    if (this.samples.length === 0) return null;
    return Math.min(...this.samples.map((s) => s.rttMs));
  }

  serverNow(clientNow: number): number {
    return clientNow + this.offsetMs;
  }

  /** Milliseconds until a server deadline, as seen from this device right now. */
  remainingMs(deadline: number | null, clientNow: number): number {
    if (deadline === null) return 0;
    return Math.max(0, deadline - this.serverNow(clientNow));
  }
}
