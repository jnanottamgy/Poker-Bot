import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Alert, Button, TextField } from '@jpb/ui';
import { friendlyError } from '../api/errors';
import type { FriendlyError } from '../api/errors';
import { useBackend } from '../app/backend';
import { isValidPublicId, isValidRejoinCode, normalizePublicId, normalizeRejoinCode } from './rejoinFragment';
import type { RejoinCredentials } from './rejoinFragment';

export interface RejoinFormProps {
  joinCode: string;
  /** Prefilled from a staff rejoin QR; submitted automatically once. */
  initial?: RejoinCredentials | null;
  onRejoined: () => void;
  submitLabel?: string;
}

/** Recover a seat on this device with the player ID + one-time rejoin code. */
export function RejoinForm({ joinCode, initial = null, onRejoined, submitLabel = 'Rejoin tournament' }: RejoinFormProps) {
  const { api } = useBackend();
  const [publicId, setPublicId] = useState(initial?.publicId ?? '');
  const [code, setCode] = useState(initial?.rejoinCode ?? '');
  const [errors, setErrors] = useState<{ publicId?: string; code?: string }>({});
  const [failure, setFailure] = useState<FriendlyError | null>(null);
  const [busy, setBusy] = useState(false);
  const autoSubmitted = useRef(false);

  const submit = async (pid: string, rc: string) => {
    const nextErrors: typeof errors = {};
    if (!isValidPublicId(pid)) nextErrors.publicId = 'Enter your player ID, like JPN-7A42.';
    if (!isValidRejoinCode(rc)) nextErrors.code = 'Enter the rejoin code you saved when you registered.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setBusy(true);
    setFailure(null);
    try {
      await api.rejoin(joinCode, { publicId: pid, rejoinCode: rc });
      onRejoined();
    } catch (e) {
      setFailure(friendlyError(e));
      setBusy(false);
    }
  };

  useEffect(() => {
    if (initial && !autoSubmitted.current) {
      autoSubmitted.current = true;
      void submit(initial.publicId, initial.rejoinCode);
    }
    // Only for the staff QR, once.
  }, [initial]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const pid = normalizePublicId(publicId);
    const rc = normalizeRejoinCode(code);
    setPublicId(pid);
    setCode(rc);
    void submit(pid, rc);
  };

  return (
    <form className="pw-form" onSubmit={onSubmit} noValidate aria-busy={busy || undefined}>
      {failure && (
        <Alert severity="CRITICAL" title={failure.title}>
          {failure.message}
        </Alert>
      )}
      <TextField
        label="Player ID"
        value={publicId}
        onChange={(e) => setPublicId(e.target.value)}
        autoComplete="username"
        autoCapitalize="characters"
        spellCheck={false}
        placeholder="JPN-7A42"
        error={errors.publicId}
        required
      />
      <TextField
        label="Rejoin code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        autoComplete="one-time-code"
        autoCapitalize="characters"
        spellCheck={false}
        placeholder="XXXX-XXXX"
        hint="The code you saved when you registered (or from a staff QR)."
        error={errors.code}
        required
      />
      <Button type="submit" variant="primary" size="xl" block loading={busy} loadingLabel="Rejoining…">
        {submitLabel}
      </Button>
    </form>
  );
}
