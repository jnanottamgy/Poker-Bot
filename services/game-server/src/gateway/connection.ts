import type { WebSocket } from 'ws';
import type { ClientAudience } from '@jpb/shared-types';
import type { AdminUserRecord } from '../persistence/repos/admins';
import { RateLimiter } from '../security/rate-limit';
import { newId } from '../security/ids';
import { CLOSE_CODES } from './options';
import type { GatewayOptions } from './options';

/** Identity established from cookies on the upgrade request (either, both or neither may be present). */
export interface GatewayPrincipal {
  player: { token: string; sessionId: string; playerId: string; tournamentId: string } | null;
  admin: { token: string; sessionId: string; admin: AdminUserRecord } | null;
}

export interface ConnectionHooks {
  /** A frame was written to the socket. */
  sent(conn: Connection): void;
  /** A stale socket drained below the low-water mark: resync it with a snapshot. */
  drained(conn: Connection): void;
  error(err: unknown, conn: Connection): void;
}

type PendingFrame =
  | { kind: 'table'; tableId: string; version: number; frame: string }
  | { kind: 'tournament'; seq: number; frame: string }
  | { kind: 'other'; frame: string };

/** Bus frames held while a snapshot is being built; beyond this the oldest are dropped (views are complete). */
const MAX_PENDING = 512;

const OPEN = 1;

/**
 * One client socket: its identity, audience state, rate limits, ordering
 * and backpressure. Frames from the bus are buffered while a snapshot is
 * being assembled and then flushed only if newer than the snapshot, so a
 * client never sees state go backwards.
 */
export class Connection {
  readonly id = newId('wsc');
  audience: ClientAudience | null = null;
  tournamentId: string | null = null;
  /** Player identity bound to this socket (PLAYER, or SPECTATOR with a player session of this tournament). */
  playerId: string | null = null;
  isController = false;
  /** The table whose updates this socket receives. */
  tableId: string | null = null;
  /** Tables for which this ADMIN socket performed an audited hole-card reveal. */
  readonly revealedTables = new Set<string>();
  readonly channels = new Set<string>();
  lastSeenAt: number;
  lastAuthCheckAt: number;
  helloTimer: NodeJS.Timeout | null = null;
  /** Set once close was requested; no more frames are written. */
  closing = false;
  /** Set once the socket closed and the gateway cleaned up. */
  closed = false;
  stale = false;
  rateViolations = 0;

  readonly messageLimiter: RateLimiter;
  readonly actionLimiter: RateLimiter;
  readonly snapshotLimiter: RateLimiter;

  private syncDepth = 0;
  private pending: PendingFrame[] = [];
  private lastTableVersion = -1;
  private lastTournamentSeq = -1;
  private chain: Promise<void> = Promise.resolve();
  private actionChain: Promise<void> = Promise.resolve();
  private drainTimer: NodeJS.Timeout | null = null;

  constructor(
    readonly socket: WebSocket,
    public principal: GatewayPrincipal,
    readonly ip: string,
    private readonly opts: GatewayOptions,
    private readonly hooks: ConnectionHooks,
    now: number,
  ) {
    this.lastSeenAt = now;
    this.lastAuthCheckAt = now;
    this.messageLimiter = new RateLimiter(opts.limits.message, 1);
    this.actionLimiter = new RateLimiter(opts.limits.action, 1);
    this.snapshotLimiter = new RateLimiter(opts.limits.snapshot, 1);
  }

  /** Runs `fn` after every previously scheduled task of this connection (snapshots, table switches). */
  serial(fn: () => Promise<void>): Promise<void> {
    const next = this.chain.then(() => (this.closed ? undefined : fn()));
    this.chain = next.catch((err: unknown) => this.hooks.error(err, this));
    return this.chain;
  }

  /** Player actions keep their own queue so a slow snapshot never delays an action. */
  serialAction(fn: () => Promise<void>): Promise<void> {
    const next = this.actionChain.then(() => (this.closed ? undefined : fn()));
    this.actionChain = next.catch((err: unknown) => this.hooks.error(err, this));
    return this.actionChain;
  }

