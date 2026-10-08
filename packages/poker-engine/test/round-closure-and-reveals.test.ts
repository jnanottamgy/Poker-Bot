/**
 * Regression + property tests for two fixed defects:
 *  - rule 7: a lone remaining actor who already covers every live opponent's
 *    street contribution (BB all-in for less than the nominal blind) is never
 *    prompted, so a timeout can never fold a covered hand;
 *  - rule 11: every pot winner is revealed at showdown, including the winner
 *    of an uncontested side pot.
 */
import type { AnteType, HandEvent, SeatIndex } from '@jpb/shared-types';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyAction, checkHandInvariants, createHand, getLegalActions, timeoutIntent } from '../src';
import type { CreateHandInput, HandState } from '../src';
import { Table, prng, randInt, shuffledDeck } from './helpers';

describe('rule 7: lone actor who covers every live opponent is not prompted', () => {
  it('heads-up ALL_PLAYERS ante: BB all-in on the ante (no blind posted) leaves the SB with no decision', () => {
    const t = new Table({
      stacks: { 0: 1000, 1: 20 },
      buttonSeat: 0,
      smallBlindSeat: 0,
      bigBlindSeat: 1,
      ante: 25,
      anteType: 'ALL_PLAYERS',
      hole: { 0: ['Kh', 'Kd'], 1: ['7c', '2d'] },
      board: ['3s', '8h', '9c', 'Js', '4d'],
    });
    expect(t.player(1)).toMatchObject({ allIn: true, streetContribution: 0, anteContribution: 20 });
    expect(t.ofKind('TURN_TO_ACT')).toHaveLength(0);
    expect(t.state.phase).toBe('HAND_COMPLETE');
    // SB put in 25 + 50; 55 of it is unmatched and comes back. Pot 40 to the kings.
    expect(t.ofKind('UNCALLED_BET_RETURNED')[0]).toMatchObject({ seat: 0, amount: 55 });
    expect(t.state.players.map((p) => p.stack)).toEqual([1020, 0]);
  });

  it('heads-up BB all-in for MORE than the SB (but less than the BB): the SB faces a real bet and must act', () => {
    const t = new Table({ stacks: { 0: 1000, 1: 80 }, buttonSeat: 0, smallBlindSeat: 0, bigBlindSeat: 1 });
    expect(t.acting).toBe(0);
    expect(getLegalActions(t.state)).toMatchObject({ canCheck: false, canCall: true, callAmount: 50 });
    // Facing 30 real chips, CHECK_ELSE_FOLD legitimately folds.
    expect(timeoutIntent(t.state)).toEqual({ type: 'FOLD' });
  });

  it('BB all-in for less than the SB but the button called the nominal BB: the SB still faces a bet', () => {
    const t = new Table({ stacks: { 0: 1000, 1: 1000, 2: 30 }, buttonSeat: 0, smallBlindSeat: 1, bigBlindSeat: 2 });
    t.act(0, { type: 'CALL' });
    expect(t.acting).toBe(1);
    expect(getLegalActions(t.state)).toMatchObject({ canCall: true, callAmount: 50, canRaise: true });
  });

  it('a lone actor behind a short all-in BB is prompted, and is not prompted again once they match it', () => {
    // Dead SB; BB all-in for 30. Seat 0 has 0 in and must act; calling closes the round.
    const t = new Table({ stacks: { 0: 1000, 2: 30 }, buttonSeat: 1, smallBlindSeat: null, bigBlindSeat: 2 });
    expect(t.acting).toBe(0);
    expect(getLegalActions(t.state)).toMatchObject({ callAmount: 100 });
    t.act(0, { type: 'CALL' });
    expect(t.state.phase).toBe('HAND_COMPLETE');
    expect(t.ofKind('UNCALLED_BET_RETURNED')[0]).toMatchObject({ seat: 0, amount: 70 });
  });
});

describe('rule 11: every pot winner is revealed', () => {
  it('a player who loses the main pot but wins an uncontested side pot is revealed with the worst hand', () => {
    // Seat 3 all-in for 100 preflop with AA; seats 0/1/2 build a side pot; on the river 1 and 2 fold.
    const t = new Table({
      stacks: { 0: 1000, 1: 1000, 2: 1000, 3: 100 },
      buttonSeat: 0,
      smallBlindSeat: 1,
      bigBlindSeat: 2,
      hole: { 3: ['Ah', 'Ad'], 0: ['8c', '3h'], 1: ['5c', '6c'], 2: ['Qs', 'Qd'] },
      board: ['2c', '7d', '9h', '4s', 'Jc'],
    });
    t.act(3, { type: 'ALL_IN' });
    t.act(0, { type: 'CALL' });
    t.act(1, { type: 'CALL' });
    t.act(2, { type: 'CHECK' });
    t.act(1, { type: 'BET', amount: 100 });
    t.act(2, { type: 'CALL' });
    t.act(0, { type: 'CALL' });
    for (let i = 0; i < 3; i++) t.act(t.acting as number, { type: 'CHECK' });
    t.act(1, { type: 'FOLD' });
    t.act(2, { type: 'FOLD' });
    const reveals = t.ofKind('SHOWDOWN')[0]?.reveals ?? [];
    expect(reveals.map((r) => [r.seat, r.mucked, r.cards])).toEqual([
      [3, false, ['Ah', 'Ad']],
      [0, false, ['8c', '3h']],
    ]);
    expect(reveals.find((r) => r.seat === 0)?.hand?.category).toBe('HIGH_CARD');
    expect(t.state.players.map((p) => p.stack)).toEqual([1100, 800, 800, 400]);
  });

  it('a live player who wins no pot and cannot beat the shown hand still mucks', () => {
    const t = new Table({
      stacks: { 0: 1000, 1: 1000 },
      buttonSeat: 0,
      smallBlindSeat: 0,
      bigBlindSeat: 1,
      hole: { 0: ['7c', '2d'], 1: ['Ah', 'Ad'] },
      board: ['3s', '8h', '9c', 'Js', '4d'],
    });
    t.act(0, { type: 'CALL' });
    t.act(1, { type: 'CHECK' });
    for (let i = 0; i < 6; i++) t.act(t.acting as number, { type: 'CHECK' });
    const reveals = t.ofKind('SHOWDOWN')[0]?.reveals ?? [];
    // No river bet: first live seat after the button (seat 1, aces) shows; seat 0 loses and mucks.
    expect(reveals.map((r) => [r.seat, r.mucked, r.cards])).toEqual([
      [1, false, ['Ah', 'Ad']],
      [0, true, null],
    ]);
  });
});

