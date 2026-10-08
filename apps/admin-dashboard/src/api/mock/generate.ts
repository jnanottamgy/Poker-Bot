import type { BlindClockState, LiveMetricsPoint, TournamentStatus } from '@jpb/shared-types';
import { placeClock } from '../../lib/schedule';
import { Rng, fakeHash } from './rng';
import { FIRST_NAMES, LAST_NAMES, NICKNAMES, buildConfig } from './seedData';
import type { MockPlayer, MockTable, MockTournament } from './state';

/** Shape of one generated tournament (deterministic from `key`). */
export interface TournamentSpec {
  key: string;
  name: string;
  joinCode: string;
  status: TournamentStatus;
  registered: number;
  /** Players still in (seated + in transit + suspended). */
  active: number;
  activeTables: number;
  closedTables: number;
  pending?: number;
  inTransit?: number;
  suspended?: number;
  simulation?: boolean;
  startedAgoMin?: number;
  createdAgoDays: number;
  completedAgoDays?: number;
  maxPlayers: number;
  startInMin?: number;
  /** A stalled table (by number) to drive the "TABLE_STALLED" alert. */
  stalledTable?: number;
}

export const TOURNAMENT_SPECS: TournamentSpec[] = [
  { key: 'spring', name: 'Spring Showdown 2026', joinCode: 'SPRING26', status: 'RUNNING', registered: 2000, active: 1204, activeTables: 136, closedTables: 87, inTransit: 7, suspended: 2, startedAgoMin: 194, createdAgoDays: 12, maxPlayers: 2000, stalledTable: 37 },
  { key: 'campus', name: 'Campus Cup — Final Day', joinCode: 'CAMPUS', status: 'FINAL_TABLE', registered: 480, active: 9, activeTables: 1, closedTables: 59, startedAgoMin: 402, createdAgoDays: 20, maxPlayers: 512 },
  { key: 'tuesday', name: 'Tuesday Deepstack', joinCode: 'DEEPTUE', status: 'PAUSED', registered: 312, active: 120, activeTables: 15, closedTables: 24, startedAgoMin: 150, createdAgoDays: 5, maxPlayers: 400 },
  { key: 'lunch', name: 'Lunch Break Bounty', joinCode: 'LUNCH', status: 'BREAK', registered: 96, active: 52, activeTables: 7, closedTables: 5, startedAgoMin: 80, createdAgoDays: 2, maxPlayers: 120 },
  { key: 'friday', name: 'Friday Night Turbo', joinCode: 'FRITURBO', status: 'REGISTRATION', registered: 214, active: 0, activeTables: 0, closedTables: 0, pending: 12, createdAgoDays: 3, maxPlayers: 1000, startInMin: 135 },
  { key: 'monsoon', name: 'Monsoon Masters', joinCode: 'MONSOON', status: 'REGISTRATION_CLOSED', registered: 640, active: 0, activeTables: 0, closedTables: 0, createdAgoDays: 9, maxPlayers: 640, startInMin: 20 },
  { key: 'founders', name: 'Founders Freeroll', joinCode: 'FOUNDERS', status: 'DRAFT', registered: 0, active: 0, activeTables: 0, closedTables: 0, createdAgoDays: 1, maxPlayers: 300 },
  { key: 'winter', name: 'Winter Classic 2025', joinCode: 'WINTER25', status: 'COMPLETED', registered: 1536, active: 1, activeTables: 0, closedTables: 171, startedAgoMin: 60 * 24 * 40, createdAgoDays: 55, completedAgoDays: 40, maxPlayers: 1600 },
  { key: 'hackathon', name: 'Hackathon Sit & Go', joinCode: 'HACKSNG', status: 'CANCELLED', registered: 18, active: 0, activeTables: 0, closedTables: 0, createdAgoDays: 30, maxPlayers: 27 },
  { key: 'demo1000', name: 'Demo · 1,000 bots', joinCode: 'DEMO1K', status: 'RUNNING', registered: 1000, active: 612, activeTables: 70, closedTables: 42, startedAgoMin: 48, simulation: true, createdAgoDays: 0, maxPlayers: 1000 },
  { key: 'demo32', name: 'Demo · 32 bots (speed)', joinCode: 'DEMO32', status: 'COMPLETED', registered: 32, active: 1, activeTables: 0, closedTables: 4, startedAgoMin: 300, simulation: true, createdAgoDays: 1, completedAgoDays: 0, maxPlayers: 32 },
];

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const STARTED: readonly TournamentStatus[] = ['STARTING', 'RUNNING', 'BREAK', 'PAUSED', 'FINAL_TABLE', 'COMPLETED'];

