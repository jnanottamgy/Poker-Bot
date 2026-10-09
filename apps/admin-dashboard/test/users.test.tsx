import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { AdminUserDto } from '@jpb/shared-types';
import { ROLE_PERMISSIONS } from '@jpb/shared-types';
import { deviceLabel, filterUsers, generatePassword, passwordProblem, permissionDiff, rolePermissionsOf, sameScope, usernameProblem, userStatus } from '../src/sections/users/model';
import { renderControlRoom } from './support/renderControlRoom';

const TIMEOUT = { timeout: 5000 };

const user = (x: Partial<AdminUserDto>): AdminUserDto => ({
  id: 'adm_x',
  username: 'x',
  displayName: 'X',
  role: 'STAFF',
  tournamentScope: null,
  createdAt: 0,
  createdBy: null,
  disabled: false,
  lastLoginAt: null,
  locked: false,
  failedLogins: 0,
  ...x,
});

async function openUsers(as = 'super') {
  const r = renderControlRoom('/users', { as });
  await screen.findByRole('heading', { name: /^Admin users$/, level: 2 }, TIMEOUT);
  await screen.findByRole('table', { name: 'Admin users' }, TIMEOUT);
  return r;
}

/** Opens a row's ⋯ menu and picks an item. */
function rowAction(name: string, item: RegExp) {
  fireEvent.click(screen.getByRole('button', { name: `Actions for ${name}` }));
  fireEvent.click(screen.getByRole('menuitem', { name: item }));
}

/** Fills a level-2 dialog (reason + typed word) and confirms. */
function confirmL2(dialog: HTMLElement, word: string, button: string, reason = 'Requested by the head of security') {
  fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: reason } });
  fireEvent.change(within(dialog).getByLabelText(/to confirm/), { target: { value: word } });
  fireEvent.click(within(dialog).getByRole('button', { name: button }));
}

