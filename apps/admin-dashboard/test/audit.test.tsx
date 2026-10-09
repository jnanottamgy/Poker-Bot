import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { AuditEntryDto } from '@jpb/shared-types';
import { diffJson, diffSummary, flatten } from '../src/sections/audit/diff';
import { EMPTY_FILTERS, actionInfo, auditCsv, dateRange, inRange, parseFilters, pastRange, serverQuery, writeFilters } from '../src/sections/audit/model';
import { renderControlRoom } from './support/renderControlRoom';

const TIMEOUT = { timeout: 5000 };
const PAGING_TIMEOUT = { timeout: 15_000 };

const entry = (x: Partial<AuditEntryDto>): AuditEntryDto => ({
  id: 'aud_1',
  seq: 1,
  at: Date.UTC(2026, 9, 8, 12, 0, 0),
  tournamentId: 't1',
  adminId: 'adm_1',
  adminUsername: 'director',
  action: 'ADJUST_STACK',
  target: 'player:JPN-AAAA',
  reason: 'Dealer miscount',
  beforeState: { stack: 100 },
  afterState: { stack: 250 },
  ip: '10.0.0.1',
  prevHash: '0'.repeat(64),
  hash: 'f'.repeat(64),
  ...x,
});

async function openAudit(path = '/t/trn_spring/audit', as = 'director') {
  const r = renderControlRoom(path, { as });
  await screen.findByRole('heading', { name: /^Audit log$/, level: 2 }, TIMEOUT);
  return r;
}

afterEach(() => vi.restoreAllMocks());

/** jsdom's Blob has no .text(): read it with FileReader. */
function readBlob(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(b);
  });
}

describe('audit diff', () => {
  it('diffs nested objects and arrays leaf by leaf', () => {
    const d = diffJson({ status: 'IN_HAND', holds: ['ADMIN'], timing: { a: 1, b: 2 } }, { status: 'HELD', holds: ['ADMIN', 'BREAK'], timing: { a: 1 } });
    const byPath = Object.fromEntries(d.rows.map((r) => [r.path, r]));
    expect(byPath.status).toMatchObject({ kind: 'changed', before: '"IN_HAND"', after: '"HELD"' });
    expect(byPath['holds[0]']).toMatchObject({ kind: 'same' });
    expect(byPath['holds[1]']).toMatchObject({ kind: 'added', after: '"BREAK"' });
    expect(byPath['timing.b']).toMatchObject({ kind: 'removed', before: '2' });
    expect(d.changed).toBe(3);
  });

  it('handles null snapshots, primitives and key order', () => {
    expect(diffJson(null, { a: 1 }).rows).toEqual([{ path: 'a', kind: 'added', before: '', after: '1' }]);
    expect(diffJson(5, 6).rows).toEqual([{ path: '(value)', kind: 'changed', before: '5', after: '6' }]);
    expect(diffJson({ a: 1, b: 2 }, { b: 2, a: 1 }).changed).toBe(0);
    expect(flatten({ empty: {}, list: [] }).leaves.get('empty')).toBe('{}');
    expect(diffSummary({ stack: 100 }, { stack: 250 })).toBe('stack 100 → 250');
    expect(diffSummary(null, null)).toBeNull();
    expect(diffSummary({ a: 1, b: 1 }, { a: 2, b: 2 })).toBe('2 fields changed');
  });
});

