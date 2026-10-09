import { Fragment } from 'react';
import type { AdminRole, Permission } from '@jpb/shared-types';
import { Badge, Icon, Panel, StatusPill, formatCount } from '@jpb/ui';
import { ALL_PERMISSIONS, PERMISSION_GROUPS, PERMISSION_INFO, ROLES, ROLE_META } from './model';

/** Role → permission matrix, grouped, as returned by the server (usersList.rolePermissions). */
export function PermissionMatrix({ matrix, counts }: { matrix: Record<AdminRole, readonly Permission[]>; counts: Record<AdminRole, number> }) {
  const has = (r: AdminRole, p: Permission) => matrix[r].includes(p);
  return (
    <Panel flush title="Role → permission matrix" icon="shield" description="What each role may do. The server checks the permission (and tournament scope) on every request; hiding a button is only a convenience.">
      <div className="acr-users-tablewrap" tabIndex={0} role="region" aria-label="Permission matrix (scrollable)">
        <table className="acr-users-matrix" aria-label="Role permissions">
          <thead>
            <tr>
              <th scope="col">Permission</th>
              {ROLES.map((r) => (
                <th key={r} scope="col" className="is-role">
                  <span className="acr-users-matrix__role">
                    <StatusPill size="sm" tone={ROLE_META[r].tone} icon={ROLE_META[r].icon} label={ROLE_META[r].label} />
                    <span className="acr-users-dim">
                      {formatCount(matrix[r].length)} permissions · {formatCount(counts[r])} {counts[r] === 1 ? 'user' : 'users'}
                    </span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSION_GROUPS.map((g) => (
              <Fragment key={g}>
                <tr className="acr-users-matrix__group">
                  <th scope="colgroup" colSpan={ROLES.length + 1}>
                    {g}
                  </th>
                </tr>
                {ALL_PERMISSIONS.filter((p) => PERMISSION_INFO[p].group === g).map((p) => (
                  <tr key={p}>
                    <th scope="row">
                      <span className="acr-users-matrix__perm">
                        <span>
                          {PERMISSION_INFO[p].label}
                          {PERMISSION_INFO[p].sensitive && (
                            <Badge tone="warning" srLabel="Sensitive permission">
                              sensitive
                            </Badge>
                          )}
                        </span>
                        <span className="jpb-mono acr-users-dim">{p}</span>
                      </span>
                    </th>
                    {ROLES.map((r) => (
                      <td key={r} className={has(r, p) ? 'is-yes' : 'is-no'}>
                        {has(r, p) ? (
                          <>
                            <Icon name="check" />
                            <span className="jpb-sr-only">Granted</span>
                          </>
                        ) : (
                          <>
                            <span aria-hidden="true">—</span>
                            <span className="jpb-sr-only">Not granted</span>
                          </>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
