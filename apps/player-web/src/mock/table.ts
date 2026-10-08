/**
 * MOCK table actor: a compact No-Limit Hold'em table that stands in for the
 * real server while it is being built. It produces the same frames the real
 * gateway sends (TableEvents + PlayerTableView / SpectatorTableView) so the
 * player app can be exercised end-to-end in the browser.
 *
 * This file is NOT part of the client's game logic: the app never imports it
 * outside mock mode, and the client only renders what this "server" sends.
 */
import type {
  ActionRejectCode,
  ActionType,
  CardCode,
  CurrentBlinds,
  HandPhase,
  HoldReason,
  LegalActions,
  PlayerTableView,
  PublicHandView,
  PublicSeatView,
  RemovalReason,
  ShowdownReveal,
  SpectatorTableView,
  Street,
  TableEvent,
  TableEventPayload,
  TableStatus,
  TableViewBase,
} from '@jpb/shared-types';
import { CANONICAL_DECK } from '@jpb/shared-types';
import { evaluateBest, preflopStrength } from './evaluator';
import type { MockEvaluated } from './evaluator';
import { seededRng, shuffled } from './rng';
import type { Rng } from './rng';

export interface MockClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realClock: MockClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export type BotStyle = 'tight' | 'loose' | 'aggro' | 'station';
/** Scripted override for one hand (by playerId). */
export type ScriptedMove = 'shove' | 'fold' | 'call';

export interface SimPlayer {
  playerId: string;
  displayName: string;
  publicId: string;
  stack: number;
  style: BotStyle;
  /** Decisions come from a real client (the hero), never from the bot policy. */
  human?: boolean;
}

export interface HandScript {
  hole?: Record<string, [CardCode, CardCode]>;
  board?: CardCode[];
  moves?: Record<string, ScriptedMove>;
}

export interface HandReport {
  handNumber: number;
  busted: string[];
  players: string[];
  /** Stack each player started the hand with. */
  startingStacks: Record<string, number>;
}

export interface TableBatch {
  events: TableEvent[];
  version: number;
}

export interface MockTiming {
  heroTimerMs: number;
  botTimerMs: number;
  botThinkMs: number;
  streetDelayMs: number;
  betweenHandsMs: number;
  showdownDelayMs: number;
  graceMs: number;
}

export const DEFAULT_TIMING: MockTiming = {
  heroTimerMs: 20_000,
  botTimerMs: 15_000,
  botThinkMs: 1_100,
  streetDelayMs: 750,
  betweenHandsMs: 2_600,
  showdownDelayMs: 4_600,
  graceMs: 1_500,
};

interface SeatState {
  player: SimPlayer;
  seat: number;
  connected: boolean;
  away: boolean;
  inHand: boolean;
  folded: boolean;
  allIn: boolean;
  street: number;
  total: number;
  hole: [CardCode, CardCode] | null;
  shown: [CardCode, CardCode] | null;
  lastAction: PublicSeatView['lastAction'];
  timeouts: number;
}

interface HandState {
  handId: string;
  handNumber: number;
  phase: HandPhase;
  boardPlan: CardCode[];
  board: CardCode[];
  currentBet: number;
  lastRaise: number;
  acting: number | null;
  deadline: number | null;
  timerMs: number;
  turnVersion: number | null;
  toAct: Set<number>;
  buttonSeat: number;
  sbSeat: number | null;
  bbSeat: number;
  moves: Record<string, ScriptedMove>;
  finalPot: number;
  startingStacks: Record<string, number>;
}

export interface MockTableOptions {
  tableId: string;
  tournamentId: string;
  tableNumber: number;
  maxSeats: number;
  blinds: CurrentBlinds;
  seed: number;
  clock?: MockClock;
  timing?: Partial<MockTiming>;
  /** Divides bot/street/between-hand delays (not the hero's action timer). */
  speed?: number;
  firstHandNumber?: number;
}

export interface SubmitResult {
  ok: boolean;
  code: ActionRejectCode | null;
  message: string | null;
}

const STREETS: Record<number, Street> = { 0: 'PREFLOP', 3: 'FLOP', 4: 'TURN', 5: 'RIVER' };

export class MockTable {
  readonly tableId: string;
  readonly tableNumber: number;
  readonly maxSeats: number;
  readonly seats: Array<SeatState | null>;
  blinds: CurrentBlinds;
  status: TableStatus = 'WAITING';
  holds: HoldReason[] = [];
  frozen = false;
  version = 0;
  seq = 0;
  handNumber: number;
  hand: HandState | null = null;
  button: number | null = null;
  onHandComplete: ((report: HandReport) => void) | null = null;

