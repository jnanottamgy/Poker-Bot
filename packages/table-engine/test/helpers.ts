import { dealPlan } from '@jpb/poker-engine';
import { fisherYatesShuffle, HmacDrbgSource, utf8Encode } from '@jpb/randomness';
import { CANONICAL_DECK } from '@jpb/shared-types';
import type {
  CardCode,
  CommandReply,
  CurrentBlinds,
  PlayerActionIntent,
  SeatIndex,
  SeatPositionStats,
  TableCommand,
  TableCommandEnvelope,
  TableEvent,
  TableEventPayload,
  TableTimerRequest,
  TableTimingState,
} from '@jpb/shared-types';
import { expect } from 'vitest';
import { checkTableInvariants, createTableState, nextHandPositions, reduceTable } from '../src';
import type { CreateTableInput, TableContext, TableState, TableTransition } from '../src';

export const TABLE_ID = 'T1';
export const TOURNAMENT_ID = 'TOUR';
export const T0 = 1_000_000;

export const TIMING: TableTimingState = {
  actionTimerMs: 15_000,
  awayActionTimerMs: 5_000,
  awayAfterTimeouts: 2,
  actionGraceMs: 1_000,
  betweenHandsDelayMs: 3_000,
  showdownDelayMs: 2_000,
};

export const BLINDS: CurrentBlinds = { level: 1, smallBlind: 50, bigBlind: 100, ante: 0, anteType: 'NONE' };

export const ZERO_STATS: SeatPositionStats = {
  handsDealtAtTable: 0,
  handsSinceBigBlind: 0,
  handsSinceSmallBlind: 0,
  handsPlayedTotal: 0,
};

/** Deterministic deck per hand: CANONICAL_DECK shuffled with an HMAC-DRBG keyed by the seed, labelled by hand number. */
export function seededDeck(seed: string, handNumber: number): CardCode[] {
  const src = new HmacDrbgSource(utf8Encode(seed), `test-deck|${handNumber}`);
  return fisherYatesShuffle(CANONICAL_DECK, src);
}

export function seededContext(seed = 'table-engine-tests'): TableContext {
  return { deckFor: (n) => seededDeck(seed, n) };
}

/**
 * Builds a deck giving `hole[seat]` to the given seats and `board` as the board,
 * for a hand dealt to `seats` with `buttonSeat`; other positions are filled
 * with the remaining cards in canonical order.
 */
