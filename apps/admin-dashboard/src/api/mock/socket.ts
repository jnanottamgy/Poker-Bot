import { PROTOCOL_VERSION } from '@jpb/shared-types';
import type { ClientMessage, ServerMessage, TournamentEventEnvelope } from '@jpb/shared-types';
import type { SocketFactory, SocketLike } from '@jpb/client-sdk';
import type { MockServer } from './server';
import type { MockTable, MockTournament } from './state';
import { adminTableView, summary } from './views';

/** Recent events replayed after the snapshot so a fresh control room has a populated live feed. */
const REPLAY_EVENTS = 14;

/**
 * In-browser stand-in for the game server's `/ws` endpoint, speaking the
 * real protocol (packages/shared-types/src/protocol.ts) to an unmodified
 * JpbClient through its `socketFactory` option.
 */
export class MockSocket implements SocketLike {
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  private tournamentId: string | null = null;
  private watched: string | null = null;
  private tableSeq = 0;
  private readonly unsubs: Array<() => void> = [];

  constructor(
    private readonly server: MockServer,
    private readonly hub: MockSocketHub,
    refuse: boolean,
  ) {
    setTimeout(() => {
      if (this.readyState === 3) return;
      if (refuse) {
        this.readyState = 3;
        this.onclose?.({ code: 1006 });
        return;
      }
      this.readyState = 1;
      this.onopen?.({});
    }, 40);
  }

  send(data: string): void {
    if (this.readyState !== 1) return;
    const msg = JSON.parse(data) as ClientMessage;
    switch (msg.t) {
      case 'hello':
        this.hello(msg.tournamentId);
        break;
      case 'ping':
        this.push({ t: 'pong', st: this.server.now(), ct: msg.ct });
        break;
      case 'watch':
        this.watched = msg.tableId;
        this.tableSeq = 0;
        if (msg.tableId) this.sendTable();
        break;
      case 'snapshot_request':
        if (this.tournamentId) this.snapshot(0);
        break;
      default:
        this.push({ t: 'error', st: this.server.now(), code: 'NOT_ALLOWED', message: 'Admins cannot act at tables.' });
    }
  }

  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    for (const u of this.unsubs.splice(0)) u();
    this.hub.forget(this);
    setTimeout(() => this.onclose?.({ code: 1000 }), 0);
  }

  private push(msg: ServerMessage): void {
    if (this.readyState !== 1) return;
    const data = JSON.stringify(msg);
    // Async delivery, like a real socket.
    setTimeout(() => this.readyState === 1 && this.onmessage?.({ data }), 0);
  }

  private tournament(): MockTournament | null {
    return this.server.world.tournaments.find((t) => t.id === this.tournamentId) ?? null;
  }

  private hello(tournamentId: string): void {
    const admin = this.server.currentAdmin();
    if (!admin) {
      this.push({ t: 'error', st: this.server.now(), code: 'UNAUTHENTICATED', message: 'Please sign in.' });
      return;
    }
    if (admin.tournamentScope && !admin.tournamentScope.includes(tournamentId)) {
      this.push({ t: 'error', st: this.server.now(), code: 'OUT_OF_SCOPE', message: 'You are not assigned to this tournament.' });
      return;
    }
    this.tournamentId = tournamentId;
    const t = this.tournament();
    if (!t) {
      this.push({ t: 'error', st: this.server.now(), code: 'NOT_FOUND', message: 'Tournament not found.' });
      return;
    }
    this.push({ t: 'welcome', st: this.server.now(), sessionId: this.server.world.currentSessionId ?? 'mock', audience: 'ADMIN', protocol: PROTOCOL_VERSION });
    const replay = t.events.slice(-REPLAY_EVENTS);
    this.snapshot(replay.length);
    for (const env of replay) this.sendEvent(t, env);
    this.unsubs.push(
      this.server.onEvent((tt, env) => tt.id === this.tournamentId && this.sendEvent(tt, env)),
      this.server.onTable((tt, table) => tt.id === this.tournamentId && table.tableId === this.watched && this.sendTable(table)),
    );
  }

  private snapshot(holdBack: number): void {
    const t = this.tournament();
    if (!t) return;
    const s = summary(t);
    const table = this.watched ? t.tables.find((x) => x.tableId === this.watched) : undefined;
    this.push({
      t: 'snapshot',
      st: this.server.now(),
      snapshot: { audience: 'ADMIN', tournament: { ...s, lastSeq: Math.max(0, s.lastSeq - holdBack) }, table: table ? this.view(t, table) : null },
    });
  }

  private sendEvent(t: MockTournament, env: TournamentEventEnvelope): void {
    this.push({ t: 'tournament_event', st: this.server.now(), event: env, summary: summary(t) });
  }

  private view(t: MockTournament, table: MockTable) {
    const admin = this.server.currentAdmin();
    return adminTableView(t, table, this.server.now(), admin ? table.revealedTo.includes(admin.id) : false);
  }

  private sendTable(table?: MockTable): void {
    const t = this.tournament();
    const tb = table ?? t?.tables.find((x) => x.tableId === this.watched);
    if (!t || !tb) return;
    const view = this.view(t, tb);
    const fromSeq = this.tableSeq + 1;
    this.tableSeq = Math.max(fromSeq, view.lastEventSeq);
    this.push({ t: 'table_update', st: this.server.now(), tableId: tb.tableId, fromSeq, toSeq: this.tableSeq, version: view.version, events: [], view });
  }
}

/** Tracks open mock sockets; can simulate a network drop for demos and screenshots. */
export class MockSocketHub {
  private readonly sockets = new Set<MockSocket>();
  private refuseUntil = 0;

  constructor(private readonly server: MockServer) {}

  readonly factory: SocketFactory = () => {
    const s = new MockSocket(this.server, this, Date.now() < this.refuseUntil);
    this.sockets.add(s);
    return s;
  };

  forget(s: MockSocket): void {
    this.sockets.delete(s);
  }

  /** Drop every connection and refuse reconnects for `ms` (the UI must show "reconnecting", data greyed). */
  drop(ms = 8000): void {
    this.refuseUntil = Date.now() + ms;
    for (const s of [...this.sockets]) {
      s.readyState = 3;
      this.sockets.delete(s);
      s.onclose?.({ code: 1006 });
    }
  }
}
