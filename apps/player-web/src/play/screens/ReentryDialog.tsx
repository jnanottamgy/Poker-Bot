import { useState } from 'react';
import { Alert, Button, Modal, formatChips, useToast } from '@jpb/ui';
import { friendlyError } from '../../api/errors';
import type { FriendlyError } from '../../api/errors';
import type { ReenterResponse } from '../../api/client';
import { useBackend } from '../../app/backend';
import type { ReentryOffer } from '../reentry';

export interface ReentryDialogProps {
  open: boolean;
  offer: ReentryOffer | null;
  startingStack: number | null;
  onClose: () => void;
  /** The server accepted the new entry (the live connection then seats it). */
  onReentered: (res: ReenterResponse) => void;
}

/**
 * Confirmation before POST /api/player/reenter: a re-entry spends one of the
 * player's entries, so it is never a single tap. The server re-checks every
 * rule; its refusal is shown here in plain words.
 */
export function ReentryDialog({ open, offer, startingStack, onClose, onReentered }: ReentryDialogProps) {
  const { api } = useBackend();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<FriendlyError | null>(null);

  const close = () => {
    if (busy) return;
    setFailure(null);
    onClose();
  };

  const confirm = async () => {
    setBusy(true);
    setFailure(null);
    try {
      const res = await api.reenter();
      toast.push({ tone: 'success', title: 'You are back in', description: `Entry #${res.entryNumber} · a seat is being assigned.` });
      setBusy(false);
      onReentered(res);
    } catch (e) {
      setFailure(friendlyError(e));
      setBusy(false);
    }
  };

  const details = [
    startingStack !== null ? `You start again with ${formatChips(startingStack)} chips at the table with a free seat.` : 'You start again with a fresh starting stack.',
    offer?.entriesLeft !== null && offer?.entriesLeft !== undefined ? `This uses one of your ${offer.entriesLeft} remaining entr${offer.entriesLeft === 1 ? 'y' : 'ies'}.` : 'This uses one of your entries.',
    offer?.untilLevel ? `Re-entry is open through level ${offer.untilLevel}.` : null,
  ].filter((x): x is string => x !== null);

  return (
    <Modal
      open={open}
      onClose={close}
      title="Re-enter the tournament?"
      size="sm"
      dismissible={!busy}
      className="pw-reentry"
      footer={
        <>
          <Button variant="ghost" size="lg" onClick={close} disabled={busy}>
            Not now
          </Button>
          <Button variant="primary" size="lg" onClick={() => void confirm()} loading={busy} loadingLabel="Re-entering…">
            Confirm re-entry
          </Button>
        </>
      }
    >
      <div className="pw-reentry__body">
        {failure && (
          <Alert severity="CRITICAL" title={failure.title}>
            {failure.message}
          </Alert>
        )}
        <ul className="pw-tips">
          {details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
