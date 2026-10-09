import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { PayoutRowDto } from '@jpb/shared-types';
import { filterPayouts, isBackward, isNoop, matches, nextStatus, parseFilters, tallyByStatus, validatePayment } from '../src/sections/payouts/model';
import { renderControlRoom } from './support/renderControlRoom';

const TIMEOUT = { timeout: 5000 };

const row = (over: Partial<PayoutRowDto> = {}): PayoutRowDto => ({
  entryId: 'ent_1',
  playerId: 'ply_1',
  publicId: 'JPN-AB12',
  displayName: 'Ana Costa',
  finishPosition: 3,
  tiedCount: 1,
  prizeMinor: 50_000,
  currency: 'INR',
  paymentStatus: 'UNPAID',
  paidAt: null,
  processedBy: null,
  paymentReference: null,
  ...over,
});

const dataRows = (table: HTMLElement) => within(table).getAllByRole('row').filter((r) => r.getAttribute('data-row') !== null);

async function openPayouts(path = '/t/trn_winter/payouts', as = 'director') {
  const r = renderControlRoom(path, { as });
  await screen.findByRole('heading', { name: /^Payouts$/, level: 2 }, TIMEOUT);
  return r;
}

describe('payouts display model', () => {
  it('walks the workflow UNPAID → PROCESSING → PAID', () => {
    expect(nextStatus('UNPAID')).toBe('PROCESSING');
    expect(nextStatus('PROCESSING')).toBe('PAID');
    expect(nextStatus('PAID')).toBeNull();
    expect(isBackward('PAID', 'PROCESSING')).toBe(true);
    expect(isBackward('UNPAID', 'PAID')).toBe(false);
  });

  it('requires a reference to mark paid and a note to move back', () => {
    expect(validatePayment({ status: 'PAID', reference: '  ', note: '' }, 'PROCESSING').reference).toMatch(/reference/);
    expect(validatePayment({ status: 'PAID', reference: 'UPI-1', note: '' }, 'PROCESSING')).toEqual({});
    expect(validatePayment({ status: 'PROCESSING', reference: '', note: '' }, 'UNPAID')).toEqual({});
    expect(validatePayment({ status: 'UNPAID', reference: '', note: '' }, 'PAID').note).toMatch(/audit log/);
    expect(validatePayment({ status: 'UNPAID', reference: '', note: 'Bank returned it' }, 'PAID')).toEqual({});
    expect(validatePayment({ status: 'PROCESSING', reference: 'x'.repeat(121), note: '' }, 'UNPAID').reference).toMatch(/120/);
    expect(isNoop(row(), { status: 'UNPAID', reference: '', note: '' })).toBe(true);
    expect(isNoop(row(), { status: 'UNPAID', reference: '', note: 'x' })).toBe(false);
  });

  it('filters by status and searches name, public id, reference or place', () => {
    const rows = [row(), row({ entryId: 'e2', displayName: 'Lena Silva', publicId: 'JPN-ZZ99', finishPosition: 1, paymentStatus: 'PAID', paymentReference: 'UPI-777' })];
    expect(matches(rows[0]!, 'ana')).toBe(true);
    expect(matches(rows[1]!, 'upi-777')).toBe(true);
    expect(matches(rows[0]!, '3rd')).toBe(true);
    expect(matches(rows[0]!, '#3')).toBe(true);
    expect(matches(rows[1]!, '3')).toBe(false);
    expect(filterPayouts(rows, { status: 'PAID', q: '' }).map((r) => r.entryId)).toEqual(['e2']);
    expect(tallyByStatus(rows)).toEqual({ UNPAID: { count: 1, amountMinor: 50_000 }, PROCESSING: { count: 0, amountMinor: 0 }, PAID: { count: 1, amountMinor: 50_000 } });
    expect(parseFilters(new URLSearchParams('status=HACKED&q=ana'))).toEqual({ status: '', q: 'ana' });
  });
});