describe('audit model', () => {
  it('round-trips filters through the URL and builds the server query', () => {
    const f = { adminId: 'adm_meera', action: 'TABLE_HOLD', target: 'table:37', from: '2026-10-08T10:00', to: '2026-10-08T11:30', scope: 'all' as const };
    expect(parseFilters(writeFilters(new URLSearchParams(), f))).toEqual(f);
    expect(parseFilters(new URLSearchParams('from=yesterday&action=drop table;'))).toEqual({ ...EMPTY_FILTERS, action: '' });
    expect(serverQuery(f, 't1')).toEqual({ adminId: 'adm_meera', action: 'TABLE_HOLD', target: 'table:37' });
    expect(serverQuery({ ...EMPTY_FILTERS, target: '  ' }, 't1')).toEqual({ tournamentId: 't1' });
  });

  it('applies an inclusive date range (a minute-precision end covers that minute)', () => {
    const r = dateRange({ from: '2026-10-08T10:00', to: '2026-10-08T10:05' });
    const at = (s: string) => ({ at: new Date(s).getTime() });
    expect(inRange(at('2026-10-08T10:05:59'), r)).toBe(true);
    expect(inRange(at('2026-10-08T10:06:00'), r)).toBe(false);
    expect(inRange(at('2026-10-08T09:59:59'), r)).toBe(false);
    expect(pastRange(at('2026-10-08T09:59:59'), r)).toBe(true);
    expect(pastRange(at('2026-10-08T09:59:59'), dateRange({ from: '', to: '' }))).toBe(false);
  });

  it('exports CSV with the server columns, quoting and formula neutralisation', () => {
    const csv = auditCsv([entry({ reason: '=HYPERLINK("x")', target: 'player:"q", ok' })]);
    const [head, row] = csv.trim().split('\r\n');
    expect(head).toBe('seq,at,tournament,admin_id,admin,action,target,reason,before,after,ip,prev_hash,hash');
    expect(row).toContain('"player:""q"", ok"');
    expect(row).toContain(`"'=HYPERLINK(""x"")"`);
    expect(row).toContain('"{""stack"":100}"');
  });

  it('names known actions and flags danger level 2', () => {
    expect(actionInfo('ADJUST_STACK')).toMatchObject({ label: 'Stack adjusted', danger: true });
    expect(actionInfo('SOMETHING_NEW').label).toBe('Something new');
  });
});

