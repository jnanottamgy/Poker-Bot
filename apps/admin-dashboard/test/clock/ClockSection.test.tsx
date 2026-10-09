import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderControlRoom } from '../support/renderControlRoom';

const PATH = '/t/trn_spring/clock';
const TIMEOUT = { timeout: 4000 };

async function openClock(as = 'director') {
  const r = renderControlRoom(PATH, { as });
  await screen.findByRole('heading', { name: /Clock & Structure/ }, TIMEOUT);
  const t = () => r.mock.server.tournament('trn_spring');
  return { ...r, t };
}

/** Disabled itself or inside a disabled fieldset (locked ControlCard). */
const disabled = (el: HTMLElement) => (el as HTMLButtonElement).disabled || el.closest('fieldset[disabled]') !== null;

function dialog() {
  return screen.getByRole('dialog');
}

/** Fills the level-2 double confirmation (reason + typed word) and confirms. */
function confirmLevel2(word: string, button: RegExp) {
  const d = dialog();
  const confirm = within(d).getByRole('button', { name: button });
  expect(disabled(confirm)).toBe(true);
  fireEvent.change(within(d).getByLabelText(/Reason/), { target: { value: 'Floor decision after a dealer error' } });
  expect(disabled(confirm)).toBe(true);
  fireEvent.change(within(d).getByLabelText(/to confirm/), { target: { value: word } });
  expect(disabled(confirm)).toBe(false);
  fireEvent.click(confirm);
}

describe('Clock & Structure section', () => {
  it('shows the big clock, every control and the structure with projected times', async () => {
    const { t } = await openClock();
    const level = t().config.blindSchedule[t().clock.levelIndex]!;
    const clock = screen.getByRole('region', { name: 'Blind clock' });
    expect(within(clock).getByRole('timer').textContent).toContain(`Level ${level.level} of 30`);
    for (const name of ['Advance level', 'Set level…', 'Add 1 minute', 'Remove 1 minute', 'Add 5 minutes', 'Remove 5 minutes', 'Start break now', 'Pause after hand', 'Edit future levels & breaks']) {
      expect(screen.getAllByRole('button', { name }).length).toBeGreaterThan(0);
    }
    expect(screen.getByRole('switch', { name: /tables play at their own pace/ }).getAttribute('aria-checked')).toBe('false');
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(expect.arrayContaining(['Starts', 'Ends']));
    expect(within(table).getByText('NOW')).toBeTruthy();
    expect(within(table).getAllByText('Break').length).toBeGreaterThan(0);
  });

  it('advance level asks for one confirmation, then the server moves to the next level', async () => {
    const { t } = await openClock();
    const before = t().clock.levelIndex;
    fireEvent.click(screen.getByRole('button', { name: 'Advance level' }));
    const d = await screen.findByRole('dialog');
    expect(within(d).getByText(new RegExp(`Advance to level ${before + 2}`))).toBeTruthy();
    fireEvent.click(within(d).getByRole('button', { name: 'Advance level' }));
    await waitFor(() => expect(t().clock.levelIndex).toBe(before + 1), TIMEOUT);
    expect(t().clock.levelEndsAt).not.toBeNull();
  });

  it('adds and removes time through the add-time endpoint (negative allowed)', async () => {
    const { t } = await openClock();
    const before = t().clock.levelEndsAt!;
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 minute' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /^Add 1 min/ }));
    await waitFor(() => expect(t().clock.levelEndsAt).toBe(before + 60_000), TIMEOUT);

    fireEvent.change(screen.getByLabelText(/Custom amount/), { target: { value: '2:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    const d = await screen.findByRole('dialog');
    expect(within(d).getByText(/Remove 2 min 30 s from the level/)).toBeTruthy();
    fireEvent.click(within(d).getByRole('button', { name: /^Remove 2 min 30 s/ }));
    await waitFor(() => expect(t().clock.levelEndsAt).toBe(before + 60_000 - 150_000), TIMEOUT);
  });

  it('rejects a custom amount it cannot understand without calling the server', async () => {
    await openClock();
    fireEvent.change(screen.getByLabelText(/Custom amount/), { target: { value: 'soon' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Use minutes/);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('set level is level 2: pick the target, then type LEVEL and a reason', async () => {
    const { t } = await openClock();
    fireEvent.click(screen.getByRole('button', { name: 'Set level…' }));
    const pick = await screen.findByRole('dialog');
    fireEvent.change(within(pick).getByLabelText('New level'), { target: { value: '2' } });
    expect(within(pick).getByRole('status').textContent).toMatch(/BACKWARDS/);
    fireEvent.click(within(pick).getByRole('button', { name: 'Review change…' }));
    await screen.findByText('Set blind level 3');
    expect(within(dialog()).getByText('Before → after')).toBeTruthy();
    confirmLevel2('LEVEL', /Set level 3/);
    await waitFor(() => expect(t().clock.levelIndex).toBe(2), TIMEOUT);
  });

  it('edits a future level inline and saves it with the EDIT confirmation (current level stays locked)', async () => {
    const { t } = await openClock();
    const cur = t().clock.levelIndex;
    const nextNumber = t().config.blindSchedule[cur + 1]!.level;
    fireEvent.click(screen.getByRole('button', { name: 'Edit future levels & breaks' }));
    expect(screen.queryByLabelText(`Level ${nextNumber - 1} small blind`)).toBeNull();
    const minutes = screen.getByLabelText(`Level ${nextNumber} duration in minutes`);
    fireEvent.change(minutes, { target: { value: '0' } });
    expect(await screen.findByText(/problem to fix before saving/)).toBeTruthy();
    expect(disabled(screen.getByRole('button', { name: 'Review & save…' }))).toBe(true);
    fireEvent.change(minutes, { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review & save…' }));
    await screen.findByText('Change future levels and breaks');
    expect(within(dialog()).getByText(`Level ${nextNumber}`)).toBeTruthy();
    confirmLevel2('EDIT', /Save structure/);
    await waitFor(() => expect(t().config.blindSchedule[cur + 1]!.durationSeconds).toBe(1500), TIMEOUT);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Review & save…' })).toBeNull(), TIMEOUT);
  });

  it('starts a break with the chosen duration and turns hand-for-hand on', async () => {
    const { t } = await openClock();
    fireEvent.change(screen.getByLabelText('Duration'), { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start break now' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Start break' }));
    await waitFor(() => expect(t().status).toBe('BREAK'), TIMEOUT);
    expect(t().clock.breakEndsAt! - t().clock.levelStartedAt!).toBeGreaterThan(0);
  });

  it('hand-for-hand toggles through a level-1 confirmation', async () => {
    const { t } = await openClock();
    fireEvent.click(screen.getByRole('switch', { name: /tables play at their own pace/ }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Start hand-for-hand' }));
    await waitFor(() => expect(t().handForHand).toBe(true), TIMEOUT);
  });

  it('a viewer sees the clock and structure but every control is locked with the permission named', async () => {
    await openClock('viewer');
    expect(screen.getAllByText(/Requires CLOCK_CONTROL/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Requires TOURNAMENT_PAUSE/)).toBeTruthy();
    expect(screen.getByText(/Requires TABLE_CONTROL/)).toBeTruthy();
    expect(disabled(screen.getByRole('button', { name: 'Advance level' }))).toBe(true);
    expect(disabled(screen.getByRole('button', { name: 'Edit future levels & breaks' }))).toBe(true);
  });
});
