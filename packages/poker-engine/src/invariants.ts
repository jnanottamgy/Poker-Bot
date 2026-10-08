import { DECK_SIZE } from '@jpb/shared-types';
import type { HandPhase } from '@jpb/shared-types';
import { isCardCode } from './cards';
import { canAct, isBettingPhase } from './legal';
import type { HandState } from './types';

/** Board sizes allowed in each phase (fold wins may stop before the river). */
const BOARD_SIZES: Readonly<Record<HandPhase, readonly number[]>> = {
  HAND_CREATED: [0],
  DEAL_HOLE_CARDS: [0],
  PREFLOP: [0],
  FLOP: [3],
  TURN: [4],
  RIVER: [5],
  SHOWDOWN: [5],
  POT_DISTRIBUTION: [0, 3, 4, 5],
  HAND_COMPLETE: [0, 3, 4, 5],
};
/** Burn cards that must accompany each board size. */
const BURNS_FOR_BOARD: Readonly<Record<number, number>> = { 0: 0, 3: 1, 4: 2, 5: 3 };
const PRE_DEAL_PHASES: readonly HandPhase[] = ['HAND_CREATED', 'DEAL_HOLE_CARDS'];
const AFTER_BETTING_PHASES: readonly HandPhase[] = ['POT_DISTRIBUTION', 'HAND_COMPLETE'];

function isChips(n: unknown): boolean {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
}

/**
 * Structural health checks of a hand state. Returns human-readable problems;
 * an empty array means healthy. Checked: card uniqueness and accounting
 * (deck + board + burns + hole cards = 52 distinct cards), board/burn sizes
 * per phase, non-negative integer chips, chip conservation
 * (sum of stacks + pot = sum of starting stacks), pot reconciliation with
 * contributions, all-in/fold flags, acting-seat validity and betting fields.
 */
export function checkHandInvariants(state: HandState): string[] {
  const errors: string[] = [];
  const err = (m: string): void => {
    errors.push(m);
  };

  // --- seats
  const seats = new Set<number>();
  for (const p of state.players) {
    if (!Number.isSafeInteger(p.seat) || p.seat < 0 || p.seat >= state.maxSeats) err(`seat ${p.seat} out of range`);
    if (seats.has(p.seat)) err(`duplicate seat ${p.seat}`);
    seats.add(p.seat);
  }
  for (let i = 1; i < state.players.length; i++) {
    if ((state.players[i - 1]?.seat ?? 0) >= (state.players[i]?.seat ?? 0)) err('players not in ascending seat order');
  }

  // --- cards
  const all: unknown[] = [...state.deck, ...state.board, ...state.burns];
  const preDeal = PRE_DEAL_PHASES.includes(state.phase);
  for (const p of state.players) {
    if (p.holeCards === null) {
      if (!preDeal) err(`seat ${p.seat} has no hole cards in ${state.phase}`);
    } else {
      all.push(...p.holeCards);
    }
  }
  const seen = new Set<string>();
  for (const c of all) {
    if (!isCardCode(c)) err(`invalid card ${String(c)}`);
    else if (seen.has(c)) err(`duplicate card ${c}`);
    else seen.add(c);
  }
  if (all.length !== DECK_SIZE) err(`card count ${all.length} != ${DECK_SIZE}`);
  if (!BOARD_SIZES[state.phase].includes(state.board.length)) {
    err(`board has ${state.board.length} cards in ${state.phase}`);
  }
  if (BURNS_FOR_BOARD[state.board.length] !== state.burns.length) {
    err(`${state.burns.length} burns for a board of ${state.board.length}`);
  }

  // --- chips
  let stacks = 0;
  let starting = 0;
  let contributed = 0;
  let won = 0;
  for (const p of state.players) {
    for (const [k, v] of Object.entries({
      stack: p.stack,
      startingStack: p.startingStack,
      streetContribution: p.streetContribution,
      totalContribution: p.totalContribution,
      anteContribution: p.anteContribution,
      won: p.won,
      uncalledReturned: p.uncalledReturned,
    })) {
      if (!isChips(v)) err(`seat ${p.seat} ${k} is not a non-negative integer: ${String(v)}`);
    }
    if (p.streetContribution + p.anteContribution > p.totalContribution) {
      err(`seat ${p.seat} street+ante contribution exceeds total`);
    }
    stacks += p.stack;
    starting += p.startingStack;
    contributed += p.totalContribution;
    won += p.won;
  }
  if (!isChips(state.pot)) err(`pot is not a non-negative integer: ${state.pot}`);
  if (stacks + state.pot !== starting) err(`chips not conserved: stacks ${stacks} + pot ${state.pot} != ${starting}`);
  if (state.phase === 'HAND_COMPLETE') {
    if (state.pot !== 0) err(`pot ${state.pot} not empty after the hand`);
    if (won !== contributed) err(`awarded ${won} != contributed ${contributed}`);
    if (state.result === null) err('completed hand has no result');
  } else if (state.pot !== contributed) {
    err(`pot ${state.pot} != total contributions ${contributed}`);
  }

  // --- flags
  const live = state.players.filter((p) => !p.folded);
  if (live.length === 0) err('every player folded');
  for (const p of state.players) {
    if (p.folded && p.allIn) err(`seat ${p.seat} is both folded and all-in`);
    if (!AFTER_BETTING_PHASES.includes(state.phase)) {
      if (p.allIn !== (p.stack === 0) && !p.folded) err(`seat ${p.seat} allIn flag disagrees with stack ${p.stack}`);
    }
  }

  // --- betting
  if (isBettingPhase(state.phase)) {
    if (state.actingSeat === null) err(`no acting seat in ${state.phase}`);
    if (!isChips(state.currentBet) || !isChips(state.minRaiseIncrement)) err('betting fields are not integers');
    if (state.minRaiseIncrement < state.bigBlind) err('minRaiseIncrement below the big blind');
    for (const p of state.players) {
      if (p.streetContribution > state.currentBet) err(`seat ${p.seat} contributed above the current bet`);
    }
  } else if (state.actingSeat !== null) {
    err(`acting seat set in ${state.phase}`);
  }
  if (state.actingSeat !== null) {
    const actor = state.players.find((p) => p.seat === state.actingSeat);
    if (actor === undefined) err(`acting seat ${state.actingSeat} not in hand`);
    else if (!canAct(actor)) err(`acting seat ${state.actingSeat} cannot act (folded or all-in)`);
  }
  return errors;
}