describe('Audit log (§2.16)', { timeout: 30_000 }, () => {
  it('lists entries with human labels, opens one and shows its before → after diff', async () => {
    await openAudit('/t/trn_spring/audit?action=ADJUST_STACK');
    const grid = await screen.findByRole('table', { name: 'Audit entries' }, TIMEOUT);
    await waitFor(() => expect(within(grid).getByText('Stack adjusted')).toBeTruthy(), TIMEOUT);
    fireEvent.click(within(grid).getByText('Stack adjusted'));
    const pane = await screen.findByRole('region', { name: 'Audit entry' }, TIMEOUT);
    expect(within(pane).getByText('Dealer miscount verified on camera')).toBeTruthy();
    const changes = within(pane).getByRole('table', { name: 'Field changes' });
    expect(within(changes).getByText('stack')).toBeTruthy();
    fireEvent.click(within(pane).getByRole('tab', { name: 'Raw JSON' }));
    expect(within(pane).getByLabelText('Before state JSON').textContent).toContain('"stack"');
  });

  it('filters by admin and action on the server', async () => {
    await openAudit();
    const grid = await screen.findByRole('table', { name: 'Audit entries' }, TIMEOUT);
    await waitFor(() => expect(within(grid).getAllByText('staff').length).toBeGreaterThan(0), TIMEOUT);
    fireEvent.change(screen.getByLabelText('Admin'), { target: { value: 'adm_karan' } });
    await waitFor(() => expect(within(screen.getByRole('table', { name: 'Audit entries' })).queryAllByText('director')).toHaveLength(0), TIMEOUT);
    expect(within(screen.getByRole('table', { name: 'Audit entries' })).getAllByText('staff').length).toBeGreaterThan(0);
    // Staff never holds tables in the seeded log: the server returns nothing.
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'TABLE_HOLD' } });
    await screen.findByText('No entry matches these filters', undefined, TIMEOUT);
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect((screen.getByLabelText('Action') as HTMLSelectElement).value).toBe(''), TIMEOUT);
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'TABLE_HOLD' } });
    await waitFor(() => {
      const labels = within(screen.getByRole('table', { name: 'Audit entries' })).getAllByText(/^(Table held|Player moved|Rebalance requested|Registration approved)$/);
      expect(labels.length).toBeGreaterThan(0);
      expect(labels.every((l) => l.textContent === 'Table held')).toBe(true);
    }, TIMEOUT);
  });

  // Renders two full 200-entry pages through the mock backend: slow on a loaded CI runner.
  it('pages older entries with the beforeSeq cursor', async () => {
    await openAudit();
    const grid = await screen.findByRole('table', { name: 'Audit entries' }, PAGING_TIMEOUT);
    // 200 loaded + 1 "loading more" row + the header row.
    await waitFor(() => expect(grid.getAttribute('aria-rowcount')).toBe('202'), PAGING_TIMEOUT);
    fireEvent.click(screen.getByRole('button', { name: 'load more now' }));
    await waitFor(() => expect(Number(grid.getAttribute('aria-rowcount'))).toBeGreaterThan(202), PAGING_TIMEOUT);
    await screen.findByText(/End of the log for these filters/, undefined, PAGING_TIMEOUT);
  }, 60_000);

  it('applies a date range while paging', async () => {
    const { mock } = await openAudit();
    const all = mock.server.world.audit.filter((e) => e.tournamentId === 'trn_spring');
    const target = all.find((e) => e.action === 'ADJUST_STACK')!;
    const pad = (n: number) => String(n).padStart(2, '0');
    const d = new Date(target.at);
    const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    fireEvent.change(screen.getByLabelText('From'), { target: { value: local } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: local } });
    const grid = await screen.findByRole('table', { name: 'Audit entries' }, TIMEOUT);
    await waitFor(() => expect(within(grid).getByText('Stack adjusted')).toBeTruthy(), TIMEOUT);
    const inMinute = all.filter((e) => Math.floor(e.at / 60_000) === Math.floor(target.at / 60_000)).length;
    await waitFor(() => expect(grid.getAttribute('aria-rowcount')).toBe(String(inMinute + 1)), TIMEOUT);
  });

  it('verifies the hash chain: intact, then broken with a jump to the first bad entry', async () => {
    const { mock } = await openAudit();
    fireEvent.click(screen.getByRole('button', { name: 'Verify chain' }));
    await screen.findByText('Hash chain intact', undefined, TIMEOUT);

    const victim = mock.server.world.audit.find((e) => e.tournamentId === 'trn_spring' && e.action === 'ADJUST_STACK')!;
    victim.prevHash = 'tampered';
    fireEvent.click(screen.getByRole('button', { name: 'Verify chain' }));
    await screen.findByText(`Hash chain broken at entry #${victim.seq}`, undefined, TIMEOUT);
    fireEvent.click(screen.getByRole('button', { name: `Show entry #${victim.seq}` }));
    const pane = await screen.findByRole('region', { name: 'Audit entry' }, TIMEOUT);
    await waitFor(() => expect(within(pane).getByText(/The hash chain breaks at this entry/)).toBeTruthy(), TIMEOUT);
    expect(screen.getByText(`Showing the log from entry #${victim.seq} down`)).toBeTruthy();
  });

  it('exports JSON (paged here) and the server CSV with the current filters', async () => {
    const blobs: Blob[] = [];
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: (b: Blob) => (blobs.push(b), 'blob:x') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => undefined });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await openAudit('/t/trn_spring/audit?action=ADJUST_STACK');
    fireEvent.click(await screen.findByRole('button', { name: 'Export JSON' }, TIMEOUT));
    await waitFor(() => expect(blobs).toHaveLength(1), TIMEOUT);
    const json = JSON.parse(await readBlob(blobs[0]!)) as { complete: boolean; entries: AuditEntryDto[] };
    expect(json.complete).toBe(true);
    expect(json.entries.length).toBeGreaterThan(0);
    expect(json.entries.every((e) => e.action === 'ADJUST_STACK')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(blobs).toHaveLength(2), TIMEOUT);
    expect((await readBlob(blobs[1]!)).split('\n')[0]).toContain('seq,at,tournament');
  });

  it('is restricted without AUDIT_VIEW', async () => {
    renderControlRoom('/t/trn_spring/audit', { as: 'viewer' });
    await screen.findByText('The audit log is restricted', undefined, TIMEOUT);
    expect(screen.queryByRole('button', { name: 'Verify chain' })).toBeNull();
  });
});
