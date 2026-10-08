import { CANONICAL_DECK, TOURNAMENT_TRANSITIONS } from '@jpb/shared-types';
import type {
  AdminTableView,
  CardCode,
  HandPhase,
  PlayerDetailDto,
  PlayerListItemDto,
  PublicSeatView,
  TableDetailDto,
  TableListItemDto,
  TournamentCounters,
  TournamentListItemDto,
  TournamentOverviewDto,
  TournamentPublicSummary,
} from '@jpb/shared-types';
import { Rng, fakeHash } from './rng';
import type { MockPlayer, MockTable, MockTournament, MockWorld } from './state';

/** Projections of mock state into the DTOs of packages/shared-types/src/api.ts. */

export const STALL_AFTER_MS = 60_000;
const ACTIVE = new Set(['SEATED', 'IN_TRANSIT', 'SUSPENDED']);

export function isActivePlayer(p: MockPlayer): boolean {
  return ACTIVE.has(p.status) && !(p.finishPosition === 1);
}

export function openTables(t: MockTournament): MockTable[] {
  return t.tables.filter((x) => x.status !== 'CLOSED');
}

export function counters(t: MockTournament): TournamentCounters {
  let registered = 0;
  let active = 0;
  let eliminated = 0;
  let inTransit = 0;
  for (const p of t.players) {
    if (p.status === 'PENDING_APPROVAL' || p.status === 'WITHDRAWN') continue;
    registered++;
    if (p.status === 'ELIMINATED' || p.status === 'DISQUALIFIED') eliminated++;
    else if (ACTIVE.has(p.status) && t.startedAt !== null) active++;
    if (p.status === 'IN_TRANSIT') inTransit++;
  }
  return {
    registered,
    active,
    eliminated,
    inTransit,
    tables: openTables(t).length,
    handsCompleted: t.handsCompleted,
    totalChips: t.startedAt === null ? 0 : registered * t.config.startingStack,
    largestPot: t.largestPot,
  };
}

export function currentLevels(t: MockTournament) {
  const s = t.config.blindSchedule;
  return { currentLevel: t.startedAt === null ? null : (s[t.clock.levelIndex] ?? null), nextLevel: t.startedAt === null ? null : (s[t.clock.levelIndex + 1] ?? null) };
}

export function summary(t: MockTournament): TournamentPublicSummary {
  return {
    tournamentId: t.id,
    name: t.name,
    status: t.status,
    clock: t.clock,
    ...currentLevels(t),
    counters: counters(t),
    handForHand: t.handForHand,
    lastSeq: t.seq,
    serverSeedHash: t.serverSeedHash,
  };
}

export function tableListStatus(table: MockTable, now: number): TableListItemDto['status'] {
  if (table.status === 'CLOSED') return 'CLOSED';
  if (table.stalled || (table.status === 'IN_HAND' && !table.frozen && now - table.lastProgressAt > STALL_AFTER_MS)) return 'STALLED';
  return table.status;
}

export function tableChips(t: MockTournament, table: MockTable): number {
  let sum = 0;
  for (const id of table.seats) if (id) sum += playerById(t, id)?.stack ?? 0;
  return sum;
}

const playerIndex = new WeakMap<MockTournament, Map<string, MockPlayer>>();
export function playerById(t: MockTournament, playerId: string): MockPlayer | undefined {
  let m = playerIndex.get(t);
  if (!m || m.size !== t.players.length) {
    m = new Map(t.players.map((p) => [p.playerId, p]));
    playerIndex.set(t, m);
  }
  return m.get(playerId);
}