  /** Direct reply frames (welcome, snapshot, pong, action_result, error...). */
  send(frame: string): boolean {
    if (this.closing || this.closed || this.socket.readyState !== OPEN) return false;
    if (this.socket.bufferedAmount > this.opts.closeBufferBytes) {
      this.close(CLOSE_CODES.SLOW_CONSUMER, 'slow consumer');
      return false;
    }
    this.socket.send(frame);
    this.hooks.sent(this);
    return true;
  }

  sendTable(tableId: string, version: number, frame: string): void {
    if (this.closing || tableId !== this.tableId) return;
    if (this.syncDepth > 0) return this.hold({ kind: 'table', tableId, version, frame });
    if (version < this.lastTableVersion || this.stale) return;
    if (this.socket.bufferedAmount > this.opts.staleBufferBytes) {
      this.markStale();
      return;
    }
    this.lastTableVersion = version;
    this.send(frame);
  }

  sendTournament(seq: number, frame: string): void {
    if (this.closing) return;
    if (this.syncDepth > 0) return this.hold({ kind: 'tournament', seq, frame });
    if (seq <= this.lastTournamentSeq) return;
    this.lastTournamentSeq = seq;
    this.send(frame);
  }

  /** Other bus-sourced frames (self_update, notice): ordered after a snapshot in progress. */
  sendOrdered(frame: string): void {
    if (this.syncDepth > 0) return this.hold({ kind: 'other', frame });
    this.send(frame);
  }

  beginSync(): void {
    this.syncDepth++;
  }

  /** Ends a snapshot: the snapshot's versions become the baseline, then held frames newer than it are flushed. */
  endSync(baseline: { tableVersion: number | null; tournamentSeq: number | null }): void {
    this.lastTableVersion = baseline.tableVersion ?? -1;
    if (baseline.tournamentSeq !== null) this.lastTournamentSeq = Math.max(this.lastTournamentSeq, baseline.tournamentSeq);
    this.syncDepth = Math.max(0, this.syncDepth - 1);
    if (this.syncDepth > 0) return;
    const held = this.pending;
    this.pending = [];
    for (const p of held) {
      if (p.kind === 'table') {
        if (p.version > this.lastTableVersion) this.sendTable(p.tableId, p.version, p.frame);
      } else if (p.kind === 'tournament') this.sendTournament(p.seq, p.frame);
      else this.send(p.frame);
    }
  }

  /** Table switch: the next update/snapshot of the new table starts a fresh version baseline. */
  resetTableBaseline(): void {
    this.lastTableVersion = -1;
    this.pending = this.pending.filter((p) => p.kind !== 'table');
  }

  get syncing(): boolean {
    return this.syncDepth > 0;
  }

  /** Counts a frame against the per-connection message budget. */
  allowMessage(now: number): boolean {
    return this.messageLimiter.take('c', now);
  }

  close(code: number, reason: string): void {
    if (this.closing || this.closed) return;
    this.closing = true;
    this.stopDrainTimer();
    try {
      this.socket.close(code, reason);
    } catch {
      this.socket.terminate();
    }
  }

  dispose(): void {
    this.closed = true;
    this.closing = true;
    this.stopDrainTimer();
    if (this.helloTimer) clearTimeout(this.helloTimer);
    this.helloTimer = null;
    this.pending = [];
  }

  private hold(p: PendingFrame): void {
    if (this.pending.length >= MAX_PENDING) this.pending.shift();
    this.pending.push(p);
  }

  private markStale(): void {
    if (this.stale) return;
    this.stale = true;
    this.drainTimer = setInterval(() => this.checkDrain(), this.opts.drainCheckMs);
    this.drainTimer.unref?.();
  }

  private checkDrain(): void {
    if (this.closing || this.closed) return this.stopDrainTimer();
    const buffered = this.socket.bufferedAmount;
    if (buffered > this.opts.closeBufferBytes) {
      this.close(CLOSE_CODES.SLOW_CONSUMER, 'slow consumer');
      return;
    }
    if (buffered > this.opts.drainedBufferBytes) return;
    this.stopDrainTimer();
    this.stale = false;
    this.hooks.drained(this);
  }

  private stopDrainTimer(): void {
    if (this.drainTimer) clearInterval(this.drainTimer);
    this.drainTimer = null;
  }
}
