import { HAND_PHASE_TRANSITIONS } from '@jpb/shared-types';
import type {
  AnteType,
  CardCode,
  ForcedBetType,
  HandEvent,
  HandPhase,
  HandSeatInput,
  PlayerActionIntent,
  SeatIndex,
  Street,
} from '@jpb/shared-types';
import { isFullDeck } from './cards';
import { cardsNeeded, dealPlan } from './dealing';
import { distributePots } from './distribution';
import {
  canAct,
  computeLegalActions,
  isBettingPhase,
  isRoundComplete,
  livePlayers,
  needsToAct,
  reject,
  resolveIntent,
} from './legal';
import type { ResolvedAction } from './legal';
import { buildPots } from './pots';
import type { BuildPotsResult, PotContribution } from './pots';
import { clockwiseFrom } from './seats';
import { resolveShowdown } from './showdown';
import type { ShowdownOutcome } from './showdown';
import type {
  AwardedPot,
  CreateHandInput,
  HandPlayerState,
  HandRejection,
  HandResult,
  HandState,
  HandTransition,
  Pot,
} from './types';

const ANTE_TYPES: readonly AnteType[] = ['NONE', 'BB_ANTE', 'ALL_PLAYERS'];
const MIN_PLAYERS = 2;
const NEXT_STREET: Readonly<Partial<Record<HandPhase, Street>>> = { PREFLOP: 'FLOP', FLOP: 'TURN', TURN: 'RIVER' };
const STREET_CARDS: Readonly<Record<Street, number>> = { PREFLOP: 0, FLOP: 3, TURN: 1, RIVER: 1 };
const BURN_PER_STREET = 1;

// ---------------------------------------------------------------------------
// helpers

/** Asserts HAND_PHASE_TRANSITIONS. An illegal transition is a programmer bug. */
function transitionPhase(s: HandState, to: HandPhase): void {
  if (!HAND_PHASE_TRANSITIONS[s.phase].includes(to)) {
    throw new Error(`Illegal hand phase transition ${s.phase} -> ${to}`);
  }
  s.phase = to;
}

function playerAt(s: HandState, seat: SeatIndex): HandPlayerState {
  const p = s.players.find((x) => x.seat === seat);
  if (p === undefined) throw new Error(`No player at seat ${seat}`);
  return p;
}

function isSafeChips(n: unknown, min: number): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= min;
}

/** Contributions at pot-building level and the dead money (BB_ANTE ante goes to the main pot). */
function potInputs(s: HandState): { contribs: PotContribution[]; deadMoney: number } {
  const bbAnte = s.anteType === 'BB_ANTE';
  return {
    contribs: s.players.map((p) => ({
      seat: p.seat,
      folded: p.folded,
      amount: bbAnte ? p.totalContribution - p.anteContribution : p.totalContribution,
    })),
    deadMoney: bbAnte ? s.players.reduce((sum, p) => sum + p.anteContribution, 0) : 0,
  };
}

/** Pots (and the currently uncalled amount) for the chips in the pot right now. */
export function currentPots(state: HandState): BuildPotsResult {
  const { contribs, deadMoney } = potInputs(state);
  if (contribs.every((c) => c.amount === 0) && deadMoney === 0) return { pots: [], uncalled: null };
  return buildPots(contribs, { deadMoney });
}

