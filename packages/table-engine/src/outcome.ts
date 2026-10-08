import type { ActionRejectCode, CommandReply } from '@jpb/shared-types';

/** Result of a command handler. A rejection discards the working copy (state unchanged). */
export type Outcome = { ok: true; message: string | null } | { ok: false; code: ActionRejectCode; message: string };

export const accept = (message: string | null = null): Outcome => ({ ok: true, message });

export const reject = (code: ActionRejectCode, message: string): Outcome => ({ ok: false, code, message });

export function toReply(o: Outcome): CommandReply {
  return o.ok
    ? { ok: true, code: null, message: o.message, duplicate: false }
    : { ok: false, code: o.code, message: o.message, duplicate: false };
}
