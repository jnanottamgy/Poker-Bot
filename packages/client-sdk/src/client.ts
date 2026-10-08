import type { ClientAudience, ClientMessage, ServerMessage } from '@jpb/shared-types';
import { PROTOCOL_VERSION } from '@jpb/shared-types';
import { ActionSubmitter } from './actions';
import type { ActionOutcome, SubmitInput } from './actions';
import { ClockSync } from './clock';
import { GameConnection, defaultScheduler } from './connection';
import type { Scheduler, SocketFactory } from './connection';
import { GameStore } from './store';

export interface JpbClientOptions {
  /** e.g. wss://host/ws (auth rides on the session cookie). */
  url: string;
  audience: ClientAudience;
  tournamentId: string;
  socketFactory?: SocketFactory;
  scheduler?: Scheduler;
  actionTimeoutMs?: number;
}

/**
 * The single object an app needs: connection + clock sync + server-state
 * store + idempotent action submission.
 */
export class JpbClient {
  readonly store = new GameStore();
  readonly clock = new ClockSync();
  private readonly connection: GameConnection;
  private readonly actions: ActionSubmitter;
  private watchedTableId: string | null = null;

  constructor(private readonly opts: JpbClientOptions) {
    const scheduler = opts.scheduler ?? defaultScheduler;
    const socketFactory = opts.socketFactory ?? ((url: string) => new WebSocket(url) as unknown as ReturnType<SocketFactory>);
    this.connection = new GameConnection({
      url: opts.url,
      socketFactory,
      scheduler,
      hello: () => this.hello(),
      onMessage: (msg, at) => this.onMessage(msg, at),
      onStatus: (status) => this.store.update({ connection: status, ...(status !== 'open' ? { synced: false } : {}) }),
      onOpen: () => {
        this.send({ t: 'ping', ct: scheduler.now() });
        this.actions.resendPending();
        if (this.watchedTableId) this.send({ t: 'watch', tableId: this.watchedTableId });
      },
    });
    this.actions = new ActionSubmitter((m) => this.connection.send(m), this.store, scheduler, opts.actionTimeoutMs);
  }

  connect(): void {
    this.connection.connect();
  }

  close(): void {
    this.connection.close();
  }

  /** Call on browser 'online' / 'visibilitychange' (visible) to reconnect immediately. */
  nudge(): void {
    this.connection.nudge();
  }

  act(input: SubmitInput): Promise<ActionOutcome> {
    return this.actions.submit(input);
  }

  /** Make this device the active controller (after "Another device is connected"). */
  takeover(): void {
    this.send({ t: 'takeover' });
  }

  requestSnapshot(): void {
    this.send({ t: 'snapshot_request' });
  }

  /** Spectators/admins: choose which table to follow (null = tournament only). */
  watch(tableId: string | null): void {
    this.watchedTableId = tableId;
    this.send({ t: 'watch', tableId });
  }

  private send(msg: ClientMessage): boolean {
    return this.connection.send(msg);
  }

  private hello(): ClientMessage {
    const s = this.store.getState();
    return {
      t: 'hello',
      v: PROTOCOL_VERSION,
      audience: this.opts.audience,
      tournamentId: this.opts.tournamentId,
      resume: s.lastTournamentSeq > 0 || s.lastTableSeq > 0 ? { tableId: s.table?.tableId ?? null, tableSeq: s.lastTableSeq, tournamentSeq: s.lastTournamentSeq } : null,
    };
  }

  private onMessage(msg: ServerMessage, receivedAt: number): void {
    this.clock.observeServerTime(msg.st, receivedAt);
    if (msg.t === 'pong') {
      this.clock.recordPong(msg.ct, msg.st, receivedAt);
      this.store.update({ serverOffsetMs: this.clock.offsetMs, rttMs: this.clock.rttMs });
      return;
    }
    if (msg.t === 'action_result') {
      this.actions.onResult(msg.actionId, msg.ok, msg.code, msg.message);
      return;
    }
    const needsSnapshot = this.store.apply(msg);
    if (needsSnapshot) this.requestSnapshot();
  }
}
