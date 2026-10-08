/**
 * Independent verification of one hand against the revealed server seed.
 *
 * Total function: never throws on untrusted input; every problem becomes a
 * FAILED (or NOT_AVAILABLE) check with a fixed-template explanation. Nothing
 * is reported VERIFIED unless it was recomputed here from the revealed seed.
 */
import type { HmacSha256Fn } from '@jpb/randomness';
import { FAIRNESS_SCHEME, TABLE_SIZE_LIMITS } from '@jpb/shared-types';
import type {
  CardCode,
  DerivedDeal,
  DerivedHandCards,
  FairnessCheckId,
  FairnessCheckResult,
  FairnessMismatch,
  FairnessOverallStatus,
  HandFairnessRecord,
  HandVerificationResult,
  SeatIndex,
} from '@jpb/shared-types';
import { commitmentFor } from './commitment';
import { BURNS_FOR_BOARD_SIZE } from './constants';
import { dealingOrder, expectedDeal } from './dealing';
import { deckHash, deriveDeck } from './deck';
import { deckLabel, deckLabelProblem } from './labels';
import { recordShapeProblems } from './record';
import { digestProblem, serverSeedProblem } from './validate';

export interface VerifyOptions {
  /** Faster byte-identical HMAC-SHA256 (e.g. node:crypto). Defaults to the portable pure-JS implementation. */
  hmac?: HmacSha256Fn;
}

const BOARD_ITEM_NAMES = ['flop card 1', 'flop card 2', 'flop card 3', 'turn', 'river'] as const;
const BURN_ITEM_NAMES = ['burn 1 (before the flop)', 'burn 2 (before the turn)', 'burn 3 (before the river)'] as const;

const TEXT = {
  seedNotRevealed:
    'The server seed has not been revealed yet; it is revealed after the tournament is completed or cancelled.',
  needsSeed: 'Requires the revealed server seed.',
  needsCommitment:
    'Not checked: the revealed seed does not match the published commitment, so cards derived from it prove nothing.',
  noDeck: 'Not checked: no deck could be derived from this record.',
} as const;

function result(
  check: FairnessCheckId,
  status: FairnessCheckResult['status'],
  detail: string,
  mismatches: FairnessMismatch[] = [],
): FairnessCheckResult {
  return { check, status, detail, mismatches };
}

function overallStatus(checks: readonly FairnessCheckResult[]): FairnessOverallStatus {
  if (checks.some((c) => c.status === 'FAILED')) return 'FAILED';
  return checks.every((c) => c.status === 'VERIFIED') ? 'VERIFIED' : 'INCOMPLETE';
}

function idsOf(record: unknown): Pick<HandVerificationResult, 'tournamentId' | 'tableId' | 'handId' | 'handNumber'> {
  const r = (typeof record === 'object' && record !== null ? record : {}) as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  return {
    tournamentId: str(r.tournamentId),
    tableId: str(r.tableId),
    handId: str(r.handId),
    handNumber: typeof r.handNumber === 'number' ? r.handNumber : null,
  };
}

function finish(
  record: unknown,
  checks: [FairnessCheckResult, FairnessCheckResult, FairnessCheckResult, FairnessCheckResult],
  withheldSeats: SeatIndex[],
  derived: DerivedHandCards | null,
): HandVerificationResult {
  return { ...idsOf(record), status: overallStatus(checks), checks, withheldSeats, derived };
}

function checkCommitment(record: HandFairnessRecord, seed: string | null): FairnessCheckResult {
  if (seed === null) return result('SEED_COMMITMENT', 'NOT_AVAILABLE', TEXT.seedNotRevealed);
  if (serverSeedProblem(seed) !== null) {
    return result('SEED_COMMITMENT', 'FAILED', 'The revealed server seed is not 64 hexadecimal characters (32 bytes).');
  }
  if (digestProblem('serverSeedHash', record.serverSeedHash) !== null) {
    return result('SEED_COMMITMENT', 'FAILED', 'The published commitment is not a SHA-256 hex digest.');
  }
  const derived = commitmentFor(seed);
  if (derived === record.serverSeedHash.toLowerCase()) {
    return result('SEED_COMMITMENT', 'VERIFIED', 'SHA-256 of the revealed seed bytes equals the published commitment.');
  }
  return result(
    'SEED_COMMITMENT',
    'FAILED',
    'SHA-256 of the revealed seed bytes does not equal the published commitment.',
    [{ item: 'seed commitment', published: record.serverSeedHash, derived }],
  );
}

function checkDeckHash(published: string, derived: string): FairnessCheckResult {
  if (digestProblem('deckHash', published) !== null) {
    return result('DECK_HASH', 'FAILED', 'The published deck hash is not a SHA-256 hex digest.');
  }
  if (published.toLowerCase() === derived) {
    return result(
      'DECK_HASH',
      'VERIFIED',
      'The published deck hash equals SHA-256 of the deck derived from the revealed seed.',
    );
  }
  return result(
    'DECK_HASH',
    'FAILED',
    'The published deck hash differs from SHA-256 of the deck derived from the revealed seed.',
    [{ item: 'deck hash', published, derived }],
  );
}