export function isStarted(status: TournamentStatus): boolean {
  return STARTED.includes(status);
}

function makePlayers(spec: TournamentSpec, rng: Rng, createdAt: number, startingStack: number): MockPlayer[] {
  const used = new Set<string>();
  const players: MockPlayer[] = [];
  for (let i = 0; i < spec.registered; i++) {
    const first = rng.pick(FIRST_NAMES);
    const last = rng.pick(LAST_NAMES);
    let publicId = `JPN-${rng.code(4)}`;
    while (used.has(publicId)) publicId = `JPN-${rng.code(4)}`;
    used.add(publicId);
    const handle = `${first}.${last}`.toLowerCase();
    players.push({
      playerId: `ply_${spec.key}_${i}`,
      entryId: `ent_${spec.key}_${i}`,
      publicId,
      displayName: `${first} ${last}`,
      nickname: rng.chance(0.18) ? rng.pick(NICKNAMES) : null,
      status: 'REGISTERED',
      tableId: null,
      seat: null,
      stack: startingStack,
      finishPosition: null,
      tiedCount: 1,
      connected: null,
      consecutiveTimeouts: 0,
      registrationSeq: i + 1,
      registeredAt: createdAt + Math.round((i / Math.max(1, spec.registered)) * (spec.createdAgoDays * DAY * 0.6)) + rng.int(0, MIN),
      pii: {
        email: `${handle}${rng.int(1, 99)}@example.edu`,
        phone: `+91 9${rng.int(1000, 9999)} ${rng.int(10000, 99999)}`,
        participantId: rng.chance(0.6) ? `P-${rng.int(10000, 99999)}` : null,
        collegeId: rng.chance(0.5) ? `CU${rng.int(100000, 999999)}` : null,
      },
      handsPlayed: 0,
      largestPotWon: 0,
      prizeMinor: 0,
      payment: { status: 'UNPAID', paidAt: null, processedBy: null, reference: null, note: null },
      elimination: null,
      movements: [],
      sessions: [],
    });
  }
  if (spec.pending) for (const p of players.slice(-spec.pending)) p.status = 'PENDING_APPROVAL';
  return players;
}

function makeTables(spec: TournamentSpec, rng: Rng, maxSeats: number, now: number): MockTable[] {
  const total = spec.activeTables + spec.closedTables;
  const numbers = Array.from({ length: total }, (_, i) => i + 1);
  // Broken tables are spread through the numbering, like a real event; the stalled table stays open.
  const closed = new Set(rng.shuffle(numbers.filter((n) => n !== spec.stalledTable && n !== 1)).slice(0, spec.closedTables));
  return numbers.map((n) => {
    const isClosed = closed.has(n);
    return {
      tableId: `tbl_${spec.key}_${n}`,
      tableNumber: n,
      maxSeats,
      seats: Array.from({ length: maxSeats }, () => null),
      status: isClosed ? 'CLOSED' : 'IN_HAND',
      holds: [],
      frozen: false,
      handNumber: 0,
      isFinalTable: false,
      lastProgressAt: now - rng.int(1, 20) * 1000,
      stalled: false,
      handStep: rng.int(0, 7),
      revealedTo: [],
    } satisfies MockTable;
  });
}

