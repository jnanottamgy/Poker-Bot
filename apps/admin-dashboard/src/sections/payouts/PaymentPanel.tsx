import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router';
import type { AuditEntryDto, PaymentStatus, PayoutRowDto } from '@jpb/shared-types';
import { Button, DescriptionList, EmptyState, Icon, IconButton, Panel, Skeleton, StatusPill, TextArea, TextField, cx, formatMoneyMinor, useToast } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import { qk } from '../../api/query/keys';
import { useQuery } from '../../api/query/useQuery';
import { sectionHref } from '../../app/sections';
import { usePermission } from '../../auth/permissions';
import { useDangerousAction } from '../../danger/DangerProvider';
import { formatDateTime } from '../../lib/time';
import { MAX_NOTE, MAX_REFERENCE, PAYMENT_META, PAYMENT_STATUSES, draftFor, hasErrors, isBackward, isNoop, placeLabel, validatePayment } from './model';
import type { PaymentDraft, PaymentErrors } from './model';

/** Payment changes shown in the history (the audit log keeps them all). */
const HISTORY_LIMIT = 20;

function Stepper({ status }: { status: PaymentStatus }) {
  const at = PAYMENT_STATUSES.indexOf(status);
  return (
    <ol className="acr-payouts-steps" aria-label={`Payment status: ${PAYMENT_META[status].label}`}>
      {PAYMENT_STATUSES.map((s, i) => (
        <li key={s} className={cx('acr-payouts-step', i < at && 'is-done', i === at && 'is-current')} aria-current={i === at ? 'step' : undefined}>
          <span className="acr-payouts-step__dot" aria-hidden="true">
            <Icon name={i < at ? 'check' : PAYMENT_META[s].icon} />
          </span>
          <span className="acr-payouts-step__label">{PAYMENT_META[s].label}</span>
        </li>
      ))}
    </ol>
  );
}

interface AuditPayment {
  status?: PaymentStatus;
  reference?: string | null;
  note?: string | null;
}