function validateCreateInput(input: CreateHandInput): void {
  const fail = (msg: string): never => {
    throw new RangeError(`createHand: ${msg}`);
  };
  if (!isSafeChips(input.handNumber, 0)) fail('handNumber must be a non-negative integer');
  if (!isSafeChips(input.maxSeats, MIN_PLAYERS)) fail('maxSeats must be an integer >= 2');
  if (!Array.isArray(input.seats) || input.seats.length < MIN_PLAYERS) fail('at least two dealt-in seats required');
  if (input.seats.length > input.maxSeats) fail('more seats than maxSeats');
  if (!Array.isArray(input.deck) || !isFullDeck(input.deck)) fail('deck must contain the 52 cards exactly once');
  if (cardsNeeded(input.seats.length) > input.deck.length) fail('too many seats for one deck');
  const seatSet = new Set<number>();
  const idSet = new Set<string>();
  let total = 0;
  for (const s of input.seats) {
    if (!isSafeChips(s.seat, 0) || s.seat >= input.maxSeats) fail(`seat ${String(s.seat)} out of range`);
    if (seatSet.has(s.seat)) fail(`duplicate seat ${s.seat}`);
    if (typeof s.playerId !== 'string' || s.playerId.length === 0) fail(`seat ${s.seat} has no playerId`);
    if (idSet.has(s.playerId)) fail(`duplicate player ${s.playerId}`);
    if (!isSafeChips(s.stack, 1)) fail(`seat ${s.seat} stack must be a positive integer`);
    seatSet.add(s.seat);
    idSet.add(s.playerId);
    total += s.stack;
  }
  if (!Number.isSafeInteger(total)) fail('total chips exceed safe integer range');
  if (!isSafeChips(input.buttonSeat, 0) || input.buttonSeat >= input.maxSeats) fail('buttonSeat out of range');
  if (!seatSet.has(input.bigBlindSeat)) fail('bigBlindSeat must be a dealt-in seat');
  if (input.smallBlindSeat !== null) {
    if (!seatSet.has(input.smallBlindSeat)) fail('smallBlindSeat must be a dealt-in seat or null');
    if (input.smallBlindSeat === input.bigBlindSeat) fail('smallBlindSeat equals bigBlindSeat');
  }
  if (!isSafeChips(input.bigBlind, 1)) fail('bigBlind must be a positive integer');
  if (!isSafeChips(input.smallBlind, 0) || input.smallBlind > input.bigBlind) fail('smallBlind must be 0..bigBlind');
  if (!isSafeChips(input.ante, 0)) fail('ante must be a non-negative integer');
  if (!ANTE_TYPES.includes(input.anteType)) fail(`unknown anteType ${String(input.anteType)}`);
}

function initialState(input: CreateHandInput): HandState {
  const players: HandPlayerState[] = [...input.seats]
    .sort((a, b) => a.seat - b.seat)
    .map((s) => ({
      seat: s.seat,
      playerId: s.playerId,
      startingStack: s.stack,
      stack: s.stack,
      holeCards: null,
      folded: false,
      allIn: false,
      streetContribution: 0,
      totalContribution: 0,
      anteContribution: 0,
      actedThisStreet: false,
      betLevelAtLastAction: null,
      lastAction: null,
      won: 0,
      uncalledReturned: 0,
    }));
  return {
    handId: input.handId,
    handNumber: input.handNumber,
    maxSeats: input.maxSeats,
    buttonSeat: input.buttonSeat,
    smallBlindSeat: input.smallBlindSeat,
    bigBlindSeat: input.bigBlindSeat,
    smallBlind: input.smallBlind,
    bigBlind: input.bigBlind,
    ante: input.anteType === 'NONE' ? 0 : input.ante,
    anteType: input.anteType,
    phase: 'HAND_CREATED',
    players,
    deck: [...input.deck],
    board: [],
    burns: [],
    pot: 0,
    currentBet: 0,
    minRaiseIncrement: input.bigBlind,
    lastAggressorSeat: null,
    aggressorByStreet: { PREFLOP: null, FLOP: null, TURN: null, RIVER: null },
    actingSeat: null,
    bettingRoundOpen: false,
    allInRunOut: false,
    actionLog: [],
    result: null,
  };
}

// ---------------------------------------------------------------------------
// forced bets & dealing

