import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { bandIndexOf, bandState, bubbleState, chipShare, formatBB, ladderBands, parseView, placeText, stackInBB, tieRangeText } from '../src/sections/standings/model';
import { renderControlRoom } from './support/renderControlRoom';

const TIMEOUT = { timeout: 5000 };

/**
 * jsdom has no layout: no Element.scrollTo and scrollHeight = clientHeight = 0
 * (the virtualizer clamps every scroll to 0). Give the scroll element browser-like
 * metrics so a jump really scrolls the virtual list.
 */
function shimScrolling() {
  Element.prototype.scrollTo = function scrollTo(this: Element, opts?: ScrollToOptions | number) {
    const top = typeof opts === 'number' ? opts : (opts?.top ?? 0);
    (this as HTMLElement).scrollTop = top;
    queueMicrotask(() => this.dispatchEvent(new Event('scroll')));
  } as Element['scrollTo'];
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 100_000_000 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 640 });
}

const dataRows = (table: HTMLElement) => within(table).getAllByRole('row').filter((r) => r.getAttribute('data-row') !== null);

async function openStandings(path = '/t/trn_spring/standings', as = 'director') {
  const r = renderControlRoom(path, { as });
  await screen.findByRole('heading', { name: /^Standings$/, level: 2 }, TIMEOUT);
  return r;
}

describe('standings display model', () => {
  it('labels the two views and parses the URL defensively', () => {
    expect(parseView('finish')).toBe('finish');
    expect(parseView('stack')).toBe('stack');
    expect(parseView('<script>')).toBe('stack');
    expect(parseView(null)).toBe('stack');
  });

  it('formats BB truncated (never overstated), shares and ties', () => {
    expect(stackInBB(31_999, 1_000)).toBe(31.9);
    expect(formatBB(12_345, 1_000)).toBe('12.3 BB');
    expect(formatBB(100, null)).toBe('—');
    expect(formatBB(100, 0)).toBe('—');
    expect(chipShare(250, 1_000)).toBe(0.25);
    expect(chipShare(1, 0)).toBeNull();
    expect(placeText(5, 2)).toBe('5th (tied ×2)');
    expect(placeText(1)).toBe('1st');
    expect(placeText(null)).toBe('—');
    expect(tieRangeText(5, 2)).toBe('5th–6th');
    expect(tieRangeText(5, 1)).toBeNull();
  });

  it('tracks the money bubble from players remaining and paid places', () => {
    expect(bubbleState(1_204, 240, 'RUNNING')).toEqual({ kind: 'before-money', toGo: 964, paidPlaces: 240 });
    expect(bubbleState(241, 240, 'RUNNING')).toEqual({ kind: 'on-bubble', paidPlaces: 240 });
    expect(bubbleState(240, 240, 'RUNNING')).toEqual({ kind: 'in-money', paidPlaces: 240, remaining: 240 });
    expect(bubbleState(1, 240, 'COMPLETED').kind).toBe('complete');
    expect(bubbleState(null, 240, 'REGISTRATION').kind).toBe('not-started');
    expect(bubbleState(10, 0, 'RUNNING').kind).toBe('no-prizes');
  });

  it('bands equal consecutive prizes, never merging labelled places', () => {
    const bands = ladderBands([
      { position: 3, amountMinor: 500 },
      { position: 1, amountMinor: 5_000, label: 'Champion' },
      { position: 2, amountMinor: 2_000 },
      { position: 4, amountMinor: 500 },
      { position: 5, amountMinor: 500 },
      { position: 6, amountMinor: 200 },
    ]);
    expect(bands.map((b) => [b.from, b.to, b.amountMinor, b.totalMinor])).toEqual([
      [1, 1, 5_000, 5_000],
      [2, 2, 2_000, 2_000],
      [3, 5, 500, 1_500],
      [6, 6, 200, 200],
    ]);
    expect(bands[0]!.label).toBe('Champion');
    expect(bandIndexOf(bands, 4)).toBe(2);
    expect(bandIndexOf(bands, 6)).toBe(3);
    // Positions above the players remaining are decided.
    expect(bandState({ from: 3, to: 5 }, 2, false)).toBe('decided');
    expect(bandState({ from: 3, to: 5 }, 4, false)).toBe('partly');
    expect(bandState({ from: 3, to: 5 }, 9, false)).toBe('in-play');
    expect(bandState({ from: 3, to: 5 }, 9, true)).toBe('decided');
  });
});