function distributeStacks(active: MockPlayer[], totalChips: number, rng: Rng): void {
  const weights = active.map(() => Math.exp(rng.gauss() * 0.65));
  const sum = weights.reduce((a, b) => a + b, 0);
  let assigned = 0;
  active.forEach((p, i) => {
    p.stack = Math.max(1, Math.floor((totalChips * weights[i]!) / sum));
    assigned += p.stack;
  });
  const leader = active.reduce((best, p) => (p.stack > best.stack ? p : best), active[0]!);
  leader.stack += totalChips - assigned;
}

function seatPlayers(seated: MockPlayer[], tables: MockTable[], rng: Rng): void {
  const open = tables.filter((t) => t.status !== 'CLOSED');
  if (open.length === 0) return;
  const shuffled = rng.shuffle(seated);
  shuffled.forEach((p, i) => {
    const table = open[i % open.length]!;
    const free = table.seats.map((s, idx) => (s === null ? idx : -1)).filter((x) => x >= 0);
    const seat = free.length > 0 ? rng.pick(free) : 0;
    table.seats[seat] = p.playerId;
    p.tableId = table.tableId;
    p.seat = seat;
  });
}

function eliminate(spec: TournamentSpec, outs: MockPlayer[], tables: MockTable[], startedAt: number, elapsed: number, rng: Rng): void {
  const n = outs.length;
  outs.forEach((p, k) => {
    const t = startedAt + Math.round(elapsed * Math.pow((k + 1) / (n + 1), 1 / 1.15));
    const tie = k === 6 && n > 10;
    const position = tie ? spec.registered - 5 : spec.registered - k;
    const table = rng.pick(tables);
    p.status = 'ELIMINATED';
    p.stack = 0;
    p.finishPosition = position;
    p.tiedCount = k === 5 || tie ? 2 : 1;
    p.connected = rng.chance(0.3);
    p.handsPlayed = Math.round(((t - startedAt) / MIN) * 1.6);
    p.elimination = {
      playerId: p.playerId,
      entryId: p.entryId,
      finishPosition: position,
      tiedCount: p.tiedCount,
      eliminatedAt: t,
      handId: `hand_${spec.key}_e${k}`,
      handNumber: rng.int(1, 120),
      tableId: table.tableId,
      startingStackOfHand: rng.int(800, 30_000),
      batchId: `batch_${spec.key}_${tie ? 5 : k}`,
    };
  });
}

function applyPrizes(t: MockTournament, rng: Rng): void {
  const places = t.config.prizeStructure.places;
  for (const p of t.players) {
    if (p.finishPosition === null) continue;
    const place = places.find((x) => x.position === p.finishPosition);
    if (!place) continue;
    p.prizeMinor = place.amountMinor;
    if (t.status === 'COMPLETED') {
      const r = rng.next();
      const status = p.finishPosition <= 30 || r < 0.6 ? 'PAID' : r < 0.8 ? 'PROCESSING' : 'UNPAID';
      p.payment = {
        status,
        paidAt: status === 'PAID' ? (t.completedAt ?? 0) + rng.int(1, 72) * 3600_000 : null,
        processedBy: status === 'UNPAID' ? null : rng.pick(['meera', 'karan']),
        reference: status === 'PAID' ? `UPI-${rng.int(100000000, 999999999)}` : null,
        note: null,
      };
    }
  }
}