describe('Payouts (§2.13)', { timeout: 20_000 }, () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:payouts');
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => vi.restoreAllMocks());

  it('shows totals (configured / awarded / paid / outstanding) and every prize with its status', async () => {
    const { mock } = await openPayouts();
    const t = mock.server.tournament('trn_winter');
    const totals = await screen.findByRole('region', { name: 'Payout totals' }, TIMEOUT);
    for (const label of ['Configured pool', 'Awarded', 'Paid', 'Outstanding']) expect(within(totals).getByText(label)).toBeTruthy();
    const pool = t.config.prizeStructure.places.reduce((a, p) => a + p.amountMinor, 0);
    expect(within(totals).getAllByText(`₹${(pool / 100).toLocaleString('en-IN')}`).length).toBeGreaterThan(0);
    const table = screen.getByRole('table', { name: 'Payouts' });
    const winners = t.players.filter((p) => p.prizeMinor > 0 && p.finishPosition !== null);
    expect(table.getAttribute('aria-rowcount')).toBe(String(winners.length + 1));
    const first = dataRows(table)[0]!;
    expect(within(first).getByText('1st')).toBeTruthy();
    expect(within(first).getByText('Paid')).toBeTruthy();
  });

  it('filters by payment status (URL) and searches by public id', async () => {
    const { router, mock } = await openPayouts();
    fireEvent.click(screen.getByRole('button', { name: /^Unpaid/ }));
    await waitFor(() => expect(router.state.location.search).toContain('status=UNPAID'), TIMEOUT);
    const unpaid = mock.server.tournament('trn_winter').players.filter((p) => p.prizeMinor > 0 && p.payment.status === 'UNPAID');
    await waitFor(() => expect(screen.getByRole('table', { name: 'Payouts' }).getAttribute('aria-rowcount')).toBe(String(unpaid.length + 1)), TIMEOUT);
    for (const r of dataRows(screen.getByRole('table', { name: 'Payouts' }))) expect(within(r).getByText('Unpaid')).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search payouts' }), { target: { value: unpaid[0]!.publicId } });
    await waitFor(() => expect(dataRows(screen.getByRole('table', { name: 'Payouts' }))).toHaveLength(1), TIMEOUT);
  });

  it('marks a prize as paid: reference required, one level-1 confirmation, audit entry', async () => {
    const { mock } = await openPayouts('/t/trn_winter/payouts?status=PROCESSING');
    const t = mock.server.tournament('trn_winter');
    const table = await screen.findByRole('table', { name: 'Payouts' }, TIMEOUT);
    const target = t.players.filter((p) => p.prizeMinor > 0 && p.payment.status === 'PROCESSING').sort((a, b) => a.finishPosition! - b.finishPosition!)[0]!;
    fireEvent.click(within(dataRows(table)[0]!).getByRole('button', { name: `Mark paid — ${target.displayName}` }));
    const panel = await screen.findByRole('complementary', { name: 'Payment details' }, TIMEOUT);
    await waitFor(() => expect(within(panel).getByText(new RegExp(target.displayName))).toBeTruthy(), TIMEOUT);
    expect((within(panel).getByRole('radio', { name: /^Paid/ }) as HTMLInputElement).checked).toBe(true);

    // Without a reference the form refuses (accounting needs it).
    fireEvent.click(within(panel).getByRole('button', { name: 'Mark as paid…' }));
    expect(await within(panel).findByText(/Enter the payment reference/, undefined, TIMEOUT)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.change(within(panel).getByRole('textbox', { name: /Payment reference/ }), { target: { value: 'UPI-424242' } });
    fireEvent.change(within(panel).getByRole('textbox', { name: /Note/ }), { target: { value: 'Paid at the desk' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Mark as paid…' }));
    const dialog = await screen.findByRole('dialog', undefined, TIMEOUT);
    expect(within(dialog).getByText(/Processing → Paid/)).toBeTruthy();
    expect(within(dialog).getByText(/UPI-424242/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mark as paid' }));

    await waitFor(() => expect(target.payment.status).toBe('PAID'), TIMEOUT);
    expect(target.payment.reference).toBe('UPI-424242');
    expect(target.payment.note).toBe('Paid at the desk');
    const audit = mock.server.world.audit.filter((e) => e.action === 'PAYMENT_UPDATED' && e.target === `entry:${target.entryId}`);
    expect(audit).toHaveLength(1);
    // The panel shows the server's new state and the audit history.
    await waitFor(() => expect(within(panel).getAllByText('UPI-424242').length).toBeGreaterThan(0), TIMEOUT);
    expect(await within(panel).findByRole('region', { name: 'Payment history' }, TIMEOUT)).toBeTruthy();
  });

  it('is read-only without PAYOUT_MANAGE (staff)', async () => {
    await openPayouts('/t/trn_winter/payouts', 'staff');
    const table = await screen.findByRole('table', { name: 'Payouts' }, TIMEOUT);
    expect(screen.getByText(/updating a payment status requires PAYOUT_MANAGE/)).toBeTruthy();
    expect(within(table).queryAllByRole('button', { name: /Mark paid|Start processing|Edit payment/ })).toHaveLength(0);
    fireEvent.click(dataRows(table)[0]!);
    const panel = await screen.findByRole('complementary', { name: 'Payment details' }, TIMEOUT);
    expect(within(panel).getByText(/Read-only/)).toBeTruthy();
    expect(within(panel).queryByRole('radio')).toBeNull();
  });

  it('explains when no prize has been awarded yet', async () => {
    await openPayouts('/t/trn_spring/payouts');
    expect(await screen.findByText('No prizes awarded yet', undefined, TIMEOUT)).toBeTruthy();
    expect(screen.getByText(/as players finish in the top 240 places/)).toBeTruthy();
  });

  it('exports the payouts CSV for accounting', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await openPayouts();
    await screen.findByRole('table', { name: 'Payouts' }, TIMEOUT);
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV for accounting' }));
    await waitFor(() => expect(click).toHaveBeenCalled(), TIMEOUT);
    expect(await screen.findByText('Downloaded payouts CSV', undefined, TIMEOUT)).toBeTruthy();
  });
});
