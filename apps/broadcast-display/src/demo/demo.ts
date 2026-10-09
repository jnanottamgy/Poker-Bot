import type {
  ActionType,
  BlindLevel,
  CardCode,
  HandCategory,
  HandEvent,
  HandPhase,
  LeaderboardDto,
  LeaderboardRowDto,
  PrizePlace,
  PublicSeatView,
  ServerMessage,
  SpectatorTableView,
  TableEvent,
  TableLevelEvent,
  TournamentCounters,
  TournamentEvent,
  TournamentEventEnvelope,
  TournamentPublicSummary,
  TournamentStatus,
} from '@jpb/shared-types';
import type { DisplayAction, TournamentInfo } from '../model/types';
import { DemoRandom } from './prng';
import type { DemoPreset } from './presets';

/**
 * DEMO MODE (?demo=1): synthesizes the exact frames the server sends a
 * DISPLAY socket (snapshot, table_update, tournament_event) from seeded,
 * deterministic data, so the big screen can be previewed and screenshotted
 * without a server. Showdown hands are scripted (cards and descriptions are
 * correct by construction); seat choices and actions come from the seeded
 * PRNG. Nothing here is used by live games.
 */

export { DEMO_PRESETS } from './presets';
export type { DemoPreset } from './presets';

export const DEMO_STEP_MS = 1_300;
const TOURNAMENT_ID = 'trn_demo_broadcast';
const JOIN_CODE = 'DEMO42';
const NAME = "Johnny's Friday Night Championship";
const STARTING_STACK = 20_000;
const MAX_SEATS = 9;
const ACTION_TIMER_MS = 20_000;
/** Steps a finished hand stays on screen (showdown reveal), then one empty step. */
const HAND_DONE_STEPS = 5;
/** One elimination elsewhere in the room every this many steps (while above the floor). */
const ELIMINATION_EVERY_STEPS = 13;
const MINUTE = 60_000;

const LEVELS: BlindLevel[] = [
  [100, 200, 0],
  [150, 300, 0],
  [200, 400, 50],
  [300, 600, 75],
  [400, 800, 100],
  [500, 1_000, 100],
  [600, 1_200, 200],
  [800, 1_600, 200],
  [1_000, 2_000, 300],
  [1_500, 3_000, 400],
  [2_000, 4_000, 500],
  [3_000, 6_000, 1_000],
].map(([sb, bb, ante], i) => ({ level: i + 1, smallBlind: sb!, bigBlind: bb!, ante: ante!, durationSeconds: 15 * 60 }));

const PLACES: PrizePlace[] = [
  { position: 1, amountMinor: 2_500_000 },
  { position: 2, amountMinor: 1_500_000 },
  { position: 3, amountMinor: 1_000_000 },
  { position: 4, amountMinor: 600_000 },
  { position: 5, amountMinor: 400_000 },
  { position: 6, amountMinor: 250_000 },
];

const NAMES = [
  'Aarav Mehta', 'Priya Sharma', 'Rohan Iyer', 'Ananya Rao', 'Vikram Nair', 'Sara Fernandes', 'Kabir Singh', 'Meera Pillai',
  'Arjun Desai', 'Isha Kapoor', 'Dev Malhotra', 'Tara Menon', 'Nikhil Joshi', 'Zoya Khan', 'Rahul Verma', 'Aditi Bose',
  'Karan Gupta', 'Neha Reddy', 'Siddharth Jain', 'Riya Das', 'Aditya Kulkarni', 'Pooja Shetty', 'Varun Chopra', 'Diya Banerjee',
  'Manav Sethi', 'Kavya Hegde', 'Yash Agarwal', 'Nisha Thomas', 'Ishaan Bhat', 'Anika Roy', 'Rehan Qureshi', 'Leela Krishnan',
  'Omar Siddiqui', 'Simran Kaur', 'Neil Dsouza', 'Ira Saxena', 'Kunal Pandey', 'Maya Varghese', 'Samar Grewal', 'Trisha Paul',
  'Harsh Vardhan', 'Naina Arora', 'Ayaan Mirza', 'Jiya Patil', 'Rudra Ghosh', 'Esha Mathur', 'Veer Rathore', 'Alia Hussain',
];

interface Script {
  board: CardCode[];
  win: [CardCode, CardCode];
  lose: [CardCode, CardCode];
  winCat: HandCategory;
  winDesc: string;
  loseCat: HandCategory;
  loseDesc: string;
  winBest: CardCode[];
  loseBest: CardCode[];
}