export function tableListItem(t: MockTournament, table: MockTable, now: number): TableListItemDto {
  const occupants = table.seats.filter((x): x is string => x !== null).map((id) => playerById(t, id)).filter((p): p is MockPlayer => Boolean(p));
  return {
    tableId: table.tableId,
    tableNumber: table.tableNumber,
    status: tableListStatus(table, now),
    holds: table.holds,
    frozen: table.frozen,
    players: occupants.length,
    maxSeats: table.maxSeats,
    handNumber: table.handNumber,
    isFinalTable: table.isFinalTable,
    lastProgressAt: table.status === 'CLOSED' ? null : table.lastProgressAt,
    disconnectedPlayers: occupants.filter((p) => p.connected === false).length,
    chips: occupants.reduce((a, p) => a + p.stack, 0),
  };
}

export function tournamentListItem(t: MockTournament): TournamentListItemDto {
  const c = counters(t);
  return {
    id: t.id,
    name: t.name,
    joinCode: t.joinCode,
    status: t.status,
    isSimulation: t.isSimulation,
    createdAt: t.createdAt,
    startedAt: t.startedAt,
    completedAt: t.completedAt,
    registered: c.registered,
    active: c.active,
    tables: c.tables,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

/** ETA formula (documented in the Overview): remaining players ÷ eliminations per ms over the last 30 minutes. */
export function estimateRemainingMs(t: MockTournament, active: number): number | null {
  const pts = t.metrics;
  if (pts.length < 5 || active <= 1) return null;
  const last = pts[pts.length - 1]!;
  const ref = pts.find((p) => p.at >= last.at - 30 * 60_000) ?? pts[0]!;
  const busted = ref.playersRemaining - last.playersRemaining;
  const dt = last.at - ref.at;
  if (busted <= 0 || dt <= 0) return null;
  return Math.round(((active - 1) / busted) * dt);
}

export function overview(world: MockWorld, t: MockTournament, now: number): TournamentOverviewDto {
  const c = counters(t);
  const actives = t.players.filter((p) => isActivePlayer(p) && t.startedAt !== null);
  const stacks = actives.map((p) => p.stack);
  const leader = actives.reduce<MockPlayer | null>((best, p) => (!best || p.stack > best.stack ? p : best), null);
  const { currentLevel, nextLevel } = currentLevels(t);
  const avg = actives.length ? Math.round(c.totalChips / actives.length) : 0;
  const lastPoint = t.metrics[t.metrics.length - 1];
  const tablesByStatus: Record<string, number> = {};
  for (const tb of t.tables) {
    const s = tableListStatus(tb, now);
    tablesByStatus[s] = (tablesByStatus[s] ?? 0) + 1;
    if (tb.frozen) tablesByStatus.FROZEN = (tablesByStatus.FROZEN ?? 0) + 1;
    if (tb.holds.includes('CONSOLIDATION')) tablesByStatus.BREAKING = (tablesByStatus.BREAKING ?? 0) + 1;
  }
  const actual = t.players.reduce((a, p) => a + p.stack, 0);
  return {
    id: t.id,
    name: t.name,
    joinCode: t.joinCode,
    status: t.status,
    resumeTo: t.resumeTo,
    allowedTransitions: [...TOURNAMENT_TRANSITIONS[t.status]],
    isSimulation: t.isSimulation,
    config: t.config,
    configLocked: t.startedAt !== null,
    createdAt: t.createdAt,
    startedAt: t.startedAt,
    completedAt: t.completedAt,
    serverSeedHash: t.serverSeedHash,
    seedRevealed: t.seedRevealed,
    publicEntropy: t.publicEntropy,
    summary: t.startedAt === null ? null : summary(t),
    clock: t.startedAt === null ? null : t.clock,
    currentLevel,
    nextLevel,
    counters: c,
    tablesByStatus,
    stats: {
      averageStack: avg,
      averageStackBB: currentLevel ? Math.round((avg / currentLevel.bigBlind) * 10) / 10 : 0,
      medianStack: median(stacks),
      chipLeader: leader ? { playerId: leader.playerId, displayName: leader.displayName, stack: leader.stack } : null,
      largestPot: t.largestPot,
      handsCompleted: t.handsCompleted,
      handsPerMinute: lastPoint?.handsPerMinute ?? 0,
      actionsPerSecond: lastPoint?.actionsPerSecond ?? 0,
      averageHandDurationMs: t.startedAt ? 94_000 : 0,
      elapsedMs: t.startedAt ? (t.completedAt ?? now) - t.startedAt : 0,
      estimatedRemainingMs: ['RUNNING', 'BREAK', 'PAUSED', 'FINAL_TABLE'].includes(t.status) ? estimateRemainingMs(t, c.active) : null,
    },
    chipConservation: t.startedAt === null ? null : { expectedTotal: c.totalChips, actualTotal: actual, ok: actual === c.totalChips, checkedAt: now - 4_000, offendingTables: [] },
    handForHand: t.handForHand,
    frozen: t.frozen,
    openAlerts: world.alerts.filter((a) => a.tournamentId === t.id && a.resolvedAt === null).length,
  };
}

export function playerListItem(t: MockTournament, p: MockPlayer, rank: number | null): PlayerListItemDto {
  const bb = currentLevels(t).currentLevel?.bigBlind ?? 0;
  const table = p.tableId ? t.tables.find((x) => x.tableId === p.tableId) : undefined;
  return {
    playerId: p.playerId,
    entryId: p.entryId,
    publicId: p.publicId,
    displayName: p.displayName,
    nickname: p.nickname,
    status: p.status,
    tableId: p.tableId,
    tableNumber: table?.tableNumber ?? null,
    seat: p.seat,
    stack: p.stack,
    stackBB: bb ? Math.round((p.stack / bb) * 10) / 10 : 0,
    stackRank: rank,
    finishPosition: p.finishPosition,
    connected: p.connected,
    consecutiveTimeouts: p.consecutiveTimeouts,
    registrationSeq: p.registrationSeq,
    registeredAt: p.registeredAt,
  };
}

export function playerDetail(t: MockTournament, p: MockPlayer, rank: number | null, now: number, piiAvailable: boolean): PlayerDetailDto {
  const rng = new Rng(`detail:${p.playerId}`);
  if (p.sessions.length === 0 && p.status !== 'PENDING_APPROVAL') {
    p.sessions = [
      { id: `pss_${p.playerId}_1`, createdAt: p.registeredAt, lastSeenAt: p.connected ? now - rng.int(1, 20) * 1000 : now - rng.int(2, 30) * 60_000, expiresAt: now + 8 * 3600_000, revokedAt: null, revokedReason: null, ip: `49.36.${rng.int(1, 250)}.${rng.int(1, 250)}`, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5) Mobile Safari/604.1', isController: true },
    ];
  }
  if (p.movements.length === 0 && t.startedAt !== null && p.status !== 'PENDING_APPROVAL') {
    const table = t.tables.find((x) => x.tableId === p.tableId) ?? t.tables[0];
    p.movements = [
      { moveId: `mv_${p.playerId}_0`, reason: 'INITIAL_SEATING', fromTableNumber: null, fromSeat: null, toTableNumber: rng.int(1, t.tables.length), toSeat: rng.int(0, 8), stack: t.config.startingStack, requestedAt: t.startedAt, completedAt: t.startedAt + 2000, scoreBreakdown: null },
    ];
    if (table && rng.chance(0.4)) {
      p.movements.push({ moveId: `mv_${p.playerId}_1`, reason: 'BALANCE', fromTableNumber: rng.int(1, t.tables.length), fromSeat: rng.int(0, 8), toTableNumber: table.tableNumber, toSeat: p.seat ?? 0, stack: Math.round(p.stack * 0.8), requestedAt: t.startedAt + rng.int(20, 120) * 60_000, completedAt: null, scoreBreakdown: { position: 2.5, blindFairness: 1.0, recentMove: 0, seatCompatibility: 0.5, total: 4.0 } });
      const last = p.movements[1]!;
      last.completedAt = last.requestedAt + 3000;
    }
  }
  return {
    ...playerListItem(t, p, rank),
    handsPlayed: p.handsPlayed,
    largestPotWon: p.largestPotWon || Math.round(p.stack * 0.4),
    prizeMinor: p.prizeMinor,
    tiedCount: p.tiedCount,
    elimination: p.elimination,
    paymentStatus: p.payment.status,
    sessions: p.sessions,
    movements: p.movements,
    recentActions: t.startedAt === null ? [] : Array.from({ length: 6 }, (_, i) => ({
      handId: `hand_${t.seedKey}_${Math.max(0, t.handsCompleted - 1 - i * 9)}`,
      handNumber: Math.max(1, (t.tables[0]?.handNumber ?? 1) - i),
      street: rng.pick(['PREFLOP', 'FLOP', 'TURN', 'RIVER'] as const),
      action: rng.pick(['FOLD', 'CALL', 'CHECK', 'RAISE'] as const),
      amount: rng.int(0, 4) * 400,
      toAmount: rng.int(0, 4) * 400,
      timeout: p.consecutiveTimeouts > 0 && i < p.consecutiveTimeouts,
      at: now - i * 95_000,
    })),
    piiAvailable,
  };
}

const PHASES: HandPhase[] = ['PREFLOP', 'PREFLOP', 'PREFLOP', 'FLOP', 'FLOP', 'TURN', 'RIVER', 'SHOWDOWN', 'HAND_COMPLETE'];

/** Live admin view of a table, derived from its hand number and step (mock only). */
export function adminTableView(t: MockTournament, table: MockTable, now: number, revealHoleCards: boolean): AdminTableView {
  const rng = new Rng(`live:${table.tableId}:${table.handNumber}`);
  const deck = rng.shuffle(CANONICAL_DECK);
  const lvl = currentLevels(t).currentLevel ?? t.config.blindSchedule[0]!;
  const occupied = table.seats.map((id, seat) => (id ? { id, seat } : null)).filter((x): x is { id: string; seat: number } => x !== null);
  const button = occupied.length ? occupied[table.handNumber % occupied.length]!.seat : null;
  const phase = PHASES[Math.min(table.handStep, PHASES.length - 1)]!;
  const boardCount = phase === 'FLOP' ? 3 : phase === 'TURN' ? 4 : phase === 'RIVER' || phase === 'SHOWDOWN' || phase === 'HAND_COMPLETE' ? 5 : 0;
  const folded = new Set(occupied.filter(() => rng.chance(Math.min(0.75, table.handStep * 0.12))).map((o) => o.seat));
  const inHand = table.status === 'IN_HAND' && occupied.length > 1;
  const live = occupied.filter((o) => !folded.has(o.seat));
  const acting = inHand && live.length > 1 ? live[table.handStep % live.length]!.seat : null;
  const pot = inHand ? lvl.bigBlind * (2 + table.handStep * 2) + lvl.ante : 0;
  const holeCards: Record<number, [CardCode, CardCode]> = {};
  const seats: Array<PublicSeatView | null> = table.seats.map((id, seat) => {
    if (!id) return null;
    const p = playerById(t, id);
    if (!p) return null;
    const idx = occupied.findIndex((o) => o.seat === seat);
    holeCards[seat] = [deck[idx * 2]!, deck[idx * 2 + 1]!];
    const pos = occupied.findIndex((o) => o.seat === button);
    const sbSeat = occupied[(pos + 1) % occupied.length]?.seat;
    const bbSeat = occupied[(pos + 2) % occupied.length]?.seat;
    return {
      seat,
      playerId: p.playerId,
      displayName: p.displayName,
      publicId: p.publicId,
      stack: p.stack,
      connected: p.connected !== false,
      inHand: inHand && !folded.has(seat),
      folded: inHand && folded.has(seat),
      allIn: false,
      streetContribution: inHand && !folded.has(seat) && seat !== acting ? lvl.bigBlind * (table.handStep % 3) : 0,
      lastAction: folded.has(seat) ? { action: 'FOLD', amount: 0, toAmount: 0 } : null,
      isButton: seat === button,
      isSmallBlind: seat === sbSeat,
      isBigBlind: seat === bbSeat,
      shownCards: phase === 'SHOWDOWN' && !folded.has(seat) ? holeCards[seat]! : null,
      away: p.consecutiveTimeouts >= t.config.timing.awayAfterTimeouts,
    };
  });
  const board = deck.slice(40, 40 + boardCount);
  return {
    audience: 'ADMIN',
    tableId: table.tableId,
    tournamentId: t.id,
    tableNumber: table.tableNumber,
    version: table.handNumber * 20 + table.handStep,
    lastEventSeq: table.handNumber * 24 + table.handStep * 3,
    status: table.status,
    holds: table.holds,
    frozen: table.frozen,
    maxSeats: table.maxSeats,
    seats,
    buttonSeat: button,
    blinds: { level: lvl.level, smallBlind: lvl.smallBlind, bigBlind: lvl.bigBlind, ante: lvl.ante, anteType: t.config.anteType },
    hand: inHand
      ? {
          handId: `live_${table.tableId}_${table.handNumber}`,
          handNumber: table.handNumber,
          phase,
          board,
          pots: [{ amount: pot, eligibleSeats: live.map((o) => o.seat) }],
          totalPot: pot,
          currentBet: acting !== null ? lvl.bigBlind * (table.handStep % 3) : 0,
          actingSeat: acting,
          actionDeadline: acting !== null && !table.frozen ? now + 11_000 : null,
          turnVersion: table.handStep,
        }
      : null,
    serverTime: now,
    holeCards: revealHoleCards ? holeCards : null,
    seatDetails: table.seats.map((id, seat) => {
      const p = id ? playerById(t, id) : undefined;
      if (!p) return null;
      return {
        seat,
        playerId: p.playerId,
        displayName: p.displayName,
        publicId: p.publicId,
        stack: p.stack,
        connected: p.connected !== false,
        consecutiveTimeouts: p.consecutiveTimeouts,
        waitingForNextHand: false,
        pendingRemoval: null,
        stats: { handsDealtAtTable: table.handNumber, handsSinceBigBlind: seat % 9, handsSinceSmallBlind: (seat + 1) % 9, handsPlayedTotal: p.handsPlayed },
      };
    }),
    timing: { actionTimerMs: t.config.timing.actionTimerSeconds * 1000, awayActionTimerMs: t.config.timing.awayActionTimerSeconds * 1000, awayAfterTimeouts: t.config.timing.awayAfterTimeouts, actionGraceMs: t.config.timing.actionGraceMs, betweenHandsDelayMs: t.config.timing.betweenHandsDelayMs, showdownDelayMs: t.config.timing.showdownDelayMs },
    handForHand: t.handForHand,
    pendingBlinds: null,
    lastProgressAt: table.lastProgressAt,
    handsPlayed: table.handNumber,
  };
}

export function tableDetail(t: MockTournament, table: MockTable, now: number, adminId: string): TableDetailDto {
  const revealed = table.revealedTo.includes(adminId);
  const view = adminTableView(t, table, now, revealed);
  const chips = tableChips(t, table);
  return {
    view,
    internals: {
      version: view.version,
      lastEventSeq: view.lastEventSeq,
      lastCommandSeq: view.version + 3,
      ownerNode: `worker-${(table.tableNumber % 2) + 1}`,
      leaseEpoch: 3,
      queueLength: table.stalled ? 4 : 0,
      faulted: false,
      lastProgressAt: table.lastProgressAt,
      invariantViolations: [],
      chipsAtTable: chips,
    },
    holeCards: revealed ? view.holeCards : null,
    recentHands: t.hands.filter((h) => h.tableId === table.tableId).slice(-10).reverse(),
  };
}

export function serverSeedHashOf(seed: string): string {
  return fakeHash(`seed:${seed}`);
}