function History({ entryId, tournamentId }: { entryId: string; tournamentId: string }) {
  const api = useApi();
  const q = { tournamentId, action: 'PAYMENT_UPDATED', target: `entry:${entryId}`, limit: HISTORY_LIMIT };
  const history = useQuery(qk.audit(q), (s) => api.audit.list(q, s), { staleMs: 10_000 });
  const entries = (history.data?.entries ?? []).filter((e) => e.target === `entry:${entryId}`);
  return (
    <section className="acr-payouts-history" aria-label="Payment history">
      <h4 className="acr-payouts-subhead">
        <Icon name="file" /> Payment history <span className="acr-payouts-dim">(audit log)</span>
      </h4>
      {history.isLoading ? (
        <Skeleton lines={3} />
      ) : history.error && !history.data ? (
        <p className="acr-payouts-dim">The audit log could not be read right now.</p>
      ) : entries.length === 0 ? (
        <p className="acr-payouts-dim">No payment change recorded yet.</p>
      ) : (
        <ol className="acr-payouts-history__list">
          {entries.map((e: AuditEntryDto) => {
            const before = (e.beforeState ?? {}) as AuditPayment;
            const after = (e.afterState ?? {}) as AuditPayment;
            const note = e.reason ?? after.note ?? null;
            return (
              <li key={e.id}>
                <span className="acr-payouts-history__line">
                  {before.status ? PAYMENT_META[before.status]?.label ?? before.status : '—'} <Icon name="arrow-right" /> <strong>{after.status ? PAYMENT_META[after.status]?.label ?? after.status : '—'}</strong>
                  {after.reference ? <span className="jpb-mono acr-payouts-history__ref">{after.reference}</span> : null}
                </span>
                <span className="acr-payouts-history__meta">
                  {formatDateTime(e.at)} · {e.adminUsername}
                  {note ? <span className="acr-payouts-history__note"> · “{note}”</span> : null}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export interface PaymentPanelProps {
  tournamentId: string;
  row: PayoutRowDto | null;
  /** Status to pre-select (quick "Mark processing / paid" from the list); bump `seq` to re-apply. */
  preset: { entryId: string; status: PaymentStatus; seq: number } | null;
  onClose: () => void;
}

/**
 * Detail of one prize and the payment workflow UNPAID → PROCESSING → PAID.
 * The form collects the new status, reference and note; the change itself
 * goes through the level-1 confirmation (entryPayment) and the audit log.
 */
export function PaymentPanel({ tournamentId, row, preset, onClose }: PaymentPanelProps) {
  const api = useApi();
  const toast = useToast();
  const danger = useDangerousAction();
  const canManage = usePermission('PAYOUT_MANAGE');
  const canAudit = usePermission('AUDIT_VIEW');
  const id = useId();
  const referenceRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<PaymentDraft>(() => (row ? draftFor(row) : { status: 'UNPAID', reference: '', note: '' }));
  const [errors, setErrors] = useState<PaymentErrors>({});
  const [busy, setBusy] = useState(false);

  // A new row (or a fresh server value for it) resets the form.
  const rowKey = row ? `${row.entryId}|${row.paymentStatus}|${row.paymentReference ?? ''}` : '';
  useEffect(() => {
    if (row) setDraft(draftFor(row));
    setErrors({});
  }, [rowKey]);
  // A quick action from the list ("Mark paid") pre-selects the status once its row is shown
  // (the selection travels through the URL, so the row can arrive a render later).
  const appliedPreset = useRef(0);
  useEffect(() => {
    if (!row || !preset || preset.entryId !== row.entryId || appliedPreset.current === preset.seq) return;
    appliedPreset.current = preset.seq;
    setDraft({ ...draftFor(row), status: preset.status });
    setErrors({});
    if (preset.status === 'PAID') requestAnimationFrame(() => referenceRef.current?.focus());
  }, [preset?.seq, row?.entryId, rowKey]);

  if (!row) {
    return (
      <Panel title="Payment details" icon="file" className="acr-payouts-panel">
        <EmptyState compact icon="trophy" title="Select a prize" description="Click a row (or press Enter on it) to see its payment details and history, and to update its status." />
      </Panel>
    );
  }

  const money = formatMoneyMinor(row.prizeMinor, row.currency);
  const m = PAYMENT_META[row.paymentStatus];
  const noop = isNoop(row, draft);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs = validatePayment(draft, row.paymentStatus);
    setErrors(errs);
    if (hasErrors(errs) || noop || busy) return;
    const reference = draft.reference.trim();
    const note = draft.note.trim();
    const to = PAYMENT_META[draft.status].label;
    const changes = [
      row.paymentStatus === draft.status ? `Status stays ${m.label}` : `Status: ${m.label} → ${to}`,
      (row.paymentReference ?? '') === reference ? (reference ? `Reference unchanged (${reference})` : 'No payment reference') : `Reference: ${row.paymentReference ?? '—'} → ${reference || '—'}`,
      note ? `Note: “${note}”` : 'No note',
      'Recorded in the audit log under your name; players never see references or notes',
    ];
    setBusy(true);
    const result = await danger({
      level: 1,
      endpoint: 'entryPayment',
      title: draft.status === row.paymentStatus ? `Update payment of ${placeLabel(row.finishPosition, row.tiedCount)}` : `Mark ${placeLabel(row.finishPosition, row.tiedCount)} as ${to.toLowerCase()}`,
      summary: `${row.displayName} · ${row.publicId} · ${money}`,
      consequences: changes,
      confirmLabel: draft.status === 'PAID' ? 'Mark as paid' : draft.status === 'PROCESSING' ? 'Mark as processing' : 'Mark as unpaid',
      tone: isBackward(row.paymentStatus, draft.status) ? 'danger' : 'primary',
      run: () => api.payouts.updatePayment(row.entryId, { status: draft.status, reference: reference || null, note: note || null }),
      success: `${row.displayName}: ${to.toLowerCase()}`,
      invalidate: [qk.payouts(tournamentId), qk.report(tournamentId), qk.auditAll()],
    });
    setBusy(false);
    if (result) setDraft((d) => ({ ...d, note: '' }));
  };

  const copyRef = async () => {
    if (!row.paymentReference) return;
    try {
      await navigator.clipboard.writeText(row.paymentReference);
      toast.push({ tone: 'success', title: 'Reference copied' });
    } catch {
      toast.push({ tone: 'warning', title: 'Could not copy', description: 'Select the reference and copy it manually.' });
    }
  };

  return (
    <Panel
      title={
        <span className="acr-payouts-panel__title">
          <span className="jpb-num">{placeLabel(row.finishPosition, row.tiedCount)}</span> · {row.displayName}
        </span>
      }
      description={<span className="jpb-mono">{row.publicId}</span>}
      icon="trophy"
      className="acr-payouts-panel"
      actions={<IconButton icon="x" size="sm" label="Close payment details" onClick={onClose} />}
    >
      <div className="acr-payouts-panel__prize">
        <span className="acr-payouts-panel__amount jpb-num">{money}</span>
        <StatusPill tone={m.tone} icon={m.icon} label={m.label} title={m.hint} />
      </div>
      {row.tiedCount > 1 && (
        <p className="acr-payouts-panel__tie">
          <Icon name="split" /> Tied with {row.tiedCount - 1} other {row.tiedCount === 2 ? 'player' : 'players'}: the prizes of the places they cover are split equally.
        </p>
      )}
      <Stepper status={row.paymentStatus} />
      <DescriptionList
        columns={2}
        items={[
          { label: 'Processed by', value: row.processedBy ?? '—' },
          { label: 'Paid at', value: row.paidAt ? formatDateTime(row.paidAt) : '—' },
          {
            label: 'Payment reference',
            mono: true,
            value: row.paymentReference ? (
              <span className="acr-payouts-refcell">
                {row.paymentReference}
                <IconButton icon="layers" size="sm" label="Copy payment reference" onClick={() => void copyRef()} />
              </span>
            ) : (
              '—'
            ),
          },
          { label: 'Entry', value: row.entryId, mono: true },
        ]}
      />
      <p className="acr-payouts-panel__links">
        <Link className="acr-link" to={sectionHref('player-detail', tournamentId, { playerId: row.playerId })}>
          Open player detail <Icon name="arrow-right" />
        </Link>
      </p>

      {canManage ? (
        <form className="acr-payouts-form" onSubmit={(e) => void submit(e)} noValidate aria-labelledby={`${id}-form`}>
          <h4 className="acr-payouts-subhead" id={`${id}-form`}>
            <Icon name="sliders" /> Update payment
          </h4>
          <fieldset className="acr-payouts-radios">
            <legend className="jpb-sr-only">New payment status</legend>
            {PAYMENT_STATUSES.map((s) => (
              <label key={s} className={cx('acr-payouts-radio', draft.status === s && 'is-on', `is-${PAYMENT_META[s].tone}`)}>
                <input type="radio" name={`${id}-status`} value={s} checked={draft.status === s} onChange={() => setDraft((d) => ({ ...d, status: s }))} />
                <Icon name={PAYMENT_META[s].icon} />
                <span>
                  <strong>{PAYMENT_META[s].label}</strong>
                  <small>{PAYMENT_META[s].hint}</small>
                </span>
              </label>
            ))}
          </fieldset>
          <TextField
            ref={referenceRef}
            label="Payment reference"
            required={draft.status === 'PAID'}
            hint={draft.status === 'PAID' ? 'Bank or UPI transaction id — required to mark as paid.' : 'Optional until the prize is paid.'}
            value={draft.reference}
            maxLength={MAX_REFERENCE}
            error={errors.reference}
            onChange={(e) => setDraft((d) => ({ ...d, reference: e.target.value }))}
            autoComplete="off"
            spellCheck={false}
          />
          <TextArea
            label="Note"
            rows={2}
            hint={isBackward(row.paymentStatus, draft.status) ? 'Required when moving back. Recorded in the audit log; never shown to players.' : 'Optional. Recorded in the audit log; never shown to players.'}
            required={isBackward(row.paymentStatus, draft.status)}
            value={draft.note}
            maxLength={MAX_NOTE}
            error={errors.note}
            onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
          />
          <div className="acr-payouts-form__actions">
            <Button type="submit" variant={isBackward(row.paymentStatus, draft.status) ? 'danger-outline' : 'primary'} icon="check" disabled={noop} loading={busy} loadingLabel="Waiting for confirmation…">
              {noop ? 'No changes' : draft.status === row.paymentStatus ? 'Save reference…' : `Mark as ${PAYMENT_META[draft.status].label.toLowerCase()}…`}
            </Button>
            {!noop && (
              <Button variant="ghost" onClick={() => { setDraft(draftFor(row)); setErrors({}); }}>
                Reset
              </Button>
            )}
          </div>
        </form>
      ) : (
        <p className="acr-payouts-readonly">
          <Icon name="lock" /> Read-only. Changing a payment status requires PAYOUT_MANAGE.
        </p>
      )}

      {canAudit && <History entryId={row.entryId} tournamentId={tournamentId} />}
    </Panel>
  );
}
