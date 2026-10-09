import { useCallback, useMemo, useState } from 'react';
import type { AdminRole, AdminUserDto } from '@jpb/shared-types';
import { Button, DataTable, EmptyState, ErrorState, Icon, Panel, SearchInput, Skeleton, StatusPill, cx, formatCount, initials } from '@jpb/ui';
import type { Column, MenuItem } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import { friendlyError } from '../../api/errors';
import { qk } from '../../api/query/keys';
import { useQuery } from '../../api/query/useQuery';
import { useSession } from '../../auth/SessionProvider';
import { usePermission } from '../../auth/permissions';
import { PageHeader } from '../../components/PageHeader';
import { formatAgo, formatDateTime } from '../../lib/time';
import { useNow } from '../alerts/useNow';
import { ROLES, ROLE_META, STATUS_META, filterUsers, rolePermissionsOf, scopeLabel, userStatus } from './model';
import type { UserFilters, UserStatus } from './model';
import { PermissionMatrix } from './PermissionMatrix';
import { SessionsPanel } from './SessionsPanel';
import { EMPTY_DRAFT, PasswordDialog, UserDialog, draftOf } from './UserDialog';
import type { UserDraft } from './UserDialog';
import { useUserActions } from './useUserActions';
import './users.css';

const USERS_POLL_MS = 30_000;
const SESSIONS_POLL_MS = 20_000;
const PAGE_SIZE = 25;
const TOURNAMENTS_Q = { simulations: true } as const;

type DialogState = { kind: 'create'; draft: UserDraft } | { kind: 'edit'; user: AdminUserDto; draft: UserDraft } | { kind: 'password'; user: AdminUserDto; pw: { password: string; confirm: string } } | null;