export function makeMetrics(spec: TournamentSpec, startedAt: number, now: number, rng: Rng): LiveMetricsPoint[] {
  const elapsed = now - startedAt;
  const points: LiveMetricsPoint[] = [];
  const span = Math.min(elapsed, 120 * MIN);
  const R = spec.registered;
  const A = spec.active;
  for (let at = now - span; at <= now; at += MIN) {
    const frac = Math.min(1, (at - startedAt) / elapsed);
    const remaining = Math.round(R - (R - A) * Math.pow(frac, 1.15));
    const tables = Math.max(1, Math.ceil(remaining / 8.8));
    const hpm = Math.max(1, Math.round(tables * 1.55 * (1 + rng.gauss() * 0.05)));
    const spike = rng.chance(0.04) ? rng.int(40, 140) : 0;
    const p50 = Math.round(16 + rng.gauss() * 1.8);
    points.push({
      at,
      playersRemaining: remaining,
      tables,
      handsPerMinute: hpm,
      actionsPerSecond: Math.round(((hpm * 9) / 60) * 10) / 10,
      actionLatencyP50: p50,
      actionLatencyP95: Math.round(p50 * 2.6 + rng.int(0, 8) + spike * 0.4),
      actionLatencyP99: Math.round(p50 * 5.2 + rng.int(0, 16) + spike),
      connections: remaining + Math.round(remaining * 0.22) + 6,
    });
  }
  return points;
}

/** Applies the paused / break / final-table particulars of a spec to its clock and tables. */
function settleStatus(t: MockTournament, spec: TournamentSpec, now: number): void {
  const open = t.tables.filter((x) => x.status !== 'CLOSED');
  if (spec.status === 'PAUSED') {
    const remaining = Math.max(60_000, (t.clock.levelEndsAt ?? now) - now);
    t.clock = { ...t.clock, levelEndsAt: null, pausedRemainingMs: remaining };
    t.resumeTo = 'RUNNING';
    for (const tb of open) Object.assign(tb, { status: 'HELD', holds: ['PAUSE'] });
  }
  if (spec.status === 'BREAK') {
    const next = t.config.blindSchedule[t.clock.levelIndex + 1] ?? t.config.blindSchedule[t.clock.levelIndex]!;
    t.clock = { levelIndex: Math.min(t.clock.levelIndex + 1, t.config.blindSchedule.length - 1), levelStartedAt: null, levelEndsAt: null, pausedRemainingMs: next.durationSeconds * 1000, breakEndsAt: now + 6 * MIN + 12_000, pendingBreakAfterLevel: null };
    t.resumeTo = 'RUNNING';
    for (const tb of open) Object.assign(tb, { status: 'HELD', holds: ['BREAK'] });
  }
  if (spec.status === 'FINAL_TABLE' && open[0]) open[0].isFinalTable = true;
  if (spec.stalledTable) {
    const st = open.find((x) => x.tableNumber === spec.stalledTable);
    if (st) Object.assign(st, { stalled: true, lastProgressAt: now - 92_000 });
  }
  if (spec.status === 'RUNNING' && open.length > 20) {
    Object.assign(open[11]!, { status: 'HELD', holds: ['ADMIN'] });
    Object.assign(open[23]!, { status: 'HELD', holds: ['CONSOLIDATION'] });
    for (const tb of open.slice(30, 52)) tb.status = 'BETWEEN_HANDS';
  }
}