/** Showdowns verified by hand: the winner's hand really beats the loser's on that board. */
const SCRIPTS: Script[] = [
  { board: ['Kh', '7d', '2c', 'Ks', '9h'], win: ['Ah', 'Kd'], lose: ['Qc', 'Qd'], winCat: 'THREE_OF_A_KIND', winDesc: 'Three of a Kind, Kings', loseCat: 'TWO_PAIR', loseDesc: 'Two Pair, Kings and Queens', winBest: ['Kh', 'Kd', 'Ks', 'Ah', '9h'], loseBest: ['Kh', 'Ks', 'Qc', 'Qd', '9h'] },
  { board: ['Js', 'Ts', '4d', '8c', '2s'], win: ['As', '5s'], lose: ['Qh', '9d'], winCat: 'FLUSH', winDesc: 'Flush, Ace High', loseCat: 'STRAIGHT', loseDesc: 'Straight, Queen High', winBest: ['As', 'Js', 'Ts', '5s', '2s'], loseBest: ['Qh', 'Js', 'Ts', '9d', '8c'] },
  { board: ['6h', '6c', 'Qd', '3s', 'Ah'], win: ['Qs', 'Qc'], lose: ['Ac', 'Kd'], winCat: 'FULL_HOUSE', winDesc: 'Full House, Queens full of Sixes', loseCat: 'TWO_PAIR', loseDesc: 'Two Pair, Aces and Sixes', winBest: ['Qs', 'Qc', 'Qd', '6h', '6c'], loseBest: ['Ac', 'Ah', '6h', '6c', 'Kd'] },
  { board: ['5d', '8h', '9s', 'Tc', '2h'], win: ['7c', '6d'], lose: ['9h', '9c'], winCat: 'STRAIGHT', winDesc: 'Straight, Ten High', loseCat: 'THREE_OF_A_KIND', loseDesc: 'Three of a Kind, Nines', winBest: ['Tc', '9s', '8h', '7c', '6d'], loseBest: ['9h', '9c', '9s', 'Tc', '8h'] },
  { board: ['Kc', '4h', '4s', 'Jd', '7c'], win: ['Kh', 'Qs'], lose: ['Ad', 'Jh'], winCat: 'TWO_PAIR', winDesc: 'Two Pair, Kings and Fours', loseCat: 'TWO_PAIR', loseDesc: 'Two Pair, Jacks and Fours', winBest: ['Kc', 'Kh', '4h', '4s', 'Qs'], loseBest: ['Jd', 'Jh', '4h', '4s', 'Ad'] },
  { board: ['3d', '9d', 'Qh', '2c', '8s'], win: ['Ac', 'Qc'], lose: ['Td', '9c'], winCat: 'ONE_PAIR', winDesc: 'One Pair, Queens', loseCat: 'ONE_PAIR', loseDesc: 'One Pair, Nines', winBest: ['Qc', 'Qh', 'Ac', '9d', '8s'], loseBest: ['9c', '9d', 'Qh', 'Td', '8s'] },
];

interface DemoPlayer {
  id: string;
  name: string;
  stack: number;
  table: number | null;
  seat: number | null;
  finish: number | null;
}

interface DemoHand {
  number: number;
  script: Script;
  hero: number;
  villain: number;
  /** Villain gives up on the turn: the hand ends without a showdown. */
  villainFolds: boolean;
  order: number[];
  button: number;
  sbSeat: number;
  bbSeat: number;
  folded: number[];
  acted: number[];
  contrib: Record<number, number>;
  lastAction: Record<number, { action: ActionType; amount: number; toAmount: number }>;
  pot: number;
  street: 0 | 1 | 2 | 3;
  currentBet: number;
  acting: number | null;
  deadline: number | null;
  turnVersion: number;
  shown: Record<number, [CardCode, CardCode]>;
  phase: HandPhase;
  doneSteps: number;
}

interface PresetShape {
  status: TournamentStatus;
  registered: number;
  active: number;
  tables: number;
  featuredPlayers: number;
  levelIndex: number;
  handForHand: boolean;
  /** Stop eliminating at this many players. */
  floor: number;
  playing: boolean;
}