// ---------------------------------------------------------------------------
// properties

const ANTES: AnteType[] = ['NONE', 'BB_ANTE', 'ALL_PLAYERS'];

/** Random hand biased towards short blinds (the situations these fixes are about). */
function shortBlindConfig(seed: number): CreateHandInput {
  const rnd = prng(seed);
  const n = 2 + randInt(rnd, 4); // 2..5 players
  const maxSeats = n + randInt(rnd, 3);
  const seats = Array.from({ length: n }, (_, i) => i);
  const bigBlind = 100;
  const anteType = ANTES[randInt(rnd, 3)] as AnteType;
  const ante = anteType === 'NONE' ? 0 : 5 + randInt(rnd, 50);
  const stack = (): number => {
    const r = rnd();
    if (r < 0.45) return 1 + randInt(rnd, 160); // often all-in for less than a blind
    if (r < 0.6) return 1 + randInt(rnd, 600);
    return 500 + randInt(rnd, 5000);
  };
  const buttonSeat = seats[n - 1] as SeatIndex;
  const headsUp = n === 2;
  return {
    handId: `RC${seed}`,
    handNumber: seed,
    maxSeats,
    seats: seats.map((seat) => ({ seat, playerId: `P${seat}`, stack: stack() })),
    buttonSeat,
    smallBlindSeat: headsUp ? buttonSeat : 0,
    bigBlindSeat: headsUp ? 0 : 1,
    smallBlind: 50,
    bigBlind,
    ante,
    anteType,
    deck: shuffledDeck(rnd),
  };
}

/** The lone-actor rule: if exactly one player can act, they must be behind some live opponent. */
function assertPromptIsADecision(s: HandState): void {
  if (s.actingSeat === null) return;
  const live = s.players.filter((p) => !p.folded);
  const actors = live.filter((p) => !p.allIn);
  if (actors.length !== 1) return;
  const actor = actors[0] as (typeof actors)[number];
  const highestOpponent = Math.max(0, ...live.filter((p) => p !== actor).map((p) => p.streetContribution));
  expect(actor.streetContribution, 'lone actor prompted while already covering everyone').toBeLessThan(highestOpponent);
}

/** Every pot winner at a showdown is revealed with their real cards. */
function assertWinnersRevealed(s: HandState, events: readonly HandEvent[]): void {
  const showdown = events.find((e): e is Extract<HandEvent, { kind: 'SHOWDOWN' }> => e.kind === 'SHOWDOWN');
  if (showdown === undefined) return;
  const bySeat = new Map(showdown.reveals.map((r) => [r.seat, r]));
  for (const e of events) {
    if (e.kind !== 'POT_AWARDED') continue;
    for (const w of e.winners) {
      const r = bySeat.get(w.seat);
      expect(r?.mucked, `pot ${e.potIndex} winner seat ${w.seat} mucked`).toBe(false);
      expect(r?.cards).toEqual(s.players.find((p) => p.seat === w.seat)?.holeCards);
    }
  }
}

/** Plays a hand; actions are random legal ones or the timeout intent. */
function playHand(seed: number): void {
  const rnd = prng(seed ^ 0x5bd1e995);
  const created = createHand(shortBlindConfig(seed));
  let state = created.state;
  const events: HandEvent[] = [...created.events];
  assertPromptIsADecision(state);
  for (let guard = 0; state.actingSeat !== null; guard++) {
    if (guard > 200) throw new Error('hand did not terminate');
    const legal = getLegalActions(state);
    if (legal === null) throw new Error('acting seat without legal actions');
    const r = rnd();
    const intent =
      r < 0.25
        ? timeoutIntent(state)
        : r < 0.6 && legal.canCall
          ? { type: 'CALL' as const }
          : r < 0.75 && legal.canCheck
            ? { type: 'CHECK' as const }
            : r < 0.85 && legal.canAllIn
              ? { type: 'ALL_IN' as const }
              : r < 0.9
                ? { type: 'FOLD' as const }
                : legal.canCheck
                  ? { type: 'CHECK' as const }
                  : { type: 'CALL' as const };
    const t = applyAction(state, state.actingSeat, intent, { timeout: r < 0.25 });
    if (!t.ok) throw new Error(`rejected ${JSON.stringify(intent)}: ${t.code}`);
    state = t.state;
    events.push(...t.events);
    expect(checkHandInvariants(state)).toEqual([]);
    assertPromptIsADecision(state);
  }
  expect(state.phase).toBe('HAND_COMPLETE');
  assertWinnersRevealed(state, events);
}

describe('properties (fast-check)', () => {
  it('a prompt is always a real decision, and every showdown pot winner is revealed', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 0x7fffffff }), (seed) => {
        playHand(seed);
      }),
      { numRuns: 3000, seed: 20261008 },
    );
  });
});
