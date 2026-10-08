import { CANONICAL_DECK } from '@jpb/shared-types';
import type { CardCode, HandActionDto, HandDetailDto, HandFairnessRecord, HandListItemDto, Street } from '@jpb/shared-types';
import { placeClock } from '../../lib/schedule';
import { Rng, fakeHash } from './rng';
import type { MockPlayer, MockTable, MockTournament } from './state';

/**
 * Deterministic synthetic hand histories for the mock. A hand is fully
 * determined by (tournament, global hand index): the list row and the detail
 * are produced by the same simulation, so they always agree. The cards are
 * plausible, NOT verifiable against the mock seed (no real HMAC stream).
 */

interface SimSeat {
  seat: number;
  player: Pick<MockPlayer, 'playerId' | 'displayName' | 'publicId'>;
  start: number;
  stack: number;
  folded: boolean;
  cards: [CardCode, CardCode];
  contributed: number;
}

interface SimResult {
  seats: SimSeat[];
  actions: Array<Omit<HandActionDto, 'displayName' | 'playerId'> & { idx: number }>;
  board: CardCode[];
  pot: number;
  showdown: boolean;
  allIn: boolean;
  winners: SimSeat[];
  buttonSeat: number;
  sbSeat: number;
  bbSeat: number;
}

const STREETS: Street[] = ['PREFLOP', 'FLOP', 'TURN', 'RIVER'];

function simulate(rng: Rng, players: Array<SimSeat['player']>, bb: number, ante: number, startedAt: number): SimResult {
  const deck = rng.shuffle(CANONICAL_DECK);
  const seatIdx = rng.shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8]).slice(0, players.length).sort((a, b) => a - b);
  const seats: SimSeat[] = players.map((player, i) => {
    const start = Math.max(bb * 3, Math.round(bb * (12 + Math.exp(rng.gauss() * 0.7) * 30)));
    return { seat: seatIdx[i]!, player, start, stack: start, folded: false, cards: [deck[i * 2]!, deck[i * 2 + 1]!], contributed: 0 };
  });
  const n = seats.length;
  const btn = rng.int(0, n - 1);
  const order = (from: number) => Array.from({ length: n }, (_, k) => seats[(from + k) % n]!);
  const sb = seats[(btn + 1) % n]!;
  const bbSeat = seats[(btn + 2) % n]!;
  const actions: SimResult['actions'] = [];
  let pot = 0;
  let t = startedAt;
  let allIn = false;
  const put = (s: SimSeat, amount: number, street: Street, action: HandActionDto['action'], toAmount: number) => {
    const a = Math.min(amount, s.stack);
    s.stack -= a;
    s.contributed += a;
    pot += a;
    const isAllIn = s.stack === 0;
    allIn ||= isAllIn;
    t += 900 + Math.round(rng.next() * 4000);
    actions.push({ idx: seats.indexOf(s), seq: actions.length + 1, street, seat: s.seat, action, amount: a, toAmount, allIn: isAllIn, timeout: rng.chance(0.015), stackAfter: s.stack, potAfter: pot, at: t });
  };
  if (ante > 0) put(bbSeat, ante, 'PREFLOP', 'POST_ANTE', 0);
  put(sb, bb / 2, 'PREFLOP', 'POST_SB', bb / 2);
  put(bbSeat, bb, 'PREFLOP', 'POST_BB', bb);
  const wantShowdown = rng.chance(0.36);
  let streetsPlayed = 1;
  for (let s = 0; s < STREETS.length; s++) {
    const street = STREETS[s]!;
    const live = seats.filter((x) => !x.folded);
    if (live.length < 2) break;
    if (s > 0) streetsPlayed = s + 1;
    let bet = s === 0 ? bb : 0;
    const contrib = new Map(seats.map((x) => [x, s === 0 ? (x === sb ? bb / 2 : x === bbSeat ? bb : 0) : 0]));
    const actors = order(s === 0 ? btn + 3 : btn + 1).filter((x) => !x.folded && x.stack > 0);
    for (const x of actors) {
      const stillIn = seats.filter((y) => !y.folded).length;
      const owe = bet - (contrib.get(x) ?? 0);
      const r = rng.next();
      if (stillIn > 2 && r < (s === 0 ? 0.55 : 0.3) && owe > 0) {
        x.folded = true;
        t += 1200;
        actions.push({ idx: seats.indexOf(x), seq: actions.length + 1, street, seat: x.seat, action: 'FOLD', amount: 0, toAmount: contrib.get(x) ?? 0, allIn: false, timeout: false, stackAfter: x.stack, potAfter: pot, at: t });
      } else if (r > 0.82 || (bet === 0 && r > 0.6)) {
        const to = Math.max(bet * 2.5, bb * 2);
        const add = Math.round(to - (contrib.get(x) ?? 0));
        put(x, add, street, bet === 0 ? 'BET' : 'RAISE', to);
        contrib.set(x, (contrib.get(x) ?? 0) + add);
        bet = Math.max(bet, contrib.get(x) ?? 0);
      } else if (owe > 0) {
        put(x, owe, street, 'CALL', bet);
        contrib.set(x, bet);
      } else {
        t += 800;
        actions.push({ idx: seats.indexOf(x), seq: actions.length + 1, street, seat: x.seat, action: 'CHECK', amount: 0, toAmount: contrib.get(x) ?? 0, allIn: false, timeout: false, stackAfter: x.stack, potAfter: pot, at: t });
      }
    }
    // Everyone who has not matched the bet calls it (keeps the history consistent).
    for (const x of seats.filter((y) => !y.folded && (contrib.get(y) ?? 0) < bet && y.stack > 0)) {
      put(x, bet - (contrib.get(x) ?? 0), street, 'CALL', bet);
    }
    if (!wantShowdown && s >= 1) {
      // End uncontested: all but the last aggressor fold.
      const keep = seats.filter((y) => !y.folded);
      for (const x of keep.slice(1)) {
        x.folded = true;
        actions.push({ idx: seats.indexOf(x), seq: actions.length + 1, street, seat: x.seat, action: 'FOLD', amount: 0, toAmount: 0, allIn: false, timeout: false, stackAfter: x.stack, potAfter: pot, at: (t += 1000) });
      }
      break;
    }
  }
  const remaining = seats.filter((x) => !x.folded);
  const showdown = remaining.length > 1;
  const boardCount = showdown ? 5 : streetsPlayed >= 2 ? [0, 3, 4, 5][Math.min(3, streetsPlayed - 1)]! : 0;
  const board = deck.slice(n * 2 + 1, n * 2 + 1 + boardCount + 2).filter((_, i) => i !== 3 && i !== 5).slice(0, boardCount);
  const winners = showdown && rng.chance(0.06) ? remaining.slice(0, 2) : [rng.pick(remaining)];
  const share = Math.floor(pot / winners.length);
  winners.forEach((w, i) => (w.stack += share + (i === 0 ? pot - share * winners.length : 0)));
  return { seats, actions, board, pot, showdown, allIn, winners, buttonSeat: seats[btn]!.seat, sbSeat: sb.seat, bbSeat: bbSeat.seat };
}

