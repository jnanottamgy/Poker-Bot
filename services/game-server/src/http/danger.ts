import { z } from 'zod';
import { badRequest } from './errors';

/**
 * Danger level 2 (docs/ADMIN_CONTROL_ROOM.md §4): the request must carry a
 * reason and the exact confirmation word shown in the UI's double-confirm
 * dialog. The server enforces it so scripts cannot skip the safeguard.
 */
export const CONFIRM_WORDS = {
  FREEZE: 'FREEZE',
  CANCEL: 'CANCEL',
  LEVEL: 'LEVEL',
  BREAK: 'BREAK',
  REVEAL: 'REVEAL',
  RESTORE: 'RESTORE',
  DISQUALIFY: 'DISQUALIFY',
  ADJUST: 'ADJUST',
  REVOKE: 'REVOKE',
  EDIT: 'EDIT',
  USER: 'USER',
} as const;

export type ConfirmWord = keyof typeof CONFIRM_WORDS;

const reasonSchema = z.string().trim().min(3, 'A reason of at least 3 characters is required.').max(500);

export function requireReason(body: unknown): string {
  const r = reasonSchema.safeParse((body as { reason?: unknown } | null)?.reason);
  if (!r.success) throw badRequest('REASON_REQUIRED', 'Please enter a reason (at least 3 characters).');
  return r.data;
}

export function optionalReason(body: unknown): string | null {
  const raw = (body as { reason?: unknown } | null)?.reason;
  if (raw === undefined || raw === null || raw === '') return null;
  return requireReason(body);
}

/** Level 2: reason + typed confirmation word. Returns the reason. */
export function requireDangerConfirmation(body: unknown, word: ConfirmWord): string {
  const reason = requireReason(body);
  const confirm = (body as { confirm?: unknown } | null)?.confirm;
  if (confirm !== CONFIRM_WORDS[word]) {
    throw badRequest('CONFIRMATION_REQUIRED', `Type ${CONFIRM_WORDS[word]} to confirm this action.`, { confirmWord: CONFIRM_WORDS[word] });
  }
  return reason;
}