function postForced(s: HandState, ev: HandEvent[], p: HandPlayerState, betType: ForcedBetType, wanted: number): void {
  const amount = Math.min(wanted, p.stack);
  if (amount <= 0) return; // nothing to post (zero-sized blind, or already all-in)
  p.stack -= amount;
  p.totalContribution += amount;
  if (betType === 'ANTE') p.anteContribution += amount;
  else p.streetContribution += amount;
  s.pot += amount;
  p.allIn = p.stack === 0;
  s.actionLog.push({
    kind: 'FORCED_BET',
    street: 'PREFLOP',
    seat: p.seat,
    playerId: p.playerId,
    betType,
    amount,
    allIn: p.allIn,
  });
  ev.push({ kind: 'FORCED_BET_POSTED', seat: p.seat, betType, amount, allIn: p.allIn, stack: p.stack, pot: s.pot });
}

/**
 * Rules 1-2. Antes first (ALL_PLAYERS: every player in dealing order;
 * BB_ANTE: the big blind, who first reserves the blind because the blind
 * takes priority), then the small blind, then the big blind. The preflop
 * current bet is the full nominal big blind.
 */
function postForcedBets(s: HandState, ev: HandEvent[]): void {
  if (s.ante > 0 && s.anteType === 'ALL_PLAYERS') {
    const order = clockwiseFrom(
      s.players.map((p) => p.seat),
      s.buttonSeat,
      s.maxSeats,
    );
    for (const seat of order) postForced(s, ev, playerAt(s, seat), 'ANTE', s.ante);
  } else if (s.ante > 0 && s.anteType === 'BB_ANTE') {
    const bb = playerAt(s, s.bigBlindSeat);
    const reservedForBlind = Math.min(s.bigBlind, bb.stack);
    postForced(s, ev, bb, 'ANTE', Math.min(s.ante, bb.stack - reservedForBlind));
  }
  if (s.smallBlindSeat !== null) postForced(s, ev, playerAt(s, s.smallBlindSeat), 'SMALL_BLIND', s.smallBlind);
  postForced(s, ev, playerAt(s, s.bigBlindSeat), 'BIG_BLIND', s.bigBlind);
  s.currentBet = s.bigBlind;
  s.minRaiseIncrement = s.bigBlind;
}

function dealHoleCards(s: HandState, ev: HandEvent[]): void {
  const plan = dealPlan(
    s.players.map((p) => p.seat),
    s.buttonSeat,
    s.maxSeats,
  );
  for (const { seat, deckIndices } of plan.holeCards) {
    const p = playerAt(s, seat);
    const cards: [CardCode, CardCode] = [s.deck[deckIndices[0]] as CardCode, s.deck[deckIndices[1]] as CardCode];
    p.holeCards = cards;
    ev.push({ kind: 'HOLE_CARDS_DEALT', seat, playerId: p.playerId, cards: [...cards] });
  }
  s.deck = s.deck.slice(2 * plan.seatOrder.length);
}

function resetStreet(s: HandState): void {
  s.currentBet = 0;
  s.minRaiseIncrement = s.bigBlind;
  s.lastAggressorSeat = null;
  for (const p of s.players) {
    p.streetContribution = 0;
    p.actedThisStreet = false;
    p.betLevelAtLastAction = null;
    p.lastAction = null;
  }
}

/** Moves to the next street: burn one card, deal the street's board cards. */
function dealNextStreet(s: HandState, ev: HandEvent[]): void {
  const street = NEXT_STREET[s.phase];
  if (street === undefined) throw new Error(`No street follows ${s.phase}`);
  transitionPhase(s, street);
  const count = STREET_CARDS[street];
  const burn = s.deck.slice(0, BURN_PER_STREET);
  const newCards = s.deck.slice(BURN_PER_STREET, BURN_PER_STREET + count);
  if (newCards.length !== count) throw new Error('Deck exhausted');
  s.deck = s.deck.slice(BURN_PER_STREET + count);
  s.burns = [...s.burns, ...burn];
  s.board = [...s.board, ...newCards];
  resetStreet(s);
  ev.push({ kind: 'STREET_STARTED', street, board: [...s.board], newCards: [...newCards], pot: s.pot });
}

// ---------------------------------------------------------------------------
// betting flow

