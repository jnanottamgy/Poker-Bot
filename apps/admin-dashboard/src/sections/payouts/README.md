# Payouts (§2.13)

Prizes won, their payment workflow and the totals accounting needs.

- **Data:** `GET /tournaments/:id/payouts` (PAYOUT_VIEW), polled every 15 s and invalidated after
  every payment change. Money is always integer minor units formatted with `formatMoneyMinor`
  and the tournament currency.
- **Totals:** configured pool (paid places), awarded (winners so far, and what is still in
  play), paid (count of winners) and outstanding (unpaid · processing), plus a paid-of-awarded
  progress bar. All four figures are the server's `totals`; the counts per status come from
  the rows.
- **List:** virtualized (`../standings/VirtualGrid`), filters in the URL (`status`, `q`, and the
  selected `entry`): status chips with counts, search by name, public id, reference, processor or
  place ("3", "3rd", "#3"). Columns: place (+ `T×n` tie badge), player + public id, prize, status
  pill (icon + text), processed by + paid time, reference, quick next step.
- **Workflow UNPAID → PROCESSING → PAID** (`PaymentPanel.tsx`): select a row (click / Enter) to
  see the stepper, details (processed by, paid at, reference with copy, entry id), the form and
  the history. The form picks the new status, the payment reference and a note; then the change
  goes through `useDangerousAction` level 1 (`entryPayment`) with a before → after summary.
  UI rules (the server accepts more): PAID needs a reference (bank / UPI id) so the books
  reconcile; moving a status back needs a note. The note is sent as `note` and the server writes
  it to the audit log (`reason ?? note`). Quick buttons in the rows pre-select the next status.
- **History:** with AUDIT_VIEW, the panel lists every `PAYMENT_UPDATED` audit entry of the
  entry (who, when, before → after, reference, note).
- **Permissions:** without PAYOUT_MANAGE everything is read-only (no quick buttons, no form);
  without PAYOUT_VIEW the screen explains the restriction. Payment details are staff-only copy.
- **Export:** "Export CSV for accounting" downloads `payouts.csv` via the API client.
- On narrow layouts (≤ 1200 px) the payment panel sits under the list and is scrolled into view
  when a row is selected.

## Contract notes

1. `PayoutRowDto` has `paidAt` only: the time a prize was moved to PROCESSING is not available
   ("time not recorded"). Suggested: `processedAt: number | null`.
2. The payment note is not returned (it only lives in the audit log). Suggested:
   `paymentNote: string | null` on `PayoutRowDto`.
3. `GET /payouts` returns every prize row unpaginated. At 1,000,000 players with 12 % paid this
   is 120,000 rows in one response; the UI virtualizes and filters client-side. Suggested:
   `status`, `q`, `offset`, `limit` on the endpoint and per-status totals in the response.
4. The server accepts PAID without a reference and backward moves without a note; the UI
   enforces both for accounting. Server-side enforcement would make the rule authoritative.
