import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { TableListItemDto } from '@jpb/shared-types';
import { gridColumns } from '../src/sections/tables/TableGrid';
import { parseFilters, serverQuery } from '../src/sections/tables/filters';
import { tileLabel } from '../src/sections/tables/TableTileCard';
import { displayStatus, pillText, statusText } from '../src/sections/tables/tableStatus';
import { SPRING, location, renderAt } from './tables.helpers';

afterEach(() => cleanup());

const row = (over: Partial<TableListItemDto> = {}): TableListItemDto => ({
  tableId: 'tbl_x',
  tableNumber: 7,
  status: 'IN_HAND',
  holds: [],
  frozen: false,
  players: 8,
  maxSeats: 9,
  handNumber: 41,
  isFinalTable: false,
  lastProgressAt: 1_000_000,
  disconnectedPlayers: 0,
  chips: 120_000,
  ...over,
});

describe('table status projection', () => {
  it('orders exceptions: closed > frozen > stalled > breaking > held > play', () => {
    expect(displayStatus(row({ status: 'CLOSED', frozen: true }))).toBe('CLOSED');
    expect(displayStatus(row({ status: 'STALLED', frozen: true }))).toBe('FROZEN');
    expect(displayStatus(row({ status: 'STALLED' }))).toBe('STALLED');
    expect(displayStatus(row({ status: 'HELD', holds: ['CONSOLIDATION'] }))).toBe('BREAKING');
    expect(displayStatus({ ...row({ status: 'HELD' }), breaking: true })).toBe('BREAKING');
    expect(displayStatus(row({ status: 'HELD', holds: ['ADMIN'] }))).toBe('HELD');
    expect(displayStatus(row({ status: 'BETWEEN_HANDS' }))).toBe('BETWEEN_HANDS');
  });

  it('always states the hold reason in text', () => {
    expect(statusText(row({ status: 'HELD', holds: ['ADMIN', 'BREAK'] }))).toBe('Held (Admin hold · Break)');
    expect(pillText(row({ status: 'HELD', holds: ['ADMIN'] }))).toBe('Held · Admin');
    expect(statusText(row({ status: 'IN_HAND', holds: ['PAUSE'] }))).toBe('Active — holds after this hand (Tournament paused)');
  });

  it('speaks a tile as one sentence (status never colour-only)', () => {
    const label = tileLabel(row({ status: 'STALLED', disconnectedPlayers: 2, isFinalTable: true, lastProgressAt: 1_000_000 }), 1_092_000);
    expect(label).toBe('Table 7, final table, Stalled, 8 of 9 players, hand 41, last progress 1m 32s ago, 2 disconnected, 120,000 chips');
  });

  it('maps URL filters to the server query and ignores junk', () => {
    const f = parseFilters(new URLSearchParams('status=STALLED&min=2&max=99&stalled=1&offline=1&q=3a7&sort=chips&view=list'));
    expect(f).toMatchObject({ status: 'STALLED', minPlayers: 2, maxPlayers: null, stalled: true, disconnected: true, q: '37', sort: 'chips', view: 'list' });
    expect(serverQuery(f)).toEqual({ status: 'STALLED', minPlayers: 2, stalled: true, q: '37', sort: 'chips' });
    expect(parseFilters(new URLSearchParams('status=NOPE&sort=evil')).status).toBe('');
  });

  it('fits whole tiles per row', () => {
    expect(gridColumns('list', 2000)).toBe(1);
    expect(gridColumns('grid', 1200)).toBe(5);
    expect(gridColumns('grid', 100)).toBe(1);
  });
});