function promptNext(s: HandState, ev: HandEvent[], fromSeat: SeatIndex): void {
  const order = clockwiseFrom(
    s.players.map((p) => p.seat),
    fromSeat,
    s.maxSeats,
  );
  const seat = order.find((x) => needsToAct(s, playerAt(s, x)));
  if (seat === undefined) throw new Error('Betting round open but nobody needs to act');
  const p = playerAt(s, seat);
  s.actingSeat = seat;
  ev.push({ kind: 'TURN_TO_ACT', seat, playerId: p.playerId, legal: computeLegalActions(s, p) });
}

/** Ends the current street's betting; flags an all-in run-out (rule 7). */
function finishRound(s: HandState, ev: HandEvent[]): void {
  if (s.bettingRoundOpen && isBettingPhase(s.phase)) {
    ev.push({ kind: 'BETTING_ROUND_COMPLETE', street: s.phase, pot: s.pot });
  }
  s.bettingRoundOpen = false;
  s.actingSeat = null;
  const live = livePlayers(s);
  if (live.length >= MIN_PLAYERS && s.phase !== 'RIVER' && live.filter(canAct).length <= 1) {
    s.allInRunOut = true;
  }
}

/** Deals streets until a betting round opens or the river is complete. */
function runStreets(s: HandState, ev: HandEvent[]): void {
  for (;;) {
    if (s.phase === 'RIVER') {
      finishHand(s, ev, 'SHOWDOWN');
      return;
    }
    dealNextStreet(s, ev);
    if (!isRoundComplete(s)) {
      s.bettingRoundOpen = true;
      promptNext(s, ev, s.buttonSeat);
      return;
    }
  }
}

/** After an action (or forced bets): next decision, or end of round/hand. */
function continueBetting(s: HandState, ev: HandEvent[], fromSeat: SeatIndex): void {
  s.actingSeat = null;
  if (livePlayers(s).length === 1) {
    finishRound(s, ev);
    finishHand(s, ev, 'FOLD');
    return;
  }
  if (!isRoundComplete(s)) {
    promptNext(s, ev, fromSeat);
    return;
  }
  finishRound(s, ev);
  runStreets(s, ev);
}

// ---------------------------------------------------------------------------
// end of hand

function returnUncalled(s: HandState, ev: HandEvent[]): HandResult['uncalled'] {
  const { uncalled } = currentPots(s);
  if (uncalled === null) return null;
  const p = playerAt(s, uncalled.seat);
  // Under ALL_PLAYERS antes the unmatched excess can include part of this
  // player's own ante (every opponent posted only a partial ante); that part
  // comes back too, so the ante bookkeeping is reduced accordingly.
  const fromAnte = Math.max(0, uncalled.amount - (p.totalContribution - p.anteContribution));
  p.anteContribution -= fromAnte;
  p.stack += uncalled.amount;
  p.totalContribution -= uncalled.amount;
  p.streetContribution -= Math.min(uncalled.amount, p.streetContribution);
  p.uncalledReturned += uncalled.amount;
  s.pot -= uncalled.amount;
  if (p.stack > 0) p.allIn = false;
  ev.push({
    kind: 'UNCALLED_BET_RETURNED',
    seat: p.seat,
    playerId: p.playerId,
    amount: uncalled.amount,
    stack: p.stack,
  });
  return { seat: p.seat, playerId: p.playerId, amount: uncalled.amount };
}

