import { useCallback } from 'react';
import { useApi } from '../../api/ApiProvider';
import { qk } from '../../api/query/keys';
import { useQuery } from '../../api/query/useQuery';
import { useSession } from '../../auth/SessionProvider';
import { usePermission } from '../../auth/permissions';

const USERS_STALE_MS = 60_000;

/**
 * Admin id → display name. Alerts and audit entries only carry admin ids;
 * names come from the admin users list when this admin may read it
 * (ADMIN_USERS_MANAGE), otherwise only "you" is resolved and other ids are
 * shown as they are.
 */
export function useAdminNames(): (adminId: string | null) => string {
  const api = useApi();
  const { me } = useSession();
  const canList = usePermission('ADMIN_USERS_MANAGE', null);
  const users = useQuery(qk.users(), (s) => api.users.list(s), { enabled: canList, staleMs: USERS_STALE_MS });
  const list = users.data?.users;
  return useCallback(
    (adminId: string | null) => {
      if (!adminId) return 'System';
      if (me && adminId === me.admin.id) return `${me.admin.displayName} (you)`;
      const u = list?.find((x) => x.id === adminId);
      return u ? `${u.displayName} (${u.username})` : adminId;
    },
    [me, list],
  );
}
