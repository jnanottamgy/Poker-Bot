import type {
  BlindLevel,
  HandEvent,
  PublicSeatView,
  ServerMessage,
  SpectatorTableView,
  TableEvent,
  TableLevelEvent,
  TournamentEvent,
  TournamentPublicSummary,
  TournamentStatus,
} from '@jpb/shared-types';
import type { DisplayAction, DisplayFrame } from '../src/model/types';

export const T = 'trn_test';
export const LEVEL: BlindLevel = { level: 4, smallBlind: 300, bigBlind: 600, ante: 75, durationSeconds: 900 };
export const NEXT: BlindLevel = { level: 5, smallBlind: 400, bigBlind: 800, ante: 100, durationSeconds: 900 };

export function summary(over: Partial<TournamentPublicSummary> = {}, status: TournamentStatus = 'RUNNING'): TournamentPublicSummary {
  return {
    tournamentId: T,
    name: 'Test Cup',
    status,
    clock: { levelIndex: 3, levelStartedAt: 1_000_000, levelEndsAt: 1_900_000, pausedRemainingMs: null, breakEndsAt: null, pendingBreakAfterLevel: null },
    currentLevel: LEVEL,
    nextLevel: NEXT,
    counters: { registered: 40, active: 20, eliminated: 20, inTransit: 0, tables: 3, handsCompleted: 120, totalChips: 800_000, largestPot: 30_000 },
    handForHand: false,
    lastSeq: 10,
    serverSeedHash: 'abc',
    ...over,
  };
}

export function seat(i: number, over: Partial<PublicSeatView> = {}): PublicSeatView {
  return {
    seat: i,
    playerId: `p${i}`,
    displayName: `Player ${i}`,
    publicId: `P${i}`,
    stack: 20_000,
    connected: true,
    inHand: true,
    folded: false,
    allIn: false,
    streetContribution: 0,
    lastAction: null,
    isButton: i === 0,
    isSmallBlind: false,
    isBigBlind: false,
    shownCards: null,
    away: false,
    ...over,
  };
}

export function view(over: Partial<SpectatorTableView> = {}): SpectatorTableView {
  return {
    audience: 'SPECTATOR',
    tableId: 'tbl_1',
    tournamentId: T,
    tableNumber: 1,
    version: 5,
    lastEventSeq: 50,
    status: 'IN_HAND',
    holds: [],
    frozen: false,
    maxSeats: 6,
    seats: [seat(0), seat(1), null, seat(3), null, null],
    buttonSeat: 0,
    blinds: { level: 4, smallBlind: 300, bigBlind: 600, ante: 75, anteType: 'BB_ANTE' },
    hand: {
      handId: 'h1',
      handNumber: 9,
      phase: 'FLOP',
      board: ['Ah', 'Kd', '7c'],
      pots: [],
      totalPot: 2_400,
      currentBet: 0,
      actingSeat: 1,
      actionDeadline: 2_000_000,
      turnVersion: 3,
    },
    serverTime: 1_985_000,
    ...over,
  };
}

let tseq = 100;
export function tev(table: string, event: HandEvent | TableLevelEvent, seq = ++tseq): TableEvent {
  return { tableId: table, tournamentId: T, seq, version: 1, at: 1_000, visibility: 'PUBLIC', privateTo: null, event };
}

export const frame = (f: DisplayFrame, at = 1_000): DisplayAction => ({ type: 'frame', frame: f, at });

export function snapshotFrame(featured: SpectatorTableView | null, s = summary()): DisplayAction {
  const msg: ServerMessage = { t: 'snapshot', st: 1, snapshot: { audience: 'DISPLAY', tournament: s, featured } };
  return frame(msg);
}

export function updateFrame(v: SpectatorTableView, events: TableEvent[] = [], fromSeq = v.lastEventSeq, toSeq = v.lastEventSeq): DisplayAction {
  return frame({ t: 'table_update', st: 1, tableId: v.tableId, fromSeq, toSeq, version: v.version, events, view: v });
}

export function tourFrame(seq: number, event: TournamentEvent, at = 5_000, s: TournamentPublicSummary | null = null): DisplayAction {
  return frame({ t: 'tournament_event', st: 1, event: { tournamentId: T, seq, at, event }, summary: s }, at);
}

export function elimination(position: number, remaining: number, name = `Out ${position}`): TournamentEvent {
  return {
    kind: 'PLAYER_ELIMINATED',
    record: { playerId: `x${position}`, entryId: `e${position}`, finishPosition: position, tiedCount: 1, eliminatedAt: 1, handId: 'h', handNumber: 1, tableId: 'tbl_2', startingStackOfHand: 100, batchId: 'b' },
    displayName: name,
    playersRemaining: remaining,
  };
}

/** Deep-freezes a value so a reducer that mutates its input throws. */
export function deepFreeze<V>(v: V): V {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k]);
  }
  return v;
}