export function riggedDeck(opts: {
  seats: readonly SeatIndex[];
  buttonSeat: SeatIndex;
  maxSeats: number;
  hole: Readonly<Record<number, readonly [CardCode, CardCode]>>;
  board?: readonly CardCode[];
}): CardCode[] {
  const plan = dealPlan(opts.seats, opts.buttonSeat, opts.maxSeats);
  const deck: Array<CardCode | null> = new Array<CardCode | null>(52).fill(null);
  for (const { seat, deckIndices } of plan.holeCards) {
    const cards = opts.hole[seat];
    if (cards) {
      deck[deckIndices[0]] = cards[0];
      deck[deckIndices[1]] = cards[1];
    }
  }
  const boardIdx = [...plan.flop, plan.turn, plan.river];
  (opts.board ?? []).forEach((c, i) => {
    deck[boardIdx[i] as number] = c;
  });
  const used = new Set(deck.filter((c): c is CardCode => c !== null));
  if (used.size !== deck.filter((c) => c !== null).length) throw new Error('riggedDeck: duplicate card');
  const rest = CANONICAL_DECK.filter((c) => !used.has(c));
  return deck.map((c) => c ?? (rest.shift() as CardCode));
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

export interface HarnessOptions {
  maxSeats?: number;
  timing?: TableTimingState;
  blinds?: CurrentBlinds;
  initialButtonSeat?: SeatIndex | null;
  seed?: string;
  /** Deep-freeze every input state (proves the reducer never mutates). Default true. */
  freeze?: boolean;
  /** Run checkTableInvariants after every command. Default true. */
  invariants?: boolean;
  /** Replaces the seeded deck provider (rigged decks still take precedence). */
  deckFor?: (handNumber: number) => CardCode[];
}

/** Drives one table through commands, recording envelopes, events and timers, and checking invariants. */
export class Harness {
  state: TableState;
  readonly initial: TableState;
  now = T0;
  readonly envelopes: TableCommandEnvelope[] = [];
  readonly events: TableEvent[] = [];
  readonly timers: TableTimerRequest[] = [];
  last: TableTransition | null = null;
  /** Decks queued for specific hand numbers (rigged); others come from the seeded provider. */
  readonly rigged = new Map<number, CardCode[]>();
  readonly ctx: TableContext;
  private seq = 0;
  private readonly freezeInputs: boolean;
  private readonly checkInvariants: boolean;

  constructor(opts: HarnessOptions = {}) {
    const input: CreateTableInput = {
      tableId: TABLE_ID,
      tournamentId: TOURNAMENT_ID,
      tableNumber: 1,
      maxSeats: opts.maxSeats ?? 9,
      timing: opts.timing ?? TIMING,
      blinds: opts.blinds ?? BLINDS,
      initialButtonSeat: opts.initialButtonSeat ?? null,
      createdAt: T0,
    };
    this.state = createTableState(input);
    this.initial = structuredClone(this.state);
    const seed = opts.seed ?? 'table-engine-tests';
    const fallback = opts.deckFor ?? ((n: number) => seededDeck(seed, n));
    this.ctx = { deckFor: (n) => this.rigged.get(n) ?? fallback(n) };
    this.freezeInputs = opts.freeze ?? true;
    this.checkInvariants = opts.invariants ?? true;
  }

  send(command: TableCommand, at: number = this.now): TableTransition {
    this.now = Math.max(this.now, at);
    this.seq += 1;
    const envelope: TableCommandEnvelope = {
      commandId: `c${this.seq}`,
      tableId: TABLE_ID,
      at,
      command: structuredClone(command),
    };
    this.envelopes.push(structuredClone(envelope));
    const input = this.freezeInputs ? deepFreeze(this.state) : this.state;
    const t = reduceTable(input, envelope, this.ctx);
    const expectedSeq = (this.events.at(-1)?.seq ?? 0) + 1;
    t.events.forEach((e, i) => {
      expect(e.seq).toBe(expectedSeq + i);
      expect(e.version).toBe(t.state.version);
    });
    if (t.state !== input) {
      if (t.events.length > 0 || t.state.version !== input.version) expect(t.state.version).toBe(input.version + 1);
    }
    if (this.checkInvariants) expect(checkTableInvariants(t.state)).toEqual([]);
    this.state = t.state;
    this.events.push(...t.events);
    this.timers.push(...t.timers);
    this.last = t;
    return t;
  }

  advance(ms: number): void {
    this.now += ms;
  }

  seat(
    playerId: string,
    seat: SeatIndex,
    stack = 10_000,
    extra: Partial<Extract<TableCommand, { type: 'SEAT_PLAYER' }>> = {},
  ): CommandReply {
    const r = this.send({
      type: 'SEAT_PLAYER',
      playerId,
      displayName: `Name ${playerId}`,
      publicId: `JPN-${playerId}`,
      seat,
      stack,
      stats: ZERO_STATS,
      moveId: null,
      ...extra,
    }).reply;
    return r as CommandReply;
  }

  start(): TableTransition {
    return this.send({ type: 'START' });
  }

  /** Acts for the player whose turn it is (or `playerId`), echoing the current turnVersion. */
  act(
    intent: PlayerActionIntent,
    opts: { playerId?: string; actionId?: string; version?: number | null; at?: number } = {},
  ): CommandReply {
    const turn = this.state.turn;
    const playerId = opts.playerId ?? turn?.playerId ?? 'nobody';
    const actionId = opts.actionId ?? `a${this.envelopes.length + 1}`;
    const r = this.send(
      {
        type: 'PLAYER_ACTION',
        actionId,
        playerId,
        intent,
        tableStateVersion: opts.version === undefined ? (turn?.turnVersion ?? null) : opts.version,
      },
      opts.at ?? this.now,
    ).reply;
    return r as CommandReply;
  }

  /** Fires the pending ACTION_TIMEOUT at its due time. */
  fireTurnTimer(): TableTransition {
    const turn = this.state.turn;
    if (turn === null) throw new Error('no turn');
    const at = turn.deadline + turn.graceMs;
    return this.send({ type: 'TIMER_FIRED', kind: 'ACTION_TIMEOUT', token: turn.timerToken }, Math.max(at, this.now));
  }

  /** Fires the pending NEXT_HAND timer at its due time. */
  fireNextHand(): TableTransition {
    const next = this.state.nextHand;
    if (next === null) throw new Error('no NEXT_HAND pending');
    return this.send({ type: 'TIMER_FIRED', kind: 'NEXT_HAND', token: next.token }, Math.max(next.dueAt, this.now));
  }

  /** Rigs the deck of the next hand so the given seats get the given hole cards (positions predicted from the state). */
  rigNextHand(hole: Readonly<Record<number, readonly [CardCode, CardCode]>>, board?: readonly CardCode[]): void {
    const pos = nextHandPositions(this.state);
    if (pos === null) throw new Error('cannot predict next hand');
    const seats = this.state.seats.flatMap((o, i) => (o !== null && o.stack > 0 ? [i] : []));
    this.rigged.set(
      this.state.handNumber + 1,
      riggedDeck({ seats, buttonSeat: pos.buttonSeat, maxSeats: this.state.maxSeats, hole, board }),
    );
  }

  payloads<K extends TableEventPayload['kind']>(kind: K): Array<Extract<TableEventPayload, { kind: K }>> {
    return this.events.map((e) => e.event).filter((e): e is Extract<TableEventPayload, { kind: K }> => e.kind === kind);
  }

  lastPayloads(): TableEventPayload[] {
    return (this.last?.events ?? []).map((e) => e.event);
  }

  occupant(playerId: string) {
    return this.state.seats.find((o) => o !== null && o.playerId === playerId) ?? null;
  }

  seatOf(playerId: string): SeatIndex {
    return this.state.seats.findIndex((o) => o !== null && o.playerId === playerId);
  }

  /** Everyone folds to the big blind (or checks when possible) until the hand completes. */
  foldAround(): void {
    let guard = 0;
    while (this.state.turn !== null) {
      if (guard++ > 50) throw new Error('foldAround: runaway');
      const legal = this.legal();
      this.act(legal.canCheck ? { type: 'CHECK' } : { type: 'FOLD' });
    }
  }

  legal() {
    const hand = this.state.hand;
    const turn = this.state.turn;
    if (hand === null || turn === null) throw new Error('nobody to act');
    const ev = [...this.events].reverse().find((e) => e.event.kind === 'ACTION_REQUESTED');
    if (ev === undefined || ev.event.kind !== 'ACTION_REQUESTED') throw new Error('no ACTION_REQUESTED');
    return ev.event.legal;
  }

  /**
   * Plays the current hand so that `victim` goes all-in and `killer` calls
   * everything; everyone else folds. With a rigged deck the killer wins.
   */
  playAllInHand(victim: string, killer: string): void {
    let guard = 0;
    while (this.state.turn !== null) {
      if (guard++ > 50) throw new Error('playAllInHand: runaway');
      const who = this.state.turn.playerId;
      const legal = this.legal();
      if (who === victim) this.act({ type: 'ALL_IN' });
      else if (who === killer)
        this.act(legal.canCall ? { type: 'CALL' } : legal.canCheck ? { type: 'CHECK' } : { type: 'FOLD' });
      else this.act(legal.canCheck ? { type: 'CHECK' } : { type: 'FOLD' });
    }
  }

  /** Rigs the next hand so `killer` beats `victim`, then deals it (via NEXT_HAND) and plays it. */
  bust(victim: string, killer: string): void {
    this.rigNextHand({ [this.seatOf(killer)]: ['As', 'Ah'], [this.seatOf(victim)]: ['7c', '2d'] }, [
      'Kd',
      'Qc',
      '9s',
      '5h',
      '3c',
    ]);
    if (this.state.status === 'BETWEEN_HANDS') this.fireNextHand();
    this.playAllInHand(victim, killer);
  }
}

/** Hand positions of every HAND_STARTED event, in order. */
export function handStarts(h: Harness): Array<{ button: number; sb: number | null; bb: number; players: number[] }> {
  return h.payloads('HAND_STARTED').map((e) => ({
    button: e.buttonSeat,
    sb: e.smallBlindSeat,
    bb: e.bigBlindSeat,
    players: e.players.map((p) => p.seat),
  }));
}
