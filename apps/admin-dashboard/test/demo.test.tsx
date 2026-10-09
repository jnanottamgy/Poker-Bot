import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { DemoRequest } from '@jpb/shared-types';
import { DEFAULT_MIX, MIX_PRESETS, STRATEGIES, botsProblem, displayUrl, effectiveMix, projection, strategyCounts, throughput, toRequest } from '../src/sections/demo/model';
import type { Mix } from '../src/sections/demo/model';
import { renderControlRoom } from './support/renderControlRoom';

const TIMEOUT = { timeout: 5000 };

async function openDemo(as = 'director') {
  const r = renderControlRoom('/demo', { as });
  await screen.findByRole('heading', { name: /^Demo & simulation$/, level: 2 }, TIMEOUT);
  await screen.findByRole('list', { name: 'Demos' }, TIMEOUT);
  return r;
}

describe('demo model', () => {
  it('assigns strategies exactly like the server (weighted, interleaved)', () => {
    // 7919 is prime, so over any multiple of the total weight every residue appears equally often.
    const counts = strategyCounts(100, DEFAULT_MIX);
    expect(counts.RANDOM_LEGAL_ACTION).toBe(40);
    expect(counts.CALL_HEAVY).toBe(20);
    expect(counts.ALWAYS_FOLD).toBe(10);
    expect(counts.TIMEOUT_ALWAYS).toBe(0);
    for (const p of MIX_PRESETS) {
      const c = strategyCounts(1_003, p.mix);
      expect(STRATEGIES.reduce((a, s) => a + c[s], 0)).toBe(1_003);
    }
  });

  it('falls back to the default mix when every weight is 0, and builds the request', () => {
    const zero = Object.fromEntries(STRATEGIES.map((s) => [s, 0])) as Mix;
    expect(effectiveMix(zero)).toBe(DEFAULT_MIX);
    expect(toRequest(16, { ...zero, FLAKY: 3 }, true, '  Rehearsal  ')).toEqual({ players: 16, strategyMix: { FLAKY: 3 }, speedMode: true, name: 'Rehearsal' });
    expect(toRequest(8, zero, false, '')).toEqual({ players: 8, strategyMix: {}, speedMode: false });
  });

  it('validates the field size and computes throughput', () => {
    expect(botsProblem(1)).toMatch(/At least 2/);
    expect(botsProblem(2.5)).toMatch(/whole number/);
    expect(botsProblem(100_001)).toMatch(/At most/);
    expect(botsProblem(10_000)).toBeNull();
    expect(projection(100)).toEqual({ tables: 13, paid: 15 });
    const tp = throughput({ startedAt: 0, handsCompleted: 120, actionsSubmitted: 1_200, players: 101, playersRemaining: 51 }, 120_000);
    expect(tp).toMatchObject({ handsPerMinute: 60, actionsPerSecond: 10, eliminated: 50, progress: 0.5 });
    expect(displayUrl('DEMO1K', 'https://poker.example')).toBe('https://poker.example/display/DEMO1K');
  });
});

describe('Demo & simulation (§2.20)', { timeout: 30_000 }, () => {
  it('lists demos with live status, throughput and links', async () => {
    await openDemo();
    const list = screen.getByRole('list', { name: 'Demos' });
    const running = within(list).getByText('Demo · 1,000 bots').closest('li')!;
    expect(within(running).getByText('bots playing')).toBeTruthy();
    await waitFor(() => expect(within(within(running).getByLabelText(/Live status/)).getByText('612')).toBeTruthy(), TIMEOUT);
    expect(within(running).getByRole('link', { name: /Control room/ }).getAttribute('href')).toBe('/t/trn_demo1000/overview');
    expect(within(running).getByRole('link', { name: /Big screen/ }).getAttribute('href')).toMatch(/\/display\/DEMO1K$/);
    const done = within(list).getByText('Demo · 32 bots (speed)').closest('li')!;
    expect(within(done).getByRole('link', { name: /Results/ }).getAttribute('href')).toBe('/t/trn_demo32/reports');
    expect(within(done).queryByRole('button', { name: 'Stop' })).toBeNull();
  });

  it('creates a demo with a preset size, a strategy mix and speed mode', async () => {
    const r = await openDemo();
    const { mock } = r;
    const sent: DemoRequest[] = [];
    const create = mock.backend.api.demo.create;
    mock.backend.api.demo.create = (body) => (sent.push(body), create(body));
    fireEvent.click(screen.getByRole('button', { name: '16' }));
    fireEvent.click(screen.getByRole('button', { name: 'Aggressive' }));
    fireEvent.change(screen.getByLabelText(/^Always fold/), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Speed mode' }));
    fireEvent.change(screen.getByLabelText('Name (optional)'), { target: { value: 'Floor rehearsal' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start demo with 16 bots' }));
    await waitFor(() => expect(sent).toHaveLength(1), TIMEOUT);
    expect(sent[0]).toEqual({ players: 16, strategyMix: { RAISE_HEAVY: 5, ALL_IN_RANDOMLY: 3, RANDOM_LEGAL_ACTION: 2, ALWAYS_FOLD: 2 }, speedMode: true, name: 'Floor rehearsal' });
    const row = await screen.findByText('Floor rehearsal', { selector: 'button' }, TIMEOUT);
    expect(r.router.state.location.search).toBe(`?demo=${mock.server.world.demos[0]!.tournamentId}`);
    await waitFor(() => expect(screen.getByText('Floor rehearsal', { selector: 'button' }).getAttribute('aria-pressed')).toBe('true'), TIMEOUT);
    expect(row).toBeTruthy();
    expect(mock.server.world.demos.some((d) => d.players === 16)).toBe(true);
  });

  it('asks for a confirmation before a large demo', async () => {
    const { mock } = await openDemo();
    fireEvent.click(screen.getByRole('button', { name: '10,000' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start demo with 10,000 bots' }));
    const d = await screen.findByRole('dialog', { name: 'Start a 10,000-bot demo' }, TIMEOUT);
    expect(within(d).getByText(/1,250 tables/)).toBeTruthy();
    fireEvent.click(within(d).getByRole('button', { name: 'Start demo' }));
    await waitFor(() => expect(mock.server.world.demos.some((x) => x.players === 10_000)).toBe(true), TIMEOUT);
  });

  it('rejects a custom size outside the limits', async () => {
    await openDemo();
    fireEvent.change(screen.getByLabelText('Custom number of bots'), { target: { value: '1' } });
    expect(screen.getByText('At least 2 bots.')).toBeTruthy();
    expect((screen.getByRole('button', { name: /^Start demo/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('stops a running demo (level 1)', async () => {
    const { mock } = await openDemo();
    const running = screen.getByText('Demo · 1,000 bots').closest('li')!;
    fireEvent.click(await within(running).findByRole('button', { name: 'Stop' }, TIMEOUT));
    const d = await screen.findByRole('dialog', { name: 'Stop Demo · 1,000 bots' }, TIMEOUT);
    fireEvent.click(within(d).getByRole('button', { name: 'Stop demo' }));
    await waitFor(() => expect(mock.server.tournament('trn_demo1000').status).toBe('CANCELLED'), TIMEOUT);
  });

  it('is restricted without SIMULATION_RUN', async () => {
    renderControlRoom('/demo', { as: 'staff' });
    await screen.findByText('Demos are restricted', undefined, TIMEOUT);
  });
});