const SHAPES: Readonly<Record<DemoPreset, PresetShape>> = {
  running: { status: 'RUNNING', registered: 48, active: 22, tables: 3, featuredPlayers: 8, levelIndex: 5, handForHand: false, floor: 10, playing: true },
  final: { status: 'FINAL_TABLE', registered: 48, active: 9, tables: 1, featuredPlayers: 9, levelIndex: 9, handForHand: false, floor: 9, playing: true },
  bubble: { status: 'RUNNING', registered: 48, active: 7, tables: 1, featuredPlayers: 7, levelIndex: 8, handForHand: true, floor: 7, playing: true },
  break: { status: 'BREAK', registered: 48, active: 18, tables: 2, featuredPlayers: 9, levelIndex: 6, handForHand: false, floor: 18, playing: false },
  paused: { status: 'PAUSED', registered: 48, active: 15, tables: 2, featuredPlayers: 8, levelIndex: 7, handForHand: false, floor: 15, playing: false },
  frozen: { status: 'PAUSED', registered: 48, active: 15, tables: 2, featuredPlayers: 8, levelIndex: 7, handForHand: false, floor: 15, playing: false },
  champion: { status: 'COMPLETED', registered: 48, active: 1, tables: 1, featuredPlayers: 1, levelIndex: 11, handForHand: false, floor: 1, playing: false },
  pre: { status: 'REGISTRATION', registered: 23, active: 23, tables: 0, featuredPlayers: 0, levelIndex: 0, handForHand: false, floor: 23, playing: false },
};

export interface DemoEngine {
  /** Frames to send right after "connecting": snapshot then history events (dated in the past). */
  open(now: number): DisplayAction[];
  /** One step of simulated play. */
  step(now: number): DisplayAction[];
  leaderboard(mode: 'stack' | 'finish', limit: number): LeaderboardDto;
  info(): TournamentInfo;
}

