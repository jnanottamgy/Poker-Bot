import type { ReactNode } from 'react';
import type { Permission } from '@jpb/shared-types';
import { Icon } from '@jpb/ui';
import { useSession } from './SessionProvider';
import { inTournamentScope, useCurrentTournamentId } from './scope';

/**
 * UI permission checks. They only decide what to show — the server re-checks
 * permission and tournament scope on every call (ADMIN_CONTROL_ROOM §3).
 */

/** Does the signed-in admin hold `permission` for the current (or given) tournament? */
export function usePermission(permission: Permission, tournamentId?: string | null): boolean {
  const { me } = useSession();
  const current = useCurrentTournamentId();
  const tid = tournamentId === undefined ? current : tournamentId;
  if (!me) return false;
  return me.permissions.includes(permission) && inTournamentScope(me, tid);
}

export interface Gate {
  allowed: boolean;
  /** Pass to `ControlCard lockedPermission` / show as "Requires X". Null when allowed. */
  lockedPermission: Permission | null;
  /** Tooltip / aria-description for a disabled control. */
  reason: string | null;
}

export function useGate(permission: Permission, tournamentId?: string | null): Gate {
  const allowed = usePermission(permission, tournamentId);
  return { allowed, lockedPermission: allowed ? null : permission, reason: allowed ? null : `Requires ${permission}` };
}

export interface CanProps {
  permission: Permission;
  /**
   * hide (default): render nothing (or `fallback`) without the permission.
   * disable: render the children inert inside a disabled fieldset plus a "Requires X" note.
   */
  mode?: 'hide' | 'disable';
  fallback?: ReactNode;
  tournamentId?: string | null;
  children: ReactNode;
}

/** Permission gate for controls. */
export function Can({ permission, mode = 'hide', fallback = null, tournamentId, children }: CanProps) {
  const allowed = usePermission(permission, tournamentId);
  if (allowed) return <>{children}</>;
  if (mode === 'hide') return <>{fallback}</>;
  return (
    <span className="acr-can-locked" title={`Requires ${permission}`}>
      <fieldset disabled className="acr-can-locked__set">
        <legend className="jpb-sr-only">Locked: requires {permission}</legend>
        {children}
      </fieldset>
      <span className="acr-can-locked__note">
        <Icon name="lock" /> Requires {permission}
      </span>
    </span>
  );
}
