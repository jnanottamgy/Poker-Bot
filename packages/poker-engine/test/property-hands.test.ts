import { HAND_PHASE_TRANSITIONS } from '@jpb/shared-types';
import type { AnteType, HandEvent, HandPhase, LegalActions, PlayerActionIntent, SeatIndex } from '@jpb/shared-types';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  checkHandInvariants,
  clockwiseFrom,
  createHand,
  dealFromDeck,
  evaluateHand,
  getLegalActions,
  timeoutIntent,
} from '../src';
import type { CreateHandInput, HandState } from '../src';
import { prng, randInt, shuffledDeck } from './helpers';

const ANTE_TYPES: AnteType[] = ['NONE', 'BB_ANTE', 'ALL_PLAYERS'];

/** Builds a random but valid hand configuration from a seed. */
function randomConfig(seed: number): CreateHandInput {
  const rnd = prng(seed);
  const n = 2 + randInt(rnd, 9); // 2..10 players
  const maxSeats = n + randInt(rnd, 11 - n); // n..10
  const all = Array.from({ length: maxSeats }, (_, i) => i);
  const seats: number[] = [];
  while (seats.length < n) seats.push(all.splice(randInt(rnd, all.length), 1)[0] as number);
  const bigBlind = [2, 10, 20, 100, 200][randInt(rnd, 5)] as number;
  const smallBlind = rnd() < 0.8 ? Math.floor(bigBlind / 2) : randInt(rnd, bigBlind + 1);
  const anteType = ANTE_TYPES[randInt(rnd, 3)] as AnteType;
  const ante = anteType === 'NONE' ? 0 : randInt(rnd, bigBlind + 1);
  const stackFor = (): number => {
    const r = rnd();
    if (r < 0.2) return 1 + randInt(rnd, bigBlind * 2); // tiny, often all-in from forced bets
    if (r < 0.35) return 1 + randInt(rnd, bigBlind * 8);
    return bigBlind * (5 + randInt(rnd, 150)) + randInt(rnd, bigBlind);
  };
  const buttonSeat = randInt(rnd, maxSeats); // may be empty: dead button
  const order = clockwiseFrom(seats, buttonSeat, maxSeats);
  let smallBlindSeat: SeatIndex | null;
  let bigBlindSeat: SeatIndex;
  const style = rnd();
  if (n === 2 && seats.includes(buttonSeat)) {
    smallBlindSeat = buttonSeat; // heads-up
    bigBlindSeat = seats.find((s) => s !== buttonSeat) as number;
  } else if (style < 0.8) {
    smallBlindSeat = order[0] as number;
    bigBlindSeat = order[1] as number;
  } else if (style < 0.9) {
    smallBlindSeat = null; // dead small blind
    bigBlindSeat = order[1] as number;
  } else {
    bigBlindSeat = seats[randInt(rnd, n)] as number; // arbitrary but valid positions
    const others = seats.filter((s) => s !== bigBlindSeat);
    smallBlindSeat = rnd() < 0.3 ? null : (others[randInt(rnd, others.length)] as number);
  }
  return {
    handId: `H${seed}`,
    handNumber: seed >>> 0,
    maxSeats,
    seats: seats.map((seat) => ({ seat, playerId: `P${seat}`, stack: stackFor() })),
    buttonSeat,
    smallBlindSeat,
    bigBlindSeat,
    smallBlind,
    bigBlind,
    ante,
    anteType,
    deck: shuffledDeck(rnd),
  };
}

/** A random legal intent (deterministic strategy driven by the seeded PRNG). */
function randomIntent(rnd: () => number, legal: LegalActions): PlayerActionIntent {
  const options: Array<() => PlayerActionIntent> = [];
  const add = (w: number, f: () => PlayerActionIntent) => {
    for (let i = 0; i < w; i++) options.push(f);
  };
  add(legal.canCall ? 2 : 1, () => ({ type: 'FOLD' }));
  if (legal.canCheck) add(4, () => ({ type: 'CHECK' }));
  if (legal.canCall) add(5, () => ({ type: 'CALL' }));
  const sized = (): number => {
    const r = rnd();
    if (r < 0.4) return legal.minTo;
    if (r < 0.55) return legal.maxTo;
    return legal.minTo + randInt(rnd, legal.maxTo - legal.minTo + 1);
  };
  if (legal.canBet) add(3, () => ({ type: 'BET', amount: sized() }));
  if (legal.canRaise) add(3, () => ({ type: 'RAISE', amount: sized() }));
  if (legal.canAllIn) add(1, () => ({ type: 'ALL_IN' }));
  return (options[randInt(rnd, options.length)] as () => PlayerActionIntent)();
}

