import type {
  ActionRejectCode,
  AdminTableView,
  ClientSnapshot,
  PlayerNotice,
  PlayerSelfSummary,
  PlayerTableView,
  ServerMessage,
  SpectatorTableView,
  TableEvent,
  TournamentEventEnvelope,
  TournamentPublicSummary,
} from '@jpb/shared-types';
import type { ConnectionStatus } from './connection';

export type AnyTableView = PlayerTableView | SpectatorTableView | AdminTableView;

export interface PendingActionState {
  actionId: string;
  tableId: string;
  type: string;
  amount: number | undefined;
  sentAt: number;
}

export interface LastActionResult {
  actionId: string;
  ok: boolean;
  code: ActionRejectCode | 'TIMEOUT' | 'NOT_CONNECTED' | null;
  message: string | null;
}

export interface GameState {
  connection: ConnectionStatus;
  /** True once at least one authoritative snapshot arrived on the current connection. */
  synced: boolean;
  anotherDevice: boolean;
  serverOffsetMs: number;
  rttMs: number | null;
  tournament: TournamentPublicSummary | null;
  self: PlayerSelfSummary | null;
  table: AnyTableView | null;
  /** Most recent table events (bounded), for animations and the hand log. */
  tableEvents: TableEvent[];
  lastTableSeq: number;
  tournamentEvents: TournamentEventEnvelope[];
  lastTournamentSeq: number;
  notices: PlayerNotice[];
  pendingAction: PendingActionState | null;
  lastActionResult: LastActionResult | null;
  lastError: { code: string; message: string } | null;
}

export const INITIAL_STATE: GameState = {
  connection: 'idle',
  synced: false,
  anotherDevice: false,
  serverOffsetMs: 0,
  rttMs: null,
  tournament: null,
  self: null,
  table: null,
  tableEvents: [],
  lastTableSeq: 0,
  tournamentEvents: [],
  lastTournamentSeq: 0,
  notices: [],
  pendingAction: null,
  lastActionResult: null,
  lastError: null,
};

const MAX_TABLE_EVENTS = 300;
const MAX_TOURNAMENT_EVENTS = 200;

/**
 * Client-side mirror of server state. It never computes game state: it only
 * stores what the server sent, and the latest server frame always replaces
 * whatever was there (spec §76). Compatible with React's useSyncExternalStore.
 */
export class GameStore {
  private state: GameState = INITIAL_STATE;
  private readonly listeners = new Set<() => void>();

  getState = (): GameState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  update(patch: Partial<GameState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of [...this.listeners]) l();
  }

  /** Applies one server frame. Returns true if the frame indicates a gap that warrants a snapshot request. */
  apply(msg: ServerMessage): boolean {
    switch (msg.t) {
      case 'snapshot':
        this.applySnapshot(msg.snapshot);
        return false;
      case 'table_update': {
        const s = this.state;
        const sameTable = s.table?.tableId === msg.tableId;
        const gap = sameTable && s.lastTableSeq > 0 && msg.fromSeq > s.lastTableSeq + 1;
        const fresh = msg.events.filter((e) => !sameTable || e.seq > s.lastTableSeq);
        const events = sameTable ? [...s.tableEvents, ...fresh] : fresh;
        this.update({
          table: msg.view,
          tableEvents: events.slice(-MAX_TABLE_EVENTS),
          lastTableSeq: Math.max(sameTable ? s.lastTableSeq : 0, msg.toSeq),
        });
        return gap;
      }
      case 'table_event': {
        const s = this.state;
        if (s.table && msg.event.tableId !== s.table.tableId) return false;
        if (msg.event.seq <= s.lastTableSeq) return false;
        const gap = s.lastTableSeq > 0 && msg.event.seq > s.lastTableSeq + 1;
        this.update({ tableEvents: [...s.tableEvents, msg.event].slice(-MAX_TABLE_EVENTS), lastTableSeq: msg.event.seq });
        return gap;
      }
      case 'tournament_event': {
        const s = this.state;
        if (msg.event.seq <= s.lastTournamentSeq) return false;
        const gap = s.lastTournamentSeq > 0 && msg.event.seq > s.lastTournamentSeq + 1;
        this.update({
          tournament: msg.summary ?? s.tournament,
          tournamentEvents: [...s.tournamentEvents, msg.event].slice(-MAX_TOURNAMENT_EVENTS),
          lastTournamentSeq: msg.event.seq,
        });
        return gap;
      }
      case 'self_update': {
        const tableChanged = this.state.self?.tableId !== msg.self.tableId;
        this.update({
          self: msg.self,
          ...(tableChanged ? { table: null, tableEvents: [], lastTableSeq: 0 } : {}),
        });
        return tableChanged && msg.self.tableId !== null;
      }
      case 'notice':
        this.update({ notices: [...this.state.notices, msg.notice] });
        return false;
      case 'another_device':
        this.update({ anotherDevice: true });
        return false;
      case 'error':
        this.update({ lastError: { code: msg.code, message: msg.message } });
        return false;
      default:
        return false;
    }
  }

  dismissNotice(index = 0): void {
    const notices = this.state.notices.slice();
    notices.splice(index, 1);
    this.update({ notices });
  }

  private applySnapshot(snap: ClientSnapshot): void {
    const table = 'table' in snap ? snap.table : snap.audience === 'DISPLAY' ? snap.featured : null;
    this.update({
      synced: true,
      anotherDevice: false,
      tournament: snap.tournament,
      self: snap.audience === 'PLAYER' ? snap.self : this.state.self,
      table,
      tableEvents: table && table.tableId === this.state.table?.tableId ? this.state.tableEvents : [],
      lastTableSeq: table ? table.lastEventSeq : 0,
      lastTournamentSeq: Math.max(this.state.lastTournamentSeq, snap.tournament.lastSeq),
    });
  }
}
