import { Alert, Button, formatCount } from '@jpb/ui';
import type { AuditVerifyResponse } from '../../api/types';
import { friendlyError } from '../../api/errors';
import { formatDateTime } from '../../lib/time';

/** The server re-verifies at most this many entries per call (persistence/repos/audit.ts). */
export const VERIFY_WINDOW = 100_000;

export interface ChainState {
  running: boolean;
  result: AuditVerifyResponse | null;
  error: unknown;
}

/** Result of "Verify chain": intact ✓, or the first broken entry with a jump to it. */
export function ChainCheck({ state, onJump, onRetry, onDismiss }: { state: ChainState; onJump: (seq: number) => void; onRetry: () => void; onDismiss: () => void }) {
  if (state.error && !state.running) {
    const f = friendlyError(state.error);
    return (
      <Alert severity="WARNING" title="Could not verify the chain" onDismiss={onDismiss} actions={<Button size="sm" variant="secondary" icon="refresh" onClick={onRetry}>Try again</Button>}>
        {f.description}
      </Alert>
    );
  }
  const r = state.result;
  if (!r) return null;
  const partial = r.checked >= VERIFY_WINDOW;
  if (r.intact) {
    return (
      <Alert severity="SUCCESS" title="Hash chain intact" onDismiss={onDismiss} meta={`Verified on the server ${formatDateTime(r.verifiedAt)}`}>
        {formatCount(r.checked)} {r.checked === 1 ? 'entry' : 'entries'} re-hashed in order; every entry links to the one before it.
        {partial ? ` The server checks the first ${formatCount(VERIFY_WINDOW)} entries per run.` : ''}
      </Alert>
    );
  }
  return (
    <Alert
      severity="CRITICAL"
      title={`Hash chain broken at entry #${r.brokenAtSeq ?? '?'}`}
      onDismiss={onDismiss}
      meta={`Verified on the server ${formatDateTime(r.verifiedAt)} · ${formatCount(r.checked)} entries checked`}
      actions={
        r.brokenAtSeq !== null ? (
          <Button size="sm" variant="secondary" icon="eye" onClick={() => onJump(r.brokenAtSeq!)}>
            Show entry #{r.brokenAtSeq}
          </Button>
        ) : undefined
      }
    >
      Entry #{r.brokenAtSeq} does not chain to the entry before it: the log was altered at or before this point. Preserve the database and escalate before changing anything else.
    </Alert>
  );
}
