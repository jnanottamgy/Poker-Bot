import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from './Button';
import { Icon } from './Icon';
import { Modal } from './Modal';

export interface PreviewRow {
  label: string;
  before: ReactNode;
  after: ReactNode;
}

export interface ConfirmDialogProps {
  open: boolean;
  /** e.g. "Cancel tournament". */
  title: string;
  /** One-line summary of what happens. */
  summary?: ReactNode;
  /** Bullet list of consequences ("All 1,204 players are removed from tables", ...). */
  consequences?: ReactNode[];
  /** Before -> after preview rows. */
  preview?: PreviewRow[];
  /** Word the operator must type exactly (case-sensitive). Default "CONFIRM". */
  confirmWord?: string;
  /** Minimum reason length after trimming. Default 8. The reason is sent to the audit log. */
  minReasonLength?: number;
  /** Confirm button text. Default = title. */
  confirmLabel?: string;
  /** Request in flight: confirm shows "Submitting…", inputs locked. */
  pending?: boolean;
  /** Server-side failure text (friendly). */
  error?: ReactNode;
  /** 'danger' (default) or 'warning' styling. */
  severity?: 'danger' | 'warning';
  /** `requestId` is unique per opening of the dialog: send it as an idempotency key. */
  onConfirm: (input: { reason: string; requestId: string }) => void;
  onCancel: () => void;
  inline?: boolean;
}

/**
 * DOUBLE CONFIRMATION for dangerous admin operations (spec §146): the
 * operator opens the dialog (first confirmation), then must type the
 * confirmation word AND give a reason (second confirmation). The confirm
 * button stays disabled until both are valid; Enter cannot bypass it.
 */
export function ConfirmDialog({
  open,
  title,
  summary,
  consequences,
  preview,
  confirmWord = 'CONFIRM',
  minReasonLength = 8,
  confirmLabel,
  pending = false,
  error,
  severity = 'danger',
  onConfirm,
  onCancel,
  inline,
}: ConfirmDialogProps) {
  const id = useId();
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');
  const wordRef = useRef<HTMLInputElement>(null);
  // Synchronous lock: a double click (or Enter then click) must not send twice
  // even before the parent flips `pending`.
  const sentRef = useRef(false);
  const openCount = useRef(0);
  const prevPending = useRef(pending);

  useEffect(() => {
    if (open) {
      openCount.current += 1;
      setTyped('');
      setReason('');
    }
    sentRef.current = false;
  }, [open]);
  useEffect(() => {
    if (error) sentRef.current = false;
  }, [error]);
  useEffect(() => {
    if (prevPending.current && !pending) sentRef.current = false;
    prevPending.current = pending;
  }, [pending]);

  const wordOk = typed === confirmWord;
  const reasonOk = reason.trim().length >= minReasonLength;
  const canConfirm = wordOk && reasonOk && !pending;

  const submit = (): void => {
    if (!canConfirm || sentRef.current) return;
    sentRef.current = true;
    onConfirm({ reason: reason.trim(), requestId: `${id}-${openCount.current}` });
  };

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={
        <span className="jpb-confirm__title">
          <Icon name={severity === 'danger' ? 'critical' : 'warning'} /> {title}
        </span>
      }
      description={summary}
      tone="danger"
      size="md"
      dismissible={!pending}
      initialFocusRef={wordRef}
      inline={inline}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={pending}>
            Keep as is
          </Button>
          <Button variant={severity === 'danger' ? 'danger' : 'secondary'} onClick={submit} disabled={!canConfirm} loading={pending} icon="shield">
            {confirmLabel ?? title}
          </Button>
        </>
      }
    >
      <form
        className="jpb-confirm"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {consequences && consequences.length > 0 && (
          <div className="jpb-confirm__section">
            <h3 className="jpb-confirm__h">What will happen</h3>
            <ul className="jpb-confirm__list">
              {consequences.map((c, i) => (
                <li key={i}>
                  <Icon name="arrow-right" /> <span>{c}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {preview && preview.length > 0 && (
          <div className="jpb-confirm__section">
            <h3 className="jpb-confirm__h">Before → after</h3>
            <table className="jpb-confirm__preview">
              <thead>
                <tr>
                  <th scope="col">Field</th>
                  <th scope="col">Before</th>
                  <th scope="col">After</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((r) => (
                  <tr key={r.label}>
                    <th scope="row">{r.label}</th>
                    <td className="jpb-num">{r.before}</td>
                    <td className="jpb-num jpb-confirm__after">{r.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="jpb-confirm__section">
          <label className="jpb-field__label" htmlFor={`${id}-reason`}>
            Reason (recorded in the audit log)
            <span aria-hidden="true"> *</span>
          </label>
          <textarea
            id={`${id}-reason`}
            className="jpb-input jpb-textarea"
            rows={3}
            value={reason}
            disabled={pending}
            required
            aria-describedby={`${id}-reason-hint`}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this needed?"
          />
          <p id={`${id}-reason-hint`} className="jpb-field__hint">
            {reasonOk ? (
              <>
                <Icon name="check" /> Reason provided
              </>
            ) : (
              `Required — at least ${minReasonLength} characters.`
            )}
          </p>
        </div>
        <div className="jpb-confirm__section">
          <label className="jpb-field__label" htmlFor={`${id}-word`}>
            Type <strong className="jpb-confirm__word">{confirmWord}</strong> to confirm
          </label>
          <input
            ref={wordRef}
            id={`${id}-word`}
            className="jpb-input jpb-confirm__typed"
            value={typed}
            disabled={pending}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={typed.length > 0 && !wordOk ? true : undefined}
            onChange={(e) => setTyped(e.target.value)}
          />
        </div>
        {error && (
          <p className="jpb-confirm__error" role="alert">
            <Icon name="warning" /> {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
