import { useMemo } from 'react';
import type { AdminRole, AdminUserDto, Permission } from '@jpb/shared-types';
import { formatCount } from '@jpb/ui';
import type { PreviewRow } from '@jpb/ui';
import { useApi, useQueryClient } from '../../api/ApiProvider';
import { qk } from '../../api/query/keys';
import type { AdminSessionDto, UpdateUserRequest } from '../../api/types';
import { useDangerousAction } from '../../danger/DangerProvider';
import { PERMISSION_INFO, ROLE_META, permissionDiff, sameScope, scopeLabel } from './model';
import type { UserDraft } from './UserDialog';

/** Permissions most worth noticing first (sensitive ones), at most `max` named. */
const LIST_MAX = 5;
const list = (ps: Permission[]) => {
  const sorted = [...ps].sort((a, b) => Number(Boolean(PERMISSION_INFO[b].sensitive)) - Number(Boolean(PERMISSION_INFO[a].sensitive)));
  const named = sorted.slice(0, LIST_MAX).map((p) => PERMISSION_INFO[p].label.toLowerCase());
  return sorted.length > LIST_MAX ? `${named.join('; ')} and ${sorted.length - LIST_MAX} more` : named.join('; ');
};

/**
 * Admin-user controls with their danger level (docs/API.md): create L1,
 * edit / disable / reset password L2 with the word USER, revoke a session L1
 * with a required reason. Each resolves to the result, or undefined when
 * cancelled or failed (the dialog shows the friendly error).
 */
