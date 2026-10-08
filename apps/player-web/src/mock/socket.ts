import type { SocketLike } from '@jpb/client-sdk';
import type { ClientMessage, ServerMessage } from '@jpb/shared-types';
import type { MockConn, MockServer } from './server';

const OPEN = 1;
const CLOSED = 3;
let nextId = 1;

/**
 * In-browser stand-in for a WebSocket to the game server. It satisfies the
 * same `SocketLike` surface JpbClient expects (injected via `socketFactory`),
 * serializes every frame as JSON like the real wire, and adds a small
 * latency so "Submitting…" states are visible.
 */
export class MockSocket implements SocketLike {
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  private readonly conn: MockConn;

  constructor(
    readonly url: string,
    private readonly server: () => MockServer,
    private readonly latencyMs = 70,
  ) {
    const deliver = (msg: ServerMessage) => {
      if (this.readyState === OPEN) this.onmessage?.({ data: JSON.stringify(msg) });
    };
    this.conn = {
      id: nextId++,
      audience: null,
      controller: false,
      push: (msg: ServerMessage) => {
        setTimeout(() => deliver(msg), this.latencyMs);
      },
      drop: () => {
        setTimeout(() => this.terminate(), this.latencyMs);
      },
    };
    setTimeout(() => {
      if (this.readyState !== 0) return;
      if (this.server().isDown()) {
        this.readyState = CLOSED;
        this.onerror?.({});
        this.onclose?.({ code: 1006 });
        return;
      }
      this.readyState = OPEN;
      this.onopen?.({});
    }, 40);
  }

  send(data: string): void {
    if (this.readyState !== OPEN) return;
    const msg = JSON.parse(data) as ClientMessage;
    setTimeout(() => {
      if (this.readyState === OPEN) this.server().onMessage(this.conn, msg);
    }, this.latencyMs);
  }

  close(): void {
    if (this.readyState === CLOSED) return;
    const wasOpen = this.readyState === OPEN;
    this.readyState = CLOSED;
    if (wasOpen) this.server().onClose(this.conn);
    setTimeout(() => this.onclose?.({ code: 1000 }), 0);
  }

  /** Server-side drop (network loss, server refusal). */
  private terminate(): void {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    this.server().onClose(this.conn);
    this.onclose?.({ code: 1006 });
  }
}
