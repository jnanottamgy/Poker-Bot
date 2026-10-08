import type { CardCode, HandFairnessRecord, SeatIndex } from '@jpb/shared-types';
import { BURNS_FOR_BOARD_SIZE, dealingOrder, deckHash, deriveDeck, expectedDeal } from '../src';

/**
 * GOLDEN HAND — computed once with the standalone node:crypto verifier in
 * examples/verify-hand.mjs (an implementation independent of src/), then
 * hardcoded. Also published in docs/FAIRNESS.md as a known-answer vector.
 */
export const GOLDEN = {
  serverSeed: '7f3a9c0e5b1d4f2a8c6e0b9d3f1a5c7e9b2d4f6a8c0e1b3d5f7a9c2e4b6d8f0a',
  serverSeedHash: '48e66cbb9b09867577226dc0c03aba3db47d6843b72132554aa5a13af3d6c680',
  clientSeeds: ['a1'.repeat(32), '0f'.repeat(32), 'c3'.repeat(32)],
  adminEntropy: 'Johnny night #1',
  publicEntropy: '5fec1ce0b3dcd68e5a0bfb474f6b67f110900e96cb5fab8fbda22ded4021a362',
  tournamentId: 'trn_golden',
  tableId: 'trn_golden:T1',
  handNumber: 7,
  label: 'JPB/v1/deck|trn_golden|trn_golden:T1|7|5fec1ce0b3dcd68e5a0bfb474f6b67f110900e96cb5fab8fbda22ded4021a362',
  deck: [
    'Jd',
    '4h',
    'Ah',
    '8c',
    '7d',
    'Js',
    '3c',
    'Kc',
    'Qd',
    '3s',
    'Ks',
    '9s',
    'Jh',
    '8s',
    '5h',
    '8h',
    'Ts',
    '3d',
    '3h',
    'Qc',
    'Td',
    '5s',
    '6d',
    '8d',
    'Tc',
    '6c',
    'Jc',
    '2h',
    '4d',
    'Kd',
    '7h',
    'Qh',
    '4s',
    '9c',
    'Ad',
    'Kh',
    '5d',
    '7s',
    'Ac',
    '6s',
    '7c',
    '2s',
    '2d',
    'Qs',
    'As',
    'Th',
    '2c',
    '5c',
    '9d',
    '6h',
    '9h',
    '4c',
  ] as CardCode[],
  deckHash: '09ee7e41b162866a5d58ae08e61d018d4e41fc068e6392c0b5f7d90655fe1c3d',
  /** maxSeats 6, button on seat 3, dealt-in seats 0, 2, 3, 5 → dealing order 5, 0, 2, 3. */
  maxSeats: 6,
  buttonSeat: 3,
  holeCards: [
    { seat: 5, playerId: 'ply_5', cards: ['Jd', '7d'] },
    { seat: 0, playerId: 'ply_0', cards: ['4h', 'Js'] },
    { seat: 2, playerId: 'ply_2', cards: ['Ah', '3c'] },
    { seat: 3, playerId: 'ply_3', cards: ['8c', 'Kc'] },
  ] as Array<{ seat: SeatIndex; playerId: string; cards: [CardCode, CardCode] }>,
  burns: ['Qd', 'Jh', '5h'] as CardCode[],
  board: ['3s', 'Ks', '9s', '8s', '8h'] as CardCode[],
  /** First three uint32 of drawSource('seating'). */
  seatingUint32: [402487111, 3894643950, 2508272878],
  /** publicEntropy of no client seeds and no admin entropy (preimage "JPB/v1/entropy||"). */
  emptyEntropy: '2ea095f8ad5537bb6f01630edeb3e42cb0b29ca54cdf2021416a3f374ce87486',
} as const;

export function goldenRecord(): HandFairnessRecord {
  return {
    scheme: 'JPB/v1',
    tournamentId: GOLDEN.tournamentId,
    tableId: GOLDEN.tableId,
    handId: `${GOLDEN.tableId}:${GOLDEN.handNumber}`,
    handNumber: GOLDEN.handNumber,
    publicEntropy: GOLDEN.publicEntropy,
    serverSeedHash: GOLDEN.serverSeedHash,
    deckHash: GOLDEN.deckHash,
    maxSeats: GOLDEN.maxSeats,
    buttonSeat: GOLDEN.buttonSeat,
    holeCards: GOLDEN.holeCards.map((h) => ({ seat: h.seat, playerId: h.playerId, cards: [h.cards[0], h.cards[1]] })),
    board: GOLDEN.board.slice(),
    burns: GOLDEN.burns.slice(),
  };
}

export interface HonestHandSpec {
  serverSeed: string;
  serverSeedHash: string;
  tournamentId: string;
  tableId: string;
  handNumber: number;
  publicEntropy: string;
  maxSeats: number;
  buttonSeat: SeatIndex;
  seats: SeatIndex[];
  /** 0, 3, 4 or 5. */
  boardSize: number;
}

/**
 * What an honest server would publish: deal the derived deck in the
 * normative order (test helper only — production records come from the
 * poker engine's actual events, never from re-deriving the deck).
 */
export function honestRecord(spec: HonestHandSpec): HandFairnessRecord {
  const deck = deriveDeck(spec);
  const deal = expectedDeal(deck, dealingOrder(spec.seats, spec.buttonSeat, spec.maxSeats));
  const burns = BURNS_FOR_BOARD_SIZE[spec.boardSize];
  if (burns === undefined) throw new Error(`bad board size ${spec.boardSize}`);
  return {
    scheme: 'JPB/v1',
    tournamentId: spec.tournamentId,
    tableId: spec.tableId,
    handId: `${spec.tableId}:${spec.handNumber}`,
    handNumber: spec.handNumber,
    publicEntropy: spec.publicEntropy,
    serverSeedHash: spec.serverSeedHash,
    deckHash: deckHash(deck),
    maxSeats: spec.maxSeats,
    buttonSeat: spec.buttonSeat,
    holeCards: deal.holeCards.map((h) => ({ seat: h.seat, playerId: `ply_${h.seat}`, cards: h.cards })),
    board: deal.board.slice(0, spec.boardSize),
    burns: deal.burns.slice(0, burns),
  };
}

/** A card that differs from `card` (deterministic). */
export function otherCard(card: CardCode): CardCode {
  return card === 'As' ? 'Ks' : 'As';
}
