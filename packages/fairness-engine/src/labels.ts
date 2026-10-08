import { DECK_PURPOSE, FIELD_SEPARATOR, LABEL_PREFIX, RESERVED_PURPOSES } from './constants';
import { assertNoProblem, handNumberProblem, labelFieldProblem, publicEntropyProblem } from './validate';

export interface DeckLabelParams {
  tournamentId: string;
  tableId: string;
  handNumber: number;
  publicEntropy: string;
}

export interface DrawLabelParams {
  tournamentId: string;
  purpose: string;
  publicEntropy: string;
}

/** Reason the deck-label inputs are unusable, or null. */
export function deckLabelProblem(p: DeckLabelParams): string | null {
  return (
    labelFieldProblem('tournamentId', p.tournamentId) ??
    labelFieldProblem('tableId', p.tableId) ??
    handNumberProblem(p.handNumber) ??
    publicEntropyProblem(p.publicEntropy)
  );
}

/**
 * Per-hand deck label (CONTRACTS §2):
 *   "JPB/v1/deck|{tournamentId}|{tableId}|{handNumber}|{publicEntropy}"
 * No field may contain "|", so distinct inputs always give distinct labels.
 */
export function deckLabel(p: DeckLabelParams): string {
  assertNoProblem(deckLabelProblem(p));
  return [`${LABEL_PREFIX}${DECK_PURPOSE}`, p.tournamentId, p.tableId, p.handNumber.toString(10), p.publicEntropy].join(
    FIELD_SEPARATOR,
  );
}

/**
 * Label of a non-deck draw (seating, final-table seat draw, button draws):
 *   "JPB/v1/{purpose}|{tournamentId}|{publicEntropy}"
 * Purposes are fixed strings such as "seating", "final-table", "button:{tableId}".
 * "deck" and "entropy" are reserved.
 */
export function drawLabel(p: DrawLabelParams): string {
  assertNoProblem(
    labelFieldProblem('purpose', p.purpose),
    RESERVED_PURPOSES.includes(p.purpose) ? `purpose "${p.purpose}" is reserved` : null,
    labelFieldProblem('tournamentId', p.tournamentId),
    publicEntropyProblem(p.publicEntropy),
  );
  return [`${LABEL_PREFIX}${p.purpose}`, p.tournamentId, p.publicEntropy].join(FIELD_SEPARATOR);
}