/** Reason the dealt-in seat list cannot define a dealing order, or null. */
function seatListProblem(record: HandFairnessRecord): string | null {
  const { maxSeats, buttonSeat, holeCards } = record;
  const minSeats = TABLE_SIZE_LIMITS.MIN_PLAYERS_PER_TABLE;
  const maxAllowed = TABLE_SIZE_LIMITS.ABSOLUTE_MAX_SEATS;
  if (!Number.isSafeInteger(maxSeats) || maxSeats < minSeats || maxSeats > maxAllowed)
    return `maxSeats must be an integer in [${minSeats}, ${maxAllowed}]`;
  const inRange = (s: number): boolean => Number.isSafeInteger(s) && s >= 0 && s < maxSeats;
  if (!inRange(buttonSeat)) return 'buttonSeat must be a seat index in [0, maxSeats)';
  if (holeCards.length < minSeats || holeCards.length > maxSeats)
    return `a hand has between ${minSeats} and maxSeats dealt-in seats`;
  if (!holeCards.every((h) => inRange(h.seat))) return 'every dealt-in seat must be a seat index in [0, maxSeats)';
  if (new Set(holeCards.map((h) => h.seat)).size !== holeCards.length) return 'a seat is listed more than once';
  if (holeCards.some((h) => h.playerId.length === 0)) return 'every dealt-in seat needs a playerId';
  if (new Set(holeCards.map((h) => h.playerId)).size !== holeCards.length)
    return 'a player is listed in more than one seat';
  return null;
}

function checkHoleCards(record: HandFairnessRecord, deal: DerivedDeal): FairnessCheckResult {
  const published = new Map(record.holeCards.map((h) => [h.seat, h.cards]));
  const mismatches: FairnessMismatch[] = [];
  const verified: SeatIndex[] = [];
  const withheld: SeatIndex[] = [];
  for (const { seat, cards: expected } of deal.holeCards) {
    const cards = published.get(seat) ?? null;
    if (cards === null) {
      withheld.push(seat);
      continue;
    }
    verified.push(seat);
    expected.forEach((card, i) => {
      if (cards[i] !== card)
        mismatches.push({ item: `seat ${seat} hole card ${i + 1}`, published: String(cards[i]), derived: card });
    });
  }
  if (mismatches.length > 0) {
    return result(
      'HOLE_CARDS',
      'FAILED',
      `${mismatches.length} published hole card(s) differ from their positions in the derived deck.`,
      mismatches,
    );
  }
  if (verified.length === 0)
    return result(
      'HOLE_CARDS',
      'NOT_AVAILABLE',
      'All hole cards were withheld by the publisher; none could be checked.',
    );
  const withheldText =
    withheld.length > 0 ? `; ${withheld.length} seat(s) withheld and not checked (seat ${withheld.join(', ')})` : '';
  return result(
    'HOLE_CARDS',
    'VERIFIED',
    `Hole cards of ${verified.length} seat(s) match their dealing positions in the derived deck${withheldText}.`,
  );
}

function compareCards(
  published: readonly string[],
  derived: readonly CardCode[],
  names: readonly string[],
): FairnessMismatch[] {
  const out: FairnessMismatch[] = [];
  published.forEach((card, i) => {
    if (card !== derived[i])
      out.push({ item: names[i] ?? `card ${i + 1}`, published: card, derived: derived[i] as CardCode });
  });
  return out;
}

function checkBoard(record: HandFairnessRecord, deal: DerivedDeal): FairnessCheckResult {
  const size = record.board.length;
  const burnsExpected = BURNS_FOR_BOARD_SIZE[size];
  if (burnsExpected === undefined)
    return result('BOARD', 'FAILED', `The board has ${size} card(s); a dealt board has 0, 3, 4 or 5.`);
  if (record.burns !== null && record.burns.length !== burnsExpected) {
    return result(
      'BOARD',
      'FAILED',
      `${record.burns.length} burn card(s) published for a ${size}-card board; expected ${burnsExpected}.`,
    );
  }
  const mismatches = [
    ...compareCards(record.board, deal.board, BOARD_ITEM_NAMES),
    ...(record.burns === null ? [] : compareCards(record.burns, deal.burns, BURN_ITEM_NAMES)),
  ];
  if (mismatches.length > 0) {
    return result(
      'BOARD',
      'FAILED',
      `${mismatches.length} published community/burn card(s) differ from their positions in the derived deck.`,
      mismatches,
    );
  }
  if (size === 0) {
    const burnText = record.burns === null ? ' Burn cards withheld.' : '';
    return result(
      'BOARD',
      'VERIFIED',
      `No community cards were dealt (the hand ended before the flop); nothing differs.${burnText}`,
    );
  }
  const burnText =
    record.burns === null ? 'burn cards withheld and not checked' : `as do the ${burnsExpected} burn card(s)`;
  return result(
    'BOARD',
    'VERIFIED',
    `All ${size} community card(s) match their dealing positions in the derived deck; ${burnText}.`,
  );
}

