import type { ActionType, CardCode, HandActionDto, HandDetailDto, Street } from '@jpb/shared-types';
import { TABLE_SIZE_LIMITS } from '@jpb/shared-types';
import { cardShort, formatChips } from '@jpb/ui';

/**
 * Replay model for §2.10: the recorded hand history turned into a list of
 * frames (PRE-FLOP → FLOP → TURN → RIVER → SHOWDOWN, action by action).
 * Pure function of the server's HandDetailDto — nothing is re-evaluated or
 * re-decided here: stacks and pots come from the recorded `stackAfter` /
 * `potAfter`, pot awards from the recorded winners, and the last frame shows
 * the recorded final stacks (any difference is reported, never hidden).
 */

export const STREETS: readonly Street[] = ['PREFLOP', 'FLOP', 'TURN', 'RIVER'];
export type ReplayStage = 'START' | Street | 'SHOWDOWN';
export type FrameKind = 'start' | 'action' | 'street' | 'uncalled' | 'showdown' | 'award';

export const STAGE_LABEL: Readonly<Record<ReplayStage, string>> = {
  START: 'Deal',
  PREFLOP: 'Pre-flop',
  FLOP: 'Flop',
  TURN: 'Turn',
  RIVER: 'River',
  SHOWDOWN: 'Showdown',
};

export interface ReplaySeat {
  seat: number;
  playerId: string;
  name: string;
  stack: number;
  /** Chips in front of the player on the current street (swept into the pot when the street ends). */
  bet: number;
  folded: boolean;
  allIn: boolean;
  /** Last voluntary action this street (shown on the seat). */
  lastAction: { action: ActionType; amount: number; toAmount: number } | null;
  /** Hole cards turned face up at showdown. */
  shown: boolean;
  /** Chips won so far in the award frames. */
  won: number;
}

export interface ReplayFrame {
  kind: FrameKind;
  stage: ReplayStage;
  /** `HandActionDto.seq` of an action frame. */
  actionSeq: number | null;
  /** Seat that acted / received chips in this frame. */
  actor: number | null;
  board: CardCode[];
  /** Total chips in the middle, including bets in front of players. */
  pot: number;
  seats: ReplaySeat[];
  caption: string;
  /** Pot breakdown, once known (showdown / awards). */
  pots: Array<{ amount: number }> | null;
  /** Cards to highlight (the winning five of the pot being awarded). */
  winningCards: CardCode[] | null;
}

export interface StackDifference {
  seat: number;
  name: string;
  replayed: number;
  recorded: number;
}

export interface Replay {
  frames: ReplayFrame[];
  /** Index of the first frame of each stage present in this hand. */
  stageStarts: Partial<Record<ReplayStage, number>>;
  /** Frame index of each action (by seq). */
  frameOfAction: ReadonlyMap<number, number>;
  /** Seats whose replayed final stack differs from the recorded final stack. */
  differences: StackDifference[];
}

const POSTS = new Set<HandActionDto['action']>(['POST_SB', 'POST_BB', 'POST_ANTE']);

export function isPost(action: HandActionDto['action']): action is 'POST_SB' | 'POST_BB' | 'POST_ANTE' {
  return POSTS.has(action);
}

/** "raises to 1,200", "calls 600", "posts the small blind 300"… (amounts exact). */
export function actionPhrase(a: Pick<HandActionDto, 'action' | 'amount' | 'toAmount' | 'allIn' | 'timeout'>): string {
  const tail = `${a.allIn && a.action !== 'ALL_IN' ? ' (all-in)' : ''}${a.timeout ? ' — timed out' : ''}`;
  switch (a.action) {
    case 'POST_SB':
      return `posts the small blind ${formatChips(a.amount)}${tail}`;
    case 'POST_BB':
      return `posts the big blind ${formatChips(a.amount)}${tail}`;
    case 'POST_ANTE':
      return `posts an ante of ${formatChips(a.amount)}${tail}`;
    case 'FOLD':
      return `folds${tail}`;
    case 'CHECK':
      return `checks${tail}`;
    case 'CALL':
      return `calls ${formatChips(a.amount)}${tail}`;
    case 'BET':
      return `bets ${formatChips(a.toAmount)}${tail}`;
    case 'RAISE':
      return `raises to ${formatChips(a.toAmount)}${tail}`;
    case 'ALL_IN':
      return `is all-in for ${formatChips(a.toAmount)}${tail}`;
    default:
      return String(a.action).toLowerCase();
  }
}

/** Short label for tables: "RAISE 1,200", "POST SB 300". */
export function actionShort(a: Pick<HandActionDto, 'action' | 'amount' | 'toAmount'>): string {
  switch (a.action) {
    case 'POST_SB':
      return 'POST SB';
    case 'POST_BB':
      return 'POST BB';
    case 'POST_ANTE':
      return 'ANTE';
    case 'ALL_IN':
      return 'ALL-IN';
    default:
      return a.action;
  }
}

