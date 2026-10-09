import { useCallback, useState } from 'react';
import { ApiError } from '@jpb/client-sdk';
import { formatCount } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import { friendlyError } from '../../api/errors';
import { qk } from '../../api/query/keys';
import { useDangerousAction } from '../../danger/DangerProvider';

/** Most registrations approved in one confirmation (each is its own audited request). */
export const BULK_APPROVE_MAX = 100;
/**
 * Admin writes are rate limited (API.md: 20 burst, then 2/s). After the burst
 * the loop paces itself, and a 429 waits before one more try.
 */
const BURST = 15;
const PACE_MS = 550;
const RETRY_AFTER_429_MS = 2_000;
const MAX_TRIES = 3;

export interface BulkTarget {
  playerId: string;
  displayName: string;
}

export interface BulkResult {
  approved: string[];
  failed: Array<{ playerId: string; displayName: string; message: string }>;
}

export interface BulkProgress {
  done: number;
  total: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Approves pending registrations one request at a time (each is a separate
 * level-1 action in the audit log) behind ONE confirmation. Partial failures
 * are reported per player; nothing is retried silently except rate limiting.
 */
export function useBulkApprove(tournamentId: string) {
  const api = useApi();
  const danger = useDangerousAction();
  const [progress, setProgress] = useState<BulkProgress | null>(null);
  const [last, setLast] = useState<BulkResult | null>(null);

  const approveOne = useCallback(
    async (playerId: string, reason: string) => {
      for (let attempt = 1; ; attempt++) {
        try {
          return await api.players.approve(playerId, reason ? { reason } : {});
        } catch (err) {
          if (err instanceof ApiError && err.status === 429 && attempt < MAX_TRIES) {
            await sleep(RETRY_AFTER_429_MS * attempt);
            continue;
          }
          throw err;
        }
      }
    },
    [api],
  );

  const run = useCallback(
    (targets: BulkTarget[], onDone?: (r: BulkResult) => void) => {
      const list = targets.slice(0, BULK_APPROVE_MAX);
      const n = list.length;
      const names = list.slice(0, 3).map((t) => t.displayName).join(', ');
      return danger<BulkResult>({
        level: 1,
        endpoint: 'playerApprove',
        title: n === 1 ? `Approve ${list[0]!.displayName}` : `Approve ${formatCount(n)} registrations`,
        summary: n === 1 ? 'The registration counts toward the player limit and the player is seated when play starts.' : `${names}${n > 3 ? ` and ${formatCount(n - 3)} more` : ''}.`,
        consequences: [
          'Approved players count toward the maximum number of players',
          'They are seated at random when the tournament starts (or by late registration if it is running)',
          n > 1 ? 'Each approval is a separate audit-log entry with your name' : 'The approval is audit-logged with your name',
        ],
        reason: 'optional',
        confirmLabel: n === 1 ? 'Approve' : `Approve ${formatCount(n)}`,
        run: async ({ reason }) => {
          const result: BulkResult = { approved: [], failed: [] };
          let firstError: unknown = null;
          setProgress({ done: 0, total: n });
          try {
            for (let i = 0; i < n; i++) {
              const t = list[i]!;
              if (i >= BURST) await sleep(PACE_MS);
              try {
                await approveOne(t.playerId, reason);
                result.approved.push(t.playerId);
              } catch (err) {
                firstError ??= err;
                const f = friendlyError(err);
                result.failed.push({ playerId: t.playerId, displayName: t.displayName, message: f.description });
              }
              setProgress({ done: i + 1, total: n });
            }
          } finally {
            setProgress(null);
          }
          if (result.approved.length === 0 && result.failed.length > 0) {
            // Nothing changed: keep the dialog open with the server's (friendly) reason.
            setLast(result);
            throw firstError;
          }
          setLast(result);
          return result;
        },
        success: (r) =>
          r.failed.length === 0
            ? `${formatCount(r.approved.length)} registration${r.approved.length === 1 ? '' : 's'} approved`
            : `${formatCount(r.approved.length)} approved · ${formatCount(r.failed.length)} could not be approved`,
        invalidate: [qk.tournament(tournamentId)],
        onSuccess: (r) => onDone?.(r),
      });
    },
    [danger, approveOne, tournamentId],
  );

  return { run, progress, last, clearLast: () => setLast(null) };
}
