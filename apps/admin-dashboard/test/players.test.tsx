import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { connectionOf, finishText, formatBB, playersQuery, seatText, stackInBB } from '../src/sections/players/model';
import { parsePlayerFilters } from '../src/sections/players/filters';
import { renderControlRoom } from './support/renderControlRoom';

const TIMEOUT = { timeout: 5000 };

async function openPlayers(path: string, as = 'director') {
  const r = renderControlRoom(path, { as });
  await screen.findByRole('heading', { name: /Players/ }, TIMEOUT);
  const table = await screen.findByRole('table', { name: /^Players/ }, TIMEOUT);
  return { ...r, table };
}

const dataRows = (table: HTMLElement) => within(table).getAllByRole('row').filter((r) => r.getAttribute('data-row') !== null);
/** The list re-mounts while a new query loads: always read the current table. */
const rowsNow = (name: RegExp = /^Players/) => dataRows(screen.getByRole('table', { name }));

describe('Players (§2.7)', { timeout: 20_000 }, () => {
  it('lists players server-paginated and virtualized, with every column of the spec', async () => {
    const { table, mock } = await openPlayers('/t/trn_spring/players');
    const t = mock.server.tournament('trn_spring');
    // aria-rowcount = every player + the header row, although only a window of rows is in the DOM.
    expect(table.getAttribute('aria-rowcount')).toBe(String(t.players.length + 1));
    await waitFor(() => expect(within(dataRows(table)[0]!).queryByText(/#1$/)).toBeTruthy(), TIMEOUT);
    expect(dataRows(table).length).toBeLessThan(t.players.length);
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    for (const h of ['Rank', 'Player', 'Public ID', 'Status', 'Table / seat', 'Stack', 'Connection', 'Timeouts', 'Finish', 'Registered']) {
      expect(headers.some((x) => x?.includes(h))).toBe(true);
    }
    // Default sort once started: stack, largest first (aria-sort on the header).
    expect(within(table).getByRole('columnheader', { name: /Stack/ }).getAttribute('aria-sort')).toBe('descending');
    const leader = [...t.players].filter((p) => p.status === 'SEATED' || p.status === 'IN_TRANSIT' || p.status === 'SUSPENDED').sort((a, b) => b.stack - a.stack)[0]!;
    expect(within(dataRows(table)[0]!).getByText(leader.displayName)).toBeTruthy();
    expect(screen.getAllByText(new RegExp(`^${t.players.length.toLocaleString('en-US')} players`)).length).toBeGreaterThan(0);
  });

  it('searches on the server by public id and keeps the filters in the URL', async () => {
    const { mock, router } = await openPlayers('/t/trn_spring/players');
    const target = mock.server.tournament('trn_spring').players[42]!;
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search players' }), { target: { value: target.publicId } });
    await waitFor(() => expect(router.state.location.search).toContain(`q=${target.publicId}`), TIMEOUT);
    await waitFor(() => expect(rowsNow()).toHaveLength(1), TIMEOUT);
    expect(within(rowsNow()[0]!).getByText(target.displayName)).toBeTruthy();
    expect(screen.getAllByText(/^1 player/).length).toBeGreaterThan(0);
  });

  it('filters by status from the quick chips and shows an empty state with a reset', async () => {
    const { router } = await openPlayers('/t/trn_spring/players');
    fireEvent.click(screen.getByRole('button', { name: /^Suspended/ }));
    await waitFor(() => expect(router.state.location.search).toContain('status=SUSPENDED'), TIMEOUT);
    await waitFor(() => expect(rowsNow(/Suspended/).length).toBe(2), TIMEOUT);
    for (const row of rowsNow(/Suspended/)) expect(within(row).getByText('Suspended')).toBeTruthy();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search players' }), { target: { value: 'zzzz-nobody' } });
    expect(await screen.findByText('No player matches these filters', undefined, TIMEOUT)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(router.state.location.search).toBe(''), TIMEOUT);
  });

  it('bulk-approves selected pending registrations behind one level-1 confirmation', async () => {
    const { table, mock } = await openPlayers('/t/trn_friday/players?status=PENDING_APPROVAL');
    await waitFor(() => expect(dataRows(table)).toHaveLength(12), TIMEOUT);
    const [first, second] = dataRows(table);
    fireEvent.click(within(first!).getByRole('checkbox'));
    fireEvent.click(within(second!).getByRole('checkbox'));
    const bar = screen.getByRole('region', { name: 'Bulk approval' });
    expect(within(bar).getByText(/pending registrations selected/)).toBeTruthy();
    fireEvent.click(within(bar).getByRole('button', { name: /Approve 2/ }));
    const d = await screen.findByRole('dialog');
    expect(within(d).getByText('Approve 2 registrations')).toBeTruthy();
    fireEvent.click(within(d).getByRole('button', { name: 'Approve 2' }));
    const t = mock.server.tournament('trn_friday');
    await waitFor(() => expect(t.players.filter((p) => p.status === 'PENDING_APPROVAL')).toHaveLength(10), TIMEOUT);
    expect(mock.server.world.audit.filter((e) => e.action === 'PLAYER_APPROVED' && e.tournamentId === 'trn_friday')).toHaveLength(2);
  });

  it('hides bulk approval from a viewer (no PLAYER_APPROVE_REGISTRATION)', async () => {
    const { table } = await openPlayers('/t/trn_friday/players?status=PENDING_APPROVAL', 'viewer');
    await waitFor(() => expect(dataRows(table)).toHaveLength(12), TIMEOUT);
    expect(within(table).queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('keyboard: arrows move between rows, Enter opens the player', async () => {
    const { table, router, mock } = await openPlayers('/t/trn_friday/players?sort=registration');
    await waitFor(() => expect(dataRows(table).length).toBeGreaterThan(3), TIMEOUT);
    const first = dataRows(table)[0]!;
    expect(first.tabIndex).toBe(0);
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    await waitFor(() => expect(document.activeElement?.getAttribute('data-row')).toBe('1'), TIMEOUT);
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    const second = mock.server.tournament('trn_friday').players[1]!;
    await waitFor(() => expect(router.state.location.pathname).toBe(`/t/trn_friday/players/${second.playerId}`), TIMEOUT);
  });
});

describe('players display model', () => {
  it('formats BB truncated (never overstated), seats 1-based and ties', () => {
    expect(stackInBB(31_999, 1_000)).toBe(31.9);
    expect(formatBB(12_345, 1_000)).toBe('12.3 BB');
    expect(formatBB(100, 0)).toBe('—');
    expect(seatText(12, 0)).toBe('Table 12 · seat 1');
    expect(seatText(null, null)).toBe('—');
    expect(finishText(3, 2)).toBe('3rd (tied ×2)');
    expect(finishText(null)).toBe('—');
  });

  it('connection is icon + text, with "away" after the configured timeouts', () => {
    expect(connectionOf({ status: 'SEATED', connected: true, consecutiveTimeouts: 0 }, 2).label).toBe('Online');
    expect(connectionOf({ status: 'SEATED', connected: true, consecutiveTimeouts: 2 }, 2).label).toBe('Away');
    expect(connectionOf({ status: 'SEATED', connected: false, consecutiveTimeouts: 0 }, 2)).toMatchObject({ label: 'Offline', icon: 'wifi-off' });
    expect(connectionOf({ status: 'ELIMINATED', connected: null, consecutiveTimeouts: 0 }, 2).key).toBe('none');
  });

  it('builds the server query and parses URL filters defensively', () => {
    expect(playersQuery('  ana ', 'AWAY', 't1', 'name')).toEqual({ q: 'ana', status: 'AWAY', tableId: 't1', sort: 'name' });
    expect(playersQuery('', '', null, 'stack')).toEqual({ sort: 'stack' });
    const f = parsePlayerFilters(new URLSearchParams('status=HACKED&sort=evil&table=tbl_1&tn=7&q=x'));
    expect(f).toEqual({ q: 'x', status: '', tableId: 'tbl_1', tableNumber: 7, sort: null });
  });
});
