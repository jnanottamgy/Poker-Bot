import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { TableSizeConfig } from '@jpb/shared-types';
import { formFields, registrationState, seatingPreview, seatingText, tableCount } from '../src/sections/registration/model';
import { buildConfig } from '../src/api/mock/seedData';
import { renderControlRoom } from './support/renderControlRoom';

const TIMEOUT = { timeout: 5000 };

async function openRegistration(tid = 'trn_friday', as = 'director') {
  const r = renderControlRoom(`/t/${tid}/registration`, { as });
  await screen.findByRole('heading', { name: /^Registration$/, level: 2 }, TIMEOUT);
  await screen.findByRole('region', { name: 'Registration status' }, TIMEOUT);
  return { ...r, t: () => r.mock.server.tournament(tid) };
}

describe('Registration (§2.9)', { timeout: 20_000 }, () => {
  it('shows the state, counts vs min / max, the QR, the access code and the rules', async () => {
    const { t } = await openRegistration();
    const hero = screen.getByRole('region', { name: 'Registration status' });
    expect(within(hero).getByText('Registration open')).toBeTruthy();
    expect(within(hero).getByText(/\/ 1,000 players/)).toBeTruthy();
    expect(within(hero).getByText(/Minimum of 2 players reached/)).toBeTruthy();
    expect(within(hero).getByText('Until end of level 6')).toBeTruthy();
    expect(await screen.findByRole('img', { name: /QR code of the join page .*\/join\/FRITURBO/ }, TIMEOUT)).toBeTruthy();
    expect(screen.getAllByText(t().config.registration.accessCode!).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Registration rules' })).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Registration form fields' }).textContent).toContain('Email');
  });

  it('pending queue: approve (level 1) and reject with a required reason', async () => {
    const { t, mock } = await openRegistration();
    const queue = await screen.findByRole('table', { name: 'Pending registrations' }, TIMEOUT);
    await waitFor(() => expect(within(queue).getAllByRole('row').length).toBe(13), TIMEOUT);
    const pending = t().players.filter((p) => p.status === 'PENDING_APPROVAL');
    const [a, b] = pending;

    fireEvent.click(within(queue).getByRole('button', { name: `Approve ${a!.displayName}` }));
    const d1 = await screen.findByRole('dialog', { name: `Approve ${a!.displayName}` }, TIMEOUT);
    fireEvent.click(within(d1).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(a!.status).toBe('REGISTERED'), TIMEOUT);

    fireEvent.click(within(screen.getByRole('table', { name: 'Pending registrations' })).getByRole('button', { name: `Reject ${b!.displayName}` }));
    const d2 = await screen.findByRole('dialog', { name: `Reject ${b!.displayName}` }, TIMEOUT);
    const go = within(d2).getByRole('button', { name: 'Reject registration' }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.change(within(d2).getByLabelText(/Reason/), { target: { value: 'Duplicate registration' } });
    fireEvent.click(go);
    await waitFor(() => expect(b!.status).toBe('WITHDRAWN'), TIMEOUT);
    expect(mock.server.world.audit.some((e) => e.action === 'PLAYER_REJECTED' && e.reason === 'Duplicate registration')).toBe(true);
  });

  it('close registration, then START with admin entropy and the seating preview', async () => {
    const { t } = await openRegistration();
    const start = screen.getByRole('button', { name: 'Start tournament…' }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    expect(screen.getByText('Close registration first')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Close registration' }));
    const d = await screen.findByRole('dialog', { name: 'Close registration' }, TIMEOUT);
    fireEvent.click(within(d).getByRole('button', { name: 'Close registration' }));
    await waitFor(() => expect(t().status).toBe('REGISTRATION_CLOSED'), TIMEOUT);
    await waitFor(() => expect((screen.getByRole('button', { name: 'Start tournament…' }) as HTMLButtonElement).disabled).toBe(false), TIMEOUT);

    const n = t().players.filter((p) => p.status === 'REGISTERED').length;
    expect(screen.getAllByText(new RegExp(`^${n} players → \\d+ tables`)).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText('Admin entropy (optional)'), { target: { value: 'dice 4-1-6-6-2-3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start tournament…' }));
    const c = await screen.findByRole('dialog', { name: 'Start tournament' }, TIMEOUT);
    expect(within(c).getByText(/admin entropy is mixed into the public entropy/)).toBeTruthy();
    expect(within(c).getByText(/pending registrations are NOT seated/)).toBeTruthy();
    fireEvent.click(within(c).getByRole('button', { name: 'Start tournament' }));
    await waitFor(() => expect(t().startedAt).not.toBeNull(), TIMEOUT);
  });

  it('opens registration of a draft tournament (level 1)', async () => {
    const { t } = await openRegistration('trn_founders');
    expect(within(screen.getByRole('region', { name: 'Registration status' })).getByText('Not open yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open registration' }));
    const d = await screen.findByRole('dialog', { name: 'Open registration' }, TIMEOUT);
    fireEvent.click(within(d).getByRole('button', { name: 'Open registration' }));
    await waitFor(() => expect(t().status).toBe('REGISTRATION'), TIMEOUT);
  });

  it('manual registration: configured fields, validation, confirmation and the printable seat card', async () => {
    const { t } = await openRegistration();
    const before = t().players.length;
    const form = screen.getByRole('button', { name: 'Register player…' }).closest('form')!;
    fireEvent.click(within(form).getByRole('button', { name: 'Register player…' }));
    expect(await within(form).findByText('Name is required.')).toBeTruthy();
    expect(within(form).getByText('Email is required.')).toBeTruthy();
    fireEvent.change(within(form).getByLabelText(/^Name/), { target: { value: 'Priya Raman' } });
    fireEvent.change(within(form).getByLabelText(/^Email/), { target: { value: 'not-an-email' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Register player…' }));
    expect(await within(form).findByText('Enter a valid email address.')).toBeTruthy();
    fireEvent.change(within(form).getByLabelText(/^Email/), { target: { value: 'priya@example.com' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Register player…' }));
    const d = await screen.findByRole('dialog', { name: 'Register Priya Raman' }, TIMEOUT);
    fireEvent.click(within(d).getByRole('button', { name: 'Register player' }));
    await waitFor(() => expect(t().players.length).toBe(before + 1), TIMEOUT);
    const p = t().players[t().players.length - 1]!;
    const card = await screen.findByRole('article', { name: 'Seat card for Priya Raman' }, TIMEOUT);
    expect(within(card).getByText(p.publicId)).toBeTruthy();
    expect(within(card).getByLabelText(/^Rejoin code/).textContent).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(screen.getByRole('button', { name: 'Print seat card' })).toBeTruthy();
  });

  it('projector view: full-screen QR with the live count, Esc closes it', async () => {
    await openRegistration();
    fireEvent.click(screen.getAllByRole('button', { name: 'Projector view' })[0]!);
    const v = await screen.findByRole('dialog', { name: /Projector view/ }, TIMEOUT);
    expect(within(v).getByText(/Scan with your phone camera to join/)).toBeTruthy();
    expect(within(v).getByText(/registered/)).toBeTruthy();
    fireEvent.keyDown(v, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Projector view/ })).toBeNull(), TIMEOUT);
  });

  it('a viewer cannot open, start, approve or register', async () => {
    await openRegistration('trn_friday', 'viewer');
    expect(screen.queryByRole('button', { name: 'Close registration' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start tournament…' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Manual registration' })).toBeNull();
    const queue = await screen.findByRole('table', { name: 'Pending registrations' }, TIMEOUT);
    expect(within(queue).queryAllByRole('button', { name: /^Approve/ })).toHaveLength(0);
  });
});

describe('registration model', () => {
  const cfg: TableSizeConfig = { targetSize: 8, maxSize: 9, minSize: 2, finalTableSize: 9 };

  it('table count follows the seating-engine formula (documented examples)', () => {
    const cases: Array<[number, number]> = [[0, 0], [5, 1], [9, 1], [16, 2], [24, 3], [100, 13], [1_000, 125], [10_000, 1_250], [1_000_000, 125_000]];
    for (const [n, tables] of cases) expect(tableCount(n, cfg, 'TARGET')).toBe(tables);
    expect(tableCount(100, cfg, 'MAX')).toBe(12);
  });

  it('seating preview balances table sizes (max − min ≤ 1)', () => {
    const p = seatingPreview(100, cfg, 'TARGET');
    expect(p.groups).toEqual([{ size: 8, count: 9 }, { size: 7, count: 4 }]);
    expect(p.groups.reduce((a, g) => a + g.size * g.count, 0)).toBe(100);
    expect(seatingText(p)).toBe('100 players → 13 tables (9 × 8 + 4 × 7 players)');
  });

  it('describes late registration by level', () => {
    const c = buildConfig('X', 'XCODE', 100);
    const level = (n: number) => ({ level: n, smallBlind: 1, bigBlind: 2, ante: 0, durationSeconds: 60 });
    expect(registrationState('RUNNING', c, level(3)).key).toBe('late');
    expect(registrationState('RUNNING', c, level(7)).key).toBe('late-ended');
    expect(registrationState('RUNNING', { ...c, lateRegistration: { enabled: false, untilLevel: 0 } }, level(1)).key).toBe('over');
    expect(registrationState('REGISTRATION', c, null).key).toBe('open');
    expect(registrationState('DRAFT', c, null).key).toBe('draft');
  });

  it('manual form always starts with a required name', () => {
    const c = buildConfig('X', 'XCODE', 100);
    const fields = formFields({ ...c, registration: { ...c.registration, fields: [{ key: 'email', required: true }] } });
    expect(fields.map((f) => [f.key, f.required])).toEqual([
      ['name', true],
      ['email', true],
    ]);
  });
});