function handContext(t: MockTournament, idx: number, at: number, table: MockTable) {
  const clock = placeClock(t.config.blindSchedule, t.config.breaks, t.startedAt ?? at, at).clock;
  const level = t.config.blindSchedule[clock.levelIndex]!;
  const rng = new Rng(`${t.seedKey}:hand:${idx}`);
  const n = rng.int(Math.min(4, table.maxSeats), table.maxSeats);
  const pool = t.players;
  const players = Array.from({ length: n }, (_, k) => pool[(idx * 7 + k * 131) % Math.max(1, pool.length)]!);
  return { rng, level, players };
}

function rowFrom(t: MockTournament, idx: number, table: MockTable, handNumber: number, at: number): { row: HandListItemDto; sim: SimResult } {
  const { rng, level, players } = handContext(t, idx, at, table);
  const sim = simulate(rng, players, level.bigBlind, level.ante, at);
  const row: HandListItemDto = {
    handId: `hand_${t.seedKey}_${idx}`,
    tableId: table.tableId,
    tableNumber: table.tableNumber,
    handNumber,
    startedAt: at,
    completedAt: sim.actions[sim.actions.length - 1]?.at ?? at + 30_000,
    level: level.level,
    smallBlind: level.smallBlind,
    bigBlind: level.bigBlind,
    totalPot: sim.pot,
    players: players.length,
    showdown: sim.showdown,
    allIn: sim.allIn,
    winners: sim.winners.map((w) => ({ playerId: w.player.playerId, displayName: w.player.displayName, amount: Math.floor(sim.pot / sim.winners.length) })),
  };
  return { row, sim };
}

