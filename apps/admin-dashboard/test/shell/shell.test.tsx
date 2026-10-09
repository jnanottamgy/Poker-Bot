import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MOCK_PASSWORD } from '../../src/api/mock';
import { renderControlRoom } from '../support/renderControlRoom';

const TIMEOUT = { timeout: 5000 };

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* no storage in this environment */
  }
});

describe('control room shell', () => {
  it('signs in from the login page and lands on the tournament list', async () => {
    const { router } = renderControlRoom('/t/trn_spring/overview', { as: null });
    await screen.findByRole('heading', { name: 'Control Room' }, TIMEOUT);
    fireEvent.change(screen.getByLabelText(/Username/), { target: { value: 'director' } });
    fireEvent.change(screen.getByLabelText(/Password/), { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Username or password is incorrect', undefined, TIMEOUT)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Password/), { target: { value: MOCK_PASSWORD } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    // Returns to where the operator was going.
    await waitFor(() => expect(router.state.location.pathname).toBe('/t/trn_spring/overview'), TIMEOUT);
    expect(await screen.findByRole('heading', { name: /Overview/ }, TIMEOUT)).toBeTruthy();
  });

  it('top bar: live clock, counters, alerts bell, pause and freeze', async () => {
    const { mock } = renderControlRoom('/t/trn_spring/overview');
    const t = mock.server.tournament('trn_spring');
    const level = t.config.blindSchedule[t.clock.levelIndex]!;
    const timer = await screen.findByRole('timer', { name: new RegExp(`^Level ${level.level}, blinds`) }, TIMEOUT);
    expect(timer.textContent).toContain(`L${level.level}`);
    expect(screen.getByRole('button', { name: /Alerts: \d+ open/ })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Pause after hand' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Emergency freeze' })).toBeTruthy();
    expect(screen.getByRole('status', { name: /Live updates/ })).toBeTruthy();
  });

  it('emergency freeze is a level-2 action (type FREEZE + reason)', async () => {
    const { mock } = renderControlRoom('/t/trn_spring/overview');
    fireEvent.click(await screen.findByRole('button', { name: 'Emergency freeze' }, TIMEOUT));
    const d = await screen.findByRole('dialog');
    const confirm = within(d).getByRole('button', { name: 'Freeze everything now' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(d).getByLabelText(/Reason/), { target: { value: 'Network outage at the venue' } });
    fireEvent.change(within(d).getByLabelText(/to confirm/), { target: { value: 'FREEZE' } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(mock.server.tournament('trn_spring').frozen).toBe(true), TIMEOUT);
    expect(await screen.findByText(/EMERGENCY FREEZE ACTIVE/, undefined, TIMEOUT)).toBeTruthy();
  });

  it('"/" opens global search; a player result opens the player screen', async () => {
    const { router } = renderControlRoom('/t/trn_spring/overview');
    await screen.findByRole('heading', { name: /Overview/ }, TIMEOUT);
    fireEvent.keyDown(document, { key: '/' });
    const input = await screen.findByRole('combobox');
    fireEvent.change(input, { target: { value: 'Meera' } });
    const first = (await screen.findAllByRole('option', undefined, TIMEOUT))[0]!;
    expect(first.textContent).toMatch(/Meera/);
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/t\/trn_spring\/players\//), TIMEOUT);
  });

  it('greys the screen and says so while live updates reconnect', async () => {
    const { mock, container } = renderControlRoom('/t/trn_spring/overview');
    await screen.findByRole('heading', { name: /Overview/ }, TIMEOUT);
    await screen.findByRole('status', { name: /Live updates connected/ }, TIMEOUT);
    mock.hub.drop(10_000);
    expect(await screen.findByText(/Reconnecting to live updates|Live updates are offline/, undefined, TIMEOUT)).toBeTruthy();
    expect(container.querySelector('.acr-content[data-stale="true"]')).not.toBeNull();
    expect(container.querySelector('.acr-topstatus[data-stale="true"]')).not.toBeNull();
  });
});

describe('tournaments', () => {
  it('lists live tournaments first and filters by status and search', async () => {
    renderControlRoom('/tournaments');
    const live = await screen.findByRole('region', { name: 'Live now' }, TIMEOUT);
    const cards = within(live).getAllByRole('button');
    expect(cards[0]!.textContent).toMatch(/Running/i);
    fireEvent.click(screen.getByRole('tab', { name: /Drafts/ }));
    await waitFor(() => expect(screen.getByRole('table', { name: 'Tournaments' }).textContent).toContain('Founders Freeroll'));
    expect(screen.getByRole('table', { name: 'Tournaments' }).textContent).not.toContain('Spring Showdown');
    fireEvent.click(screen.getByRole('tab', { name: /All/ }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tournaments' }), { target: { value: 'MONSOON' } });
    await waitFor(() => expect(screen.getByRole('table', { name: 'Tournaments' }).textContent).toContain('Monsoon Masters'));
    expect(screen.getByRole('table', { name: 'Tournaments' }).textContent).not.toContain('Tuesday Deepstack');
  });
});

describe('overview', () => {
  it('shows the FSM with the current state, legal transitions, KPIs and chip conservation', async () => {
    renderControlRoom('/t/trn_spring/overview');
    await screen.findByRole('heading', { name: /Overview/ }, TIMEOUT);
    const fsm = screen.getByRole('list', { name: 'Tournament lifecycle' });
    const current = within(fsm).getAllByRole('listitem').find((li) => li.getAttribute('aria-current') === 'step');
    expect(current?.textContent).toMatch(/Running/);
    expect(screen.getByRole('button', { name: 'Start break now' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel tournament…' })).toBeTruthy();
    const kpis = screen.getByRole('region', { name: 'Key figures' });
    for (const label of ['Players remaining', 'Hands / min', 'Estimated completion', 'Chip leader', 'Largest pot']) expect(within(kpis).getByText(label)).toBeTruthy();
    expect(screen.getByText(/Conserved — every chip is accounted for/)).toBeTruthy();
  });
});
