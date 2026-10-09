import { useEffect, useId, useState } from 'react';
import { Alert, Button, Icon, Modal, cx, formatChips, formatChipsDelta } from '@jpb/ui';
import { seatLabel, stackInBB } from './model';
import type { SeatModel } from './model';
import type { AdjustRequest } from './useTableControls';

/** The table engine accepts positive whole stacks only (a player with 0 chips is eliminated, not adjusted). */
export const MIN_ADJUSTED_STACK = 1;

export interface AdjustStackDialogProps {
  open: boolean;
  onClose: () => void;
  players: SeatModel[];
  initialPlayerId: string | null;
  initialValue?: string;
  bigBlind: number;
  /** Stacks can only change between hands (the table refuses mid-hand). */
  handInProgress: boolean;
  /** Offered when a hand is running and the operator may hold the table. */
  onHoldFirst?: () => void;
  onReview: (a: AdjustRequest, typed: string) => void;
}

export function parseStack(raw: string): number | null {
  const clean = raw.replace(/[,\s_]/g, '');
  if (!/^\d+$/.test(clean)) return null;
  const n = Number(clean);
  return Number.isSafeInteger(n) ? n : null;
}

/** Adjust a stack (level 2): pick the seat, type the corrected stack, review chips + BB and the delta. */
export function AdjustStackDialog({ open, onClose, players, initialPlayerId, initialValue, bigBlind, handInProgress, onHoldFirst, onReview }: AdjustStackDialogProps) {
  const sel = useId();
  const inp = useId();
  const [playerId, setPlayerId] = useState(initialPlayerId ?? players[0]?.playerId ?? '');
  const [raw, setRaw] = useState(initialValue ?? '');

  useEffect(() => {
    if (!open) return;
    setPlayerId(initialPlayerId ?? players[0]?.playerId ?? '');
    setRaw(initialValue ?? '');
    // Reset only when the dialog opens (live seat updates must not wipe the typed value).
  }, [open]);

  const player = players.find((p) => p.playerId === playerId) ?? null;
  const value = parseStack(raw);
  const error =
    raw.trim() === '' ? null : value === null ? 'Enter a whole number of chips.' : value < MIN_ADJUSTED_STACK ? 'The stack must be at least 1 chip (eliminations are not done here).' : player && value === player.stack ? 'That is already the current stack.' : null;
  const ok = player !== null && value !== null && error === null && !handInProgress;
  const bb = (n: number) => {
    const x = stackInBB(n, bigBlind);
    return x === null ? '' : `${x} BB`;
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Adjust a stack"
      description="Only to correct a verified error. You will confirm with the word ADJUST and a reason; both values are audit-logged."
      size="sm"
      tone="danger"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger-outline" icon="sliders" disabled={!ok} onClick={() => player && value !== null && onReview({ player, newStack: value }, raw)}>
            Review adjustment…
          </Button>
        </>
      }
    >
      <form
        className="acr-td-adjust"
        onSubmit={(e) => {
          e.preventDefault();
          if (ok && player && value !== null) onReview({ player, newStack: value }, raw);
        }}
      >
        {handInProgress && (
          <Alert
            severity="WARNING"
            title="A hand is in progress"
            meta="Stacks can only be adjusted between hands. Hold the table after this hand, then adjust."
            actions={
              onHoldFirst ? (
                <Button size="sm" icon="pause" onClick={onHoldFirst}>
                  Hold after hand…
                </Button>
              ) : undefined
            }
          />
        )}
        <div className="jpb-field">
          <label htmlFor={sel} className="jpb-field__label">
            Player
          </label>
          <span className="jpb-select-wrap">
            <select id={sel} className="jpb-input jpb-select" value={playerId} onChange={(e) => setPlayerId(e.target.value)}>
              {players.map((p) => (
                <option key={p.playerId} value={p.playerId}>
                  {`${seatLabel(p.seat)} · ${p.name} · ${formatChips(p.stack)}`}
                </option>
              ))}
            </select>
            <Icon name="chevron-down" className="jpb-select__chevron" />
          </span>
        </div>
        <div className={cx('jpb-field', error && 'is-invalid')}>
          <label htmlFor={inp} className="jpb-field__label">
            Corrected stack (chips)
          </label>
          <span className="jpb-input-wrap">
            <input
              id={inp}
              className="jpb-input jpb-num"
              inputMode="numeric"
              autoComplete="off"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={`${inp}-help`}
              placeholder={player ? String(player.stack) : ''}
            />
            <span className="jpb-input__suffix">chips</span>
          </span>
          <p id={`${inp}-help`} className={error ? 'jpb-field__error' : 'jpb-field__hint'}>
            {error ? (
              <>
                <Icon name="warning" /> {error}
              </>
            ) : (
              'Whole chips only; the big-blind count is shown for reference.'
            )}
          </p>
        </div>
        {player && (
          <dl className="acr-td-adjust__preview">
            <div>
              <dt>Current</dt>
              <dd className="jpb-num">
                {formatChips(player.stack)} <span className="acr-td-muted">{bb(player.stack)}</span>
              </dd>
            </div>
            <div>
              <dt>New</dt>
              <dd className="jpb-num">
                {value !== null && !error ? (
                  <>
                    {formatChips(value)} <span className="acr-td-muted">{bb(value)}</span>
                  </>
                ) : (
                  '—'
                )}
              </dd>
            </div>
            <div>
              <dt>Change</dt>
              <dd className={cx('jpb-num', value !== null && !error && (value > player.stack ? 'is-up' : 'is-down'))}>{value !== null && !error ? formatChipsDelta(value - player.stack) : '—'}</dd>
            </div>
          </dl>
        )}
      </form>
    </Modal>
  );
}