/**
 * Verifies one hand. `revealedServerSeed` is null while the seed is still
 * secret (everything is then NOT_AVAILABLE). Checks, always in this order:
 *
 * - SEED_COMMITMENT: SHA-256(seed bytes) == record.serverSeedHash.
 * - DECK_HASH:  deckHash(deriveDeck(seed, record ids, publicEntropy)) == record.deckHash.
 * - HOLE_CARDS: each published (non-withheld) seat's cards == its dealing positions.
 * - BOARD:      published board and burns == their dealing positions (0/3/4/5 board cards).
 *
 * If the commitment is not VERIFIED, the other checks are NOT_AVAILABLE: a
 * deck derived from an uncommitted seed proves nothing.
 */
export function verifyHand(
  record: HandFairnessRecord,
  revealedServerSeed: string | null,
  opts: VerifyOptions = {},
): HandVerificationResult {
  const shape = recordShapeProblems(record);
  if (shape.length > 0) {
    const detail = `The record is malformed: ${shape[0]}.`;
    return finish(
      record,
      [
        result('SEED_COMMITMENT', 'FAILED', detail),
        result('DECK_HASH', 'FAILED', detail),
        result('HOLE_CARDS', 'FAILED', detail),
        result('BOARD', 'FAILED', detail),
      ],
      [],
      null,
    );
  }
  const withheldSeats = record.holeCards.filter((h) => h.cards === null).map((h) => h.seat);
  if (record.scheme !== FAIRNESS_SCHEME) {
    const detail = `Unsupported fairness scheme "${record.scheme}"; this verifier implements ${FAIRNESS_SCHEME}.`;
    return finish(
      record,
      [
        result('SEED_COMMITMENT', 'NOT_AVAILABLE', detail),
        result('DECK_HASH', 'NOT_AVAILABLE', detail),
        result('HOLE_CARDS', 'NOT_AVAILABLE', detail),
        result('BOARD', 'NOT_AVAILABLE', detail),
      ],
      withheldSeats,
      null,
    );
  }

  const commitment = checkCommitment(record, revealedServerSeed);
  if (commitment.status !== 'VERIFIED') {
    const why = revealedServerSeed === null ? TEXT.needsSeed : TEXT.needsCommitment;
    return finish(
      record,
      [
        commitment,
        result('DECK_HASH', 'NOT_AVAILABLE', why),
        result('HOLE_CARDS', 'NOT_AVAILABLE', why),
        result('BOARD', 'NOT_AVAILABLE', why),
      ],
      withheldSeats,
      null,
    );
  }
  const seed = revealedServerSeed as string;

  const labelProblem = deckLabelProblem(record);
  if (labelProblem !== null) {
    const deckCheck = result('DECK_HASH', 'FAILED', `No deck can be derived from this record: ${labelProblem}.`);
    return finish(
      record,
      [
        commitment,
        deckCheck,
        result('HOLE_CARDS', 'NOT_AVAILABLE', TEXT.noDeck),
        result('BOARD', 'NOT_AVAILABLE', TEXT.noDeck),
      ],
      withheldSeats,
      null,
    );
  }
  const deck = deriveDeck(
    {
      serverSeed: seed,
      tournamentId: record.tournamentId,
      tableId: record.tableId,
      handNumber: record.handNumber,
      publicEntropy: record.publicEntropy,
    },
    opts.hmac,
  );
  const derivedHash = deckHash(deck);
  const deckCheck = checkDeckHash(record.deckHash, derivedHash);

  const seatProblem = seatListProblem(record);
  const deal =
    seatProblem === null
      ? expectedDeal(
          deck,
          dealingOrder(
            record.holeCards.map((h) => h.seat),
            record.buttonSeat,
            record.maxSeats,
          ),
        )
      : null;
  const holeCheck = deal
    ? checkHoleCards(record, deal)
    : result('HOLE_CARDS', 'FAILED', `The dealt-in seat list is invalid: ${seatProblem}.`);
  const boardCheck = deal
    ? checkBoard(record, deal)
    : result('BOARD', 'FAILED', `The dealt-in seat list is invalid (board positions depend on it): ${seatProblem}.`);

  const derived: DerivedHandCards = { label: deckLabel(record), deck, deckHash: derivedHash, deal };
  return finish(record, [commitment, deckCheck, holeCheck, boardCheck], withheldSeats, derived);
}