function cardsText(cards: readonly CardCode[]): string {
  return cards.map(cardShort).join(' ');
}

function boardAt(hand: HandDetailDto, stage: Street): CardCode[] {
  const { flop, turn, river } = hand.boardByStreet;
  if (stage === 'PREFLOP') return [];
  if (stage === 'FLOP') return flop.slice(0, 3);
  if (stage === 'TURN') return [...flop.slice(0, 3), ...(turn ? [turn] : [])];
  return [...flop.slice(0, 3), ...(turn ? [turn] : []), ...(river ? [river] : [])];
}

function streetOfBoard(size: number): Street {
  if (size >= 5) return 'RIVER';
  if (size === 4) return 'TURN';
  if (size >= 3) return 'FLOP';
  return 'PREFLOP';
}

function potLabel(type: 'MAIN' | 'SIDE', index: number, sideCount: number): string {
  if (type === 'MAIN') return sideCount > 0 ? 'Main pot' : 'Pot';
  return `Side pot ${index}`;
}

/** Builds every frame of the replay. Never throws on inconsistent data. */
export function buildReplay(hand: HandDetailDto): Replay {
  const seats: ReplaySeat[] = [...hand.seats]
    .sort((a, b) => a.seat - b.seat)
    .map((s) => ({ seat: s.seat, playerId: s.playerId, name: s.displayName, stack: s.startingStack, bet: 0, folded: false, allIn: false, lastAction: null, shown: false, won: 0 }));
  const bySeat = new Map(seats.map((s) => [s.seat, s]));
  const nameOf = (seat: number) => bySeat.get(seat)?.name ?? `Seat ${seat + 1}`;
  const frames: ReplayFrame[] = [];
  const stageStarts: Partial<Record<ReplayStage, number>> = {};
  const frameOfAction = new Map<number, number>();
  let board: CardCode[] = [];
  let pot = 0;
  let stage: ReplayStage = 'START';
  let pots: ReplayFrame['pots'] = null;

  const push = (kind: FrameKind, caption: string, extra: Partial<Pick<ReplayFrame, 'actionSeq' | 'actor' | 'winningCards'>> = {}) => {
    if (stageStarts[stage] === undefined) stageStarts[stage] = frames.length;
    frames.push({
      kind,
      stage,
      actionSeq: extra.actionSeq ?? null,
      actor: extra.actor ?? null,
      board: board.slice(),
      pot,
      seats: seats.map((s) => ({ ...s, lastAction: s.lastAction ? { ...s.lastAction } : null })),
      caption,
      pots,
      winningCards: extra.winningCards ?? null,
    });
  };
  const sweep = () => {
    for (const s of seats) {
      s.bet = 0;
      s.lastAction = null;
    }
  };

  const button = hand.buttonSeat === null ? 'a dead button' : `${nameOf(hand.buttonSeat)} on the button`;
  const blinds = `${formatChips(hand.smallBlind)}/${formatChips(hand.bigBlind)}${hand.ante > 0 ? `, ante ${formatChips(hand.ante)}` : ''}`;
  push('start', `Hand #${formatChips(hand.handNumber)}: ${seats.length} players, blinds ${blinds}, ${button}.`);
  stage = 'PREFLOP';

  const advanceTo = (target: Street) => {
    let i = STREETS.indexOf(stage as Street);
    const goal = STREETS.indexOf(target);
    while (i < goal) {
      i += 1;
      sweep();
      stage = STREETS[i]!;
      const next = boardAt(hand, stage);
      const added = next.slice(board.length);
      board = next;
      push('street', added.length > 0 ? `${STAGE_LABEL[stage]}: ${cardsText(added)}` : STAGE_LABEL[stage]);
    }
  };

  const actions = [...hand.actions].sort((a, b) => a.seq - b.seq);
  for (const a of actions) {
    if (STREETS.indexOf(a.street) > STREETS.indexOf(stage as Street)) advanceTo(a.street);
    const s = bySeat.get(a.seat);
    if (s) {
      s.stack = a.stackAfter;
      if (a.action !== 'POST_ANTE') s.bet += a.amount;
      if (a.action === 'FOLD') s.folded = true;
      if (a.allIn) s.allIn = true;
      s.lastAction = isPost(a.action) ? null : { action: a.action, amount: a.amount, toAmount: a.toAmount };
    }
    pot = a.potAfter;
    push('action', `${nameOf(a.seat)} ${actionPhrase(a)}.`, { actionSeq: a.seq, actor: a.seat });
    frameOfAction.set(a.seq, frames.length - 1);
  }

  for (const u of hand.uncalledReturns) {
    const s = bySeat.get(u.seat);
    if (s) {
      s.stack += u.amount;
      s.bet = Math.max(0, s.bet - u.amount);
    }
    pot -= u.amount;
    push('uncalled', `Uncalled ${formatChips(u.amount)} returned to ${nameOf(u.seat)}.`, { actor: u.seat });
  }

  // All-in run-out: the remaining community cards are dealt without action.
  advanceTo(streetOfBoard(hand.board.length));
  sweep();

  const sorted = [...hand.pots].sort((a, b) => a.potIndex - b.potIndex);
  const sideCount = sorted.filter((p) => p.type === 'SIDE').length;
  const shownSeats = hand.seats.filter((s) => s.shown && s.holeCards !== null);
  if (hand.showdown || shownSeats.length > 0) {
    stage = 'SHOWDOWN';
    for (const s of shownSeats) bySeat.get(s.seat)!.shown = true;
    pots = sorted.map((p) => ({ amount: p.amount }));
    const shows = shownSeats.map((s) => `${s.displayName} shows ${cardsText(s.holeCards!)}${s.finalHand ? ` (${s.finalHand.description})` : ''}`);
    push('showdown', shows.length > 0 ? `Showdown: ${shows.join('; ')}.` : 'Showdown.');
  }
  pots = sorted.map((p) => ({ amount: p.amount }));

  const finalHand = new Map(hand.seats.map((s) => [s.seat, s.finalHand]));
  sorted.forEach((p, i) => {
    for (const w of p.winners) {
      const s = bySeat.get(w.seat);
      if (s) {
        s.stack += w.amount;
        s.won += w.amount;
      }
      pot -= w.amount;
    }
    const names = p.winners.map((w) => `${nameOf(w.seat)} ${formatChips(w.amount)}`).join(', ');
    const odd = p.winners.filter((w) => w.oddChips > 0).map((w) => `${w.oddChips} odd chip${w.oddChips === 1 ? '' : 's'} to ${nameOf(w.seat)}`);
    const how = p.winningHand ? ` with ${p.winningHand.description}` : p.winners.length === 1 && !hand.showdown ? ' (uncontested)' : '';
    const isLast = i === sorted.length - 1;
    if (isLast) {
      // Last frame: the recorded final stacks are authoritative.
      for (const rec of hand.seats) {
        const s = bySeat.get(rec.seat);
        if (s) s.stack = rec.finalStack;
      }
      pot = 0;
    }
    const winning = p.winners.flatMap((w) => finalHand.get(w.seat)?.bestFive ?? []);
    push('award', `${potLabel(p.type, i, sideCount)} ${formatChips(p.amount)} → ${names}${how}${odd.length ? ` (${odd.join(', ')})` : ''}.`, {
      actor: p.winners[0]?.seat ?? null,
      winningCards: winning.length > 0 ? winning : null,
    });
  });

  return { frames, stageStarts, frameOfAction, differences: stackDifferences(hand) };
}