const GARBAGE: unknown[] = [
  { type: 'RAISE', amount: Number.NaN },
  { type: 'BET', amount: 999_999_999 },
  { type: 'RAISE', amount: -5 },
  { type: 'RAISE', amount: 1.5 },
  { type: 'DANCE' },
  null,
];

/** Phase implied by an event (null = no phase change). */
function phaseOfEvent(e: HandEvent): HandPhase | null {
  switch (e.kind) {
    case 'HAND_STARTED':
      return 'HAND_CREATED';
    case 'HOLE_CARDS_DEALT':
      return 'DEAL_HOLE_CARDS';
    case 'STREET_STARTED':
      return e.street;
    case 'SHOWDOWN':
      return 'SHOWDOWN';
    case 'POT_AWARDED':
      return 'POT_DISTRIBUTION';
    case 'HAND_COMPLETED':
      return 'HAND_COMPLETE';
    default:
      return null;
  }
}

/** Phase sequence implied by the event stream; PREFLOP begins right after the last hole card. */
function phasesFromEvents(events: HandEvent[]): HandPhase[] {
  const phases: HandPhase[] = [];
  const push = (p: HandPhase) => {
    if (phases[phases.length - 1] !== p) phases.push(p);
  };
  for (const e of events) {
    if (phases[phases.length - 1] === 'DEAL_HOLE_CARDS' && e.kind !== 'HOLE_CARDS_DEALT') push('PREFLOP');
    // With an empty pot (only an uncalled bet) no POT_AWARDED marks POT_DISTRIBUTION.
    if (e.kind === 'HAND_COMPLETED') push('POT_DISTRIBUTION');
    const p = phaseOfEvent(e);
    if (p !== null) push(p);
  }
  return phases;
}

/** Replays the event stream and checks it is consistent with itself and the final state. */
function checkEventStream(input: CreateHandInput, events: HandEvent[], final: HandState): void {
  const stacks = new Map(input.seats.map((s) => [s.seat, s.stack]));
  let pot = 0;
  const kinds = events.map((e) => e.kind);
  expect(kinds[0]).toBe('HAND_STARTED');
  expect(kinds[kinds.length - 1]).toBe('HAND_COMPLETED');
  expect(kinds.filter((k) => k === 'HAND_COMPLETED')).toHaveLength(1);
  const board: string[] = [];
  let lastPotIndex = Number.POSITIVE_INFINITY;
  let seenAward = false;
  for (const e of events) {
    switch (e.kind) {
      case 'FORCED_BET_POSTED': {
        const s = (stacks.get(e.seat) as number) - e.amount;
        stacks.set(e.seat, s);
        pot += e.amount;
        expect(e.stack).toBe(s);
        expect(e.pot).toBe(pot);
        expect(e.allIn).toBe(s === 0);
        expect(e.amount).toBeGreaterThan(0);
        break;
      }
      case 'PLAYER_ACTED': {
        const s = (stacks.get(e.seat) as number) - e.amount;
        stacks.set(e.seat, s);
        pot += e.amount;
        expect(e.stack).toBe(s);
        expect(e.pot).toBe(pot);
        expect(e.allIn).toBe(s === 0);
        break;
      }
      case 'TURN_TO_ACT':
        expect(stacks.get(e.seat)).toBeGreaterThan(0);
        expect(e.legal.stack).toBe(stacks.get(e.seat));
        expect(e.legal.pot).toBe(pot);
        break;
      case 'STREET_STARTED':
        board.push(...e.newCards);
        expect(e.board).toEqual(board);
        expect(e.pot).toBe(pot);
        break;
      case 'BETTING_ROUND_COMPLETE':
        expect(e.pot).toBe(pot);
        break;
      case 'UNCALLED_BET_RETURNED': {
        expect(seenAward).toBe(false);
        const s = (stacks.get(e.seat) as number) + e.amount;
        stacks.set(e.seat, s);
        pot -= e.amount;
        expect(e.stack).toBe(s);
        break;
      }
      case 'SHOWDOWN':
        expect(seenAward).toBe(false);
        break;
      case 'POT_AWARDED': {
        seenAward = true;
        expect(e.potIndex).toBeLessThan(lastPotIndex);
        lastPotIndex = e.potIndex;
        expect(e.potType).toBe(e.potIndex === 0 ? 'MAIN' : 'SIDE');
        expect(e.winners.reduce((a, w) => a + w.amount, 0)).toBe(e.amount);
        for (const w of e.winners) {
          stacks.set(w.seat, (stacks.get(w.seat) as number) + w.amount);
          pot -= w.amount;
        }
        break;
      }
      case 'HAND_COMPLETED':
        expect(pot).toBe(0);
        expect(e.board).toEqual(board);
        expect(e.finalStacks.map((f) => [f.seat, f.stack])).toEqual([...stacks.entries()].sort((a, b) => a[0] - b[0]));
        break;
      default:
        break;
    }
  }
  // Every hand awards down to the main pot, unless the only chips were an
  // uncalled bet (e.g. dead small blind, everyone folds to the big blind).
  if (final.result?.totalPot === 0) expect(seenAward).toBe(false);
  else expect(lastPotIndex).toBe(0);
  expect(final.board).toEqual(board);
  for (const p of final.players) expect(stacks.get(p.seat)).toBe(p.stack);

  // Hole cards and board follow the normative dealing order.
  const dealt = dealFromDeck(
    input.deck,
    input.seats.map((s) => s.seat),
    input.buttonSeat,
    input.maxSeats,
  );
  const holeEvents = events.filter(
    (e): e is Extract<HandEvent, { kind: 'HOLE_CARDS_DEALT' }> => e.kind === 'HOLE_CARDS_DEALT',
  );
  expect(holeEvents.map((e) => [e.seat, e.cards])).toEqual(dealt.holeCards.map((h) => [h.seat, h.cards]));
  expect(final.board).toEqual(dealt.board.slice(0, final.board.length));
  expect(final.burns).toEqual(dealt.burns.slice(0, final.burns.length));
  for (const p of final.players) expect(p.holeCards).toEqual(dealt.holeCards.find((h) => h.seat === p.seat)?.cards);

  // Phase sequence follows the transition table.
  const phases = phasesFromEvents(events);
  for (let i = 1; i < phases.length; i++) {
    const from = phases[i - 1] as HandPhase;
    expect([from, HAND_PHASE_TRANSITIONS[from]]).toEqual([from, expect.arrayContaining([phases[i]])]);
  }
  expect(phases[phases.length - 1]).toBe('HAND_COMPLETE');
}