describe('admin users model', () => {
  it('enforces the server password and username policy', () => {
    expect(passwordProblem('short', 'short')).toMatch(/at least 12/);
    expect(passwordProblem('long enough pw', 'long enough px')).toMatch(/do not match/);
    expect(passwordProblem('long enough pw', 'long enough pw')).toBeNull();
    expect(usernameProblem('ab', [])).toMatch(/at least 3/);
    expect(usernameProblem('bad name', [])).toMatch(/letters, digits/);
    expect(usernameProblem('Director', ['director'])).toMatch(/already in use/);
    expect(usernameProblem('floor.lead-2', ['director'])).toBeNull();
  });

  it('generates passwords from the CSPRNG without modulo bias', () => {
    const pw = generatePassword();
    expect(pw).toHaveLength(20);
    expect(pw).not.toMatch(/[0O1lI]/);
    // Bytes at or above the rejection limit are skipped, never wrapped.
    let call = 0;
    const fake = (b: Uint8Array) => {
      b.fill(call++ === 0 ? 255 : 0);
      return b;
    };
    expect(generatePassword(4, fake)).toBe('AAAA');
  });

  it('diffs role permissions and classifies accounts', () => {
    const m = rolePermissionsOf(undefined);
    expect(m.SUPER_ADMIN).toEqual(ROLE_PERMISSIONS.SUPER_ADMIN);
    const d = permissionDiff(m, 'TOURNAMENT_DIRECTOR', 'SUPER_ADMIN');
    expect(d.gains).toEqual(expect.arrayContaining(['STACK_ADJUST', 'VIEW_HOLE_CARDS', 'ADMIN_USERS_MANAGE']));
    expect(d.loses).toEqual([]);
    expect(userStatus(user({ disabled: true, locked: true }))).toBe('disabled');
    expect(userStatus(user({ locked: true }))).toBe('locked');
    expect(sameScope(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameScope(null, [])).toBe(false);
    expect(deviceLabel('Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) Safari/605.1')).toBe('Safari · iPad');
    const list = [user({ id: '1', displayName: 'Zed', role: 'VIEWER' }), user({ id: '2', displayName: 'Amy', role: 'SUPER_ADMIN' })];
    expect(filterUsers(list, { q: '', role: '', status: '' }).map((u) => u.id)).toEqual(['2', '1']);
    expect(filterUsers(list, { q: 'ze', role: '', status: '' }).map((u) => u.id)).toEqual(['1']);
  });
});

describe('Admin users (§2.19)', { timeout: 30_000 }, () => {
  it('lists accounts with role, scope and status, the sessions and the permission matrix', async () => {
    await openUsers();
    const table = screen.getByRole('table', { name: 'Admin users' });
    expect(within(table).getByText('Riya Kapoor')).toBeTruthy();
    expect(within(table).getByText('Campus Cup — Final Day')).toBeTruthy();
    expect(within(table).getByText('Locked')).toBeTruthy();
    expect(within(table).getByText('Disabled')).toBeTruthy();
    const sessions = await screen.findByRole('table', { name: 'Active sessions' }, TIMEOUT);
    expect(within(sessions).getByText('Meera Iyer')).toBeTruthy();
    const matrix = screen.getByRole('table', { name: 'Role permissions' });
    const stackRow = within(matrix).getByText('STACK_ADJUST').closest('tr')!;
    expect(within(stackRow).getAllByText('Granted')).toHaveLength(1);
    expect(within(stackRow).getAllByText('Not granted')).toHaveLength(3);
  });

  it('creates a user (password policy, then a level-1 confirmation; cancelling returns to the form)', async () => {
    const { mock } = await openUsers();
    fireEvent.click(screen.getByRole('button', { name: 'New admin user' }));
    let form = await screen.findByRole('dialog', { name: 'New admin user' }, TIMEOUT);
    fireEvent.change(within(form).getByLabelText(/^Username/), { target: { value: 'floor.lead' } });
    fireEvent.change(within(form).getByLabelText(/^Display name/), { target: { value: 'Floor Lead' } });
    fireEvent.change(within(form).getByLabelText(/^Role/), { target: { value: 'STAFF' } });
    fireEvent.change(within(form).getByLabelText(/^Initial password/), { target: { value: 'too-short' } });
    fireEvent.change(within(form).getByLabelText(/^Repeat the password/), { target: { value: 'too-short' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Create user…' }));
    expect(within(form).getByText('At least 12 characters.')).toBeTruthy();

    fireEvent.click(within(form).getByRole('radio', { name: /Only selected tournaments/ }));
    fireEvent.click(within(form).getByRole('checkbox', { name: /Friday Night Turbo/ }));
    fireEvent.click(within(form).getByRole('button', { name: 'Generate strong password' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Create user…' }));

    let confirm = await screen.findByRole('dialog', { name: 'Create floor.lead' }, TIMEOUT);
    expect(within(confirm).getByText(/Limited to Friday Night Turbo/)).toBeTruthy();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    form = await screen.findByRole('dialog', { name: 'New admin user' }, TIMEOUT);
    expect((within(form).getByLabelText(/^Username/) as HTMLInputElement).value).toBe('floor.lead');

    fireEvent.click(within(form).getByRole('button', { name: 'Create user…' }));
    confirm = await screen.findByRole('dialog', { name: 'Create floor.lead' }, TIMEOUT);
    fireEvent.click(within(confirm).getByRole('button', { name: 'Create admin user' }));
    await waitFor(() => expect(mock.server.world.admins.some((a) => a.username === 'floor.lead')).toBe(true), TIMEOUT);
    const created = mock.server.world.admins.find((a) => a.username === 'floor.lead')!;
    expect(created.role).toBe('STAFF');
    expect(created.tournamentScope).toEqual(['trn_friday']);
    expect(created.password).toHaveLength(20);
    await screen.findByText('Floor Lead', undefined, TIMEOUT);
  });

  it('changes a role with the level-2 USER confirmation and a before → after preview', async () => {
    const { mock } = await openUsers();
    rowAction('Karan Mehta', /Edit role/);
    const form = await screen.findByRole('dialog', { name: 'Edit Karan Mehta' }, TIMEOUT);
    fireEvent.change(within(form).getByLabelText(/^Role/), { target: { value: 'TOURNAMENT_DIRECTOR' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Review change…' }));
    const d = await screen.findByRole('dialog', { name: 'Change staff' }, TIMEOUT);
    expect(within(d).getByText('Tournament director')).toBeTruthy();
    expect(within(d).getByText(/Gains \d+ permissions/)).toBeTruthy();
    confirmL2(d, 'USER', 'Apply change');
    await waitFor(() => expect(mock.server.world.admins.find((a) => a.username === 'staff')!.role).toBe('TOURNAMENT_DIRECTOR'), TIMEOUT);
    expect(mock.server.world.audit.some((e) => e.action === 'ADMIN_USER_UPDATED' && e.reason === 'Requested by the head of security')).toBe(true);
  });

  it('disables an account (level 2) and cannot disable yourself', async () => {
    const { mock } = await openUsers();
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Riya Kapoor' }));
    expect(screen.getByRole('menuitem', { name: /Disable account/ }).getAttribute('aria-disabled')).toBe('true');
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    rowAction('Ana Costa', /Disable account/);
    const d = await screen.findByRole('dialog', { name: 'Disable viewer' }, TIMEOUT);
    confirmL2(d, 'USER', 'Disable account');
    await waitFor(() => expect(mock.server.world.admins.find((a) => a.username === 'viewer')!.disabled).toBe(true), TIMEOUT);
  });

  it('resets a password (form, then level 2)', async () => {
    const { mock } = await openUsers();
    rowAction('Meera Iyer', /Reset password/);
    const form = await screen.findByRole('dialog', { name: 'Reset password — Meera Iyer' }, TIMEOUT);
    fireEvent.change(within(form).getByLabelText(/^New password/), { target: { value: 'correct horse battery' } });
    fireEvent.change(within(form).getByLabelText(/^Repeat the password/), { target: { value: 'correct horse battery' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Continue…' }));
    const d = await screen.findByRole('dialog', { name: 'Reset password — director' }, TIMEOUT);
    confirmL2(d, 'USER', 'Reset password');
    await waitFor(() => expect(mock.server.world.admins.find((a) => a.username === 'director')!.password).toBe('correct horse battery'), TIMEOUT);
  });

  it('revokes one admin session with a required reason', async () => {
    const { mock } = await openUsers();
    const sessions = await screen.findByRole('table', { name: 'Active sessions' }, TIMEOUT);
    fireEvent.click(within(sessions).getByRole('button', { name: /Revoke session of Karan Mehta/ }));
    const d = await screen.findByRole('dialog', { name: 'Revoke session of Karan Mehta' }, TIMEOUT);
    const go = within(d).getByRole('button', { name: 'Revoke session' }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.change(within(d).getByLabelText(/Reason/), { target: { value: 'Lost tablet' } });
    fireEvent.click(go);
    await waitFor(() => expect(mock.server.world.sessions.find((s) => s.id === 'ses_staff')!.revokedAt).not.toBeNull(), TIMEOUT);
  });

  it('is restricted without ADMIN_USERS_MANAGE', async () => {
    renderControlRoom('/users', { as: 'director' });
    await screen.findByText('Admin users are restricted', undefined, TIMEOUT);
    expect(screen.queryByRole('button', { name: 'New admin user' })).toBeNull();
  });
});
