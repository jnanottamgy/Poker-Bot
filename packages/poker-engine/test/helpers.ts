import { CANONICAL_DECK } from '@jpb/shared-types';
import type { AnteType, CardCode, HandEvent, PlayerActionIntent, SeatIndex } from '@jpb/shared-types';
import { expect } from 'vitest';
import { applyAction, checkHandInvariants, createHand, dealPlan } from '../src';
import type { CreateHandInput, HandRejection, HandState, HandTransition } from '../src';

/** Small deterministic PRNG for tests (mulberry32). Never Math.random(). */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randInt(rnd: () => number, maxExclusive: number): number {
  return Math.floor(rnd() * maxExclusive);
}

export function shuffledDeck(rnd: () => number): CardCode[] {
  const d = [...CANONICAL_DECK];
  for (let i = d.length - 1; i > 0; i--) {
    const j = randInt(rnd, i + 1);
    [d[i], d[j]] = [d[j] as CardCode, d[i] as CardCode];
  }
  return d;
}

/**
 * Builds a deck so that the given seats receive the given hole cards and the
 * board is exactly `board` (up to 5 cards); every other position is filled
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
  const deck: Array<CardCode | null> = new Array(52).fill(null);
  for (const { seat, deckIndices } of plan.holeCards) {
    const cards = opts.hole[seat];
    if (cards) {
      deck[deckIndices[0]] = cards[0];
      deck[deckIndices[1]] = cards[1];
    }
  }
  const boardIdx = [...plan.flop, plan.turn, plan.river];
  (opts.board ?? []).forEach((c, i) => (deck[boardIdx[i] as number] = c));
  const used = new Set(deck.filter((c): c is CardCode => c !== null));
  if (used.size !== deck.filter((c) => c !== null).length) throw new Error('riggedDeck: duplicate card');
  const rest = CANONICAL_DECK.filter((c) => !used.has(c));
  return deck.map((c) => c ?? (rest.shift() as CardCode));
}

export interface SetupOpts {
  stacks: Readonly<Record<number, number>>;
  maxSeats?: number;
  buttonSeat: SeatIndex;
  smallBlindSeat: SeatIndex | null;
  bigBlindSeat: SeatIndex;
  smallBlind?: number;
  bigBlind?: number;
  ante?: number;
  anteType?: AnteType;
  hole?: Readonly<Record<number, readonly [CardCode, CardCode]>>;
  board?: readonly CardCode[];
  deck?: CardCode[];
}

export function handInput(o: SetupOpts): CreateHandInput {
  const maxSeats = o.maxSeats ?? 9;
  const seats = Object.keys(o.stacks).map(Number);
  return {
    handId: 'T1:1',
    handNumber: 1,
    maxSeats,
    seats: seats.map((seat) => ({ seat, playerId: `p${seat}`, stack: o.stacks[seat] as number })),
    buttonSeat: o.buttonSeat,
    smallBlindSeat: o.smallBlindSeat,
    bigBlindSeat: o.bigBlindSeat,
    smallBlind: o.smallBlind ?? 50,
    bigBlind: o.bigBlind ?? 100,
    ante: o.ante ?? 0,
    anteType: o.anteType ?? 'NONE',
    deck: o.deck ?? riggedDeck({ seats, buttonSeat: o.buttonSeat, maxSeats, hole: o.hole ?? {}, board: o.board ?? [] }),
  };
}

/** A running hand that records every event and checks invariants after each step. */
export class Table {
  state: HandState;
  events: HandEvent[];
  lastEvents: HandEvent[];

  constructor(o: SetupOpts | CreateHandInput) {
    const input = 'deck' in o && 'handId' in o ? (o as CreateHandInput) : handInput(o as SetupOpts);
    const t = createHand(input);
    this.state = t.state;
    this.events = [...t.events];
    this.lastEvents = t.events;
    expect(checkHandInvariants(this.state)).toEqual([]);
  }

  get acting(): SeatIndex | null {
    return this.state.actingSeat;
  }

  /** Applies an action that must succeed. */
  act(seat: SeatIndex, intent: PlayerActionIntent, opts?: { timeout?: boolean }): HandTransition {
    const r = applyAction(this.state, seat, intent, opts);
    if (!r.ok) throw new Error(`Rejected ${seat} ${JSON.stringify(intent)}: ${r.code} ${r.message}`);
    this.state = r.state;
    this.events.push(...r.events);
    this.lastEvents = r.events;
    expect(checkHandInvariants(this.state)).toEqual([]);
    return r;
  }

  /** Applies an action that must be rejected; returns the code. */
  reject(seat: SeatIndex, intent: unknown): HandRejection['code'] {
    const before = JSON.stringify(this.state);
    const r = applyAction(this.state, seat, intent as PlayerActionIntent);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(this.state)).toBe(before);
    return (r as HandRejection).code;
  }

  player(seat: SeatIndex) {
    const p = this.state.players.find((x) => x.seat === seat);
    if (!p) throw new Error(`no seat ${seat}`);
    return p;
  }

  stack(seat: SeatIndex): number {
    return this.player(seat).stack;
  }

  kinds(events: HandEvent[] = this.events): string[] {
    return events.map((e) => e.kind);
  }

  ofKind<K extends HandEvent['kind']>(kind: K): Array<Extract<HandEvent, { kind: K }>> {
    return this.events.filter((e): e is Extract<HandEvent, { kind: K }> => e.kind === kind);
  }
}