function awardPots(s: HandState, ev: HandEvent[], pots: Pot[], outcome: ShowdownOutcome | null): AwardedPot[] {
  const evaluated = new Map((outcome?.evaluated ?? []).map((e) => [e.seat, e.hand]));
  const distributions = distributePots({
    pots,
    scores: [...evaluated.entries()].map(([seat, hand]) => ({ seat, score: hand.score })),
    buttonSeat: s.buttonSeat,
    maxSeats: s.maxSeats,
  });
  return distributions.map((d) => {
    const winners = d.shares.map((share) => {
      const p = playerAt(s, share.seat);
      p.stack += share.amount;
      p.won += share.amount;
      s.pot -= share.amount;
      return { seat: share.seat, playerId: p.playerId, amount: share.amount, oddChips: share.oddChips };
    });
    const best = d.eligibleSeats.length >= MIN_PLAYERS ? evaluated.get(d.winnerSeats[0] as SeatIndex) : undefined;
    const winningHand =
      best === undefined
        ? null
        : { category: best.category, description: best.description, bestFive: [...best.bestFive] };
    const awarded: AwardedPot = {
      potIndex: d.potIndex,
      potType: d.potType,
      amount: d.amount,
      eligibleSeats: d.eligibleSeats,
      winners,
      winningHand,
    };
    ev.push({ kind: 'POT_AWARDED', ...structuredClone(awarded) });
    return awarded;
  });
}

/**
 * Fold win: -> POT_DISTRIBUTION (no cards shown).
 * Showdown: -> SHOWDOWN -> POT_DISTRIBUTION.
 * Then -> HAND_COMPLETE. Event order: UNCALLED_BET_RETURNED, SHOWDOWN,
 * POT_AWARDED (last side pot first), HAND_COMPLETED.
 */
function finishHand(s: HandState, ev: HandEvent[], winType: HandResult['winType']): void {
  transitionPhase(s, winType === 'SHOWDOWN' ? 'SHOWDOWN' : 'POT_DISTRIBUTION');
  const uncalled = returnUncalled(s, ev);
  const { pots, uncalled: leftover } = currentPots(s);
  if (leftover !== null) throw new Error('Invariant: uncalled chips remain after return');

  let outcome: ShowdownOutcome | null = null;
  if (winType === 'SHOWDOWN') {
    outcome = resolveShowdown({
      live: livePlayers(s),
      board: s.board,
      pots,
      buttonSeat: s.buttonSeat,
      maxSeats: s.maxSeats,
      finalAggressorSeat: s.aggressorByStreet.RIVER,
      revealAll: s.allInRunOut,
    });
    ev.push({ kind: 'SHOWDOWN', reveals: structuredClone(outcome.reveals) });
    transitionPhase(s, 'POT_DISTRIBUTION');
  }

  const awarded = awardPots(s, ev, pots, outcome);
  if (s.pot !== 0) throw new Error(`Invariant: ${s.pot} chips left in the pot after distribution`);
  transitionPhase(s, 'HAND_COMPLETE');

  const finalStacks: HandSeatInput[] = s.players.map((p) => ({ seat: p.seat, playerId: p.playerId, stack: p.stack }));
  const bustedSeats = s.players.filter((p) => p.stack === 0).map((p) => p.seat);
  const totalPot = awarded.reduce((sum, a) => sum + a.amount, 0);
  s.result = {
    winType,
    uncalled,
    pots: awarded,
    reveals: outcome?.reveals ?? [],
    evaluated: outcome?.evaluated ?? [],
    totalPot,
    finalStacks,
    bustedSeats,
  };
  ev.push({
    kind: 'HAND_COMPLETED',
    handId: s.handId,
    handNumber: s.handNumber,
    board: [...s.board],
    totalPot,
    finalStacks: structuredClone(finalStacks),
    bustedSeats: [...bustedSeats],
  });
}

// ---------------------------------------------------------------------------
// public API

/**
 * Starts a hand: HAND_STARTED, antes, SB, BB, hole cards (dealing order),
 * then runs forward to the first TURN_TO_ACT, or to HAND_COMPLETE when no
 * betting is possible. Throws RangeError on invalid input (caller bug).
 */
