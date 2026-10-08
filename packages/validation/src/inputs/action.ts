import { z } from 'zod';
import type { ActionType, PlayerActionRequest } from '@jpb/shared-types';
import { validateWith } from '../errors';
import type { ValidationResult } from '../errors';
import { chipsSchema, intInRange } from '../primitives';
import type { Assert, Equals, Extends } from '../typeAssert';

/**
 * Player action request (REST body and WebSocket `action` frame). This is
 * SYNTACTIC validation only: amount ranges, turn order and legality are the
 * poker/table engine's job (a 999999999 raise passes here and is rejected
 * there with AMOUNT_ABOVE_MAXIMUM).
 */

export const ACTION_TYPES = ['FOLD', 'CHECK', 'CALL', 'BET', 'RAISE', 'ALL_IN'] as const;
type _ActionTypesExact = Assert<Equals<(typeof ACTION_TYPES)[number], ActionType>>;

/** Client-generated idempotency key: 8–64 of A–Z a–z 0–9 _ -. */
export const ACTION_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export const actionIdSchema = z.string().regex(ACTION_ID_PATTERN, {
  error: 'The action id must be 8–64 characters of A–Z, a–z, 0–9, "_" or "-".',
});

export const actionTypeSchema = z.enum(ACTION_TYPES);

/** "Bet to" / "raise to" total: a non-negative safe integer when present. */
export const actionAmountSchema = chipsSchema;

/** The table's turn version the client acted on (STALE_STATE_VERSION check happens in the engine). */
export const tableStateVersionSchema = intInRange(0);

export const playerActionRequestSchema = z.strictObject({
  actionId: actionIdSchema,
  type: actionTypeSchema,
  amount: actionAmountSchema.optional(),
  tableStateVersion: tableStateVersionSchema,
});

type _ActionOutput = Assert<Extends<z.output<typeof playerActionRequestSchema>, PlayerActionRequest>>;
type _ActionInput = Assert<Extends<PlayerActionRequest, z.input<typeof playerActionRequestSchema>>>;

/** Validates a REST action body. Never throws. */
export function validatePlayerActionRequest(input: unknown): ValidationResult<PlayerActionRequest> {
  return validateWith(playerActionRequestSchema, input);
}
