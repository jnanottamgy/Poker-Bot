import { useEffect, useId, useState } from 'react';
import { Alert, Button, Modal, cx, formatChips } from '@jpb/ui';
import { formatBB, signedChips } from '../players/model';

/** A corrected stack is at least one chip: removing a player is a disqualification, not an adjustment. */
export const MIN_ADJUSTED_STACK = 1;

/** "12,500" / "12 500" / "12500" → 12500; anything else → null. */
export function parseChips(raw: string): number | null {
  const clean = raw.replace(/[,\s_]/g, '');
  if (!/^\d+$/.test(clean)) return null;
  const n = Number(clean);
  return Number.isSafeInteger(n) ? n : null;
}

export interface AdjustDialogProps {
  open: boolean;
  onClose: () => void;
  playerName: string;
  stack: number;
  bigBlind: number | null;
  /** A hand is running at the player's table: the table refuses stack changes until it ends. */
  handInProgress: boolean;
  onReview: (newStack: number) => void;
}

/** Adjust a stack (level 2): type the corrected stack, see chips + BB and the change, then confirm with ADJUST. */
export function AdjustDialog({ open, onClose, playerName, stack, bigBlind, handInProgress, onReview }: AdjustDialogProps) {
  const id = useId();
  const [raw, setRaw] = useState('');
  useEffect(() => {
    if (open) setRaw('');
  }, [open]);

  const value = parseChips(raw);
  const error =
    raw.trim() === ''
      ? null
      : value === null
        ? 'Enter a whole number of chips, e.g. 24,500.'
        : value < MIN_ADJUSTED_STACK
          ? 'The stack must be at least 1 chip. To remove a player, disqualify them instead.'
          : value === stack
            ? 'That is already the current stack.'
            : null;
  const ok = value !== null && error === null;
  const delta = value !== null ? value - stack : 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Adjust ${playerName}’s stack`}
      description="Only to correct a verified error. You will confirm with the word ADJUST and a reason; the before and after stacks are audit-logged."
      size="sm"
      tone="danger"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger-outline" icon="sliders" disabled={!ok} onClick={() => value !== null && onReview(value)}>
            Review adjustment…
          </Button>
        </>
      }
    >
      <form
        className="acr-player-detail-adjust"
        onSubmit={(e) => {
          e.preventDefault();
          if (ok && value !== null) onReview(value);
        }}
      >
        {handInProgress && (
          <Alert severity="WARNING" title="A hand is in progress at this table">
            The table applies stack changes between hands only. Hold the table from its detail screen, or wait for the hand to end; the server refuses the change otherwise.
          </Alert>
        )}
        <div className="acr-player-detail-adjust__now">
          <span className="acr-player-detail-adjust__k">Current stack</span>
          <span className="acr-player-detail-adjust__v jpb-num">{formatChips(stack)}</span>
          <span className="acr-player-detail-adjust__bb">{formatBB(stack, bigBlind)}</span>
        </div>
        <div className={cx('jpb-field', error && 'is-invalid')}>
          <label htmlFor={`${id}-in`} className="jpb-field__label">
            Corrected stack (chips)
          </label>
          <span className="jpb-input-wrap">
            <input
              id={`${id}-in`}
              className="jpb-input"
              inputMode="numeric"
              autoComplete="off"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={`${id}-help`}
              placeholder={formatChips(stack)}
            />
            <span className="jpb-input__suffix">chips</span>
          </span>
          <p id={`${id}-help`} className={error ? 'jpb-field__error' : 'jpb-field__hint'} role={error ? 'alert' : undefined}>
            {error ?? 'Whole chips only. The tournament chip total changes by the difference.'}
          </p>
        </div>
        {ok && value !== null && (
          <dl className="acr-player-detail-adjust__preview" aria-label="Preview">
            <div>
              <dt>After</dt>
              <dd className="jpb-num">{formatChips(value)}</dd>
            </div>
            <div>
              <dt>Big blinds</dt>
              <dd>
                {formatBB(stack, bigBlind)} → {formatBB(value, bigBlind)}
              </dd>
            </div>
            <div>
              <dt>Change</dt>
              <dd className={cx('jpb-num', delta > 0 ? 'is-up' : 'is-down')}>{signedChips(delta)}</dd>
            </div>
          </dl>
        )}
      </form>
    </Modal>
  );
}
