import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { AlertDto } from '@jpb/shared-types';
import { alertTab, countAlerts, filterAlerts, mergeAlerts, parseFilters, sortAlerts, writeFilters, DEFAULT_FILTERS } from '../src/sections/alerts/model';
import { describeTarget } from '../src/sections/alerts/targets';
import { renderControlRoom } from './support/renderControlRoom';

const TIMEOUT = { timeout: 5000 };

const alert = (x: Partial<AlertDto> & Pick<AlertDto, 'id'>): AlertDto => ({
  at: 1_000,
  tournamentId: 't1',
  severity: 'WARNING',
  code: 'TABLE_STALLED',
  message: 'Table 4 stalled',
  target: null,
  acknowledgedBy: null,
  acknowledgedAt: null,
  resolvedAt: null,
  ...x,
});

async function openAlerts(as = 'director', path = '/t/trn_spring/alerts') {
  const r = renderControlRoom(path, { as });
  await screen.findByRole('heading', { name: /^Alerts$/, level: 2 }, TIMEOUT);
  await screen.findByRole('tablist', { name: 'Alert state' }, TIMEOUT);
  return r;
}

describe('alerts model', () => {
  it('classifies, counts, filters and sorts alerts', () => {
    const list = [
      alert({ id: 'a', severity: 'INFO', at: 10 }),
      alert({ id: 'b', severity: 'CRITICAL', at: 30 }),
      alert({ id: 'c', severity: 'CRITICAL', at: 20, code: 'WORKER_LOST', message: 'Worker lost' }),
      alert({ id: 'd', acknowledgedAt: 40, acknowledgedBy: 'adm' }),
      alert({ id: 'e', resolvedAt: 50 }),
    ];
    expect(list.map(alertTab)).toEqual(['open', 'open', 'open', 'acknowledged', 'resolved']);
    const counts = countAlerts(list, 'open');
    expect(counts.tabs).toEqual({ open: 3, acknowledged: 1, resolved: 1 });
    expect(counts.severity).toEqual({ CRITICAL: 2, WARNING: 0, INFO: 1 });
    // Most severe first, then the longest-waiting.
    expect(sortAlerts(list.slice(0, 3), 'severity').map((a) => a.id)).toEqual(['c', 'b', 'a']);
    expect(sortAlerts(list.slice(0, 3), 'newest').map((a) => a.id)).toEqual(['b', 'c', 'a']);
    expect(filterAlerts(list, { ...DEFAULT_FILTERS, severity: 'CRITICAL', q: 'worker' }).map((a) => a.id)).toEqual(['c']);
    expect(filterAlerts(list, { ...DEFAULT_FILTERS, tab: 'resolved' }).map((a) => a.id)).toEqual(['e']);
  });

  it('merges open alerts with the history (a resolved copy wins)', () => {
    const merged = mergeAlerts([alert({ id: 'x' })], [alert({ id: 'x', resolvedAt: 9 }), alert({ id: 'y' })]);
    expect(merged.find((a) => a.id === 'x')?.resolvedAt).toBe(9);
    expect(merged).toHaveLength(2);
  });

  it('round-trips filters through the URL and ignores junk', () => {
    const f = parseFilters(new URLSearchParams('tab=resolved&severity=CRITICAL&code=WORKER_LOST&sort=oldest&scope=all&q=x'));
    expect(f).toEqual({ tab: 'resolved', severity: 'CRITICAL', code: 'WORKER_LOST', sort: 'oldest', scope: 'all', q: 'x' });
    expect(parseFilters(writeFilters(new URLSearchParams(), f))).toEqual(f);
    expect(parseFilters(new URLSearchParams('tab=nope&severity=LOUD&code=BAD'))).toEqual(DEFAULT_FILTERS);
  });

  it('turns targets into labels and links', () => {
    expect(describeTarget('table:tbl_9', 't1', 'Table 37 stalled')).toMatchObject({ label: 'Table 37', href: '/t/t1/tables/tbl_9' });
    expect(describeTarget('table:12', 't1')).toMatchObject({ label: 'Table 12', href: '/t/t1/tables?q=12' });
    expect(describeTarget('player:JPN-7A42', 't1')).toMatchObject({ label: 'JPN-7A42', href: '/t/t1/players?q=JPN-7A42' });
    expect(describeTarget('player:ply_1', 't1')).toMatchObject({ href: '/t/t1/players/ply_1' });
    expect(describeTarget('node:worker-2', 't1')).toMatchObject({ label: 'Node worker-2', href: '/system' });
    expect(describeTarget('tournament:t2', 't1')).toMatchObject({ href: '/t/t2/overview' });
    expect(describeTarget(null, 't1')).toBeNull();
  });
});