/** §2.19 Admin users — accounts, roles, tournament scope, sessions and the permission matrix. */
export default function UsersSection() {
  const api = useApi();
  const { me } = useSession();
  const canManage = usePermission('ADMIN_USERS_MANAGE', null);
  const users = useQuery(qk.users(), (s) => api.users.list(s), { enabled: canManage, pollMs: USERS_POLL_MS });
  const sessions = useQuery(qk.sessions(), (s) => api.users.sessions(s), { enabled: canManage, pollMs: SESSIONS_POLL_MS });
  const tournaments = useQuery(qk.tournaments(TOURNAMENTS_Q), (s) => api.tournaments.list(TOURNAMENTS_Q, s), { enabled: canManage, staleMs: 60_000 });
  const now = useNow(15_000);
  const [filters, setFilters] = useState<UserFilters>({ q: '', role: '', status: '' });
  const [page, setPage] = useState(0);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [dialogSeq, setDialogSeq] = useState(0);
  const [sessionFilter, setSessionFilter] = useState<string | null>(null);

  const list = useMemo(() => users.data?.users ?? [], [users.data]);
  const matrix = useMemo(() => rolePermissionsOf(users.data?.rolePermissions), [users.data]);
  const tList = useMemo(() => tournaments.data?.tournaments ?? [], [tournaments.data]);
  const tournamentName = useCallback((id: string) => tList.find((t) => t.id === id)?.name ?? id, [tList]);
  const actions = useUserActions(matrix, tournamentName);
  const isSuper = me?.admin.role === 'SUPER_ADMIN';
  const shown = useMemo(() => filterUsers(list, filters), [list, filters]);
  const sessionsOf = useCallback((id: string) => (sessions.data?.sessions ?? []).filter((s) => s.adminId === id), [sessions.data]);
  const nameOf = (id: string | null) => (id ? (list.find((u) => u.id === id)?.username ?? id) : 'bootstrap');

  const open = (d: DialogState) => {
    setDialogSeq((n) => n + 1);
    setDialog(d);
  };
  const update = (patch: Partial<UserFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(0);
  };

  const submitCreate = async (draft: UserDraft) => {
    setDialog(null);
    const r = await actions.create(draft);
    if (!r) open({ kind: 'create', draft });
  };
  const submitEdit = async (user: AdminUserDto, draft: UserDraft) => {
    setDialog(null);
    const r = await actions.update(user, draft);
    if (!r) open({ kind: 'edit', user, draft });
  };
  const submitPassword = async (user: AdminUserDto, password: string, confirm: string) => {
    setDialog(null);
    const r = await actions.resetPassword(user, password, sessionsOf(user.id).length);
    if (!r) open({ kind: 'password', user, pw: { password, confirm } });
  };

  /** Why the signed-in admin cannot change this account (mirrors the server's rules), or null. */
  const lockReason = (u: AdminUserDto): string | null => (u.role === 'SUPER_ADMIN' && !isSuper ? 'Only a super admin can change super admin accounts' : null);

  const rowActions = (u: AdminUserDto): Array<MenuItem | 'separator'> => {
    const locked = lockReason(u);
    const self = u.id === me?.admin.id;
    const active = sessionsOf(u.id);
    return [
      { id: 'edit', label: 'Edit role, scope or name…', icon: 'sliders', disabled: Boolean(locked), disabledReason: locked ?? undefined, onSelect: () => open({ kind: 'edit', user: u, draft: draftOf(u) }) },
      { id: 'password', label: 'Reset password…', icon: 'key', disabled: Boolean(locked), disabledReason: locked ?? undefined, onSelect: () => open({ kind: 'password', user: u, pw: { password: '', confirm: '' } }) },
      { id: 'sessions', label: `Show sessions (${formatCount(active.length)})`, icon: 'monitor', onSelect: () => setSessionFilter(u.id) },
      { id: 'signout', label: 'Sign out everywhere…', icon: 'log-out', disabled: active.length === 0, disabledReason: active.length === 0 ? 'No active sessions' : undefined, onSelect: () => void actions.revokeAll(u, active) },
      'separator',
      u.disabled
        ? { id: 'enable', label: 'Enable account…', icon: 'check-circle', disabled: Boolean(locked), disabledReason: locked ?? undefined, onSelect: () => void actions.setDisabled(u, false, 0) }
        : { id: 'disable', label: 'Disable account…', icon: 'ban', danger: true, disabled: Boolean(locked) || self, disabledReason: self ? 'You cannot disable yourself' : (locked ?? undefined), onSelect: () => void actions.setDisabled(u, true, active.length) },
    ];
  };

  const columns: Array<Column<AdminUserDto>> = [
    {
      key: 'user',
      header: 'Admin',
      width: '240px',
      sortValue: (u) => u.displayName.toLowerCase(),
      render: (u) => (
        <span className="acr-users-ident">
          <span className="acr-avatar" aria-hidden="true">
            {initials(u.displayName)}
          </span>
          <span className="acr-cell-stack">
            <span className="acr-cell-strong">
              {u.displayName}
              {u.id === me?.admin.id && <span className="acr-tag">YOU</span>}
            </span>
            <span className="acr-cell-sub jpb-mono">{u.username}</span>
          </span>
        </span>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      sortValue: (u) => ROLES.indexOf(u.role),
      render: (u) => <StatusPill size="sm" tone={ROLE_META[u.role].tone} icon={ROLE_META[u.role].icon} label={ROLE_META[u.role].label} />,
    },
    {
      key: 'scope',
      header: 'Tournaments',
      render: (u) => (
        <span className={cx('acr-users-scopecell', u.tournamentScope !== null && 'is-limited')} title={u.tournamentScope ? u.tournamentScope.map(tournamentName).join('\n') : 'Every current and future tournament'}>
          <Icon name={u.tournamentScope === null ? 'layers' : 'lock'} /> {scopeLabel(u.tournamentScope, tournamentName)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortValue: (u) => userStatus(u),
      render: (u) => {
        const st = STATUS_META[userStatus(u)];
        return (
          <span className="acr-cell-stack">
            <StatusPill size="sm" tone={st.tone} icon={st.icon} label={st.label} title={st.hint} />
            {u.failedLogins > 0 && <span className="acr-cell-sub">{formatCount(u.failedLogins)} failed sign-in{u.failedLogins === 1 ? '' : 's'}</span>}
          </span>
        );
      },
    },
    {
      key: 'login',
      header: 'Last sign-in',
      sortValue: (u) => u.lastLoginAt ?? 0,
      render: (u) => (u.lastLoginAt ? <span title={formatDateTime(u.lastLoginAt)}>{formatAgo(now - u.lastLoginAt)}</span> : <span className="acr-users-dim">never</span>),
    },
    {
      key: 'sessions',
      header: 'Sessions',
      numeric: true,
      sortValue: (u) => sessionsOf(u.id).length,
      render: (u) => {
        const n = sessionsOf(u.id).length;
        return n > 0 ? (
          <button type="button" className="acr-users-linkbtn jpb-num" onClick={() => setSessionFilter(u.id)} aria-label={`Show ${n} active sessions of ${u.displayName}`}>
            {formatCount(n)}
          </button>
        ) : (
          <span className="acr-users-dim">0</span>
        );
      },
    },
    {
      key: 'created',
      header: 'Created',
      sortValue: (u) => u.createdAt,
      render: (u) => (
        <span className="acr-cell-stack">
          <span>{formatDateTime(u.createdAt).split(',')[0]}</span>
          <span className="acr-cell-sub">by {nameOf(u.createdBy)}</span>
        </span>
      ),
    },
  ];

  const header = (
    <PageHeader
      title="Admin users"
      icon="key"
      description="Control-room accounts: roles, tournament scope, sign-in status and active sessions. Changes need a typed confirmation and are audit-logged."
      actions={
        canManage ? (
          <Button variant="primary" size="sm" icon="plus" onClick={() => open({ kind: 'create', draft: EMPTY_DRAFT })}>
            New admin user
          </Button>
        ) : undefined
      }
    />
  );

  if (!canManage) {
    return (
      <div className="acr-page acr-users">
        {header}
        <EmptyState icon="lock" title="Admin users are restricted" description="Managing admin users requires the ADMIN_USERS_MANAGE permission (super admins)." />
      </div>
    );
  }
  if (users.isLoading) {
    return (
      <div className="acr-page acr-users" aria-busy="true" aria-label="Loading admin users">
        {header}
        <Skeleton shape="block" height={88} />
        <Skeleton shape="block" height={360} />
      </div>
    );
  }
  if (!users.data) {
    return (
      <div className="acr-page acr-users">
        {header}
        <ErrorState title="Could not load the admin users" description={friendlyError(users.error).description} onRetry={() => void users.refetch()} />
      </div>
    );
  }

  const byStatus = (s: UserStatus) => list.filter((u) => userStatus(u) === s).length;
  const roleCounts = Object.fromEntries(ROLES.map((r) => [r, list.filter((u) => u.role === r).length])) as Record<AdminRole, number>;
  const signedIn = new Set((sessions.data?.sessions ?? []).map((s) => s.adminId)).size;
  const chip = (active: boolean, label: string, n: number, onClick: () => void, icon?: Parameters<typeof Icon>[0]['name']) => (
    <button key={label} type="button" className={cx('acr-users-chip', active && 'is-on')} aria-pressed={active} onClick={onClick}>
      {icon && <Icon name={icon} />}
      {label}
      <span className="acr-users-chip__n jpb-num">{formatCount(n)}</span>
    </button>
  );

  return (
    <div className="acr-page acr-users">
      {header}
      <section className="acr-users-summary" aria-label="Accounts summary">
        <div>
          <span className="acr-users-summary__label">Accounts</span>
          <span className="acr-users-summary__value jpb-num">{formatCount(list.length)}</span>
        </div>
        <div>
          <span className="acr-users-summary__label">
            <Icon name="check-circle" /> Active
          </span>
          <span className="acr-users-summary__value jpb-num">{formatCount(byStatus('active'))}</span>
        </div>
        <div className={cx(byStatus('locked') > 0 && 'is-warning')}>
          <span className="acr-users-summary__label">
            <Icon name="lock" /> Locked
          </span>
          <span className="acr-users-summary__value jpb-num">{formatCount(byStatus('locked'))}</span>
        </div>
        <div>
          <span className="acr-users-summary__label">
            <Icon name="ban" /> Disabled
          </span>
          <span className="acr-users-summary__value jpb-num">{formatCount(byStatus('disabled'))}</span>
        </div>
        <div>
          <span className="acr-users-summary__label">
            <Icon name="monitor" /> Signed in now
          </span>
          <span className="acr-users-summary__value jpb-num">{formatCount(signedIn)}</span>
        </div>
      </section>

      <Panel flush title={`${formatCount(shown.length)} of ${formatCount(list.length)} accounts`} icon="users" className={cx(users.isStale && 'jpb-stale')} description={users.isStale ? 'Not current — the last refresh failed.' : 'Open a row’s ⋯ menu for its controls.'}>
        <div className="acr-users-toolbar">
          <div className="acr-users-chips" role="group" aria-label="Filter by role">
            {chip(filters.role === '', 'All roles', list.length, () => update({ role: '' }))}
            {ROLES.map((r) => chip(filters.role === r, ROLE_META[r].label, roleCounts[r], () => update({ role: r }), ROLE_META[r].icon))}
          </div>
          <div className="acr-users-chips" role="group" aria-label="Filter by status">
            {(Object.keys(STATUS_META) as UserStatus[]).map((s) => chip(filters.status === s, STATUS_META[s].label, byStatus(s), () => update({ status: filters.status === s ? '' : s }), STATUS_META[s].icon))}
          </div>
          <SearchInput className="acr-users-search" value={filters.q} onChange={(q) => update({ q: q.slice(0, 64) })} label="Search admin users" placeholder="Name or username" resultSummary={`${formatCount(shown.length)} accounts`} />
        </div>
        <DataTable
          label="Admin users"
          columns={columns}
          rows={shown.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)}
          rowKey={(u) => u.id}
          rowLabel={(u) => u.displayName}
          rowActions={rowActions}
          density="compact"
          stickyFirstColumn
          pagination={shown.length > PAGE_SIZE ? { page, pageSize: PAGE_SIZE, total: shown.length, onPageChange: setPage } : undefined}
          empty={<EmptyState compact icon="search" title="No account matches" description="Try another name, role or status." />}
        />
      </Panel>

      <SessionsPanel sessions={sessions} users={list} meId={me?.admin.id ?? null} now={now} actions={actions} filterAdminId={sessionFilter} onClearFilter={() => setSessionFilter(null)} />

      <PermissionMatrix matrix={matrix} counts={roleCounts} />

      {dialog?.kind === 'create' && (
        <UserDialog
          key={dialogSeq}
          mode="create"
          initial={dialog.draft}
          canGrantSuper={isSuper}
          isSelf={false}
          takenUsernames={list.map((u) => u.username)}
          tournaments={tList}
          tournamentsLoading={tournaments.isLoading}
          onSubmit={(d) => void submitCreate(d)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'edit' && (
        <UserDialog
          key={dialogSeq}
          mode="edit"
          user={dialog.user}
          initial={dialog.draft}
          canGrantSuper={isSuper}
          isSelf={dialog.user.id === me?.admin.id}
          takenUsernames={[]}
          tournaments={tList}
          tournamentsLoading={tournaments.isLoading}
          onSubmit={(d) => void submitEdit(dialog.user, d)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'password' && <PasswordDialog key={dialogSeq} user={dialog.user} initial={dialog.pw} onSubmit={(p, c) => void submitPassword(dialog.user, p, c)} onClose={() => setDialog(null)} />}
    </div>
  );
}
