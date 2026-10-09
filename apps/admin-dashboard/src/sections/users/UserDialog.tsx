import { useState } from 'react';
import type { AdminRole, AdminUserDto, TournamentListItemDto } from '@jpb/shared-types';
import { Button, Icon, Modal, Select, TextField } from '@jpb/ui';
import { DISPLAY_NAME_MAX, ROLES, ROLE_META, USERNAME_RULE, displayNameProblem, passwordProblem, sameScope, usernameProblem } from './model';
import { PasswordFields, ScopePicker } from './fields';

export interface UserDraft {
  username: string;
  displayName: string;
  role: AdminRole;
  scope: string[] | null;
  password: string;
  confirm: string;
}

export const EMPTY_DRAFT: UserDraft = { username: '', displayName: '', role: 'STAFF', scope: null, password: '', confirm: '' };

export function draftOf(u: AdminUserDto): UserDraft {
  return { username: u.username, displayName: u.displayName, role: u.role, scope: u.tournamentScope, password: '', confirm: '' };
}

export interface UserDialogProps {
  mode: 'create' | 'edit';
  initial: UserDraft;
  /** The account being edited (edit mode). */
  user?: AdminUserDto;
  /** The signed-in admin may grant SUPER_ADMIN. */
  canGrantSuper: boolean;
  /** Editing your own account: role is locked (the server refuses it). */
  isSelf: boolean;
  takenUsernames: readonly string[];
  tournaments: readonly TournamentListItemDto[];
  tournamentsLoading: boolean;
  onSubmit: (draft: UserDraft) => void;
  onClose: () => void;
}

/**
 * Create / edit form. Submitting does not save: it hands the draft to the
 * caller, which asks for the confirmation (L1 create, L2 `USER` edit) and
 * reopens this form with the same draft if the operator goes back.
 */
export function UserDialog({ mode, initial, user, canGrantSuper, isSelf, takenUsernames, tournaments, tournamentsLoading, onSubmit, onClose }: UserDialogProps) {
  const [d, setD] = useState<UserDraft>(initial);
  const [tried, setTried] = useState(false);
  const set = (patch: Partial<UserDraft>) => setD((p) => ({ ...p, ...patch }));

  const errors = {
    username: mode === 'create' ? usernameProblem(d.username, takenUsernames) : null,
    displayName: displayNameProblem(d.displayName),
    password: mode === 'create' ? passwordProblem(d.password, d.confirm) : null,
    scope: d.scope !== null && d.scope.length === 0 ? 'Choose at least one tournament, or allow all tournaments.' : null,
  };
  const valid = Object.values(errors).every((e) => e === null);
  const unchanged = mode === 'edit' && user !== undefined && d.displayName.trim() === user.displayName && d.role === user.role && sameScope(d.scope, user.tournamentScope);
  const roleOptions = ROLES.filter((r) => r !== 'SUPER_ADMIN' || canGrantSuper || initial.role === 'SUPER_ADMIN').map((r) => ({ value: r, label: ROLE_META[r].label }));

  const submit = () => {
    setTried(true);
    if (!valid || unchanged) return;
    onSubmit({ ...d, username: d.username.trim(), displayName: d.displayName.trim() });
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={mode === 'create' ? 'New admin user' : `Edit ${user?.displayName ?? 'admin user'}`}
      description={mode === 'create' ? 'Admin accounts are separate from player accounts. Every change is audit-logged.' : 'Changes need a typed confirmation and a reason; they apply on the admin’s next request.'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon="arrow-right" onClick={submit} disabled={unchanged}>
            {mode === 'create' ? 'Create user…' : 'Review change…'}
          </Button>
        </>
      }
    >
      <form
        className="acr-users-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="acr-users-form__row">
          <TextField
            label="Username"
            value={d.username}
            required
            disabled={mode === 'edit'}
            maxLength={USERNAME_RULE.max}
            autoComplete="off"
            hint={mode === 'edit' ? 'Usernames cannot change (the audit log refers to them).' : 'Letters, digits, dot, dash, underscore. Used to sign in.'}
            error={tried ? errors.username : null}
            onChange={(e) => set({ username: e.target.value })}
          />
          <TextField label="Display name" value={d.displayName} required maxLength={DISPLAY_NAME_MAX} hint="Shown in the top bar and the audit log." error={tried ? errors.displayName : null} onChange={(e) => set({ displayName: e.target.value })} />
        </div>
        <Select
          label="Role"
          value={d.role}
          disabled={isSelf}
          options={roleOptions}
          hint={isSelf ? 'You cannot change your own role.' : ROLE_META[d.role].description}
          onChange={(e) => set({ role: e.target.value as AdminRole })}
        />
        {!canGrantSuper && (
          <p className="acr-users-dim acr-users-form__note">
            <Icon name="lock" /> Only a super admin can create or change super admin accounts.
          </p>
        )}
        <ScopePicker value={d.scope} onChange={(scope) => set({ scope })} tournaments={tournaments} loading={tournamentsLoading} error={tried ? errors.scope : null} />
        {mode === 'create' && <PasswordFields password={d.password} confirm={d.confirm} showErrors={tried} onChange={(p) => set(p)} label="Initial password" />}
        {tried && unchanged && <p className="acr-users-dim">Nothing changed yet.</p>}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}

export interface PasswordDialogProps {
  user: AdminUserDto;
  initial: { password: string; confirm: string };
  onSubmit: (password: string, confirm: string) => void;
  onClose: () => void;
}

/** New password for another admin (then the L2 `USER` confirmation). */
export function PasswordDialog({ user, initial, onSubmit, onClose }: PasswordDialogProps) {
  const [pw, setPw] = useState(initial);
  const [tried, setTried] = useState(false);
  const problem = passwordProblem(pw.password, pw.confirm);
  const submit = () => {
    setTried(true);
    if (!problem) onSubmit(pw.password, pw.confirm);
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`Reset password — ${user.displayName}`}
      description={`Sets a new password for ${user.username} and signs out all of their sessions. Give it to them in person.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon="arrow-right" onClick={submit}>
            Continue…
          </Button>
        </>
      }
    >
      <form
        className="acr-users-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <PasswordFields password={pw.password} confirm={pw.confirm} showErrors={tried} onChange={setPw} label="New password" />
        {tried && problem && (
          <p className="acr-users-error" role="alert">
            <Icon name="warning" /> {problem}
          </p>
        )}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}