/** Builds the initial hand list once (oldest first). */
export function ensureHands(t: MockTournament): HandListItemDto[] {
  if (t.hands.length > 0 || t.startedAt === null || t.handsCompleted === 0) return t.hands;
  const span = (t.completedAt ?? t.metrics[t.metrics.length - 1]?.at ?? t.startedAt + 60_000) - t.startedAt;
  const gap = span / t.handsCompleted;
  const tables = t.tables;
  const counts = new Map<string, number>();
  for (let idx = 0; idx < t.handsCompleted; idx++) {
    const table = tables[idx % tables.length]!;
    const handNumber = (counts.get(table.tableId) ?? 0) + 1;
    counts.set(table.tableId, handNumber);
    t.hands.push(rowFrom(t, idx, table, handNumber, Math.round(t.startedAt + idx * gap)).row);
  }
  return t.hands;
}

/** Appends one live hand (called by the mock ticker when a table completes a hand). */
export function appendHand(t: MockTournament, table: MockTable, at: number): HandListItemDto {
  ensureHands(t);
  const idx = t.hands.length;
  const { row } = rowFrom(t, idx, table, table.handNumber, at - 60_000);
  t.hands.push(row);
  return row;
}

function indexOfHand(t: MockTournament, handId: string): number {
  const prefix = `hand_${t.seedKey}_`;
  if (!handId.startsWith(prefix)) return -1;
  const idx = Number(handId.slice(prefix.length));
  return Number.isInteger(idx) && idx >= 0 && idx < t.hands.length ? idx : -1;
}

export function findHand(tournaments: MockTournament[], handId: string): { t: MockTournament; idx: number } | null {
  for (const t of tournaments) {
    ensureHands(t);
    const idx = indexOfHand(t, handId);
    if (idx >= 0) return { t, idx };
  }
  return null;
}

export function handDetail(t: MockTournament, idx: number): HandDetailDto {
  const row = t.hands[idx]!;
  const table = t.tables.find((x) => x.tableId === row.tableId)!;
  const { rng, level, players } = handContext(t, idx, row.startedAt, table);
  const sim = simulate(rng, players, level.bigBlind, level.ante, row.startedAt);
  const deckHash = fakeHash(`deck:${row.handId}`);
  return {
    ...row,
    buttonSeat: sim.buttonSeat,
    smallBlindSeat: sim.sbSeat,
    bigBlindSeat: sim.bbSeat,
    ante: level.ante,
    board: sim.board,
    boardByStreet: { flop: sim.board.slice(0, 3), turn: sim.board[3] ?? null, river: sim.board[4] ?? null },
    seats: sim.seats.map((s) => ({
      seat: s.seat,
      playerId: s.player.playerId,
      displayName: s.player.displayName,
      publicId: s.player.publicId,
      startingStack: s.start,
      finalStack: s.stack,
      holeCards: s.cards,
      shown: sim.showdown && !s.folded,
      finalHand: sim.showdown && !s.folded ? { category: 'ONE_PAIR', description: 'One pair', bestFive: [...s.cards, ...sim.board.slice(0, 3)] as CardCode[] } : null,
    })),
    actions: sim.actions.map(({ idx: seatIndex, ...a }) => ({ ...a, playerId: sim.seats[seatIndex]!.player.playerId, displayName: sim.seats[seatIndex]!.player.displayName })),
    pots: [
      {
        potIndex: 0,
        type: 'MAIN',
        amount: sim.pot,
        eligibleSeats: sim.seats.filter((s) => !s.folded).map((s) => s.seat),
        winners: sim.winners.map((w, i) => ({ seat: w.seat, playerId: w.player.playerId, amount: Math.floor(sim.pot / sim.winners.length), oddChips: i === 0 ? sim.pot % sim.winners.length : 0 })),
        winningHand: sim.showdown ? { category: 'ONE_PAIR', description: 'One pair' } : null,
      },
    ],
    uncalledReturns: [],
    randomness: { method: 'HMAC-SHA256-STREAM+FISHER-YATES', serverSeedHash: t.serverSeedHash, publicEntropy: t.publicEntropy ?? '', deckHash, label: `JPB/v1|${t.id}|${row.tableId}|${row.handNumber}` },
  };
}

export function handFairnessRecord(t: MockTournament, idx: number, withHoleCards: boolean): HandFairnessRecord {
  const d = handDetail(t, idx);
  return {
    scheme: 'JPB/v1',
    tournamentId: t.id,
    tableId: d.tableId,
    handId: d.handId,
    handNumber: d.handNumber,
    publicEntropy: t.publicEntropy ?? '',
    serverSeedHash: t.serverSeedHash,
    deckHash: d.randomness.deckHash,
    maxSeats: t.config.tables.maxSize,
    buttonSeat: d.buttonSeat ?? 0,
    holeCards: d.seats.map((s) => ({ seat: s.seat, playerId: s.playerId, cards: withHoleCards ? s.holeCards : null })),
    board: d.board,
    burns: null,
  };
}
