import { beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import fc from 'fast-check';
import type { TableSizeConfig } from '@jpb/shared-types';
import { computeTableCount } from '@jpb/seating-engine';
import { defaultTournamentConfig } from '@jpb/validation';
import { renderControlRoom } from './support/renderControlRoom';
import { deriveJoinCode } from '../src/sections/setup/model/draft';
import { configChanges } from '../src/sections/setup/model/diff';
import { validateDraft } from '../src/sections/setup/model/issues';
import { distributePool, parsePercentages } from '../src/sections/setup/model/prizes';
import { storageKey } from '../src/sections/setup/model/storage';
import { tableCount } from '../src/sections/setup/model/tables';

const TIMEOUT = { timeout: 5000 };

beforeEach(() => sessionStorage.clear());

async function openNew() {
  const r = renderControlRoom('/tournaments/new');
  await screen.findByRole('heading', { name: /New tournament/, level: 2 }, TIMEOUT);
  return r;
}

function stepButton(name: RegExp) {
  return within(screen.getByRole('navigation', { name: 'Setup steps' })).getByRole('button', { name });
}

function nameInput() {
  return screen.getByLabelText(/Tournament name/) as HTMLInputElement;
}

describe('setup wizard model', () => {
  it('table count mirrors @jpb/seating-engine computeTableCount', () => {
    const sizes = fc
      .record({ maxSize: fc.integer({ min: 2, max: 10 }), a: fc.integer({ min: 2, max: 10 }), b: fc.integer({ min: 2, max: 10 }), c: fc.integer({ min: 2, max: 10 }) })
      .map(({ maxSize, a, b, c }): TableSizeConfig => {
        const targetSize = Math.min(a, maxSize);
        return { maxSize, targetSize, minSize: Math.min(b, targetSize), finalTableSize: Math.min(c, maxSize) };
      });
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 200_000 }), sizes, fc.constantFrom('TARGET' as const, 'MAX' as const), (n, cfg, by) => {
        expect(tableCount(n, cfg, by)).toBe(computeTableCount(n, cfg, by));
      }),
      { numRuns: 300 },
    );
  });

  it('splits a pool exactly, never increasing, remainder to 1st', () => {
    expect(distributePool(1_000_000, [5_000, 3_000, 2_000], 100).map((p) => p.amountMinor)).toEqual([500_000, 300_000, 200_000]);
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1e12 }), fc.constantFrom(1, 100, 1000), (pool, round) => {
        const places = distributePool(pool, [4_000, 2_500, 1_500, 1_200, 800], round);
        expect(places.reduce((s, p) => s + p.amountMinor, 0)).toBe(pool);
        for (let i = 1; i < places.length; i++) expect(places[i]!.amountMinor).toBeLessThanOrEqual(places[i - 1]!.amountMinor);
      }),
    );
    expect(parsePercentages('50 / 30 / 20').problems).toEqual([]);
    expect(parsePercentages('50, 30').problems[0]).toMatch(/must total exactly 100/);
    expect(parsePercentages('20 30 50').problems).toContain('Percentages must not increase from one place to the next.');
  });

  it('automatic join codes are 4–12 characters of A–Z / 0–9', () => {
    expect(deriveJoinCode('Spring Showdown 2026', '42')).toBe('SPRINGS2642');
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 0, max: 99 }), (name, n) => {
        expect(deriveJoinCode(name, String(n).padStart(2, '0'))).toMatch(/^[A-Z0-9]{4,12}$/);
      }),
    );
  });

  it('issues know their step and label; diffs summarize long lists', () => {
    const base = defaultTournamentConfig();
    const bad = { ...base, name: '', blindSchedule: base.blindSchedule.map((l, i) => (i === 2 ? { ...l, bigBlind: Number.NaN } : l)) };
    const v = validateDraft(bad);
    expect(v.ok).toBe(false);
    expect(v.issues.find((i) => i.path === 'name')).toMatchObject({ step: 'basics', label: 'Tournament name' });
    expect(v.issues.find((i) => i.path === 'blindSchedule[2].bigBlind')).toMatchObject({ step: 'blinds', label: 'Level 3 · big blind', message: 'Enter a number.' });
    const changes = configChanges(base, { ...base, maxPlayers: 500, blindSchedule: base.blindSchedule.slice(1) });
    expect(changes.map((c) => [c.label, c.before, c.after])).toEqual([
      ['Maximum players', '10,000', '500'],
      ['Blind schedule', '20 levels', '19 levels'],
    ]);
  });
});

