import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { TournamentReportDto } from '@jpb/shared-types';
import { csvRowCount, fileSlug, fileStamp } from '../src/sections/reports/download';
import { handDuration, isFinal, keyFigures, payoutFigures, reEntries, reportFilename } from '../src/sections/reports/model';
import { renderControlRoom } from './support/renderControlRoom';

const TIMEOUT = { timeout: 5000 };

const report = (over: Partial<TournamentReportDto> = {}): TournamentReportDto => ({
  tournamentId: 'trn_x',
  name: 'Spring Showdown 2026',
  status: 'COMPLETED',
  players: 100,
  entries: 112,
  tablesUsed: 12,
  startedAt: Date.UTC(2026, 2, 12, 18, 0),
  completedAt: Date.UTC(2026, 2, 12, 23, 30),
  durationMs: 5.5 * 3600_000,
  handsPlayed: 1_234,
  averageHandDurationMs: 94_000,
  finalTableDurationMs: 74 * 60_000,
  largestPot: { amount: 641_040, handId: 'h1', winnerName: 'Yusuf Chopra' },
  winner: { playerId: 'p1', displayName: 'Lena Silva', publicId: 'JPN-326M' },
  standings: [],
  prizeStructure: { currency: 'INR', places: [{ position: 1, amountMinor: 100_000, label: 'Champion' }, { position: 2, amountMinor: 50_000 }] },
  payouts: { configuredMinor: 150_000, awardedMinor: 150_000, paidMinor: 100_000, outstandingMinor: 50_000 },
  serverSeedHash: 'ab'.repeat(32),
  seedRevealed: true,
  generatedAt: Date.UTC(2026, 2, 13, 9, 5),
  ...over,
});

/** jsdom's Blob has no text(): read it like a browser FileReader would. */
function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(blob);
  });
}

describe('reports model', () => {
  it('labels every figure of the report, re-expressed but never recomputed', () => {
    const f = Object.fromEntries(keyFigures(report()).map((x) => [x.key, x]));
    expect(f.players!.value).toBe('100');
    expect(f.players!.sub).toBe('112 entries (12 re-entries)');
    expect(f.tables!.value).toBe('12');
    expect(f.duration!.value).toBe('5h 30m');
    expect(f.hands!.value).toBe('1,234');
    expect(f.avgHand!.value).toBe('94 s');
    expect(f.finalTable!.value).toBe('1h 14m');
    expect(f.largestPot!.value).toBe('641,040 chips');
    expect(f.largestPot!.sub).toBe('won by Yusuf Chopra');
    expect(f.pool!.value).toBe('₹1,500');
    const p = Object.fromEntries(payoutFigures(report()).map((x) => [x.key, x]));
    expect(p.paid!.sub).toBe('66.7% of awarded');
    expect(p.outstanding!.value).toBe('₹500');
    expect(reEntries({ entries: 5, players: 7 })).toBe(0);
    expect(handDuration(null)).toBe('—');
    expect(handDuration(150_000)).toBe('2m 30s');
    expect(isFinal('CANCELLED')).toBe(true);
    expect(isFinal('RUNNING')).toBe(false);
  });

  it('builds stable, safe file names', () => {
    expect(fileSlug('Campus Cup — Final Day!')).toBe('campus-cup-final-day');
    expect(fileSlug('***')).toBe('tournament');
    expect(fileStamp(Date.UTC(2026, 2, 13, 9, 5))).toBe('20260313-0905');
    expect(reportFilename(report(), 'json')).toBe('report-spring-showdown-2026-20260313-0905.json');
    expect(csvRowCount('\uFEFFa,b\r\n1,2\r\n3,4\r\n')).toBe(2);
    expect(csvRowCount('a,b\n')).toBe(0);
  });
});

describe('Reports (§2.18)', { timeout: 20_000 }, () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:report');
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => vi.restoreAllMocks());

  it('renders the full tournament report as a document', async () => {
    const { mock } = renderControlRoom('/t/trn_winter/reports', { as: 'director' });
    const doc = await screen.findByRole('article', { name: 'Winter Classic 2025' }, TIMEOUT);
    const t = mock.server.tournament('trn_winter');
    const champ = t.players.find((p) => p.finishPosition === 1)!;
    expect(within(doc).getByRole('region', { name: 'Champion' }).textContent).toContain(champ.displayName);
    for (const h of ['Key figures', 'Payout status', 'Final standings', 'Prize structure', 'Fairness']) expect(within(doc).getByRole('heading', { name: new RegExp(h) })).toBeTruthy();
    for (const label of ['Players', 'Tables used', 'Duration', 'Hands played', 'Average hand', 'Final-table duration', 'Largest pot', 'Prize pool', 'Configured', 'Awarded', 'Paid', 'Outstanding']) {
      expect(within(doc).getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(within(doc).getByText(t.serverSeedHash)).toBeTruthy();
    // Long tables are folded on screen (print shows every row) and can be expanded.
    const standings = within(doc).getAllByRole('table')[0]!;
    expect(within(standings).getAllByRole('row').length).toBeGreaterThan(20);
    fireEvent.click(within(doc).getByRole('button', { name: /Show all \d+ places/ }));
    expect(within(doc).getByRole('button', { name: 'Show fewer' }).getAttribute('aria-expanded')).toBe('true');
    expect(within(doc).getByText('Total prize pool')).toBeTruthy();
  });

  it('marks a running tournament’s report as provisional', async () => {
    renderControlRoom('/t/trn_spring/reports', { as: 'director' });
    const doc = await screen.findByRole('article', { name: 'Spring Showdown 2026' }, TIMEOUT);
    expect(within(doc).getByRole('note').textContent).toMatch(/Provisional/);
  });

  it('prints with the browser dialog and exports JSON and CSV', async () => {
    const print = vi.fn();
    window.print = print;
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    renderControlRoom('/t/trn_winter/reports', { as: 'director' });
    await screen.findByRole('article', { name: 'Winter Classic 2025' }, TIMEOUT);
    fireEvent.click(screen.getByRole('button', { name: 'Print / save as PDF' }));
    expect(print).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Export JSON' }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1), TIMEOUT);
    expect(await screen.findByText('Downloaded report JSON', undefined, TIMEOUT)).toBeTruthy();
    const blob = (URL.createObjectURL as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Blob;
    const json = JSON.parse(await readBlob(blob)) as TournamentReportDto;
    expect(json.tournamentId).toBe('trn_winter');
    expect(json.standings.length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(2), TIMEOUT);
    expect(await screen.findByText('Downloaded report CSV', undefined, TIMEOUT)).toBeTruthy();
  });

  it('is restricted without EXPORT_DATA', async () => {
    renderControlRoom('/t/trn_winter/reports', { as: 'staff' });
    expect(await screen.findByText('Reports are restricted', undefined, TIMEOUT)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Export JSON' })).toBeNull();
  });
});