function checkResult(input: CreateHandInput, s: HandState): void {
  expect(s.phase).toBe('HAND_COMPLETE');
  const result = s.result;
  if (result === null) throw new Error('no result');
  const startTotal = input.seats.reduce((a, x) => a + x.stack, 0);
  expect(s.players.reduce((a, p) => a + p.stack, 0)).toBe(startTotal);
  const contributed = s.players.reduce((a, p) => a + p.totalContribution, 0);
  expect(result.totalPot).toBe(contributed);
  expect(result.pots.reduce((a, p) => a + p.amount, 0)).toBe(contributed);
  const live = s.players.filter((p) => !p.folded);
  const folded = new Set(s.players.filter((p) => p.folded).map((p) => p.seat));
  const hands = new Map(
    s.board.length === 5 ? live.map((p) => [p.seat, evaluateHand([...(p.holeCards ?? []), ...s.board])]) : [],
  );
  for (const pot of result.pots) {
    expect(pot.eligibleSeats.length).toBeGreaterThan(0);
    for (const seat of pot.eligibleSeats) expect(folded.has(seat)).toBe(false);
    for (const w of pot.winners) {
      expect(folded.has(w.seat)).toBe(false);
      expect(pot.eligibleSeats).toContain(w.seat);
    }
    const amounts = pot.winners.map((w) => w.amount);
    expect(Math.max(...amounts) - Math.min(...amounts)).toBeLessThanOrEqual(1);
    if (pot.eligibleSeats.length >= 2) {
      expect(result.winType).toBe('SHOWDOWN');
      const best = Math.max(...pot.eligibleSeats.map((x) => hands.get(x)?.score ?? -1));
      const expected = pot.eligibleSeats.filter((x) => hands.get(x)?.score === best).sort((a, b) => a - b);
      expect(pot.winners.map((w) => w.seat).sort((a, b) => a - b)).toEqual(expected);
      // Winners of contested pots are always revealed.
      for (const w of pot.winners) expect(result.reveals.find((r) => r.seat === w.seat)?.mucked).toBe(false);
    }
  }
  if (result.winType === 'FOLD') {
    expect(live).toHaveLength(1);
    expect(result.reveals).toEqual([]);
  } else {
    expect(s.board).toHaveLength(5);
    expect(result.reveals.map((r) => r.seat).sort((a, b) => a - b)).toEqual(live.map((p) => p.seat));
    if (s.allInRunOut) expect(result.reveals.every((r) => !r.mucked)).toBe(true);
    for (const r of result.reveals) {
      if (r.mucked) expect(r.cards).toBeNull();
      else expect(r.hand?.score).toBe(hands.get(r.seat)?.score);
    }
  }
  expect(result.bustedSeats).toEqual(s.players.filter((p) => p.stack === 0).map((p) => p.seat));
}

