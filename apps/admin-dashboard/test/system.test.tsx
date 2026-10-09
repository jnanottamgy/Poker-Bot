import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { NodeDto } from '@jpb/shared-types';
import { estimateServerNow, heartbeatAge, latencyTone, nodeHealth, pushSample, sortedErrors } from '../src/sections/system/model';
import type { Sample } from '../src/sections/system/model';
import { renderControlRoom } from './support/renderControlRoom';

const TIMEOUT = { timeout: 5000 };

const node = (id: string, hb: number): NodeDto => ({ nodeId: id, role: 'worker', startedAt: 0, lastHeartbeatAt: hb, ownedTables: 1, ownedDirectors: 0 });

async function openSystem(as = 'director') {
  const r = renderControlRoom('/system', { as });
  await screen.findByRole('heading', { name: /^System$/, level: 2 }, TIMEOUT);
  await screen.findByRole('table', { name: 'Nodes' }, TIMEOUT);
  return r;
}

beforeEach(() => {
  // The current tournament on global screens is the last one opened.
  localStorage.setItem('jpb.admin.lastTournament', 'trn_spring');
  localStorage.removeItem('jpb.admin.system.refresh');
});

describe('system model', () => {
  it('colours latency by the alert thresholds', () => {
    expect(latencyTone('actions', 'p99', 120)).toBe('positive');
    expect(latencyTone('actions', 'p99', 180)).toBe('warning');
    expect(latencyTone('actions', 'p99', 250)).toBe('danger');
  });

  it('measures heartbeats against the newest one (no browser clock)', () => {
    const nodes = [node('a', 100_000), node('b', 99_000), node('c', 80_000)];
    expect(heartbeatAge(nodes[2]!, nodes)).toBe(20_000);
    expect(nodeHealth(nodes[1]!, nodes).label).toBe('Healthy');
    expect(nodeHealth(nodes[2]!, nodes).label).toBe('Heartbeat late');
    expect(estimateServerNow({ nodes }, 5_000, 7_000)).toBe(102_000);
    expect(estimateServerNow({ nodes: [] }, 5_000, 7_000)).toBe(7_000);
  });

  it('keeps a bounded latency history and sorts error counters', () => {
    const s = (at: number): Sample => ({ at, p50: 1, p95: 2, p99: 3, dbP95: 1, connections: 1, actionsPerSecond: 1 });
    let list: Sample[] = [];
    for (let i = 0; i < 5; i++) list = pushSample(list, s(i), 3);
    expect(list.map((x) => x.at)).toEqual([2, 3, 4]);
    expect(pushSample(list, s(4), 3)).toHaveLength(3);
    expect(sortedErrors({ B: 0, A: 3, C: 9 }).map(([k]) => k)).toEqual(['C', 'A', 'B']);
  });
});

describe('System (§2.17)', { timeout: 20_000 }, () => {
  it('shows nodes, connections by audience, latency percentiles, rates, errors and stalled tables', async () => {
    await openSystem();
    const nodes = screen.getByRole('table', { name: 'Nodes' });
    expect(within(nodes).getByText('worker-1')).toBeTruthy();
    expect(within(nodes).getAllByRole('row')).toHaveLength(5);
    expect(within(nodes).getByText('108')).toBeTruthy();

    const conns = screen.getByRole('list', { name: 'Connections by audience' });
    expect(within(conns).getByText('Players')).toBeTruthy();
    expect(within(conns).getByText('Big screens')).toBeTruthy();

    const latency = screen.getByRole('table', { name: 'Latency percentiles' });
    expect(within(latency).getByText('Player actions')).toBeTruthy();
    expect(within(latency).getByText('Database')).toBeTruthy();
    expect(within(latency).getByText('21 ms')).toBeTruthy();

    const errors = screen.getByRole('list', { name: 'Error counters' });
    expect(within(errors).getByText('Rate-limited requests')).toBeTruthy();
    expect(within(errors).getByText('41')).toBeTruthy();

    const stalled = screen.getByRole('list', { name: 'Stalled tables' });
    expect(within(stalled).getByRole('link', { name: 'Table 37' }).getAttribute('href')).toMatch(/^\/t\/trn_spring\/tables\/.+/);
    expect(screen.getByText(/Live · refreshing every 10 s/)).toBeTruthy();
  });

  it('runs the full integrity check for the current tournament', async () => {
    const { mock } = await openSystem();
    await screen.findByRole('link', { name: 'Spring Showdown 2026' }, TIMEOUT);
    fireEvent.click(screen.getByRole('button', { name: 'Run full integrity check' }));
    await screen.findByText('1 problem found', undefined, TIMEOUT);
    const problems = screen.getByRole('list', { name: 'Integrity problems' });
    expect(within(problems).getByText('Stalled')).toBeTruthy();
    expect(screen.getByText('Balanced')).toBeTruthy();
    expect(mock.server.world.audit.some((e) => e.action === 'INTEGRITY_CHECK' && e.tournamentId === 'trn_spring')).toBe(true);
  });

  it('turns auto-refresh off and back on', async () => {
    await openSystem();
    const toggle = screen.getByRole('switch', { name: 'Auto-refresh' });
    fireEvent.click(toggle);
    await screen.findByText(/Auto-refresh is off/, undefined, TIMEOUT);
    expect(localStorage.getItem('jpb.admin.system.refresh')).toBe('0');
    fireEvent.click(toggle);
    fireEvent.change(screen.getByLabelText('Refresh interval'), { target: { value: '30' } });
    await screen.findByText(/refreshing every 30 s/, undefined, TIMEOUT);
  });

  it('greys the figures when a refresh fails (never shown as live)', async () => {
    const { mock } = await openSystem();
    mock.backend.api.system.get = () => Promise.reject(new Error('down'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh now' }));
    await screen.findByText('Could not refresh system health', undefined, TIMEOUT);
    expect(screen.getByText(/Not current — the last refresh failed/)).toBeTruthy();
    await waitFor(() => expect(document.querySelector('.acr-system-body.jpb-stale')).not.toBeNull(), TIMEOUT);
  });

  it('locks the integrity check without TABLE_CONTROL', async () => {
    await openSystem('viewer');
    const run = await screen.findByRole('button', { name: 'Run full integrity check' }, TIMEOUT);
    expect((run as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Requires TABLE_CONTROL/)).toBeTruthy();
  });
});