describe('Standings (§2.12)', { timeout: 20_000 }, () => {
  beforeEach(() => {
    shimScrolling();
    URL.createObjectURL = vi.fn(() => 'blob:standings');
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => vi.restoreAllMocks());

  it('shows the live stack ranking, clearly labelled, server-paginated and virtualized', async () => {
    const { mock } = await openStandings();
    const tabs = screen.getByRole('tablist', { name: 'Standings view' });
    expect(within(tabs).getByRole('tab', { name: /Current stack ranking/ }).getAttribute('aria-selected')).toBe('true');
    expect(within(tabs).getByRole('tab', { name: /Finishing positions/ })).toBeTruthy();
    const table = await screen.findByRole('table', { name: 'Current stack ranking' }, TIMEOUT);
    const t = mock.server.tournament('trn_spring');
    const inPlay = t.players.filter((p) => p.status === 'SEATED' || p.status === 'IN_TRANSIT' || p.status === 'SUSPENDED');
    expect(table.getAttribute('aria-rowcount')).toBe(String(inPlay.length + 1));
    const leader = [...inPlay].sort((a, b) => b.stack - a.stack)[0]!;
    await waitFor(() => expect(within(dataRows(table)[0]!).getByText(leader.displayName)).toBeTruthy(), TIMEOUT);
    expect(within(dataRows(table)[0]!).getByText('#1')).toBeTruthy();
    expect(dataRows(table).length).toBeLessThan(inPlay.length);
    expect(screen.getByText(/This is NOT a result/)).toBeTruthy();
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    for (const h of ['Rank', 'Player', 'Status', 'Table', 'Stack', 'Share']) expect(headers).toContain(h);
  });

  it('switches to finishing positions (URL view=finish) with places and prizes', async () => {
    const { router, mock } = await openStandings('/t/trn_winter/standings');
    fireEvent.click(screen.getByRole('tab', { name: /Finishing positions/ }));
    await waitFor(() => expect(router.state.location.search).toContain('view=finish'), TIMEOUT);
    const table = await screen.findByRole('table', { name: 'Finishing positions' }, TIMEOUT);
    const champ = mock.server.tournament('trn_winter').players.find((p) => p.finishPosition === 1)!;
    await waitFor(() => expect(within(dataRows(table)[0]!).getByText(champ.displayName)).toBeTruthy(), TIMEOUT);
    expect(within(dataRows(table)[0]!).getByText('1st')).toBeTruthy();
    expect(within(dataRows(table)[0]!).getByText('Champion')).toBeTruthy();
    // The prize ladder sits alongside: complete tournament → every place decided.
    const ladder = screen.getByRole('table', { name: 'Prize ladder' });
    expect(within(ladder).getAllByText('Decided').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Complete').length).toBeGreaterThan(0);
  });

  it('marks ties in the finishing positions', async () => {
    const { mock } = await openStandings('/t/trn_spring/standings?view=finish');
    const t = mock.server.tournament('trn_spring');
    const tied = t.players.filter((p) => p.finishPosition !== null && p.tiedCount > 1);
    expect(tied.length).toBeGreaterThan(0);
    const table = await screen.findByRole('table', { name: 'Finishing positions' }, TIMEOUT);
    await waitFor(() => expect(dataRows(table).length).toBeGreaterThan(3), TIMEOUT);
    // Jump to the tied place: index = place − first place listed (ties skip places).
    const place = tied[0]!.finishPosition!;
    fireEvent.change(screen.getByRole('textbox', { name: 'Go to place' }), { target: { value: String(place) } });
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    const ordinal = `${place.toLocaleString('en-US')}th`;
    await waitFor(() => expect(within(table).getAllByText(ordinal).length).toBe(2), TIMEOUT);
    expect(within(table).getAllByText('T×2').length).toBeGreaterThanOrEqual(2);
    expect(within(table).getAllByText(`${ordinal}–${(place + 1).toLocaleString('en-US')}th`).length).toBe(2);
  });

  it('jumps to a rank in the virtual list', async () => {
    await openStandings();
    const table = await screen.findByRole('table', { name: 'Current stack ranking' }, TIMEOUT);
    await waitFor(() => expect(dataRows(table).length).toBeGreaterThan(3), TIMEOUT);
    fireEvent.change(screen.getByRole('textbox', { name: 'Go to rank' }), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    // Row 500 (aria-rowindex 501: the header is row 1) is rendered and its server page loaded.
    await waitFor(() => expect(within(dataRows(table).find((r) => r.getAttribute('aria-rowindex') === '501')!).getByText('#500')).toBeTruthy(), TIMEOUT);
    // The list did not restart at the top while the page loaded.
    expect(dataRows(table).some((r) => r.getAttribute('aria-rowindex') === '2')).toBe(false);
  });

  it('exports the current view as CSV through the API', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await openStandings();
    await screen.findByRole('table', { name: 'Current stack ranking' }, TIMEOUT);
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(click).toHaveBeenCalled(), TIMEOUT);
    expect(await screen.findByText('Downloaded stack ranking CSV', undefined, TIMEOUT)).toBeTruthy();
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it('explains that standings start with the first hand before the start', async () => {
    await openStandings('/t/trn_friday/standings');
    expect(await screen.findByText('Standings start with the first hand', undefined, TIMEOUT)).toBeTruthy();
    expect(screen.queryByRole('table', { name: 'Current stack ranking' })).toBeNull();
  });
});