/** Plays one random hand to completion, checking invariants after every step. Returns the number of actions. */
function playHand(seed: number): number {
  const input = randomConfig(seed);
  const inputSnapshot = JSON.stringify(input);
  const rnd = prng(seed ^ 0x5bd1e995);
  const t = createHand(input);
  expect(JSON.stringify(input)).toBe(inputSnapshot);
  let state = t.state;
  const events = [...t.events];
  expect(checkHandInvariants(state)).toEqual([]);
  const replay: Array<{ seat: SeatIndex; intent: PlayerActionIntent; timeout: boolean }> = [];
  let steps = 0;
  while (state.phase !== 'HAND_COMPLETE') {
    steps++;
    if (steps > 500) throw new Error('hand did not terminate');
    const legal = getLegalActions(state);
    if (legal === null) throw new Error(`no legal actions in ${state.phase}`);
    expect(legal.seat).toBe(state.actingSeat);
    // Occasionally probe with garbage / wrong seats: must be rejected and change nothing.
    if (rnd() < 0.1) {
      const before = JSON.stringify(state);
      const g = GARBAGE[randInt(rnd, GARBAGE.length)];
      const wrongSeat = state.players.find((p) => p.seat !== state.actingSeat)?.seat ?? -1;
      const r1 = applyAction(state, state.actingSeat as number, g as PlayerActionIntent);
      const r2 = applyAction(state, wrongSeat, { type: 'FOLD' });
      expect(r1.ok).toBe(false);
      expect(r2.ok).toBe(false);
      expect(JSON.stringify(state)).toBe(before);
    }
    const timeout = rnd() < 0.05;
    const intent = timeout ? timeoutIntent(state) : randomIntent(rnd, legal);
    const r = applyAction(state, state.actingSeat as number, intent, { timeout });
    if (!r.ok) throw new Error(`legal intent rejected: ${JSON.stringify(intent)} ${r.code} ${JSON.stringify(legal)}`);
    replay.push({ seat: state.actingSeat as number, intent, timeout });
    state = r.state;
    events.push(...r.events);
    expect(checkHandInvariants(state)).toEqual([]);
    expect(r.events.length).toBeGreaterThan(0);
  }
  checkResult(input, state);
  checkEventStream(input, events, state);

  // Determinism: replaying the same inputs reproduces the exact state and events.
  const again = createHand(randomConfig(seed));
  let s2 = again.state;
  const ev2 = [...again.events];
  for (const step of replay) {
    const r = applyAction(s2, step.seat, step.intent, { timeout: step.timeout });
    if (!r.ok) throw new Error('replay rejected');
    s2 = r.state;
    ev2.push(...r.events);
  }
  expect(s2).toEqual(state);
  expect(ev2).toEqual(events);
  return steps;
}

describe('property: random hands', () => {
  it('thousands of random hands keep every invariant and pay the right players', () => {
    let totalActions = 0;
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 31 - 1 }), (seed) => {
        totalActions += playHand(seed);
      }),
      { numRuns: 4_000, seed: 20261008 },
    );
    expect(totalActions).toBeGreaterThan(4_000);
  }, 300_000);

  it('covers interesting situations (sanity of the generator)', () => {
    let showdowns = 0;
    let foldWins = 0;
    let sidePots = 0;
    let runOuts = 0;
    let splits = 0;
    let completedAtCreate = 0;
    for (let seed = 0; seed < 1_500; seed++) {
      const input = randomConfig(seed);
      const rnd = prng(seed ^ 0x5bd1e995);
      let { state } = createHand(input);
      if (state.phase === 'HAND_COMPLETE') completedAtCreate++;
      while (state.phase !== 'HAND_COMPLETE') {
        const legal = getLegalActions(state) as LegalActions;
        const r = applyAction(state, legal.seat, randomIntent(rnd, legal));
        if (!r.ok) throw new Error(r.code);
        state = r.state;
      }
      const res = state.result;
      if (res?.winType === 'SHOWDOWN') showdowns++;
      if (res?.winType === 'FOLD') foldWins++;
      if ((res?.pots.length ?? 0) > 1) sidePots++;
      if (state.allInRunOut) runOuts++;
      if (res?.pots.some((p) => p.winners.length > 1)) splits++;
    }
    expect(showdowns).toBeGreaterThan(100);
    expect(foldWins).toBeGreaterThan(100);
    expect(sidePots).toBeGreaterThan(50);
    expect(runOuts).toBeGreaterThan(50);
    expect(splits).toBeGreaterThan(5);
    expect(completedAtCreate).toBeGreaterThan(0);
  }, 120_000);
});
