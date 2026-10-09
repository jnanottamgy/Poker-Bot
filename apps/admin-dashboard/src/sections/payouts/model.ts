import type { PaymentStatus, PayoutRowDto } from '@jpb/shared-types';
import type { IconName, Tone } from '@jpb/ui';
import { formatOrdinal } from '@jpb/ui';

/**
 * Display model of §2.13 Payouts. Prizes, positions and ties come from the
 * server; this module only labels them, filters the list and validates the
 * payment form (the server re-validates everything).
 */

export const PAYMENT_STATUSES: readonly PaymentStatus[] = ['UNPAID', 'PROCESSING', 'PAID'];

export const PAYMENT_META: Readonly<Record<PaymentStatus, { label: string; tone: Tone; icon: IconName; hint: string }>> = {
  UNPAID: { label: 'Unpaid', tone: 'warning', icon: 'clock', hint: 'Prize won, payment not started' },
  PROCESSING: { label: 'Processing', tone: 'info', icon: 'refresh', hint: 'Payment initiated, waiting for confirmation' },
  PAID: { label: 'Paid', tone: 'positive', icon: 'check-circle', hint: 'Payment confirmed with a reference' },
};

/** The forward step of the workflow UNPAID → PROCESSING → PAID (null once paid). */
export function nextStatus(s: PaymentStatus): PaymentStatus | null {
  if (s === 'UNPAID') return 'PROCESSING';
  if (s === 'PROCESSING') return 'PAID';
  return null;
}

/** Longest reference / note the server accepts (zod max in the payment route). */
export const MAX_REFERENCE = 120;
export const MAX_NOTE = 500;

export interface PaymentDraft {
  status: PaymentStatus;
  reference: string;
  note: string;
}

export interface PaymentErrors {
  status?: string;
  reference?: string;
  note?: string;
}

/**
 * Accounting rules of the form: marking a prize PAID needs the payment
 * reference (bank / UPI transaction id) so the books reconcile; moving a
 * prize back needs a note explaining why (it is written to the audit log).
 */
export function validatePayment(draft: PaymentDraft, current: PaymentStatus): PaymentErrors {
  const e: PaymentErrors = {};
  const reference = draft.reference.trim();
  const note = draft.note.trim();
  if (draft.status === 'PAID' && reference === '') e.reference = 'Enter the payment reference (bank or UPI transaction id).';
  if (reference.length > MAX_REFERENCE) e.reference = `Keep the reference under ${MAX_REFERENCE} characters.`;
  if (note.length > MAX_NOTE) e.note = `Keep the note under ${MAX_NOTE} characters.`;
  if (isBackward(current, draft.status) && note === '') e.note = 'Explain why the status goes back (recorded in the audit log).';
  return e;
}

export function isBackward(from: PaymentStatus, to: PaymentStatus): boolean {
  return PAYMENT_STATUSES.indexOf(to) < PAYMENT_STATUSES.indexOf(from);
}

export function hasErrors(e: PaymentErrors): boolean {
  return Object.keys(e).length > 0;
}

/** True when submitting would change nothing on the server. */
export function isNoop(row: Pick<PayoutRowDto, 'paymentStatus' | 'paymentReference'>, draft: PaymentDraft): boolean {
  return row.paymentStatus === draft.status && (row.paymentReference ?? '') === draft.reference.trim() && draft.note.trim() === '';
}

export function draftFor(row: Pick<PayoutRowDto, 'paymentStatus' | 'paymentReference'>, status?: PaymentStatus): PaymentDraft {
  return { status: status ?? row.paymentStatus, reference: row.paymentReference ?? '', note: '' };
}

// ---------------------------------------------------------------- filters

export type StatusFilter = PaymentStatus | '';

export interface PayoutFilters {
  status: StatusFilter;
  q: string;
}

export const MAX_SEARCH = 80;

export function parseFilters(p: URLSearchParams): PayoutFilters {
  const s = p.get('status') ?? '';
  return { status: (PAYMENT_STATUSES as readonly string[]).includes(s) ? (s as PaymentStatus) : '', q: (p.get('q') ?? '').slice(0, MAX_SEARCH) };
}

/** Name, public id, reference or exact place ("3", "3rd", "#3"). Case-insensitive. */
export function matches(row: PayoutRowDto, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const place = needle.replace(/^#/, '').replace(/(st|nd|rd|th)$/, '');
  if (/^\d+$/.test(place)) return row.finishPosition === Number(place);
  return row.displayName.toLowerCase().includes(needle) || row.publicId.toLowerCase().includes(needle) || (row.paymentReference ?? '').toLowerCase().includes(needle) || (row.processedBy ?? '').toLowerCase().includes(needle);
}

export function filterPayouts(rows: readonly PayoutRowDto[], f: PayoutFilters): PayoutRowDto[] {
  return rows.filter((r) => (f.status === '' || r.paymentStatus === f.status) && matches(r, f.q));
}

export interface StatusTally {
  count: number;
  amountMinor: number;
}

export function tallyByStatus(rows: readonly PayoutRowDto[]): Record<PaymentStatus, StatusTally> {
  const t: Record<PaymentStatus, StatusTally> = { UNPAID: { count: 0, amountMinor: 0 }, PROCESSING: { count: 0, amountMinor: 0 }, PAID: { count: 0, amountMinor: 0 } };
  for (const r of rows) {
    t[r.paymentStatus].count += 1;
    t[r.paymentStatus].amountMinor += r.prizeMinor;
  }
  return t;
}

export function placeLabel(position: number, tiedCount: number): string {
  return tiedCount > 1 ? `${formatOrdinal(position)} (tied ×${tiedCount})` : formatOrdinal(position);
}