export function createDemoEngine(preset: DemoPreset, seed: number, startedAt: number): DemoEngine {
  const rng = new DemoRandom(seed);
  const shape = SHAPES[preset];
  const totalChips = shape.registered * STARTING_STACK;
  const featuredTable = 1;
  const tableId = (n: number) => `tbl_demo_${n}`;

  // ---------------------------------------------------------------- field
  const names = rng.shuffle(NAMES).slice(0, shape.registered);
  const players: DemoPlayer[] = names.map((name, i) => ({ id: `ply_demo_${i + 1}`, name, stack: 0, table: null, seat: null, finish: null }));
  // Busted players get finish positions registered..active+1 (in order of elimination).
  players.slice(shape.active).forEach((p, i) => (p.finish = shape.registered - i));
  const alive = () => players.filter((p) => p.finish === null);
  dealStacks(alive(), totalChips, rng, shape.status === 'REGISTRATION');
  if (shape.tables > 0) seatPlayers(alive(), shape, rng);

  let seq = 0;
  let tseq = 1_000;
  let version = 1;
  let handsCompleted = shape.status === 'REGISTRATION' ? 0 : 240 + shape.levelIndex * 30;
  let largestPot = shape.status === 'REGISTRATION' ? 0 : 41_600;
  let levelIndex = shape.levelIndex;
  let levelStartedAt = startedAt - 7 * MINUTE - 20_000;
  const status: TournamentStatus = shape.status;
  let hand: DemoHand | null = null;
  let handNumber = 60 + shape.levelIndex * 7;
  let button = 0;
  let steps = 0;

  const levelMs = () => LEVELS[levelIndex]!.durationSeconds * 1000;
  const counters = (): TournamentCounters => ({
    registered: shape.registered,
    active: alive().length,
    eliminated: shape.registered - alive().length,
    inTransit: 0,
    tables: shape.status === 'REGISTRATION' ? 0 : Math.max(1, Math.ceil(alive().length / MAX_SEATS)),
    handsCompleted,
    totalChips,
    largestPot,
  });

  const summary = (now: number): TournamentPublicSummary => {
    const running = status === 'RUNNING' || status === 'FINAL_TABLE';
    const pausedLeft = levelMs() - (now - levelStartedAt);
    return {
      tournamentId: TOURNAMENT_ID,
      name: NAME,
      status,
      clock: {
        levelIndex,
        levelStartedAt: status === 'REGISTRATION' ? null : levelStartedAt,
        levelEndsAt: running ? levelStartedAt + levelMs() : null,
        pausedRemainingMs: status === 'PAUSED' || status === 'BREAK' ? Math.max(0, pausedLeft) : null,
        breakEndsAt: status === 'BREAK' ? startedAt + 6 * MINUTE + 40_000 : null,
        pendingBreakAfterLevel: null,
      },
      currentLevel: status === 'COMPLETED' ? null : LEVELS[levelIndex]!,
      nextLevel: LEVELS[levelIndex + 1] ?? null,
      counters: counters(),
      handForHand: shape.handForHand,
      lastSeq: tseq,
      serverSeedHash: 'a3f1c09e7d2b44e18c5f6a0b9d3e2c71f4a8b6d05e9c1f2a3b4c5d6e7f8091a2',
    };
  };

  // ---------------------------------------------------------------- featured table view
  const atTable = () => players.filter((p) => p.finish === null && p.table === featuredTable).sort((a, b) => a.seat! - b.seat!);

  const view = (now: number): SpectatorTableView | null => {
    if (shape.tables === 0) return null;
    const seats: Array<PublicSeatView | null> = Array.from({ length: MAX_SEATS }, () => null);
    for (const p of atTable()) {
      const s = p.seat!;
      const inHand = !!hand && hand.order.includes(s);
      const la = hand?.lastAction[s];
      seats[s] = {
        seat: s,
        playerId: p.id,
        displayName: p.name,
        publicId: p.id.replace('ply_', 'P'),
        stack: p.stack,
        connected: true,
        inHand,
        folded: !!hand && hand.folded.includes(s),
        allIn: false,
        streetContribution: hand?.contrib[s] ?? 0,
        lastAction: la ? { action: la.action, amount: la.amount, toAmount: la.toAmount } : null,
        isButton: (hand?.button ?? button) === s,
        isSmallBlind: hand?.sbSeat === s,
        isBigBlind: hand?.bbSeat === s,
        shownCards: hand?.shown[s] ?? null,
        away: false,
      };
    }
    const lvl = LEVELS[levelIndex]!;
    const pending = hand ? Object.values(hand.contrib).reduce((a, b) => a + b, 0) : 0;
    const frozen = preset === 'frozen';
    const holds = status === 'BREAK' ? ['BREAK' as const] : status === 'PAUSED' && !frozen ? ['PAUSE' as const] : shape.handForHand ? ['HAND_FOR_HAND' as const] : [];
    return {
      audience: 'SPECTATOR',
      tableId: tableId(featuredTable),
      tournamentId: TOURNAMENT_ID,
      tableNumber: featuredTable,
      version,
      lastEventSeq: seq,
      status: hand ? 'IN_HAND' : status === 'BREAK' || status === 'PAUSED' ? 'HELD' : status === 'COMPLETED' ? 'CLOSED' : 'BETWEEN_HANDS',
      holds,
      frozen,
      maxSeats: MAX_SEATS,
      seats,
      buttonSeat: hand?.button ?? button,
      blinds: { level: lvl.level, smallBlind: lvl.smallBlind, bigBlind: lvl.bigBlind, ante: lvl.ante, anteType: 'BB_ANTE' },
      hand: hand
        ? {
            handId: `hnd_demo_${hand.number}`,
            handNumber: hand.number,
            phase: hand.phase,
            board: hand.script.board.slice(0, boardCount(hand.street, hand.phase)),
            pots: hand.pot > 0 ? [{ amount: hand.pot, eligibleSeats: hand.order.filter((s) => !hand!.folded.includes(s)) }] : [],
            totalPot: hand.pot + pending,
            currentBet: hand.currentBet,
            actingSeat: hand.acting,
            actionDeadline: hand.deadline,
            turnVersion: hand.turnVersion,
          }
        : null,
      serverTime: now,
    };
  };

  // ---------------------------------------------------------------- frames
  const tableEvent = (now: number, event: HandEvent | TableLevelEvent): TableEvent => ({
    tableId: tableId(featuredTable),
    tournamentId: TOURNAMENT_ID,
    seq: ++seq,
    version,
    at: now,
    visibility: 'PUBLIC',
    privateTo: null,
    event,
  });

  const tableUpdate = (now: number, events: TableEvent[]): DisplayAction | null => {
    const v = view(now);
    if (!v) return null;
    const from = events[0]?.seq ?? seq;
    const msg: ServerMessage = { t: 'table_update', st: now, tableId: v.tableId, fromSeq: from, toSeq: seq, version: v.version, events, view: v };
    return { type: 'frame', frame: msg, at: now };
  };

  const tournamentEvent = (now: number, at: number, event: TournamentEvent): DisplayAction => {
    const env: TournamentEventEnvelope = { tournamentId: TOURNAMENT_ID, seq: ++tseq, at, event };
    return { type: 'frame', frame: { t: 'tournament_event', st: now, event: env, summary: summary(now) }, at };
  };

  // ---------------------------------------------------------------- hand simulation
  const lvl = () => LEVELS[levelIndex]!;

  const startHand = (now: number): TableEvent[] => {
    const seated = atTable().map((p) => p.seat!);
    if (seated.length < 2) return [];
    button = nextIn(seated, button);
    const order = rotateFrom(seated, button);
    const heads = order.length === 2;
    const sbSeat = heads ? button : order[0]!;
    const bbSeat = heads ? order[0]! : order[1]!;
    const pool = rng.shuffle(seated);
    hand = {
      number: ++handNumber,
      script: rng.pick(SCRIPTS),
      hero: pool[0]!,
      villain: pool[1]!,
      villainFolds: rng.next() < 0.3,
      order: rotateFrom(seated, button),
      button,
      sbSeat,
      bbSeat,
      folded: [],
      acted: [],
      contrib: {},
      lastAction: {},
      pot: 0,
      street: 0,
      currentBet: lvl().bigBlind,
      acting: null,
      deadline: null,
      turnVersion: 0,
      shown: {},
      phase: 'PREFLOP',
      doneSteps: 0,
    };
    const h = hand;
    const events: TableEvent[] = [];
    events.push(
      tableEvent(now, {
        kind: 'HAND_STARTED',
        handId: `hnd_demo_${h.number}`,
        handNumber: h.number,
        buttonSeat: h.button,
        smallBlindSeat: sbSeat,
        bigBlindSeat: bbSeat,
        smallBlind: lvl().smallBlind,
        bigBlind: lvl().bigBlind,
        ante: lvl().ante,
        anteType: 'BB_ANTE',
        players: seated.map((s) => ({ seat: s, playerId: bySeat(s).id, stack: bySeat(s).stack })),
      }),
    );
    // BB ante goes straight to the pot; blinds are street contributions.
    h.pot += take(bbSeat, lvl().ante);
    h.contrib[sbSeat] = take(sbSeat, lvl().smallBlind);
    h.contrib[bbSeat] = take(bbSeat, lvl().bigBlind);
    h.acting = nextIn(h.order, bbSeat);
    setTurn(now);
    return events;
  };

  const bySeat = (s: number) => atTable().find((p) => p.seat === s)!;
  const take = (s: number, amount: number) => {
    const p = bySeat(s);
    const a = Math.min(p.stack, amount);
    p.stack -= a;
    return a;
  };

  const setTurn = (now: number) => {
    const h = hand!;
    h.turnVersion += 1;
    h.deadline = h.acting === null ? null : now + ACTION_TIMER_MS - rng.int(0, 6) * 1000;
  };

  const live = () => hand!.order.filter((s) => !hand!.folded.includes(s));

  const act = (now: number): TableEvent[] => {
    const h = hand!;
    const s = h.acting!;
    const p = bySeat(s);
    const mine = h.contrib[s] ?? 0;
    const toCall = h.currentBet - mine;
    const key = s === h.hero || s === h.villain;
    const r = rng.next();
    let action: 'FOLD' | 'CHECK' | 'CALL' | 'BET' | 'RAISE';
    if (toCall > 0) {
      if (s === h.villain && h.villainFolds && h.street >= 2) action = 'FOLD';
      else if (!key && r < (h.street === 0 ? 0.55 : 0.7)) action = 'FOLD';
      else if (key && h.street < 2 && r < 0.15 && h.currentBet < lvl().bigBlind * 6) action = 'RAISE';
      else action = 'CALL';
    } else {
      action = (key ? r < 0.4 : r < 0.12) && h.street < 3 ? 'BET' : 'CHECK';
    }
    let amount = 0;
    if (action === 'CALL') amount = Math.min(toCall, p.stack);
    if (action === 'BET' || action === 'RAISE') {
      const potNow = h.pot + Object.values(h.contrib).reduce((a, b) => a + b, 0);
      const target = action === 'BET' ? roundTo(Math.max(lvl().bigBlind, potNow * 0.55), lvl().smallBlind) : h.currentBet * 3;
      amount = Math.min(target - mine, Math.max(0, p.stack - lvl().bigBlind));
      if (amount <= toCall) {
        action = toCall > 0 ? 'CALL' : 'CHECK';
        amount = toCall > 0 ? Math.min(toCall, p.stack) : 0;
      }
    }
    if (action === 'FOLD') h.folded.push(s);
    p.stack -= amount;
    h.contrib[s] = mine + amount;
    if (h.contrib[s]! > h.currentBet) {
      h.currentBet = h.contrib[s]!;
      h.acted = [];
    }
    h.acted.push(s);
    h.lastAction[s] = { action, amount, toAmount: h.contrib[s]! };
    const events: TableEvent[] = [
      tableEvent(now, { kind: 'PLAYER_ACTED', seat: s, playerId: p.id, action, amount, toAmount: h.contrib[s]!, allIn: p.stack === 0, stack: p.stack, pot: h.pot + Object.values(h.contrib).reduce((a, b) => a + b, 0), timeout: false }),
    ];
    const remaining = live();
    if (remaining.length === 1) return [...events, ...finish(now, false)];
    // A player with no chips behind is all-in: never asked to act again.
    const pending = remaining.filter((x) => bySeat(x).stack > 0 && (!h.acted.includes(x) || (h.contrib[x] ?? 0) < h.currentBet));
    if (pending.length === 0) return [...events, ...nextStreet(now)];
    h.acting = nextIn(remaining, s);
    while (!pending.includes(h.acting)) h.acting = nextIn(remaining, h.acting);
    setTurn(now);
    return events;
  };

  const collect = () => {
    const h = hand!;
    h.pot += Object.values(h.contrib).reduce((a, b) => a + b, 0);
    h.contrib = {};
    h.currentBet = 0;
    h.acted = [];
    h.lastAction = {};
  };

  const nextStreet = (now: number): TableEvent[] => {
    const h = hand!;
    collect();
    if (h.street === 3) return finish(now, true);
    h.street = (h.street + 1) as DemoHand['street'];
    h.phase = (['PREFLOP', 'FLOP', 'TURN', 'RIVER'] as const)[h.street];
    const board = h.script.board.slice(0, boardCount(h.street, h.phase));
    const street = h.phase as 'FLOP' | 'TURN' | 'RIVER';
    h.acting = nextIn(live(), h.button);
    setTurn(now);
    return [tableEvent(now, { kind: 'STREET_STARTED', street, board, newCards: board.slice(h.street === 1 ? 0 : -1), pot: h.pot })];
  };

  const finish = (now: number, showdown: boolean): TableEvent[] => {
    const h = hand!;
    collect();
    h.acting = null;
    h.deadline = null;
    const winner = showdown ? h.hero : live()[0]!;
    const events: TableEvent[] = [];
    if (showdown) {
      h.phase = 'SHOWDOWN';
      h.shown[h.hero] = h.script.win;
      h.shown[h.villain] = h.script.lose;
      const s = h.script;
      const mucked = live()
        .filter((x) => x !== h.hero && x !== h.villain)
        .map((x) => ({ seat: x, playerId: bySeat(x).id, cards: null, mucked: true, hand: null }));
      events.push(
        tableEvent(now, {
          kind: 'SHOWDOWN',
          reveals: [
            ...mucked,
            { seat: h.villain, playerId: bySeat(h.villain).id, cards: s.lose, mucked: false, hand: { category: s.loseCat, score: 1, bestFive: s.loseBest, description: s.loseDesc } },
            { seat: h.hero, playerId: bySeat(h.hero).id, cards: s.win, mucked: false, hand: { category: s.winCat, score: 2, bestFive: s.winBest, description: s.winDesc } },
          ],
        }),
      );
    }
    const pot = h.pot;
    bySeat(winner).stack += pot;
    h.pot = 0;
    largestPot = Math.max(largestPot, pot);
    handsCompleted += 1;
    events.push(
      tableEvent(now, {
        kind: 'POT_AWARDED',
        potIndex: 0,
        potType: 'MAIN',
        amount: pot,
        eligibleSeats: live(),
        winners: [{ seat: winner, playerId: bySeat(winner).id, amount: pot, oddChips: 0 }],
        winningHand: showdown ? { category: h.script.winCat, description: h.script.winDesc, bestFive: h.script.winBest } : null,
      }),
    );
    h.phase = 'HAND_COMPLETE';
    events.push(
      tableEvent(now, {
        kind: 'HAND_COMPLETED',
        handId: `hnd_demo_${h.number}`,
        handNumber: h.number,
        board: showdown ? h.script.board : h.script.board.slice(0, boardCount(h.street, 'HAND_COMPLETE')),
        totalPot: pot,
        finalStacks: h.order.map((x) => ({ seat: x, playerId: bySeat(x).id, stack: bySeat(x).stack })),
        bustedSeats: [],
      }),
    );
    if (!showdown) h.street = Math.min(h.street, 3) as DemoHand['street'];
    return events;
  };

  // ---------------------------------------------------------------- room events
  const eliminateElsewhere = (now: number): DisplayAction[] => {
    const others = alive().filter((p) => p.table !== featuredTable);
    if (alive().length <= shape.floor || others.length < 2) return [];
    const victim = rng.pick(others);
    const heir = rng.pick(others.filter((p) => p !== victim));
    const position = alive().length;
    heir.stack += victim.stack;
    victim.stack = 0;
    victim.finish = position;
    const out = [
      tournamentEvent(now, now, {
        kind: 'PLAYER_ELIMINATED',
        record: { playerId: victim.id, entryId: `ent_${victim.id}`, finishPosition: position, tiedCount: 1, eliminatedAt: now, handId: `hnd_x_${steps}`, handNumber: steps, tableId: tableId(victim.table ?? 2), startingStackOfHand: 0, batchId: `b${steps}` },
        displayName: victim.name,
        playersRemaining: position - 1,
      }),
    ];
    victim.table = null;
    victim.seat = null;
    return out;
  };

  const history = (now: number): DisplayAction[] => {
    if (status === 'REGISTRATION') {
      return [tournamentEvent(now, now - 5 * MINUTE, { kind: 'ANNOUNCEMENT', text: 'Registration closes at 8:30 pm. Cards in the air at 8:45 pm sharp.', from: 'DIRECTOR' })];
    }
    const out: DisplayAction[] = [];
    let t = now - 9 * MINUTE;
    const busted = players.filter((p) => p.finish !== null && p.finish > 1).sort((a, b) => b.finish! - a.finish!);
    const recent = busted.slice(-6);
    out.push(tournamentEvent(now, (t += 20_000), { kind: 'BLIND_LEVEL_CHANGED', from: LEVELS[levelIndex - 1] ?? null, to: LEVELS[levelIndex]!, levelEndsAt: levelStartedAt + levelMs() }));
    out.push(tournamentEvent(now, (t += 20_000), { kind: 'ANNOUNCEMENT', text: 'Welcome to the big screen! Follow the featured table live.', from: 'DIRECTOR' }));
    for (const p of recent) {
      out.push(
        tournamentEvent(now, (t += 45_000), {
          kind: 'PLAYER_ELIMINATED',
          record: { playerId: p.id, entryId: `ent_${p.id}`, finishPosition: p.finish!, tiedCount: 1, eliminatedAt: t, handId: `hnd_h_${p.finish}`, handNumber: p.finish!, tableId: tableId(2), startingStackOfHand: 0, batchId: `h${p.finish}` },
          displayName: p.name,
          playersRemaining: p.finish! - 1,
        }),
      );
    }
    if (shape.tables < 3) out.push(tournamentEvent(now, t + 10_000, { kind: 'TABLE_BROKEN', tableId: tableId(3), tableNumber: 3, playersMoved: 4 }));
    if (preset === 'final') {
      out.push(tournamentEvent(now, t + 20_000, { kind: 'FINAL_TABLE_FORMED', tableId: tableId(featuredTable), players: atTable().map((p) => ({ playerId: p.id, displayName: p.name, seat: p.seat!, stack: p.stack })) }));
    }
    if (preset === 'bubble') {
      out.push(tournamentEvent(now, t + 20_000, { kind: 'MILESTONE', code: 'BUBBLE', text: 'ON THE BUBBLE — HAND-FOR-HAND', playersRemaining: alive().length }));
      out.push(tournamentEvent(now, t + 21_000, { kind: 'HAND_FOR_HAND', enabled: true }));
    }
    if (preset === 'break') out.push(tournamentEvent(now, now - 40_000, { kind: 'BREAK_STARTED', endsAt: startedAt + 6 * MINUTE + 40_000, nextLevel: LEVELS[levelIndex + 1] ?? null, message: '10-minute break. Chip-up of the 100s happens now.' }));
    if (preset === 'paused') out.push(tournamentEvent(now, now - 20_000, { kind: 'TOURNAMENT_PAUSED', mode: 'AFTER_HAND', reason: 'Floor decision at table 2' }));
    if (preset === 'frozen') out.push(tournamentEvent(now, now - 20_000, { kind: 'TOURNAMENT_PAUSED', mode: 'EMERGENCY_FREEZE', reason: 'Technical check — every hand is safe' }));
    if (preset === 'champion') {
      const champ = alive()[0]!;
      out.push(tournamentEvent(now, now - 2_000, { kind: 'TOURNAMENT_COMPLETED', winnerId: champ.id, winnerName: champ.name, completedAt: now - 2_000 }));
    }
    return out;
  };

  return {
    open(now) {
      const snapshot: ServerMessage = { t: 'snapshot', st: now, snapshot: { audience: 'DISPLAY', tournament: summary(now), featured: view(now) } };
      return [{ type: 'frame', frame: snapshot, at: now }, ...history(now)];
    },
    step(now) {
      steps += 1;
      const out: DisplayAction[] = [];
      if (!shape.playing) return out;
      if (now - levelStartedAt >= levelMs() && LEVELS[levelIndex + 1]) {
        const from = LEVELS[levelIndex]!;
        levelIndex += 1;
        levelStartedAt = now;
        out.push(tournamentEvent(now, now, { kind: 'BLIND_LEVEL_CHANGED', from, to: LEVELS[levelIndex]!, levelEndsAt: now + levelMs() }));
      }
      let events: TableEvent[] = [];
      if (!hand) events = startHand(now);
      else if (hand.phase === 'HAND_COMPLETE') {
        hand.doneSteps += 1;
        if (hand.doneSteps > HAND_DONE_STEPS) hand = null;
      } else if (hand.acting !== null) events = act(now);
      version += 1;
      const update = tableUpdate(now, events);
      if (update) out.push(update);
      if (steps % ELIMINATION_EVERY_STEPS === 3) out.push(...eliminateElsewhere(now));
      return out;
    },
    leaderboard(mode, limit) {
      const rows: LeaderboardRowDto[] =
        mode === 'stack'
          ? alive()
              .sort((a, b) => b.stack - a.stack)
              .slice(0, limit)
              .map((p, i) => row(p, i + 1, null))
          : players
              .filter((p) => p.finish !== null || status === 'COMPLETED')
              .map((p) => ({ p, finish: p.finish ?? 1 }))
              .sort((a, b) => a.finish - b.finish)
              .slice(0, limit)
              .map(({ p, finish }) => row(p, finish, finish));
      return {
        mode,
        label: mode === 'stack' ? 'Current stack ranking' : 'Finishing positions',
        rows,
        total: mode === 'stack' ? alive().length : players.filter((p) => p.finish !== null).length,
        offset: 0,
        limit,
      };
    },
    info() {
      return { name: NAME, joinCode: JOIN_CODE, currency: 'INR', places: PLACES, startingStack: STARTING_STACK };
    },
  };

  function row(p: DemoPlayer, rank: number, finish: number | null): LeaderboardRowDto {
    return {
      rank,
      playerId: p.id,
      publicId: p.id.replace('ply_', 'P'),
      displayName: p.name,
      stack: p.stack,
      finishPosition: finish,
      tiedCount: 1,
      prizeMinor: finish !== null ? (PLACES.find((x) => x.position === finish)?.amountMinor ?? 0) : 0,
      status: p.finish === null ? 'SEATED' : 'ELIMINATED',
      tableNumber: p.table,
    };
  }
}