describe('Tournament setup wizard (§2.2)', { timeout: 30_000 }, () => {
  it('starts from the defaults, validates inline and links each problem to its field', async () => {
    await openNew();
    const steps = within(screen.getByRole('navigation', { name: 'Setup steps' })).getAllByRole('button');
    expect(steps).toHaveLength(10);
    expect(screen.getByText('Valid — ready to create')).toBeTruthy();

    fireEvent.change(nameInput(), { target: { value: '' } });
    expect(await screen.findByText('1 problem before you can save')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save draft' }) as HTMLButtonElement).disabled).toBe(true);
    expect(nameInput().getAttribute('aria-invalid')).toBe('true');

    // From the Review step, the problem link opens Basics and focuses the name field.
    fireEvent.click(stepButton(/Review/));
    const problems = await screen.findByRole('list', { name: 'Problems' });
    fireEvent.click(within(problems).getByRole('button', { name: /Tournament name/ }));
    await waitFor(() => expect(document.activeElement).toBe(nameInput()), TIMEOUT);

    fireEvent.change(nameInput(), { target: { value: 'Diwali Deepstack' } });
    expect((screen.getByLabelText(/Join code/) as HTMLInputElement).value).toMatch(/^DIWALID\d\d$/);
    expect(screen.getByText('Valid — ready to create')).toBeTruthy();
  });

  it('players & tables: presets and the live "N players → T tables" preview', async () => {
    await openNew();
    fireEvent.click(stepButton(/Players & tables/));
    expect((await screen.findAllByText('10,000 players → 1,250 tables (1,250 × 8)')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /6-max/ }));
    expect(screen.getAllByText('10,000 players → 1,667 tables (1,665 × 6, 2 × 5)').length).toBeGreaterThan(0);
    fireEvent.change(screen.getByRole('textbox', { name: 'Players' }), { target: { value: '100' } });
    expect(screen.getAllByText('100 players → 17 tables (15 × 6, 2 × 5)').length).toBeGreaterThan(0);
  });

  it('a blind preset can be undone; a bad level links into the virtualized schedule', async () => {
    await openNew();
    fireEvent.click(stepButton(/Chips & blinds/));
    const turbo = await screen.findByRole('button', { name: /^Turbo/ });
    fireEvent.click(turbo);
    expect(turbo.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/Applied the Turbo preset/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('button', { name: /^Standard/ }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.change(screen.getByLabelText('Level 3 big blind'), { target: { value: '' } });
    const region = await screen.findByRole('region', { name: 'Problems on this step' });
    expect(within(region).getByText('Level 3 · big blind')).toBeTruthy();
    fireEvent.click(stepButton(/Basics/));
    fireEvent.click(screen.getByRole('button', { name: /Fix 1 problem/ }));
    await waitFor(() => expect(document.activeElement?.id).toBe('setup-f-blindSchedule-2-bigBlind'), TIMEOUT);
  });

  it('keeps the in-progress draft in sessionStorage and restores it', async () => {
    await openNew();
    fireEvent.change(nameInput(), { target: { value: 'Restored Rumble' } });
    await waitFor(() => expect(sessionStorage.getItem(storageKey(null))).toContain('Restored Rumble'), TIMEOUT);
    cleanup();
    await openNew();
    expect(screen.getByText(/Restored the unsaved draft/)).toBeTruthy();
    expect(nameInput().value).toBe('Restored Rumble');
    fireEvent.click(screen.getAllByRole('button', { name: 'Start over' })[0]!);
    expect(nameInput().value).toBe(defaultTournamentConfig().name);
  });

  it('Save draft creates the tournament and shows the fairness commitment', async () => {
    const { mock, router } = await openNew();
    fireEvent.change(nameInput(), { target: { value: 'Diwali Deepstack' } });
    fireEvent.click(stepButton(/Prizes/));
    fireEvent.click(await screen.findByRole('button', { name: 'USD' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/t\/[^/]+\/setup$/), TIMEOUT);
    const t = mock.server.world.tournaments.find((x) => x.name === 'Diwali Deepstack')!;
    expect(t.status).toBe('DRAFT');
    expect(t.config.prizeStructure.currency).toBe('USD');
    expect(await screen.findByText('Tournament created as a draft', {}, TIMEOUT)).toBeTruthy();
    expect(screen.getAllByText(t.serverSeedHash).length).toBeGreaterThan(0);
    expect(sessionStorage.getItem(storageKey(null))).toBeNull();
  });

  it('Save & open registration (level 1) creates and opens registration', async () => {
    const { mock } = await openNew();
    fireEvent.change(nameInput(), { target: { value: 'Open Sesame' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & open registration' }));
    const d = await screen.findByRole('dialog', { name: 'Create and open registration' }, TIMEOUT);
    fireEvent.click(within(d).getByRole('button', { name: 'Create and open' }));
    await waitFor(() => expect(mock.server.world.tournaments.find((x) => x.name === 'Open Sesame')?.status).toBe('REGISTRATION'), TIMEOUT);
    expect(await screen.findByText('Tournament created — registration is open', {}, TIMEOUT)).toBeTruthy();
  });

  it('clones an existing tournament (tournamentClone) into a new draft', async () => {
    const { mock, router } = await openNew();
    const select = (await screen.findByRole('combobox', { name: 'Existing tournament' })) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBeGreaterThan(2), TIMEOUT);
    fireEvent.change(select, { target: { value: 'trn_founders' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clone as new draft' }));
    await waitFor(() => expect(mock.server.world.tournaments.some((x) => x.name === 'Founders Freeroll (copy)')).toBe(true), TIMEOUT);
    const copy = mock.server.world.tournaments.find((x) => x.name === 'Founders Freeroll (copy)')!;
    await waitFor(() => expect(router.state.location.pathname).toBe(`/t/${copy.id}/setup`), TIMEOUT);
  });

  it('edits a DRAFT tournament and saves with one confirmation (PUT /config)', async () => {
    const { mock } = renderControlRoom('/t/trn_founders/setup');
    await screen.findByRole('heading', { name: /Tournament setup/, level: 2 }, TIMEOUT);
    expect(screen.getByText('Saved — no changes')).toBeTruthy();
    fireEvent.change(nameInput(), { target: { value: 'Founders Freeroll II' } });
    expect(await screen.findByText('1 unsaved change')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    const d = await screen.findByRole('dialog', { name: 'Save configuration' }, TIMEOUT);
    expect(within(d).getByText(/Tournament name: “Founders Freeroll” → “Founders Freeroll II”/)).toBeTruthy();
    fireEvent.click(within(d).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mock.server.tournament('trn_founders').config.name).toBe('Founders Freeroll II'), TIMEOUT);
    await waitFor(() => expect(screen.getByText('Saved — no changes')).toBeTruthy(), TIMEOUT);
    expect(mock.server.world.audit.some((e) => e.action === 'CONFIG_UPDATED')).toBe(true);
  });

  it('shows a read-only summary once registration has closed', async () => {
    renderControlRoom('/t/trn_spring/setup');
    expect(await screen.findByText('The configuration is locked', {}, TIMEOUT)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Clock & Structure/ }).getAttribute('href')).toBe('/t/trn_spring/clock');
    expect(screen.getByRole('link', { name: /Settings/ }).getAttribute('href')).toBe('/t/trn_spring/settings');
    expect(screen.getByRole('region', { name: 'Chips & blinds summary' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    await act(async () => undefined);
  });
});