describe('Live table map (§2.5)', () => {
  it('shows exact counts per status, and tiles with number, status text, players and connections', async () => {
    renderAt(`/t/${SPRING}/tables`);
    const sum = await screen.findByRole('region', { name: 'Tables per status' });
    await waitFor(() => expect(within(sum).getByRole('button', { name: /Stalled: 1 tables/ })).toBeTruthy());
    expect(within(sum).getByRole('button', { name: /Closed: 87 tables/ })).toBeTruthy();
    const t37 = await screen.findByRole('link', { name: /^Table 37, Stalled, 9 of 9 players/ });
    expect(t37.getAttribute('href')).toBe(`/t/${SPRING}/tables/tbl_spring_37`);
    // Virtualized: far fewer tiles than tables are in the DOM.
    const list = screen.getByRole('list', { name: /Tables: 136 tables/ });
    expect(within(list).getAllByRole('listitem').length).toBeLessThan(136);
    expect(within(list).getAllByRole('listitem')[0]!.getAttribute('aria-setsize')).toBe('136');
  });

  it('filters on the server: stalled only, then status chips, and keeps them in the URL', async () => {
    renderAt(`/t/${SPRING}/tables`);
    await screen.findByRole('link', { name: /^Table 1,/ });
    fireEvent.click(screen.getByRole('button', { name: 'Stalled only' }));
    await waitFor(() => expect(screen.getByRole('list', { name: /Tables: 1 tables/ })).toBeTruthy());
    expect(location.current.search).toContain('stalled=1');
    expect(screen.getByRole('link', { name: /^Table 37,/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Clear 1 filter/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Held: 2 tables/ }));
    await waitFor(() => expect(screen.getByRole('list', { name: /Tables: 2 tables/ })).toBeTruthy());
    expect(location.current.search).toContain('status=HELD');
  });

  it('searches by table number (debounced) and opens an exact match with Enter', async () => {
    renderAt(`/t/${SPRING}/tables`);
    await screen.findByRole('link', { name: /^Table 1,/ });
    const search = screen.getByRole('searchbox', { name: 'Search by table number' });
    fireEvent.change(search, { target: { value: '37' } });
    await waitFor(() => expect(screen.getByRole('list', { name: /Tables: 1 tables/ })).toBeTruthy());
    fireEvent.submit(search.closest('form')!);
    await waitFor(() => expect(location.current.pathname).toBe(`/t/${SPRING}/tables/tbl_spring_37`));
  });

  it('shows an empty state with a way out when nothing matches', async () => {
    renderAt(`/t/${SPRING}/tables?q=999`);
    expect(await screen.findByText('No table number starts with “999”')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await screen.findByRole('link', { name: /^Table 1,/ });
  });

  it('switches to the dense list layout', async () => {
    renderAt(`/t/${SPRING}/tables?view=list`);
    expect(await screen.findByRole('link', { name: /^Table 1,/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /List/ }).getAttribute('aria-pressed')).toBe('true');
  });

  it('scans for tables with disconnected players and says how much was checked', async () => {
    renderAt(`/t/${SPRING}/tables?offline=1`);
    expect(await screen.findByText(/Checked 136 of 136 tables for disconnected players/)).toBeTruthy();
    const links = screen.getAllByRole('link', { name: /disconnected,/ });
    expect(links.length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: /everyone connected/ })).toBeNull();
  });

  it('runs the integrity check and lists violations with chip conservation', async () => {
    renderAt(`/t/${SPRING}/tables`);
    fireEvent.click(await screen.findByRole('button', { name: 'Run integrity check' }));
    expect(await screen.findByText(/1 problem found/)).toBeTruthy();
    const list = screen.getByRole('list', { name: 'Violations' });
    expect(within(list).getByRole('link', { name: 'Table 37' })).toBeTruthy();
    expect(screen.getByText('Conserved')).toBeTruthy();
  });

  it('rebalances only after a level-1 confirmation', async () => {
    renderAt(`/t/${SPRING}/tables`);
    fireEvent.click(await screen.findByRole('button', { name: 'Rebalance now' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rebalance tables now' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rebalance now' }));
    expect(await screen.findByText(/Rebalance planned|already balanced/)).toBeTruthy();
  });

  it('hides table controls from roles without TABLE_CONTROL', async () => {
    renderAt(`/t/${SPRING}/tables`, 'viewer');
    await screen.findByRole('link', { name: /^Table 1,/ });
    expect(screen.queryByRole('button', { name: 'Rebalance now' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Run integrity check' })).toBeNull();
  });
});
