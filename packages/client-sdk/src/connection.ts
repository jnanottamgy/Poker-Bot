import type { ClientMessage, ServerMessage } from '@jpb/shared-types';
import { randomUnit } from './random';

export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'replaced' | 'closed';

/** Minimal WebSocket surface (browser WebSocket and the `ws` package both satisfy it). */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

export type SocketFactory = (url: string) => SocketLike;

export interface Scheduler {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export const defaultScheduler: Scheduler = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};

export interface ConnectionOptions {
  url: string;
  socketFactory: SocketFactory;
  /** Built at every (re)connect so it can carry the latest resume cursor. */
  hello: () => ClientMessage;
  onMessage: (msg: ServerMessage, receivedAt: number) => void;
  onStatus: (status: ConnectionStatus, attempt: number) => void;
  onOpen?: () => void;
  scheduler?: Scheduler;
  heartbeatMs?: number;
  /** No frame for this long => the socket is considered dead and replaced. */
  deadAfterMs?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
}

const OPEN = 1;

/**
 * Resilient WebSocket connection: authenticates via cookies on the upgrade
 * request, sends `hello` on every open, heartbeats with ping/pong, detects
 * dead sockets (phone lock, Wi-Fi handover), and reconnects with capped
 * exponential backoff and full jitter. Stops reconnecting when the server
 * says the session moved to another device.
 */
export class GameConnection {
  private socket: SocketLike | null = null;
  private status: ConnectionStatus = 'idle';
  private attempt = 0;
  private reconnectTimer: unknown = null;
  private heartbeatTimer: unknown = null;
  private lastFrameAt = 0;
  private manuallyClosed = false;
  private readonly s: Scheduler;

  constructor(private readonly opts: ConnectionOptions) {
    this.s = opts.scheduler ?? defaultScheduler;
  }

  get currentStatus(): ConnectionStatus {
    return this.status;
  }

  connect(): void {
    this.manuallyClosed = false;
    if (this.socket && (this.status === 'open' || this.status === 'connecting')) return;
    this.open();
  }

  /** Immediately retry (e.g. browser came back online or the tab became visible). */
  nudge(): void {
    if (this.manuallyClosed || this.status === 'replaced') return;
    if (this.status === 'reconnecting' || this.status === 'idle') {
      if (this.reconnectTimer !== null) this.s.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      this.open();
    }
  }

  send(msg: ClientMessage): boolean {
    if (!this.socket || this.socket.readyState !== OPEN || this.status !== 'open') return false;
    this.socket.send(JSON.stringify(msg));
    return true;
  }

  close(): void {
    this.manuallyClosed = true;
    this.cleanupTimers();
    const s = this.socket;
    this.socket = null;
    s?.close(1000, 'client closed');
    this.setStatus('closed');
  }

  private open(): void {
    this.cleanupTimers();
    this.setStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');
    let socket: SocketLike;
    try {
      socket = this.opts.socketFactory(this.opts.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.attempt = 0;
      this.lastFrameAt = this.s.now();
      this.setStatus('open');
      socket.send(JSON.stringify(this.opts.hello()));
      this.startHeartbeat();
      this.opts.onOpen?.();
    };
    socket.onmessage = (ev) => {
      if (this.socket !== socket) return;
      const receivedAt = this.s.now();
      this.lastFrameAt = receivedAt;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      if (msg.t === 'session_replaced') {
        this.opts.onMessage(msg, receivedAt);
        this.manuallyClosed = true;
        this.cleanupTimers();
        this.socket = null;
        socket.close(4001, 'replaced');
        this.setStatus('replaced');
        return;
      }
      this.opts.onMessage(msg, receivedAt);
    };
    socket.onerror = () => {
      /* onclose follows */
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.cleanupTimers();
      if (this.manuallyClosed) return;
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    this.attempt += 1;
    this.setStatus('reconnecting');
    const base = this.opts.baseBackoffMs ?? 500;
    const cap = this.opts.maxBackoffMs ?? 10_000;
    const ceiling = Math.min(cap, base * 2 ** Math.min(this.attempt - 1, 10));
    // Full jitter spreads a reconnect storm (e.g. venue Wi-Fi blip) across the window.
    const delay = this.attempt === 1 ? Math.round(randomUnit() * base) : Math.round(randomUnit() * ceiling);
    this.reconnectTimer = this.s.setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.manuallyClosed) this.open();
    }, delay);
  }

  private startHeartbeat(): void {
    const every = this.opts.heartbeatMs ?? 10_000;
    const deadAfter = this.opts.deadAfterMs ?? 25_000;
    this.heartbeatTimer = this.s.setInterval(() => {
      const now = this.s.now();
      if (now - this.lastFrameAt > deadAfter) {
        const s = this.socket;
        this.socket = null;
        this.cleanupTimers();
        s?.close(4000, 'heartbeat timeout');
        if (!this.manuallyClosed) this.scheduleReconnect();
        return;
      }
      this.send({ t: 'ping', ct: now });
    }, every);
  }

  private cleanupTimers(): void {
    if (this.heartbeatTimer !== null) this.s.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    if (this.reconnectTimer !== null) this.s.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status && status !== 'reconnecting') return;
    this.status = status;
    this.opts.onStatus(status, this.attempt);
  }
}