describe('Alerts (§2.15)', { timeout: 20_000 }, () => {
  it('shows open / acknowledged / resolved with counts, codes with human titles and target links', async () => {
    const { mock } = await openAlerts();
    const tabs = screen.getByRole('tablist', { name: 'Alert state' });
    expect(within(tabs).getByRole('tab', { name: /Open\s*2/ })).toBeTruthy();
    expect(within(tabs).getByRole('tab', { name: /Acknowledged\s*1/ })).toBeTruthy();
    await waitFor(() => expect(within(tabs).getByRole('tab', { name: /Resolved\s*2/ })).toBeTruthy(), TIMEOUT);

    const grid = screen.getByRole('table', { name: 'Open alerts' });
    expect(within(grid).getByText('Table stalled')).toBeTruthy();
    expect(within(grid).getByText('Player cannot act')).toBeTruthy();
    const stalled = mock.server.world.alerts.find((a) => a.id === 'alr_1')!;
    const tableLink = within(grid).getByRole('link', { name: /Table 37/ });
    expect(tableLink.getAttribute('href')).toBe(`/t/trn_spring/tables/${stalled.target!.slice('table:'.length)}`);
    const player = mock.server.world.alerts.find((a) => a.id === 'alr_2')!;
    expect(within(grid).getByRole('link', { name: /Player/ }).getAttribute('href')).toBe(`/t/trn_spring/players/${player.target!.slice('player:'.length)}`);

    fireEvent.click(within(tabs).getByRole('tab', { name: /Resolved/ }));
    const resolved = await screen.findByRole('table', { name: 'Resolved alerts' }, TIMEOUT);
    expect(within(resolved).getByText('WebSocket failures spiking')).toBeTruthy();
    expect(within(resolved).queryByRole('button', { name: /Acknowledge/ })).toBeNull();
  });

  it('filters by severity', async () => {
    await openAlerts();
    fireEvent.click(screen.getByRole('button', { name: /^Critical\s*1$/ }));
    const grid = screen.getByRole('table', { name: 'Open alerts' });
    await waitFor(() => expect(within(grid).queryByText('Player cannot act')).toBeNull(), TIMEOUT);
    expect(within(grid).getByText('Table stalled')).toBeTruthy();
  });

  it('acknowledges (level 1) from the detail pane and resolves with a reason', async () => {
    const { mock } = await openAlerts();
    const grid = screen.getByRole('table', { name: 'Open alerts' });
    fireEvent.click(within(grid).getByText('Player cannot act'));
    const pane = await screen.findByRole('region', { name: 'Alert details' }, TIMEOUT);
    expect(within(pane).getByText('Recommended steps')).toBeTruthy();
    fireEvent.click(within(pane).getByRole('button', { name: 'Acknowledge' }));
    const d1 = await screen.findByRole('dialog', { name: /Acknowledge: Player cannot act/ }, TIMEOUT);
    fireEvent.click(within(d1).getByRole('button', { name: 'Acknowledge' }));
    const a2 = mock.server.world.alerts.find((a) => a.id === 'alr_2')!;
    await waitFor(() => expect(a2.acknowledgedAt).not.toBeNull(), TIMEOUT);
    expect(a2.acknowledgedBy).toBe('adm_meera');
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Alert timeline' })).getByText('Acknowledged')).toBeTruthy(), TIMEOUT);

    fireEvent.click(within(screen.getByRole('region', { name: 'Alert details' })).getByRole('button', { name: 'Resolve' }));
    const d2 = await screen.findByRole('dialog', { name: /Resolve: Player cannot act/ }, TIMEOUT);
    fireEvent.change(within(d2).getByLabelText(/Reason/), { target: { value: 'Player reconnected on a new phone' } });
    fireEvent.click(within(d2).getByRole('button', { name: 'Resolve alert' }));
    await waitFor(() => expect(a2.resolvedAt).not.toBeNull(), TIMEOUT);
    expect(mock.server.world.audit.some((e) => e.action === 'ALERT_RESOLVED' && e.reason === 'Player reconnected on a new phone')).toBe(true);
  });

  it('acknowledges every alert in the filtered list with one confirmation', async () => {
    const { mock } = await openAlerts();
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge all 2' }));
    const d = await screen.findByRole('dialog', { name: 'Acknowledge 2 alerts' }, TIMEOUT);
    fireEvent.click(within(d).getByRole('button', { name: 'Acknowledge 2' }));
    await waitFor(() => expect(mock.server.world.alerts.filter((a) => a.tournamentId === 'trn_spring' && a.resolvedAt === null && a.acknowledgedAt === null)).toHaveLength(0), TIMEOUT);
  });

  it('is read-only without ALERTS_MANAGE', async () => {
    await openAlerts('viewer');
    expect(screen.getByText(/requires ALERTS_MANAGE/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Acknowledge all/ })).toBeNull();
    const grid = screen.getByRole('table', { name: 'Open alerts' });
    expect(within(grid).queryByRole('button', { name: /Acknowledge/ })).toBeNull();
  });

  it('can include alerts of every tournament and system-wide alerts', async () => {
    await openAlerts();
    fireEvent.click(screen.getByRole('button', { name: 'All + system' }));
    const grid = await screen.findByRole('table', { name: 'Open alerts' }, TIMEOUT);
    await waitFor(() => expect(within(grid).getByText('Tournament stalled')).toBeTruthy(), TIMEOUT);
  });
});
