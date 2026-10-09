import { useMemo } from 'react';
import type { AlertDto } from '@jpb/shared-types';
import { formatCount } from '@jpb/ui';
import { useApi, useQueryClient } from '../../api/ApiProvider';
import { qk } from '../../api/query/keys';
import { useDangerousAction } from '../../danger/DangerProvider';
import { codeInfo } from './model';

/**
 * Acknowledge / resolve (danger level 1, optional reason written to the audit
 * log). Every call refreshes all alert lists and the tournament overview
 * (open-alert counter, bell) — nothing is patched locally.
 */
export function useAlertActions(tournamentId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  const danger = useDangerousAction();
  return useMemo(() => {
    const invalidate = [qk.alertsAll(), qk.overview(tournamentId)];
    return {
      acknowledge: (a: AlertDto) =>
        danger({
          level: 1,
          endpoint: 'alertAck',
          title: `Acknowledge: ${codeInfo(a.code).title}`,
          summary: a.message,
          consequences: ['The alert stays open until it is resolved, marked as acknowledged by you', 'Other staff see that someone is on it'],
          reason: 'optional',
          confirmLabel: 'Acknowledge',
          run: ({ reason }) => api.alerts.ack(a.id, reason ? { reason } : {}),
          success: 'Alert acknowledged',
          invalidate,
        }),
      resolve: (a: AlertDto) =>
        danger({
          level: 1,
          endpoint: 'alertResolve',
          title: `Resolve: ${codeInfo(a.code).title}`,
          summary: a.message,
          consequences: [
            'The alert moves to Resolved and leaves the open count',
            ...(a.code === 'TABLE_STALLED' ? ['Only resolve once the table is progressing again — a new stall raises a new alert'] : []),
          ],
          reason: 'optional',
          confirmLabel: 'Resolve alert',
          run: ({ reason }) => api.alerts.resolve(a.id, reason ? { reason } : {}),
          success: 'Alert resolved',
          invalidate,
        }),
      /** One confirmation for many alerts (incident floods); acknowledged one by one, stops at the first failure. */
      acknowledgeMany: (list: AlertDto[]) =>
        danger({
          level: 1,
          endpoint: 'alertAck',
          title: `Acknowledge ${formatCount(list.length)} alerts`,
          summary: 'Every alert in the current filtered list is marked as acknowledged by you. They stay open until resolved.',
          consequences: [`${formatCount(list.filter((a) => a.severity === 'CRITICAL').length)} critical · ${formatCount(list.filter((a) => a.severity === 'WARNING').length)} warning · ${formatCount(list.filter((a) => a.severity === 'INFO').length)} info`],
          reason: 'optional',
          confirmLabel: `Acknowledge ${formatCount(list.length)}`,
          run: async ({ reason }) => {
            let done = 0;
            let firstError: unknown = null;
            try {
              for (const a of list) {
                try {
                  await api.alerts.ack(a.id, reason ? { reason } : {});
                  done += 1;
                } catch (err) {
                  // Already acknowledged/resolved by someone else meanwhile: keep going.
                  firstError ??= err;
                }
              }
            } finally {
              // Refresh even after a partial failure: some alerts did change.
              for (const k of invalidate) queryClient.invalidate(k);
            }
            if (done === 0 && firstError) throw firstError;
            return { done, failed: list.length - done };
          },
          success: (r) => (r.failed > 0 ? `${formatCount(r.done)} acknowledged · ${formatCount(r.failed)} had already changed` : `${formatCount(r.done)} alerts acknowledged`),
        }),
    };
  }, [api, danger, queryClient, tournamentId]);
}

export type AlertActions = ReturnType<typeof useAlertActions>;