export function useUserActions(matrix: Record<AdminRole, readonly Permission[]>, tournamentName: (id: string) => string) {
  const api = useApi();
  const queryClient = useQueryClient();
  const danger = useDangerousAction();
  return useMemo(() => {
    const invalidate = [qk.users(), qk.sessions(), qk.auditAll()];
    const scopeText = (s: string[] | null) => scopeLabel(s, tournamentName);

    return {
      create: (d: UserDraft) =>
        danger({
          level: 1,
          endpoint: 'userCreate',
          title: `Create ${d.username}`,
          summary: `${d.displayName} · ${ROLE_META[d.role].label} · ${scopeText(d.scope)}`,
          consequences: [
            `Gets ${formatCount(matrix[d.role].length)} permissions of the ${ROLE_META[d.role].label.toLowerCase()} role`,
            d.scope === null ? 'Can act on every current and future tournament' : `Limited to ${d.scope.map(tournamentName).join(', ')}`,
            'Can sign in immediately with the password you set',
          ],
          confirmLabel: 'Create admin user',
          run: () => api.users.create({ username: d.username, displayName: d.displayName, role: d.role, password: d.password, tournamentScope: d.scope }),
          success: `Admin user ${d.username} created`,
          invalidate,
        }),

      update: (u: AdminUserDto, d: UserDraft) => {
        const changes: Partial<Pick<UpdateUserRequest, 'displayName' | 'role' | 'tournamentScope'>> = {};
        const preview: PreviewRow[] = [];
        const consequences: string[] = [];
        if (d.displayName !== u.displayName) {
          changes.displayName = d.displayName;
          preview.push({ label: 'Display name', before: u.displayName, after: d.displayName });
        }
        if (d.role !== u.role) {
          changes.role = d.role;
          preview.push({ label: 'Role', before: ROLE_META[u.role].label, after: ROLE_META[d.role].label });
          const diff = permissionDiff(matrix, u.role, d.role);
          if (diff.gains.length) consequences.push(`Gains ${diff.gains.length} permission${diff.gains.length === 1 ? '' : 's'}: ${list(diff.gains)}`);
          if (diff.loses.length) consequences.push(`Loses ${diff.loses.length} permission${diff.loses.length === 1 ? '' : 's'}: ${list(diff.loses)}`);
        }
        if (!sameScope(d.scope, u.tournamentScope)) {
          changes.tournamentScope = d.scope;
          preview.push({ label: 'Tournament scope', before: scopeText(u.tournamentScope), after: scopeText(d.scope) });
        }
        consequences.push('Applies on their next request — the server re-checks role and scope on every call', 'An ADMIN_USER_UPDATED audit entry records before and after');
        return danger({
          level: 2,
          endpoint: 'userUpdate',
          word: 'USER',
          title: `Change ${u.username}`,
          summary: `${u.displayName} (${ROLE_META[u.role].label})`,
          consequences,
          preview,
          confirmLabel: 'Apply change',
          run: (c) => api.users.update(u.id, { ...changes, ...c }),
          success: `${u.username} updated`,
          invalidate,
        });
      },

      setDisabled: (u: AdminUserDto, disabled: boolean, sessions: number) =>
        danger({
          level: 2,
          endpoint: 'userUpdate',
          word: 'USER',
          title: disabled ? `Disable ${u.username}` : `Enable ${u.username}`,
          summary: disabled ? 'The account can no longer sign in. Its history and audit entries are kept.' : 'The account can sign in again with its current password.',
          consequences: disabled
            ? [`${formatCount(sessions)} active ${sessions === 1 ? 'session is' : 'sessions are'} signed out immediately`, 'Nothing they did is undone', 'You can enable the account again at any time']
            : ['Their role and tournament scope are unchanged', 'Consider resetting the password if it may be known to others'],
          preview: [{ label: 'Status', before: disabled ? 'Active' : 'Disabled', after: disabled ? 'Disabled' : 'Active' }],
          confirmLabel: disabled ? 'Disable account' : 'Enable account',
          run: (c) => api.users.update(u.id, { disabled, ...c }),
          success: disabled ? `${u.username} disabled` : `${u.username} enabled`,
          invalidate,
        }),

      resetPassword: (u: AdminUserDto, password: string, sessions: number) =>
        danger({
          level: 2,
          endpoint: 'userResetPassword',
          word: 'USER',
          title: `Reset password — ${u.username}`,
          summary: 'Replaces the password. The old one stops working immediately.',
          consequences: [`${formatCount(sessions)} active ${sessions === 1 ? 'session is' : 'sessions are'} signed out`, 'Give the new password to them in person; it is never shown again', 'An ADMIN_PASSWORD_RESET audit entry is written (without the password)'],
          preview: [{ label: 'Password', before: 'current', after: `new (${password.length} characters)` }],
          confirmLabel: 'Reset password',
          run: (c) => api.users.resetPassword(u.id, { password, ...c }),
          success: `New password set for ${u.username}`,
          invalidate,
        }),

      revokeSession: (s: AdminSessionDto, who: string, own: boolean) =>
        danger({
          level: 1,
          endpoint: 'sessionRevoke',
          title: `Revoke session of ${who}`,
          summary: own ? 'This is one of your own sessions — if it is this browser, you will be signed out.' : 'That device is signed out on its next request.',
          consequences: ['They can sign in again unless the account is disabled', 'Recorded as ADMIN_SESSION_REVOKED with your reason'],
          reason: 'required',
          tone: 'danger',
          confirmLabel: 'Revoke session',
          run: ({ reason }) => api.users.revokeSession(s.id, { reason }),
          success: 'Session revoked',
          invalidate,
        }),

      revokeAll: (u: AdminUserDto, sessions: AdminSessionDto[]) =>
        danger({
          level: 1,
          endpoint: 'sessionRevoke',
          title: `Sign out ${u.username} everywhere`,
          summary: `Revokes all ${formatCount(sessions.length)} active ${sessions.length === 1 ? 'session' : 'sessions'} of ${u.displayName}.`,
          consequences: ['Every device is signed out on its next request', 'Each revocation is audit-logged with your reason'],
          reason: 'required',
          tone: 'danger',
          confirmLabel: `Revoke ${formatCount(sessions.length)}`,
          run: async ({ reason }) => {
            let done = 0;
            try {
              for (const s of sessions) {
                await api.users.revokeSession(s.id, { reason });
                done += 1;
              }
            } finally {
              for (const k of invalidate) queryClient.invalidate(k);
            }
            return done;
          },
          success: (n) => `${formatCount(n)} ${n === 1 ? 'session' : 'sessions'} revoked`,
        }),
    };
  }, [api, danger, matrix, queryClient, tournamentName]);
}

export type UserActions = ReturnType<typeof useUserActions>;