export function createHand(input: CreateHandInput): HandTransition {
  validateCreateInput(input);
  const s = initialState(input);
  const ev: HandEvent[] = [];
  ev.push({
    kind: 'HAND_STARTED',
    handId: s.handId,
    handNumber: s.handNumber,
    buttonSeat: s.buttonSeat,
    smallBlindSeat: s.smallBlindSeat,
    bigBlindSeat: s.bigBlindSeat,
    smallBlind: s.smallBlind,
    bigBlind: s.bigBlind,
    ante: s.ante,
    anteType: s.anteType,
    players: s.players.map((p) => ({ seat: p.seat, playerId: p.playerId, stack: p.startingStack })),
  });
  postForcedBets(s, ev);
  transitionPhase(s, 'DEAL_HOLE_CARDS');
  dealHoleCards(s, ev);
  transitionPhase(s, 'PREFLOP');
  if (!isRoundComplete(s)) {
    s.bettingRoundOpen = true;
    promptNext(s, ev, s.bigBlindSeat);
  } else {
    finishRound(s, ev);
    runStreets(s, ev);
  }
  return { ok: true, state: s, events: ev };
}

function applyResolved(s: HandState, p: HandPlayerState, r: ResolvedAction, timeout: boolean, ev: HandEvent[]): void {
  const street = s.phase as Street;
  const add = r.action === 'FOLD' ? 0 : r.to - p.streetContribution;
  let fullRaise: boolean | null = null;
  if (r.action === 'FOLD') {
    p.folded = true;
  } else if (add > 0) {
    p.stack -= add;
    p.streetContribution = r.to;
    p.totalContribution += add;
    s.pot += add;
    p.allIn = p.stack === 0;
    if (r.to > s.currentBet) {
      const increment = r.to - s.currentBet;
      fullRaise = increment >= s.minRaiseIncrement;
      if (fullRaise) s.minRaiseIncrement = increment;
      s.currentBet = r.to;
      s.lastAggressorSeat = p.seat;
      s.aggressorByStreet[street] = p.seat;
    }
  }
  p.actedThisStreet = true;
  p.betLevelAtLastAction = s.currentBet;
  p.lastAction = { action: r.action, amount: add, toAmount: p.streetContribution };
  s.actionLog.push({
    kind: 'ACTION',
    street,
    seat: p.seat,
    playerId: p.playerId,
    intent: r.intent,
    action: r.action,
    amount: add,
    toAmount: p.streetContribution,
    allIn: p.allIn,
    fullRaise,
    currentBetAfter: s.currentBet,
    timeout,
  });
  ev.push({
    kind: 'PLAYER_ACTED',
    seat: p.seat,
    playerId: p.playerId,
    action: r.action,
    amount: add,
    toAmount: p.streetContribution,
    allIn: p.allIn,
    stack: p.stack,
    pot: s.pot,
    timeout,
  });
}

/**
 * Applies the acting player's intent and runs the hand forward to the next
 * decision or HAND_COMPLETE. Client-triggerable problems are returned as a
 * HandRejection (never thrown). The input state is never mutated.
 */
export function applyAction(
  state: HandState,
  seat: SeatIndex,
  intent: PlayerActionIntent,
  opts: { timeout?: boolean } = {},
): HandTransition | HandRejection {
  if (!isBettingPhase(state.phase) || state.actingSeat === null) {
    return reject('HAND_NOT_IN_BETTING', 'The hand is not accepting actions');
  }
  const player = state.players.find((p) => p.seat === seat);
  if (player === undefined) return reject('PLAYER_NOT_IN_HAND', 'Seat is not dealt into this hand');
  if (player.folded) return reject('PLAYER_FOLDED', 'Player has folded');
  if (player.allIn) return reject('PLAYER_ALL_IN', 'Player is all-in');
  if (seat !== state.actingSeat) return reject('NOT_YOUR_TURN', 'It is not this seat’s turn');
  const resolved = resolveIntent(state, player, intent);
  if ('ok' in resolved) return resolved;

  const s = structuredClone(state);
  const ev: HandEvent[] = [];
  applyResolved(s, playerAt(s, seat), resolved, opts?.timeout === true, ev);
  continueBetting(s, ev, seat);
  return { ok: true, state: s, events: ev };
}
