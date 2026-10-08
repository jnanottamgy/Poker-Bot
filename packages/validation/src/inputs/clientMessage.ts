import { z } from 'zod';
import type { ClientMessage } from '@jpb/shared-types';
import { INPUT_LIMITS } from '../constants';
import { formatZodError, friendlyErrorMap } from '../errors';
import type { FormattedValidationError } from '../errors';
import { idSchema, intInRange } from '../primitives';
import { utf8ByteLength } from '../text';
import type { Assert, Extends } from '../typeAssert';
import { actionAmountSchema, actionIdSchema, actionTypeSchema, tableStateVersionSchema } from './action';

/**
 * WebSocket client frames (protocol.ts `ClientMessage`). Every frame is
 * size-checked, JSON-parsed and validated against strict schemas (unknown
 * keys are rejected so clients cannot smuggle fields).
 */

const seqSchema = intInRange(0);

export const resumeCursorSchema = z.strictObject({
  tableId: idSchema.nullable(),
  tableSeq: seqSchema,
  tournamentSeq: seqSchema,
});

export const clientAudienceSchema = z.enum(['PLAYER', 'SPECTATOR', 'ADMIN', 'DISPLAY']);

export const CLIENT_MESSAGE_TYPES = ['hello', 'action', 'takeover', 'ping', 'watch', 'snapshot_request'] as const;

export const clientMessageSchema = z.discriminatedUnion('t', [
  z.strictObject({
    t: z.literal('hello'),
    v: intInRange(1, INPUT_LIMITS.MAX_PROTOCOL_VERSION),
    audience: clientAudienceSchema,
    tournamentId: idSchema,
    resume: resumeCursorSchema.nullable(),
  }),
  z.strictObject({
    t: z.literal('action'),
    actionId: actionIdSchema,
    tableId: idSchema,
    type: actionTypeSchema,
    amount: actionAmountSchema.optional(),
    tableStateVersion: tableStateVersionSchema,
  }),
  z.strictObject({ t: z.literal('takeover') }),
  /** `ct` is echoed back in `pong`; fractional client clocks are accepted. */
  z.strictObject({ t: z.literal('ping'), ct: z.number().min(0).max(Number.MAX_SAFE_INTEGER) }),
  z.strictObject({ t: z.literal('watch'), tableId: idSchema.nullable() }),
  z.strictObject({ t: z.literal('snapshot_request') }),
]);

type _ClientMessageOutput = Assert<Extends<z.output<typeof clientMessageSchema>, ClientMessage>>;
type _ClientMessageInput = Assert<Extends<ClientMessage, z.input<typeof clientMessageSchema>>>;

export type ClientMessageErrorCode = 'FRAME_TOO_LARGE' | 'MALFORMED_JSON' | 'UNKNOWN_TYPE' | 'INVALID_MESSAGE';

export type ClientMessageParseResult =
  | { ok: true; message: ClientMessage }
  | { ok: false; code: ClientMessageErrorCode; message: string; error: FormattedValidationError | null };

export interface ClientMessageParseOptions {
  /** Maximum UTF-8 size of a frame. Default INPUT_LIMITS.CLIENT_MESSAGE_MAX_BYTES (4096). */
  maxBytes?: number;
}

const KNOWN_TYPES: ReadonlySet<string> = new Set(CLIENT_MESSAGE_TYPES);

function reject(code: ClientMessageErrorCode, message: string, error: FormattedValidationError | null = null): ClientMessageParseResult {
  return { ok: false, code, message, error };
}

/** Validates an already-decoded frame value. Never throws. */
export function validateClientMessage(data: unknown): ClientMessageParseResult {
  try {
    const t = typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as { t?: unknown }).t : undefined;
    if (typeof t !== 'string' || !KNOWN_TYPES.has(t)) return reject('UNKNOWN_TYPE', 'Unknown message type.');
    const parsed = clientMessageSchema.safeParse(data, { error: friendlyErrorMap });
    if (parsed.success) return { ok: true, message: parsed.data };
    const error = formatZodError(parsed.error);
    return reject('INVALID_MESSAGE', `Invalid "${t}" message: ${error.message}`, error);
  } catch {
    return reject('INVALID_MESSAGE', 'Invalid message.');
  }
}

/**
 * Parses one text frame: size limit (UTF-8 bytes) → JSON → schema.
 * Never throws; the result carries a machine code and a friendly message.
 */
export function parseClientMessage(raw: string, options: ClientMessageParseOptions = {}): ClientMessageParseResult {
  const maxBytes = options.maxBytes ?? INPUT_LIMITS.CLIENT_MESSAGE_MAX_BYTES;
  // UTF-8 never uses fewer bytes than UTF-16 code units, so long strings are rejected without scanning.
  if (typeof raw !== 'string' || raw.length > maxBytes || utf8ByteLength(raw) > maxBytes) {
    return reject('FRAME_TOO_LARGE', `Frames are limited to ${maxBytes} bytes.`);
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return reject('MALFORMED_JSON', 'Frame is not valid JSON.');
  }
  return validateClientMessage(data);
}
