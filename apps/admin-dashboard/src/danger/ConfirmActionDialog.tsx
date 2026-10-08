import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Icon, Modal } from '@jpb/ui';

export interface ConfirmActionDialogProps {
  open: boolean;
  title: string;
  summary?: ReactNode;
  consequences?: ReactNode[];
  reason: 'none' | 'optional' | 'required';
  confirmLabel?: string;
  tone?: 'primary' | 'danger';
  pending: boolean;
  error?: ReactNode;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

const MIN_REQUIRED_REASON = 3;

/** Level-1 confirmation: one dialog, optional or required reason (written to the audit log). */
export function ConfirmActionDialog({ open, title, summary, consequences, reason, confirmLabel, tone = 'primary', pending, error, onConfirm, onCancel }: ConfirmActionDialogProps) {
  const id = useId();
  const [text, setText] = useState('');
  const confirmRef = useRef<HTMLButtonElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const sent = useRef(false);

  useEffect(() => {
    if (open) setText('');
    sent.current = false;
  }, [open]);
  useEffect(() => {
    if (!pending) sent.current = false;
  }, [pending]);

  const reasonOk = reason !== 'required' || text.trim().length >= MIN_REQUIRED_REASON;
  const submit = () => {
    if (!reasonOk || pending || sent.current) return;
    sent.current = true;
    onConfirm(text.trim());
  };

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      description={summary}
      size="sm"
      dismissible={!pending}
      initialFocusRef={reason === 'none' ? confirmRef : reasonRef}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button ref={confirmRef} variant={tone === 'danger' ? 'danger' : 'primary'} onClick={submit} disabled={!reasonOk} loading={pending}>
            {confirmLabel ?? title}
          </Button>
        </>
      }
    >
      <form
        className="acr-confirm"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {consequences && consequences.length > 0 && (
          <ul className="acr-confirm__list">
            {consequences.map((c, i) => (
              <li key={i}>
                <Icon name="arrow-right" /> <span>{c}</span>
              </li>
            ))}
          </ul>
        )}
        {reason !== 'none' && (
          <div className="jpb-field">
            <label className="jpb-field__label" htmlFor={`${id}-reason`}>
              Reason {reason === 'required' ? '(required, recorded in the audit log)' : '(optional, recorded in the audit log)'}
            </label>
            <textarea
              ref={reasonRef}
              id={`${id}-reason`}
              className="jpb-input jpb-textarea"
              rows={2}
              value={text}
              disabled={pending}
              required={reason === 'required'}
              onChange={(e) => setText(e.target.value)}
              placeholder="e.g. Floor request after dealer error"
            />
          </div>
        )}
        {error && (
          <p className="acr-confirm__error" role="alert">
            <Icon name="warning" /> {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
