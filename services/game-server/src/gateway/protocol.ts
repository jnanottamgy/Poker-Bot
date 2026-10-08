import { z } from 'zod';
import type { ClientMessage } from '@jpb/shared-types';

/**
 * Validation of client frames (protocol.ts `ClientMessage`). Every frame is
 * size-checked, JSON-parsed and validated against a strict schema before the
 * gateway looks at it; anything else becomes an error frame, never an
 * exception. Unknown keys are rejected so clients cannot smuggle fields.
 */
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:-]+$/);
const nonNegInt = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

const hello = z.strictObject({
  t: z.literal('hello'),
  v: z.number().int().min(0).max(1_000_000),
  audience: z.enum(['PLAYER', 'SPECTATOR', 'ADMIN', 'DISPLAY']),
  tournamentId: id,
  resume: z.strictObject({ tableId: id.nullable(), tableSeq: nonNegInt, tournamentSeq: nonNegInt }).nullable(),
});

const action = z.strictObject({
  t: z.literal('action'),
  actionId: z.string().min(1).max(64).regex(/^[A-Za-z0-9_.:-]+$/),
  tableId: id,
  type: z.enum(['FOLD', 'CHECK', 'CALL', 'BET', 'RAISE', 'ALL_IN']),
  amount: nonNegInt.optional(),
  tableStateVersion: nonNegInt,
});

const clientMessageSchema = z.discriminatedUnion('t', [
  hello,
  action,
  z.strictObject({ t: z.literal('takeover') }),
  z.strictObject({ t: z.literal('ping'), ct: z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER) }),
  z.strictObject({ t: z.literal('watch'), tableId: id.nullable() }),
  z.strictObject({ t: z.literal('snapshot_request') }),
]);

const KNOWN_TYPES = new Set<string>(['hello', 'action', 'takeover', 'ping', 'watch', 'snapshot_request']);

export type ParsedFrame =
  | { ok: true; message: ClientMessage }
  | { ok: false; code: 'FRAME_TOO_LARGE' | 'MALFORMED_JSON' | 'UNKNOWN_TYPE' | 'INVALID_MESSAGE'; message: string };

export function parseClientFrame(raw: string, maxBytes: number): ParsedFrame {
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
    return { ok: false, code: 'FRAME_TOO_LARGE', message: `Frames are limited to ${maxBytes} bytes.` };
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, code: 'MALFORMED_JSON', message: 'Frame is not valid JSON.' };
  }
  const t = typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as { t?: unknown }).t : undefined;
  if (typeof t !== 'string' || !KNOWN_TYPES.has(t)) {
    return { ok: false, code: 'UNKNOWN_TYPE', message: 'Unknown message type.' };
  }
  const parsed = clientMessageSchema.safeParse(data);
  if (!parsed.success) return { ok: false, code: 'INVALID_MESSAGE', message: `Invalid "${t}" message.` };
  return { ok: true, message: parsed.data as ClientMessage };
}