  private readonly clock: MockClock;
  private readonly timing: MockTiming;
  private readonly speed: number;
  private readonly rng: Rng;
  private readonly listeners = new Set<(b: TableBatch) => void>();
  private readonly scripts: HandScript[] = [];
  private buffer: TableEvent[] | null = null;
  private after: Array<() => void> = [];
  private handTimer: unknown = null;
  private turnTimer: unknown = null;
  private turnCounter = 0;
  private running = false;
  private pendingBlinds: CurrentBlinds | null = null;

  constructor(private readonly opts: MockTableOptions) {
    this.tableId = opts.tableId;
    this.tableNumber = opts.tableNumber;
    this.maxSeats = opts.maxSeats;
    this.seats = Array.from({ length: opts.maxSeats }, () => null);
    this.blinds = opts.blinds;
    this.clock = opts.clock ?? realClock;
    this.timing = { ...DEFAULT_TIMING, ...opts.timing };
    this.speed = Math.max(0.1, opts.speed ?? 1);
    this.rng = seededRng(opts.seed);
    this.handNumber = (opts.firstHandNumber ?? 1) - 1;
  }

  /* ------------------------------------------------------------ public API */

  subscribe(fn: (b: TableBatch) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  queueScript(script: HandScript): void {
    this.scripts.push(script);
  }

  seatOf(playerId: string): number | null {
    const s = this.seats.find((x) => x?.player.playerId === playerId);
    return s ? s.seat : null;
  }

  player(playerId: string): SimPlayer | null {
    return this.seats.find((x) => x?.player.playerId === playerId)?.player ?? null;
  }

  seatPlayer(player: SimPlayer, seat: number, moveId: string | null = null): void {
    this.commit(() => {
      this.seats[seat] = {
        player,
        seat,
        connected: true,
        away: false,
        inHand: false,
        folded: false,
        allIn: false,
        street: 0,
        total: 0,
        hole: null,
        shown: null,
        lastAction: null,
        timeouts: 0,
      };
      this.emit({ kind: 'PLAYER_SEATED', seat, playerId: player.playerId, displayName: player.displayName, publicId: player.publicId, stack: player.stack, moveId });
    });
    if (this.running && !this.hand) this.scheduleNextHand(this.timing.betweenHandsMs);
  }

  removePlayer(playerId: string, reason: RemovalReason): void {
    const seat = this.seatOf(playerId);
    if (seat === null) return;
    this.commit(() => {
      const s = this.seats[seat] as SeatState;
      this.emit({ kind: 'PLAYER_REMOVED', seat, playerId, reason, stack: s.player.stack, moveId: null });
      this.seats[seat] = null;
    });
  }

  start(delayMs = 1_500): void {
    this.running = true;
    this.scheduleNextHand(delayMs);
  }

  stop(): void {
    this.running = false;
    this.clock.clearTimeout(this.handTimer);
    this.clock.clearTimeout(this.turnTimer);
  }

  setBlinds(blinds: CurrentBlinds): void {
    this.pendingBlinds = blinds;
    if (!this.hand || this.hand.phase === 'HAND_COMPLETE') this.applyPendingBlinds();
  }

  hold(reason: HoldReason): void {
    if (this.holds.includes(reason)) return;
    this.commit(() => {
      this.holds = [...this.holds, reason];
      this.refreshStatus();
    });
  }

  release(reason: HoldReason): void {
    if (!this.holds.includes(reason)) return;
    this.commit(() => {
      this.holds = this.holds.filter((h) => h !== reason);
      this.refreshStatus();
    });
    if (this.holds.length === 0 && this.running && (!this.hand || this.hand.phase === 'HAND_COMPLETE')) this.scheduleNextHand(1_200);
  }

  setConnected(playerId: string, connected: boolean): void {
    const seat = this.seatOf(playerId);
    const s = seat === null ? null : this.seats[seat];
    if (!s || s.connected === connected) return;
    this.commit(() => {
      s.connected = connected;
      this.emit({ kind: 'PLAYER_CONNECTION_CHANGED', seat: s.seat, playerId, connected });
    });
  }

  /** A player's intention (the hero). Validated exactly like the server would. */
  submit(playerId: string, type: ActionType, amount: number | undefined, tableStateVersion: number): SubmitResult {
    const reject = (code: ActionRejectCode, message: string): SubmitResult => ({ ok: false, code, message });
    if (this.frozen) return reject('TABLE_FROZEN', 'The table is paused.');
    const h = this.hand;
    const seat = this.seatOf(playerId);
    if (seat === null) return reject('PLAYER_NOT_SEATED', 'You are not seated at this table.');
    if (!h || h.phase === 'HAND_COMPLETE') return reject('NO_ACTIVE_HAND', 'No hand is being played.');
    if (h.acting === null) return reject('HAND_NOT_IN_BETTING', 'Betting is closed.');
    if (h.acting !== seat) return reject('NOT_YOUR_TURN', 'It is not your turn.');
    if (h.turnVersion !== tableStateVersion) return reject('STALE_STATE_VERSION', 'The table has moved on.');
    if (h.deadline !== null && this.clock.now() > h.deadline + this.timing.graceMs) return reject('ACTION_DEADLINE_PASSED', 'Time ran out.');
    const legal = this.legalFor(seat);
    const invalid = this.validate(legal, type, amount);
    if (invalid) return reject(invalid, 'That action is not allowed right now.');
    this.clock.clearTimeout(this.turnTimer);
    this.commit(() => this.applyAction(seat, type, amount, false));
    return { ok: true, code: null, message: null };
  }

  playerView(playerId: string): PlayerTableView | null {
    const seat = this.seatOf(playerId);
    if (seat === null) return null;
    const s = this.seats[seat] as SeatState;
    const h = this.hand;
    const acting = h !== null && h.acting === seat && h.phase !== 'HAND_COMPLETE';
    return {
      ...this.baseView(),
      audience: 'PLAYER',
      you: { playerId, seat, holeCards: s.inHand ? s.hole : null, legal: acting ? this.legalFor(seat) : null },
    };
  }

  spectatorView(): SpectatorTableView {
    return { ...this.baseView(), audience: 'SPECTATOR' };
  }

  get timerMs(): number {
    return this.hand?.timerMs ?? this.timing.heroTimerMs;
  }

  /* ----------------------------------------------------------- internals */

  private commit(fn: () => void): void {
    this.version += 1;
    this.buffer = [];
    fn();
    const events = this.buffer;
    this.buffer = null;
    for (const l of [...this.listeners]) l({ events, version: this.version });
    const after = this.after;
    this.after = [];
    for (const f of after) f();
  }

  private emit(event: TableEventPayload, privateTo: string | null = null): void {
    this.seq += 1;
    this.buffer?.push({
      tableId: this.tableId,
      tournamentId: this.opts.tournamentId,
      seq: this.seq,
      version: this.version,
      at: this.clock.now(),
      visibility: privateTo ? 'PRIVATE' : 'PUBLIC',
      privateTo,
      event,
    });
  }

  private refreshStatus(): void {
    const before = this.status;
    if (this.holds.length > 0 && (!this.hand || this.hand.phase === 'HAND_COMPLETE')) this.status = 'HELD';
    else if (this.hand && this.hand.phase !== 'HAND_COMPLETE') this.status = 'IN_HAND';
    else if (this.eligibleSeats().length >= 2 && this.running) this.status = 'BETWEEN_HANDS';
    else this.status = 'WAITING';
    if (before !== this.status || this.holds.length > 0) {
      this.emit({ kind: 'TABLE_STATUS_CHANGED', status: this.status, holds: this.holds, frozen: this.frozen });
    }
  }

  private delay(ms: number): number {
    return Math.round(ms / this.speed);
  }

  private scheduleNextHand(ms: number): void {
    this.clock.clearTimeout(this.handTimer);
    this.handTimer = this.clock.setTimeout(() => this.startHandIfPossible(), this.delay(ms));
  }

  private eligibleSeats(): SeatState[] {
    return this.seats.filter((s): s is SeatState => s !== null && s.player.stack > 0);
  }

  private applyPendingBlinds(): void {
    if (!this.pendingBlinds) return;
    const blinds = this.pendingBlinds;
    this.pendingBlinds = null;
    this.blinds = blinds;
    this.commit(() => this.emit({ kind: 'BLINDS_SCHEDULED', blinds }));
  }

  private startHandIfPossible(): void {
    if (!this.running || this.frozen) return;
    this.applyPendingBlinds();
    if (this.holds.length > 0 || this.eligibleSeats().length < 2) {
      this.commit(() => this.refreshStatus());
      return;
    }
    this.startHand(this.scripts.shift() ?? {});
  }

  private nextSeat(from: number, pred: (s: SeatState) => boolean): number | null {
    for (let k = 1; k <= this.maxSeats; k++) {
      const i = (from + k) % this.maxSeats;
      const s = this.seats[i];
      if (s && pred(s)) return i;
    }
    return null;
  }

  private startHand(script: HandScript): void {
    const eligible = this.eligibleSeats();
    this.commit(() => {
      this.handNumber += 1;
      const inHand = (s: SeatState) => s.player.stack > 0;
      const button = this.nextSeat(this.button ?? this.maxSeats - 1, inHand) as number;
      this.button = button;
      const headsUp = eligible.length === 2;
      const sbSeat = headsUp ? button : (this.nextSeat(button, inHand) as number);
      const bbSeat = this.nextSeat(sbSeat, inHand) as number;
      for (const s of this.seats) {
        if (!s) continue;
        Object.assign(s, { inHand: inHand(s), folded: false, allIn: false, street: 0, total: 0, hole: null, shown: null, lastAction: null });
      }
      const fixed = new Set<CardCode>([...(script.board ?? []), ...Object.values(script.hole ?? {}).flat()]);
      const deck = shuffled(this.rng, CANONICAL_DECK.filter((c) => !fixed.has(c)));
      const startingStacks: Record<string, number> = {};
      for (const s of eligible) {
        startingStacks[s.player.playerId] = s.player.stack;
        s.hole = script.hole?.[s.player.playerId] ?? [deck.pop() as CardCode, deck.pop() as CardCode];
      }
      const boardPlan = script.board ?? deck.splice(0, 5);
      const h: HandState = {
        handId: `H-${this.tableNumber}-${this.handNumber}`,
        handNumber: this.handNumber,
        phase: 'PREFLOP',
        boardPlan,
        board: [],
        currentBet: this.blinds.bigBlind,
        lastRaise: this.blinds.bigBlind,
        acting: null,
        deadline: null,
        timerMs: this.timing.botTimerMs,
        turnVersion: null,
        toAct: new Set(),
        buttonSeat: button,
        sbSeat,
        bbSeat,
        moves: script.moves ?? {},
        finalPot: 0,
        startingStacks,
      };
      this.hand = h;
      this.status = 'IN_HAND';
      this.emit({ kind: 'TABLE_STATUS_CHANGED', status: 'IN_HAND', holds: this.holds, frozen: this.frozen });
      this.emit({
        kind: 'HAND_STARTED',
        handId: h.handId,
        handNumber: h.handNumber,
        buttonSeat: button,
        smallBlindSeat: sbSeat,
        bigBlindSeat: bbSeat,
        smallBlind: this.blinds.smallBlind,
        bigBlind: this.blinds.bigBlind,
        ante: this.blinds.ante,
        anteType: this.blinds.anteType,
        players: eligible.map((s) => ({ seat: s.seat, playerId: s.player.playerId, stack: s.player.stack })),
      });
      this.post(sbSeat, 'SMALL_BLIND', this.blinds.smallBlind);
      this.post(bbSeat, 'BIG_BLIND', this.blinds.bigBlind);
      if (this.blinds.anteType === 'BB_ANTE' && this.blinds.ante > 0) this.post(bbSeat, 'ANTE', this.blinds.ante);
      for (const s of eligible) {
        this.emit({ kind: 'HOLE_CARDS_DEALT', seat: s.seat, playerId: s.player.playerId, cards: s.hole as [CardCode, CardCode] }, s.player.playerId);
      }
      h.toAct = new Set(eligible.filter((s) => !s.allIn).map((s) => s.seat));
      const first = this.nextSeat(headsUp ? (this.nextSeat(button, inHand) as number) : bbSeat, (s) => h.toAct.has(s.seat));
      if (first === null || this.liveSeats().filter((s) => !s.allIn).length < 2) {
        h.toAct.clear();
        this.roundComplete();
      } else this.requestAction(first);
    });
  }

  private post(seat: number, betType: 'SMALL_BLIND' | 'BIG_BLIND' | 'ANTE', amount: number): void {
    const s = this.seats[seat] as SeatState;
    const pay = Math.min(amount, s.player.stack);
    if (betType === 'ANTE') {
      s.player.stack -= pay;
      s.total += pay;
    } else this.put(s, pay);
    if (s.player.stack === 0) s.allIn = true;
    this.emit({ kind: 'FORCED_BET_POSTED', seat, betType, amount: pay, allIn: s.allIn, stack: s.player.stack, pot: this.potTotal() });
  }

  private put(s: SeatState, chips: number): void {
    s.player.stack -= chips;
    s.street += chips;
    s.total += chips;
  }

  private liveSeats(): SeatState[] {
    return this.seats.filter((s): s is SeatState => s !== null && s.inHand && !s.folded);
  }

  private potTotal(): number {
    return this.seats.reduce((sum, s) => sum + (s?.total ?? 0), 0);
  }

  legalFor(seat: number): LegalActions {
    const s = this.seats[seat] as SeatState;
    const h = this.hand as HandState;
    const stack = s.player.stack;
    const toCall = Math.max(0, h.currentBet - s.street);
    const othersWithChips = this.liveSeats().filter((o) => o.seat !== seat && !o.allIn && o.player.stack > 0).length > 0;
    const canAggress = othersWithChips && stack > toCall;
    const maxTo = s.street + stack;
    const minTo = Math.min(maxTo, h.currentBet === 0 ? this.blinds.bigBlind : h.currentBet + h.lastRaise);
    return {
      seat,
      playerId: s.player.playerId,
      canFold: toCall > 0,
      canCheck: toCall === 0,
      canCall: toCall > 0 && stack > 0,
      callAmount: Math.min(toCall, stack),
      canBet: h.currentBet === 0 && canAggress,
      canRaise: h.currentBet > 0 && canAggress,
      minTo,
      maxTo,
      canAllIn: stack > 0 && (canAggress || toCall > 0),
      allInTo: maxTo,
      currentBet: h.currentBet,
      contributedThisStreet: s.street,
      stack,
      pot: this.potTotal(),
    };
  }

  private validate(l: LegalActions, type: ActionType, amount: number | undefined): ActionRejectCode | null {
    switch (type) {
      case 'FOLD':
        return l.canFold || l.canCheck ? null : 'UNKNOWN_ACTION';
      case 'CHECK':
        return l.canCheck ? null : 'CHECK_NOT_ALLOWED';
      case 'CALL':
        return l.canCall ? null : 'CALL_NOT_ALLOWED';
      case 'ALL_IN':
        return l.canAllIn ? null : 'RAISE_NOT_ALLOWED';
      case 'BET':
      case 'RAISE': {
        if (type === 'BET' ? !l.canBet : !l.canRaise) return type === 'BET' ? 'BET_NOT_ALLOWED' : 'RAISE_NOT_ALLOWED';
        if (amount === undefined) return 'AMOUNT_REQUIRED';
        if (!Number.isInteger(amount)) return 'AMOUNT_NOT_INTEGER';
        if (amount < l.minTo) return 'AMOUNT_BELOW_MINIMUM';
        if (amount > l.maxTo) return 'AMOUNT_ABOVE_MAXIMUM';
        return null;
      }
      default:
        return 'UNKNOWN_ACTION';
    }
  }

  private requestAction(seat: number): void {
    const h = this.hand as HandState;
    const s = this.seats[seat] as SeatState;
    this.turnCounter += 1;
    h.acting = seat;
    h.turnVersion = this.turnCounter;
    const human = s.player.human === true;
    h.timerMs = human ? this.timing.heroTimerMs : this.timing.botTimerMs;
    h.deadline = this.clock.now() + h.timerMs;
    const turnVersion = h.turnVersion;
    this.emit({ kind: 'ACTION_REQUESTED', seat, playerId: s.player.playerId, legal: this.legalFor(seat), deadline: h.deadline, timerMs: h.timerMs, turnVersion });
    this.clock.clearTimeout(this.turnTimer);
    if (human) {
      this.turnTimer = this.clock.setTimeout(() => this.onTimeout(seat, turnVersion), h.timerMs + this.timing.graceMs);
    } else {
      const think = this.delay(this.timing.botThinkMs * (0.7 + this.rng() * 0.9));
      this.turnTimer = this.clock.setTimeout(() => this.botAct(seat, turnVersion), think);
    }
  }

  private onTimeout(seat: number, turnVersion: number): void {
    const h = this.hand;
    if (!h || h.acting !== seat || h.turnVersion !== turnVersion || this.frozen) return;
    const l = this.legalFor(seat);
    const s = this.seats[seat] as SeatState;
    s.timeouts += 1;
    this.commit(() => this.applyAction(seat, l.canCheck ? 'CHECK' : 'FOLD', undefined, true));
  }

  private botAct(seat: number, turnVersion: number): void {
    const h = this.hand;
    if (!h || h.acting !== seat || h.turnVersion !== turnVersion || this.frozen) return;
    const intent = this.decide(seat);
    this.commit(() => this.applyAction(seat, intent.type, intent.amount, false));
  }

  private applyAction(seat: number, type: ActionType, amount: number | undefined, timeout: boolean): void {
    const h = this.hand as HandState;
    const s = this.seats[seat] as SeatState;
    const toCall = Math.max(0, h.currentBet - s.street);
    let paid = 0;
    let reopened = false;
    const raiseTo = (to: number): void => {
      paid = to - s.street;
      this.put(s, paid);
      const size = to - h.currentBet;
      if (size > 0) {
        if (size >= h.lastRaise) h.lastRaise = size;
        h.currentBet = to;
        reopened = true;
      }
    };
    switch (type) {
      case 'FOLD':
        s.folded = true;
        break;
      case 'CHECK':
        break;
      case 'CALL':
        paid = Math.min(toCall, s.player.stack);
        this.put(s, paid);
        break;
      case 'BET':
      case 'RAISE':
        raiseTo(amount ?? h.currentBet + h.lastRaise);
        break;
      case 'ALL_IN': {
        const to = s.street + s.player.stack;
        if (to > h.currentBet) raiseTo(to);
        else {
          paid = s.player.stack;
          this.put(s, paid);
        }
        break;
      }
    }
    if (s.player.stack === 0 && !s.folded) s.allIn = true;
    s.lastAction = { action: type, amount: paid, toAmount: s.street };
    h.acting = null;
    h.deadline = null;
    this.emit({
      kind: 'PLAYER_ACTED',
      seat,
      playerId: s.player.playerId,
      action: type,
      amount: paid,
      toAmount: s.street,
      allIn: s.allIn,
      stack: s.player.stack,
      pot: this.potTotal(),
      timeout,
    });
    h.toAct.delete(seat);
    if (reopened) {
      h.toAct = new Set(this.liveSeats().filter((o) => o.seat !== seat && !o.allIn).map((o) => o.seat));
    }
    for (const o of this.liveSeats()) if (o.allIn) h.toAct.delete(o.seat);
    for (const t of [...h.toAct]) if ((this.seats[t] as SeatState).folded) h.toAct.delete(t);
    this.advance(seat);
  }

  private advance(lastSeat: number): void {
    const h = this.hand as HandState;
    if (this.liveSeats().length === 1) {
      this.finishUncontested();
      return;
    }
    // A lone player with chips who already matched the bet has nothing left to decide.
    const canAct = this.liveSeats().filter((s) => !s.allIn);
    if (canAct.length === 1 && h.toAct.size === 1) {
      const only = canAct[0] as SeatState;
      if (only.street >= h.currentBet) h.toAct.clear();
    }
    if (h.toAct.size > 0) {
      const next = this.nextSeat(lastSeat, (s) => h.toAct.has(s.seat));
      if (next !== null) {
        this.requestAction(next);
        return;
      }
    }
    this.roundComplete();
  }

  private roundComplete(): void {
    const h = this.hand as HandState;
    const street = STREETS[h.board.length] ?? 'PREFLOP';
    this.emit({ kind: 'BETTING_ROUND_COMPLETE', street, pot: this.potTotal() });
    for (const s of this.seats) if (s) s.street = 0;
    h.currentBet = 0;
    h.lastRaise = this.blinds.bigBlind;
    h.acting = null;
    h.deadline = null;
    h.turnVersion = null;
    const next = h.board.length >= 5 ? () => this.commit(() => this.showdown()) : () => this.commit(() => this.nextStreet());
    this.clock.clearTimeout(this.turnTimer);
    this.turnTimer = this.clock.setTimeout(next, this.delay(this.timing.streetDelayMs));
  }

  private nextStreet(): void {
    const h = this.hand as HandState;
    const n = h.board.length === 0 ? 3 : 1;
    const newCards = h.boardPlan.slice(h.board.length, h.board.length + n);
    h.board = [...h.board, ...newCards];
    const street = STREETS[h.board.length] as Street;
    h.phase = street;
    for (const s of this.seats) if (s && !s.folded) s.lastAction = null;
    this.emit({ kind: 'STREET_STARTED', street, board: h.board, newCards, pot: this.potTotal() });
    const canAct = this.liveSeats().filter((s) => !s.allIn);
    if (canAct.length >= 2) {
      h.toAct = new Set(canAct.map((s) => s.seat));
      const first = this.nextSeat(h.buttonSeat, (s) => h.toAct.has(s.seat));
      if (first !== null) {
        this.requestAction(first);
        return;
      }
    }
    h.toAct.clear();
    this.roundComplete();
  }

  private returnUncalled(): void {
    const contributors = this.seats.filter((s): s is SeatState => s !== null && s.total > 0).sort((a, b) => b.total - a.total);
    const [top, second] = contributors;
    if (!top) return;
    const diff = top.total - (second?.total ?? 0);
    if (diff <= 0) return;
    top.total -= diff;
    top.street = Math.max(0, top.street - diff);
    top.player.stack += diff;
    if (top.player.stack > 0) top.allIn = false;
    this.emit({ kind: 'UNCALLED_BET_RETURNED', seat: top.seat, playerId: top.player.playerId, amount: diff, stack: top.player.stack });
  }

  /** Layered main/side pots. `committedOnly` ignores the current street (for the live view). */
  private buildPots(committedOnly: boolean): Array<{ amount: number; eligibleSeats: number[] }> {
    const contrib = this.seats
      .filter((s): s is SeatState => s !== null && s.total > 0)
      .map((s) => ({ seat: s.seat, amt: committedOnly ? s.total - s.street : s.total, live: s.inHand && !s.folded }))
      .filter((c) => c.amt > 0);
    const levels = [...new Set(contrib.filter((c) => c.live).map((c) => c.amt))].sort((a, b) => a - b);
    const pots: Array<{ amount: number; eligibleSeats: number[] }> = [];
    let prev = 0;
    for (const lvl of levels) {
      const amount = contrib.reduce((sum, c) => sum + Math.max(0, Math.min(c.amt, lvl) - prev), 0);
      if (amount > 0) pots.push({ amount, eligibleSeats: contrib.filter((c) => c.live && c.amt >= lvl).map((c) => c.seat) });
      prev = lvl;
    }
    const leftover = contrib.reduce((sum, c) => sum + Math.max(0, c.amt - prev), 0);
    const last = pots[pots.length - 1];
    if (leftover > 0) {
      if (last) last.amount += leftover;
      else pots.push({ amount: leftover, eligibleSeats: contrib.filter((c) => c.live).map((c) => c.seat) });
    }
    return pots;
  }

  private finishUncontested(): void {
    const h = this.hand as HandState;
    this.returnUncalled();
    const winner = this.liveSeats()[0] as SeatState;
    const amount = this.potTotal();
    winner.player.stack += amount;
    h.finalPot = amount;
    h.phase = 'POT_DISTRIBUTION';
    this.emit({
      kind: 'POT_AWARDED',
      potIndex: 0,
      potType: 'MAIN',
      amount,
      eligibleSeats: [winner.seat],
      winners: [{ seat: winner.seat, playerId: winner.player.playerId, amount, oddChips: 0 }],
      winningHand: null,
    });
    this.complete(false);
  }

  private showdown(): void {
    const h = this.hand as HandState;
    h.phase = 'SHOWDOWN';
    this.returnUncalled();
    const evaluated = new Map<number, MockEvaluated>();
    const reveals: ShowdownReveal[] = [];
    for (const s of this.liveSeats()) {
      const e = evaluateBest([...(s.hole ?? []), ...h.board]);
      evaluated.set(s.seat, e);
      s.shown = s.hole;
      reveals.push({ seat: s.seat, playerId: s.player.playerId, cards: s.hole, mucked: false, hand: { category: e.category, score: e.score, bestFive: e.bestFive, description: e.description } });
    }
    this.emit({ kind: 'SHOWDOWN', reveals });
    h.finalPot = this.potTotal();
    h.phase = 'POT_DISTRIBUTION';
    this.buildPots(false).forEach((pot, potIndex) => {
      const best = Math.max(...pot.eligibleSeats.map((seat) => evaluated.get(seat)?.score ?? -1));
      const winners = pot.eligibleSeats.filter((seat) => evaluated.get(seat)?.score === best);
      const share = Math.floor(pot.amount / winners.length);
      let odd = pot.amount - share * winners.length;
      const shares = winners.map((seat) => {
        const s = this.seats[seat] as SeatState;
        const extra = odd > 0 ? 1 : 0;
        odd -= extra;
        s.player.stack += share + extra;
        return { seat, playerId: s.player.playerId, amount: share + extra, oddChips: extra };
      });
      const top = evaluated.get(winners[0] as number) as MockEvaluated;
      this.emit({
        kind: 'POT_AWARDED',
        potIndex,
        potType: potIndex === 0 ? 'MAIN' : 'SIDE',
        amount: pot.amount,
        eligibleSeats: pot.eligibleSeats,
        winners: shares,
        winningHand: { category: top.category, description: top.description, bestFive: top.bestFive },
      });
    });
    this.complete(true);
  }

  private complete(showdown: boolean): void {
    const h = this.hand as HandState;
    for (const s of this.seats) {
      if (!s) continue;
      s.street = 0;
      s.total = 0;
    }
    h.phase = 'HAND_COMPLETE';
    h.acting = null;
    h.deadline = null;
    h.turnVersion = null;
    const busted = this.seats.filter((s): s is SeatState => s !== null && s.inHand && s.player.stack === 0);
    this.emit({
      kind: 'HAND_COMPLETED',
      handId: h.handId,
      handNumber: h.handNumber,
      board: h.board,
      totalPot: h.finalPot,
      finalStacks: this.seats.filter((s): s is SeatState => s !== null && s.inHand).map((s) => ({ seat: s.seat, playerId: s.player.playerId, stack: s.player.stack })),
      bustedSeats: busted.map((s) => s.seat),
    });
    this.status = this.holds.length > 0 ? 'HELD' : 'BETWEEN_HANDS';
    this.emit({ kind: 'TABLE_STATUS_CHANGED', status: this.status, holds: this.holds, frozen: this.frozen });
    const report: HandReport = {
      handNumber: h.handNumber,
      busted: busted.map((s) => s.player.playerId),
      players: Object.keys(h.startingStacks),
      startingStacks: h.startingStacks,
    };
    this.after.push(() => {
      this.onHandComplete?.(report);
      if (this.running) this.scheduleNextHand(showdown ? this.timing.showdownDelayMs : this.timing.betweenHandsMs);
    });
  }

  /* ------------------------------------------------------------- bots */

  private decide(seat: number): { type: ActionType; amount?: number } {
    const h = this.hand as HandState;
    const s = this.seats[seat] as SeatState;
    const l = this.legalFor(seat);
    const move = h.moves[s.player.playerId];
    const passive = (): { type: ActionType } => ({ type: l.canCheck ? 'CHECK' : 'FOLD' });
    if (move === 'shove') return l.canAllIn ? { type: 'ALL_IN' } : l.canCall ? { type: 'CALL' } : { type: 'CHECK' };
    if (move === 'fold') return passive();
    if (move === 'call') return { type: l.canCheck ? 'CHECK' : 'CALL' };

    const hole = s.hole as [CardCode, CardCode];
    const strength = h.board.length === 0 ? preflopStrength(hole) : postflopStrength(evaluateBest([...hole, ...h.board]));
    const style = s.player.style;
    const r = this.rng();
    const unit = Math.max(1, this.blinds.smallBlind);
    const sized = (target: number): { type: ActionType; amount?: number } => {
      const to = Math.min(l.maxTo, Math.max(l.minTo, Math.round(target / unit) * unit));
      return to >= l.maxTo ? { type: 'ALL_IN' } : { type: l.canRaise ? 'RAISE' : 'BET', amount: to };
    };
    const aggressive = style === 'aggro' ? 0.12 : style === 'loose' ? 0.05 : 0;
    if (l.canCheck) {
      const wantsBet = strength + aggressive > 0.62 || (style === 'aggro' && r < 0.2);
      if (wantsBet && (l.canBet || l.canRaise) && r < 0.75) {
        return sized(h.board.length === 0 ? this.blinds.bigBlind * 3 : Math.max(this.blinds.bigBlind, l.pot * 0.6));
      }
      return { type: 'CHECK' };
    }
    const odds = l.callAmount / (l.pot + l.callAmount);
    const bb = this.blinds.bigBlind;
    const raiseWar = h.board.length === 0 ? l.currentBet > bb * 4 : l.currentBet > l.pot * 0.6;
    if (strength + aggressive > (raiseWar ? 0.9 : 0.8) && l.canRaise && r < 0.45) {
      return sized(h.board.length === 0 ? l.currentBet * 3 : l.currentBet * 2.5);
    }
    // Committing a big share of the stack needs a real hand.
    const commitment = l.callAmount / Math.max(1, l.stack);
    const threshold = (style === 'station' ? -0.12 : style === 'tight' ? 0.16 : style === 'loose' ? 0.02 : 0.06) + (commitment > 0.3 ? 0.22 : 0);
    if (strength - odds > threshold) return { type: 'CALL' };
    return { type: 'FOLD' };
  }

  /* ------------------------------------------------------------- views */

  private baseView(): TableViewBase {
    const h = this.hand;
    return {
      tableId: this.tableId,
      tournamentId: this.opts.tournamentId,
      tableNumber: this.tableNumber,
      version: this.version,
      lastEventSeq: this.seq,
      status: this.status,
      holds: this.holds,
      frozen: this.frozen,
      maxSeats: this.maxSeats,
      seats: this.seats.map((s) => (s ? this.seatView(s) : null)),
      buttonSeat: h?.buttonSeat ?? this.button,
      blinds: this.blinds,
      hand: h ? this.handView(h) : null,
      serverTime: this.clock.now(),
    };
  }

  private seatView(s: SeatState): PublicSeatView {
    const h = this.hand;
    return {
      seat: s.seat,
      playerId: s.player.playerId,
      displayName: s.player.displayName,
      publicId: s.player.publicId,
      stack: s.player.stack,
      connected: s.connected,
      inHand: h !== null && s.inHand,
      folded: s.folded,
      allIn: s.allIn,
      streetContribution: s.street,
      lastAction: s.lastAction,
      isButton: h ? h.buttonSeat === s.seat : this.button === s.seat,
      isSmallBlind: h !== null && h.phase !== 'HAND_COMPLETE' && h.sbSeat === s.seat,
      isBigBlind: h !== null && h.phase !== 'HAND_COMPLETE' && h.bbSeat === s.seat,
      shownCards: s.shown,
      away: s.away,
    };
  }

  private handView(h: HandState): PublicHandView {
    const done = h.phase === 'HAND_COMPLETE';
    return {
      handId: h.handId,
      handNumber: h.handNumber,
      phase: h.phase,
      board: h.board,
      pots: done ? [] : this.buildPots(true),
      totalPot: done ? h.finalPot : this.potTotal(),
      currentBet: h.currentBet,
      actingSeat: h.acting,
      actionDeadline: h.deadline,
      turnVersion: h.turnVersion,
    };
  }
}

function postflopStrength(e: MockEvaluated): number {
  const order = ['HIGH_CARD', 'ONE_PAIR', 'TWO_PAIR', 'THREE_OF_A_KIND', 'STRAIGHT', 'FLUSH', 'FULL_HOUSE', 'FOUR_OF_A_KIND', 'STRAIGHT_FLUSH', 'ROYAL_FLUSH'];
  const cat = order.indexOf(e.category);
  return Math.min(0.98, cat === 0 ? 0.18 : 0.42 + cat * 0.1);
}