/**
 * Re-adds every recorded movement of chips (posts and bets from the action
 * log, uncalled returns, pot awards) to the starting stacks and compares with
 * the recorded final stacks. Pot `amount`s include their odd chips (CONTRACTS).
 */
export function stackDifferences(hand: HandDetailDto): StackDifference[] {
  const stacks = new Map(hand.seats.map((s) => [s.seat, s.startingStack]));
  for (const a of hand.actions) stacks.set(a.seat, (stacks.get(a.seat) ?? 0) - a.amount);
  for (const u of hand.uncalledReturns) stacks.set(u.seat, (stacks.get(u.seat) ?? 0) + u.amount);
  for (const p of hand.pots) for (const w of p.winners) stacks.set(w.seat, (stacks.get(w.seat) ?? 0) + w.amount);
  return hand.seats
    .filter((s) => stacks.get(s.seat) !== s.finalStack)
    .map((s) => ({ seat: s.seat, name: s.displayName, replayed: stacks.get(s.seat) ?? 0, recorded: s.finalStack }));
}

/** Base duration of a frame at 1× speed (ms). */
export function frameDurationMs(kind: FrameKind): number {
  switch (kind) {
    case 'start':
      return 1100;
    case 'street':
      return 1500;
    case 'showdown':
      return 2000;
    case 'award':
      return 2000;
    default:
      return 1100;
  }
}

/** Seats drawn for the replay: the configured table size, but always large enough for every recorded seat. */
export function replaySeatCount(hand: Pick<HandDetailDto, 'seats' | 'buttonSeat'>, configured: number | null): number {
  const min = TABLE_SIZE_LIMITS.MIN_PLAYERS_PER_TABLE;
  const max = TABLE_SIZE_LIMITS.ABSOLUTE_MAX_SEATS;
  const needed = Math.max(min, ...hand.seats.map((s) => s.seat + 1), (hand.buttonSeat ?? 0) + 1);
  return Math.min(max, Math.max(needed, configured ?? needed));
}
