import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { defaultTournamentConfig } from '@jpb/validation';
import { draftOf, runningChanges, saveMode, settingChanges, settingIssues } from '../src/sections/settings/model';
import { renderControlRoom } from './support/renderControlRoom';

const TIMEOUT = { timeout: 5000 };

async function openSettings(tid: string, as = 'director') {
  const r = renderControlRoom(`/t/${tid}/settings`, { as });
  await screen.findByRole('heading', { name: /^Settings$/, level: 2 }, TIMEOUT);
  return { ...r, t: () => r.mock.server.tournament(tid) };
}

const disabled = (el: HTMLElement) => (el as HTMLButtonElement).disabled;

describe('settings model', () => {
  it('chooses PUT /config before registration closes and the running edit afterwards', () => {
    expect(saveMode('DRAFT')).toBe('config');
    expect(saveMode('REGISTRATION')).toBe('config');
    expect(saveMode('REGISTRATION_CLOSED')).toBe('running');
    expect(saveMode('RUNNING')).toBe('running');
    expect(saveMode('FINAL_TABLE')).toBe('running');
    expect(saveMode('COMPLETED')).toBe('ended');
    expect(saveMode('CANCELLED')).toBe('ended');
  });

  it('sends only the changed keys and validates with @jpb/validation', () => {
    const config = defaultTournamentConfig();
    const base = draftOf(config);
    const draft = { features: { ...base.features, haptics: false }, spectators: { ...base.spectators, delaySeconds: 30 } };
    expect(runningChanges(base, draft)).toEqual({ features: { haptics: false }, spectators: { delaySeconds: 30 } });
    expect(runningChanges(base, base)).toEqual({});
    expect(settingChanges(base, draft).map((c) => [c.label, c.before, c.after])).toEqual([
      ['Haptics', 'On', 'Off'],
      ['Spectator delay', 'Live (0 s)', '30 s'],
    ]);
    expect(settingIssues(config, draft).size).toBe(0);
    const bad = settingIssues(config, { ...draft, spectators: { ...draft.spectators, delaySeconds: 99_999 } });
    expect(bad.get('spectators.delaySeconds')).toMatch(/3,600|3600/);
  });
});

describe('Settings (§2.21)', { timeout: 20_000 }, () => {
  it('while running: a flag change is level 2 (EDIT + reason) and PATCHes only the change', async () => {
    const { t, mock } = await openSettings('trn_spring');
    expect(screen.getByRole('note', { name: 'How changes are saved' }).textContent).toMatch(/danger level 2/);
    const sound = screen.getByRole('switch', { name: 'Sound effects' });
    expect(sound.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(sound);
    expect(screen.getByText('1 unsaved change')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Apply changes…' }));
    const d = await screen.findByRole('dialog', { name: 'Change settings while running' }, TIMEOUT);
    expect(within(d).getByText('Sound effects')).toBeTruthy();
    const confirm = within(d).getByRole('button', { name: /Apply now/ });
    expect(disabled(confirm)).toBe(true);
    fireEvent.change(within(d).getByLabelText(/Reason/), { target: { value: 'Venue asked for silent phones' } });
    fireEvent.change(within(d).getByLabelText(/to confirm/), { target: { value: 'EDIT' } });
    expect(disabled(confirm)).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(t().config.features.soundEffects).toBe(false), TIMEOUT);
    expect(t().config.features.haptics).toBe(true);
    const entry = mock.server.world.audit.find((e) => e.action === 'CONFIG_EDITED_RUNNING');
    expect(entry?.reason).toBe('Venue asked for silent phones');
    await waitFor(() => expect(screen.getByText('All settings saved')).toBeTruthy(), TIMEOUT);
  });

  it('before registration closes: saved with the configuration (level 1)', async () => {
    const { t } = await openSettings('trn_friday');
    fireEvent.change(screen.getByLabelText(/Spectator delay/), { target: { value: '45' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Haptics' }));
    expect(screen.getByText('2 unsaved changes')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    const d = await screen.findByRole('dialog', { name: 'Save settings' }, TIMEOUT);
    fireEvent.click(within(d).getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(t().config.spectators.delaySeconds).toBe(45), TIMEOUT);
    expect(t().config.features.haptics).toBe(false);
  });

  it('flags an invalid delay inline and blocks saving', async () => {
    await openSettings('trn_friday');
    fireEvent.change(screen.getByLabelText(/Spectator delay/), { target: { value: '5000' } });
    expect(screen.getByLabelText(/Spectator delay/).getAttribute('aria-invalid')).toBe('true');
    expect(disabled(screen.getByRole('button', { name: 'Save settings' }))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect((screen.getByLabelText(/Spectator delay/) as HTMLInputElement).value).not.toBe('5000');
  });

  it('is read-only once the tournament has ended', async () => {
    await openSettings('trn_winter');
    expect(screen.getByRole('note', { name: 'How changes are saved' }).textContent).toMatch(/ended/);
    expect(disabled(screen.getByRole('switch', { name: 'Sound effects' }))).toBe(true);
    expect(screen.queryByRole('button', { name: /Save settings|Apply changes/ })).toBeNull();
  });
});
