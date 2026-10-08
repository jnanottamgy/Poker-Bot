import { Icon, initials } from '@jpb/ui';
import { useSession } from '../auth/SessionProvider';
import { Popover } from '../components/Popover';
import { formatTimeOfDay } from '../lib/time';

/** Signed-in admin: name, role, tournament scope, session expiry, shortcuts, sign out. */
export function AdminMenu({ onShortcuts }: { onShortcuts: () => void }) {
  const { me, logout } = useSession();
  if (!me) return null;
  const { admin } = me;
  const role = admin.role.replace(/_/g, ' ').toLowerCase();
  return (
    <Popover
      label="Account"
      align="end"
      className="acr-adminmenu"
      panelClassName="acr-adminmenu__panel"
      trigger={(p) => (
        <button type="button" className="acr-adminmenu__trigger" {...p} aria-label={`Account: ${admin.displayName}, ${role}`}>
          <span className="acr-avatar" aria-hidden="true">
            {initials(admin.displayName)}
          </span>
          <span className="acr-adminmenu__who" aria-hidden="true">
            <span className="acr-adminmenu__name">{admin.displayName}</span>
            <span className="acr-adminmenu__role">{role}</span>
          </span>
          <Icon name="chevron-down" />
        </button>
      )}
    >
      {(close) => (
        <div className="acr-adminmenu__body">
          <p className="acr-adminmenu__headline">{admin.displayName}</p>
          <dl className="acr-adminmenu__facts">
            <div>
              <dt>Username</dt>
              <dd className="jpb-mono">{admin.username}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>{role}</dd>
            </div>
            <div>
              <dt>Tournaments</dt>
              <dd>{admin.tournamentScope === null ? 'All tournaments' : `${admin.tournamentScope.length} assigned`}</dd>
            </div>
            <div>
              <dt>Session ends</dt>
              <dd className="jpb-num">{formatTimeOfDay(me.sessionExpiresAt, false)}</dd>
            </div>
          </dl>
          <button
            type="button"
            className="acr-menuitem"
            onClick={() => {
              close();
              onShortcuts();
            }}
          >
            <Icon name="list" /> Keyboard shortcuts <kbd className="jpb-kbd">?</kbd>
          </button>
          <button type="button" className="acr-menuitem acr-menuitem--danger" onClick={() => void logout()}>
            <Icon name="log-out" /> Sign out
          </button>
        </div>
      )}
    </Popover>
  );
}