export function buildTournament(spec: TournamentSpec, now: number): MockTournament {
  const rng = new Rng(`tournament:${spec.key}`);
  const createdAt = now - spec.createdAgoDays * DAY - rng.int(0, 6) * 3600_000;
  const config = buildConfig(spec.name, spec.joinCode, spec.maxPlayers, { speedMode: spec.key === 'demo32', startTime: spec.startInMin ? now + spec.startInMin * MIN : null });
  const started = isStarted(spec.status);
  const startedAt = started ? now - (spec.startedAgoMin ?? 0) * MIN : null;
  const completedAt = spec.status === 'COMPLETED' ? now - (spec.completedAgoDays ?? 0) * DAY - 3 * 3600_000 : null;
  const serverSeed = rng.hex(64);
  const players = makePlayers(spec, rng, createdAt, config.startingStack);
  const tables = makeTables(spec, rng, config.tables.maxSize, now);
  const idle: BlindClockState = { levelIndex: 0, levelStartedAt: null, levelEndsAt: null, pausedRemainingMs: null, breakEndsAt: null, pendingBreakAfterLevel: null };
  const t: MockTournament = {
    id: `trn_${spec.key}`,
    name: spec.name,
    joinCode: spec.joinCode,
    status: spec.status,
    resumeTo: null,
    isSimulation: spec.simulation ?? false,
    config,
    createdAt,
    startedAt,
    completedAt,
    serverSeed,
    serverSeedHash: fakeHash(`seed:${serverSeed}`),
    seedRevealed: spec.status === 'COMPLETED' && spec.key === 'winter',
    publicEntropy: started ? fakeHash(`entropy:${spec.key}`) : null,
    clientSeedCount: started ? Math.round(spec.registered * 0.93) : 0,
    clock: idle,
    handForHand: false,
    frozen: false,
    players,
    tables,
    handsCompleted: 0,
    largestPot: 0,
    hands: [],
    metrics: [],
    events: [],
    seq: 0,
    seedKey: spec.key,
    display: { scene: 'OVERVIEW', featuredTableId: null },
  };
  if (!started || startedAt === null) return t;

  const elapsed = (completedAt ?? now) - startedAt;
  const order = rng.shuffle(players);
  const outs = order.slice(0, spec.registered - spec.active);
  const ins = order.slice(spec.registered - spec.active);
  eliminate(spec, outs, tables, startedAt, elapsed, rng);
  const totalChips = spec.registered * config.startingStack;
  for (const p of ins) {
    p.status = 'SEATED';
    p.connected = rng.chance(0.985);
    p.handsPlayed = Math.round((elapsed / MIN) * 1.6);
    p.consecutiveTimeouts = p.connected ? 0 : rng.int(1, 3);
  }
  distributeStacks(ins, totalChips, rng);
  const transit = ins.slice(0, spec.inTransit ?? 0);
  for (const p of transit) p.status = 'IN_TRANSIT';
  seatPlayers(ins.filter((p) => p.status === 'SEATED'), tables, rng);
  for (const p of ins.slice(spec.inTransit ?? 0, (spec.inTransit ?? 0) + (spec.suspended ?? 0))) p.status = 'SUSPENDED';

  const avgTables = (spec.activeTables + spec.registered / 8.8) / 2;
  t.handsCompleted = Math.round((elapsed / MIN) * avgTables * 0.55);
  t.largestPot = Math.round(totalChips * 0.012);
  for (const tb of tables) tb.handNumber = tb.status === 'CLOSED' ? rng.int(20, 90) : Math.round(t.handsCompleted / Math.max(1, avgTables)) + rng.int(-12, 12);

  if (spec.status === 'COMPLETED') {
    const champ = ins[0]!;
    Object.assign(champ, { finishPosition: 1, tiedCount: 1, tableId: null, seat: null });
    for (const tb of tables) tb.status = 'CLOSED';
    t.clock = { ...idle, levelIndex: Math.min(config.blindSchedule.length - 1, 14) };
  } else {
    t.clock = placeClock(config.blindSchedule, config.breaks, startedAt, now).clock;
    if (t.clock.breakEndsAt !== null && spec.status === 'RUNNING') {
      // Keep RUNNING tournaments mid-level so the demo clock is live.
      const lvl = config.blindSchedule[t.clock.levelIndex]!;
      t.clock = { levelIndex: t.clock.levelIndex, levelStartedAt: now - 4 * MIN, levelEndsAt: now - 4 * MIN + lvl.durationSeconds * 1000, pausedRemainingMs: null, breakEndsAt: null, pendingBreakAfterLevel: null };
    }
  }
  settleStatus(t, spec, now);
  applyPrizes(t, rng);
  t.metrics = spec.status === 'COMPLETED' ? [] : makeMetrics(spec, startedAt, now, rng);
  return t;
}
