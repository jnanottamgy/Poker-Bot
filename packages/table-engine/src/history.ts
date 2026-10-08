import { dealingSeatOrder } from '@jpb/poker-engine';
import type { HandState } from '@jpb/poker-engine';
import { FAIRNESS_SCHEME } from '@jpb/shared-types';
import type { CardCode, EpochMs, HandFairnessRecord, PlayerId, SeatIndex, TableHandSummary } from '@jpb/shared-types';
import { HAND_HISTORY_FORMAT, HAND_HISTORY_FORMAT_VERSION } from './constants';
import type { HandHistoryRecord, HandMeta, TableState } from './types';

const copyCards = (c: [CardCode, CardCode]): [CardCode, CardCode] => [c[0], c[1]];

/** Builds the complete record of a completed hand (deep copies only). */
export function buildHandHistory(
  s: TableState,
  hand: HandState,
  meta: HandMeta,
  completedAt: EpochMs,
): HandHistoryRecord {
  const result = hand.result;
  if (result === null || hand.phase !== 'HAND_COMPLETE') throw new Error('buildHandHistory: hand is not complete');
  const shown = new Map<SeatIndex, [CardCode, CardCode]>();
  for (const r of result.reveals) if (r.cards !== null) shown.set(r.seat, copyCards(r.cards));
  const names = new Map(meta.players.map((p) => [p.seat, p]));
  return {
    format: HAND_HISTORY_FORMAT,
    formatVersion: HAND_HISTORY_FORMAT_VERSION,
    tournamentId: s.tournamentId,
    tableId: s.tableId,
    tableNumber: s.tableNumber,
    handId: hand.handId,
    handNumber: hand.handNumber,
    maxSeats: hand.maxSeats,
    startedAt: meta.startedAt,
    completedAt,
    buttonSeat: hand.buttonSeat,
    smallBlindSeat: hand.smallBlindSeat,
    smallBlindPosition: meta.smallBlindPosition,
    bigBlindSeat: hand.bigBlindSeat,
    headsUp: meta.headsUp,
    blinds: { ...meta.blinds },
    deckHash: meta.deckHash,
    dealingOrder: dealingSeatOrder(
      hand.players.map((p) => p.seat),
      hand.buttonSeat,
      hand.maxSeats,
    ),
    players: hand.players.map((p) => {
      if (p.holeCards === null) throw new Error(`buildHandHistory: seat ${p.seat} has no hole cards`);
      const who = names.get(p.seat);
      return {
        seat: p.seat,
        playerId: p.playerId,
        displayName: who?.displayName ?? '',
        publicId: who?.publicId ?? '',
        startingStack: p.startingStack,
        finalStack: p.stack,
        holeCards: copyCards(p.holeCards),
        folded: p.folded,
        won: p.won,
        uncalledReturned: p.uncalledReturned,
        shownCards: shown.get(p.seat) ?? null,
        busted: p.stack === 0,
      };
    }),
    board: [...hand.board],
    burns: [...hand.burns],
    actionLog: structuredClone(hand.actionLog),
    winType: result.winType,
    uncalled: result.uncalled === null ? null : { ...result.uncalled },
    pots: structuredClone(result.pots),
    reveals: structuredClone(result.reveals),
    totalPot: result.totalPot,
    busted: hand.players
      .filter((p) => p.stack === 0)
      .map((p) => ({ seat: p.seat, playerId: p.playerId, startingStack: p.startingStack })),
  };
}

/** Compact summary for the admin "recent hands" list. */
export function summarizeHand(h: HandHistoryRecord): TableHandSummary {
  const won = new Map<SeatIndex, { playerId: PlayerId; amount: number }>();
  for (const pot of h.pots) {
    for (const w of pot.winners) {
      const prev = won.get(w.seat);
      won.set(w.seat, { playerId: w.playerId, amount: (prev?.amount ?? 0) + w.amount });
    }
  }
  return {
    handId: h.handId,
    handNumber: h.handNumber,
    startedAt: h.startedAt,
    completedAt: h.completedAt,
    buttonSeat: h.buttonSeat,
    totalPot: h.totalPot,
    showdown: h.winType === 'SHOWDOWN',
    board: [...h.board],
    winners: [...won.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([seat, w]) => ({ seat, playerId: w.playerId, amount: w.amount })),
    busted: h.busted.map((b) => b.playerId),
  };
}

/** The full record of the last completed hand (a deep copy), or null before the first completion. */
export function lastHandHistory(state: TableState): HandHistoryRecord | null {
  return state.lastHand === null ? null : structuredClone(state.lastHand);
}

export interface FairnessRecordInput {
  /** Tournament public entropy frozen at START (fairness-engine computePublicEntropy). */
  publicEntropy: string;
  /** Published commitment of the server seed. */
  serverSeedHash: string;
}

/**
 * HandFairnessRecord (CONTRACTS §2) of a completed hand, built from what the
 * poker engine actually dealt (never re-derived from the deck). Defaults to
 * the last completed hand; a stored HandHistoryRecord may be passed instead.
 * Contains every dealt hole card: redact before publishing
 * (fairness-engine `redactHandFairnessRecord`).
 */
export function handFairnessRecord(
  state: TableState,
  input: FairnessRecordInput,
  history: HandHistoryRecord | null = state.lastHand,
): HandFairnessRecord | null {
  if (history === null) return null;
  const bySeat = new Map(history.players.map((p) => [p.seat, p]));
  return {
    scheme: FAIRNESS_SCHEME,
    tournamentId: history.tournamentId,
    tableId: history.tableId,
    handId: history.handId,
    handNumber: history.handNumber,
    publicEntropy: input.publicEntropy,
    serverSeedHash: input.serverSeedHash,
    deckHash: history.deckHash,
    maxSeats: history.maxSeats,
    buttonSeat: history.buttonSeat,
    holeCards: history.dealingOrder.map((seat) => {
      const p = bySeat.get(seat);
      if (p === undefined) throw new Error(`handFairnessRecord: seat ${seat} missing`);
      return { seat, playerId: p.playerId, cards: copyCards(p.holeCards) };
    }),
    board: [...history.board],
    burns: [...history.burns],
  };
}