/** Stacks that sum exactly to the chips in play (chip conservation holds in the demo too). */
function dealStacks(alive: DemoPlayer[], total: number, rng: DemoRandom, equal: boolean): void {
  const weights = alive.map(() => (equal ? 1 : 0.35 + rng.next() * rng.next() * 2.2));
  const sum = weights.reduce((a, b) => a + b, 0);
  let given = 0;
  alive.forEach((p, i) => {
    p.stack = Math.floor((total * weights[i]!) / sum / 25) * 25;
    given += p.stack;
  });
  if (alive[0]) alive[0].stack += total - given;
}

function seatPlayers(alive: DemoPlayer[], shape: PresetShape, rng: DemoRandom): void {
  const featured = alive.slice(0, shape.featuredPlayers);
  const seats = rng.shuffle(Array.from({ length: MAX_SEATS }, (_, i) => i)).slice(0, featured.length);
  featured.forEach((p, i) => {
    p.table = 1;
    p.seat = seats[i]!;
  });
  alive.slice(shape.featuredPlayers).forEach((p, i) => {
    p.table = 2 + (i % Math.max(1, shape.tables - 1));
    p.seat = Math.floor(i / Math.max(1, shape.tables - 1));
  });
}

function boardCount(street: number, phase: HandPhase): number {
  if (phase === 'SHOWDOWN') return 5;
  return street === 0 ? 0 : street === 1 ? 3 : street === 2 ? 4 : 5;
}

function nextIn(seats: number[], from: number): number {
  const sorted = [...seats].sort((a, b) => a - b);
  return sorted.find((s) => s > from) ?? sorted[0]!;
}

function rotateFrom(seats: number[], button: number): number[] {
  const sorted = [...seats].sort((a, b) => a - b);
  const after = sorted.filter((s) => s > button);
  const before = sorted.filter((s) => s <= button);
  return [...after, ...before];
}

function roundTo(n: number, unit: number): number {
  return Math.max(unit, Math.round(n / unit) * unit);
}
