import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { commitmentFor, computePublicEntropy, deckHash, dealingOrder, deriveDeck, expectedDeal } from '@jpb/fairness-engine';
import type { FairnessExport, HandFairnessRecord } from '@jpb/shared-types';
import { createMockBackend } from '../src/api/mock';
import type { MockBackend } from '../src/api/mock';
import type { Backend } from '../src/api/backend';
import { Providers } from '../src/app/App';
import { createRoutes } from '../src/app/routes';
import { IDLE_BULK, runBulkVerification } from '../src/sections/fairness/bulk';
import type { BulkSource, BulkState } from '../src/sections/fairness/bulk';
import { deckRoles, mergeBundles, recomputeEntropy, sampleIndices, seedInputProblem, verifyInBrowser } from '../src/sections/fairness/engine';
import { exportRangeProblem } from '../src/sections/fairness/ExportPanel';

vi.setConfig({ testTimeout: 30_000 });
const TIMEOUT = { timeout: 8_000 };

afterEach(() => cleanup());

// ------------------------------------------------------------------ verifiable fixtures

const SEED = '7f3a9c0e5b1d4f2a8c6e0b9d3f1a5c7e9b2d4f6a8c0e1b3d5f7a9c2e4b6d8f0a';
const OTHER_SEED = '0'.repeat(63) + '1';
const CLIENT_SEEDS = Array.from({ length: 12 }, (_, i) => (i * 7919 + 1).toString(16).padStart(64, 'c'));
const ENTROPY = computePublicEntropy({ clientSeeds: CLIENT_SEEDS, adminEntropy: null });
const BURNS: Record<number, number> = { 0: 0, 3: 1, 4: 2, 5: 3 };

/** A hand record exactly as an honest server publishes it (cards dealt from the derived deck). */
function honestRecord(tournamentId: string, tableId: string, handNumber: number, opts: { seats?: number[]; button?: number; board?: number; maxSeats?: number } = {}): HandFairnessRecord {
  const seats = opts.seats ?? [0, 2, 3, 5];
  const maxSeats = opts.maxSeats ?? 9;
  const button = opts.button ?? 2;
  const boardSize = opts.board ?? 5;
  const deck = deriveDeck({ serverSeed: SEED, tournamentId, tableId, handNumber, publicEntropy: ENTROPY });
  const deal = expectedDeal(deck, dealingOrder(seats, button, maxSeats));
  return {
    scheme: 'JPB/v1',
    tournamentId,
    tableId,
    handId: `h_${tableId}_${handNumber}`,
    handNumber,
    publicEntropy: ENTROPY,
    serverSeedHash: commitmentFor(SEED),
    deckHash: deckHash(deck),
    maxSeats,
    buttonSeat: button,
    holeCards: deal.holeCards.map((h) => ({ seat: h.seat, playerId: `p${h.seat}`, cards: h.cards })),
    board: deal.board.slice(0, boardSize),
    burns: deal.burns.slice(0, BURNS[boardSize]),
  };
}

function bundleOf(tournamentId: string, hands: HandFairnessRecord[], seed: string | null = SEED): FairnessExport {
  return {
    format: 'JPB-FAIRNESS-EXPORT',
    formatVersion: 1,
    scheme: 'JPB/v1',
    method: {} as FairnessExport['method'],
    tournamentId,
    serverSeedHash: commitmentFor(SEED),
    serverSeed: seed,
    publicEntropy: ENTROPY,
    entropyInputs: { clientSeeds: CLIENT_SEEDS, adminEntropy: null },
    hands,
  };
}

// ------------------------------------------------------------------ engine wrappers

describe('in-browser verification (portable engine)', () => {
  it('VERIFIES an honest hand: seed commitment · deck hash · hole cards · board', () => {
    const { result, ms } = verifyInBrowser(honestRecord('trn', 'tbl', 7), SEED);
    expect(result.status).toBe('VERIFIED');
    expect(result.checks.map((c) => [c.check, c.status])).toEqual([
      ['SEED_COMMITMENT', 'VERIFIED'],
      ['DECK_HASH', 'VERIFIED'],
      ['HOLE_CARDS', 'VERIFIED'],
      ['BOARD', 'VERIFIED'],
    ]);
    expect(ms).toBeGreaterThanOrEqual(0);
  });

  it('FAILS a hand whose published cards differ from the committed deck and names the mismatch', () => {
    const r = honestRecord('trn', 'tbl', 7);
    const swapped = { ...r, board: [r.board[1]!, r.board[0]!, ...r.board.slice(2)] };
    const { result } = verifyInBrowser(swapped, SEED);
    expect(result.status).toBe('FAILED');
    const board = result.checks.find((c) => c.check === 'BOARD')!;
    expect(board.status).toBe('FAILED');
    expect(board.mismatches.map((m) => m.item)).toEqual(['flop card 1', 'flop card 2']);
  });

  it('reports NOT AVAILABLE before the reveal, and FAILED for a seed that does not match the commitment', () => {
    const unrevealed = verifyInBrowser(honestRecord('trn', 'tbl', 7), null).result;
    expect(unrevealed.status).toBe('INCOMPLETE');
    expect(unrevealed.checks.every((c) => c.status === 'NOT_AVAILABLE')).toBe(true);
    const wrong = verifyInBrowser(honestRecord('trn', 'tbl', 7), OTHER_SEED).result;
    expect(wrong.checks.map((c) => c.status)).toEqual(['FAILED', 'NOT_AVAILABLE', 'NOT_AVAILABLE', 'NOT_AVAILABLE']);
  });

  it('validates pasted seeds and recomputes the public entropy', () => {
    expect(seedInputProblem('')).toBeNull();
    expect(seedInputProblem(SEED)).toBeNull();
    expect(seedInputProblem('abc')).toMatch(/64 hexadecimal/);
    expect(recomputeEntropy(CLIENT_SEEDS, null)).toBe(ENTROPY);
    expect(recomputeEntropy(['has space'], null)).toBeNull();
  });

  it('labels every deck position of a deal (hole cards, burns, board)', () => {
    const roles = deckRoles([3, 5, 0], 3);
    expect(roles[0]).toEqual({ kind: 'hole', seat: 3, card: 1 });
    expect(roles[3]).toEqual({ kind: 'hole', seat: 3, card: 2 });
    expect(roles[6]).toEqual({ kind: 'burn', street: 'flop' });
    expect(roles[7]).toEqual({ kind: 'board', name: 'Flop 1', dealt: true });
    expect(roles[10]).toEqual({ kind: 'unused' }); // burn 2 never dealt
    expect(roles[11]).toEqual({ kind: 'board', name: 'Turn', dealt: false });
    expect(roles[51]).toEqual({ kind: 'unused' });
  });

  it('draws a reproducible sample of distinct hands', () => {
    const a = sampleIndices('00ff11ee', 'trn', 1_000, 50);
    expect(a).toEqual(sampleIndices('00ff11ee', 'trn', 1_000, 50));
    expect(new Set(a).size).toBe(50);
    expect(a).toEqual([...a].sort((x, y) => x - y));
    expect(a.every((i) => Number.isInteger(i) && i >= 0 && i < 1_000)).toBe(true);
    expect(sampleIndices('00ff11ee', 'trn', 1_000, 50)).not.toEqual(sampleIndices('00ff11ef', 'trn', 1_000, 50));
    expect(sampleIndices('00ff11ee', 'trn', 10, 50)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(sampleIndices('00ff11ee', 'trn', 0, 5)).toEqual([]);
  });

  it('joins export pages without changing them, hands sorted by table then number', () => {
    const p1 = bundleOf('trn', [honestRecord('trn', 'b', 2), honestRecord('trn', 'a', 9)]);
    const p2 = bundleOf('trn', [honestRecord('trn', 'a', 1)]);
    const merged = mergeBundles([p1, p2])!;
    expect(merged.hands.map((h) => `${h.tableId}${h.handNumber}`)).toEqual(['a1', 'a9', 'b2']);
    expect(merged.serverSeedHash).toBe(p1.serverSeedHash);
    expect(mergeBundles([])).toBeNull();
    expect(exportRangeProblem(1, 500, 19_000)).toBeNull();
    expect(exportRangeProblem(500, 1, 19_000)).toMatch(/range/);
    expect(exportRangeProblem(1, 20_000, 30_000)).toMatch(/at most/);
    expect(exportRangeProblem(40, 50, 30)).toMatch(/only 30/);
  });
});

// ------------------------------------------------------------------ bulk runner

/** An in-memory export of `n` hands (positions in completion order). */
function fakeSource(n: number, tamper: (i: number, r: HandFairnessRecord) => HandFairnessRecord = (_, r) => r, seed: string | null = SEED) {
  const tables = ['t1', 't2', 't3'];
  const all = Array.from({ length: n }, (_, i) => tamper(i, honestRecord('trn', tables[i % 3]!, Math.floor(i / 3) + 1, { board: [0, 3, 4, 5][i % 4] })));
  const calls = { bundle: 0, handIdAt: 0, handRecord: 0 };
  const source: BulkSource = {
    handsTotal: async () => n,
    bundle: async (from, to) => {
      calls.bundle += 1;
      return bundleOf('trn', all.slice(from, to + 1), seed);
    },
    handIdAt: async (pos) => {
      calls.handIdAt += 1;
      return all[n - 1 - pos]?.handId ?? null;
    },
    handRecord: async (id) => {
      calls.handRecord += 1;
      return all.find((r) => r.handId === id)!;
    },
  };
  return { source, calls, all };
}

const run = (source: BulkSource, o: Partial<Parameters<typeof runBulkVerification>[1]> = {}) => {
  const progress: BulkState[] = [];
  const ctrl = new AbortController();
  const p = runBulkVerification(source, {
    tournamentId: 'trn',
    mode: 'all',
    sampleSize: 25,
    sampleSeed: 'abcd',
    signal: ctrl.signal,
    onProgress: (s) => progress.push(s),
    clock: () => 1_000,
    yieldFn: () => Promise.resolve(),
    ...o,
  });
  return { p, progress, ctrl };
};

describe('bulk verification', () => {
  it('verifies every hand page by page (pages of 500) with progress and tournament-level checks', async () => {
    const { source, calls } = fakeSource(1_234);
    const { p, progress } = run(source);
    const s = await p;
    expect(s.phase).toBe('done');
    expect(s.status).toBe('VERIFIED');
    expect(s).toMatchObject({ target: 1_234, done: 1_234, verified: 1_234, failed: 0, incomplete: 0, issuesTotal: 0 });
    expect(s.tournamentChecks.map((c) => [c.check, c.status])).toEqual([
      ['FORMAT', 'VERIFIED'],
      ['SEED_COMMITMENT', 'VERIFIED'],
      ['PUBLIC_ENTROPY', 'VERIFIED'],
      ['HAND_CONSISTENCY', 'VERIFIED'],
    ]);
    expect(calls.bundle).toBe(3);
    expect(progress[0]!.phase).toBe('preparing');
    expect(progress.some((x) => x.phase === 'running')).toBe(true);
  });

  it('lists failed hands and inconsistent ones, and the verdict is FAILED', async () => {
    const { source } = fakeSource(60, (i, r) => (i === 7 ? { ...r, deckHash: 'f'.repeat(64) } : i === 9 ? { ...r, publicEntropy: 'e'.repeat(64) } : r));
    const s = await run(source).p;
    expect(s.status).toBe('FAILED');
    expect(s.failed).toBe(2);
    expect(s.issues.map((i) => i.handId)).toEqual(expect.arrayContaining(['h_t2_3', 'h_t1_4']));
    expect(s.issues.find((i) => i.handId === 'h_t2_3')!.reason).toMatch(/^Deck hash:/);
    expect(s.tournamentChecks.find((c) => c.check === 'HAND_CONSISTENCY')).toMatchObject({ status: 'FAILED' });
  });

  it('samples a reproducible set of hands through the per-hand endpoint', async () => {
    const { source, calls } = fakeSource(300);
    const s = await run(source, { mode: 'sample', sampleSize: 25 }).p;
    expect(s).toMatchObject({ phase: 'done', status: 'VERIFIED', target: 25, done: 25, sampleSeed: 'abcd' });
    expect(calls.handIdAt).toBe(25);
    expect(calls.handRecord).toBe(25);
    expect(calls.bundle).toBe(1); // tournament-level values only
  });

  it('before the reveal: card checks are NOT AVAILABLE, entropy and consistency still checked', async () => {
    const { source } = fakeSource(20, undefined, null);
    const s = await run(source).p;
    expect(s.status).toBe('INCOMPLETE');
    expect(s.incomplete).toBe(20);
    expect(s.seedAvailable).toBe(false);
    expect(s.tournamentChecks.find((c) => c.check === 'PUBLIC_ENTROPY')!.status).toBe('VERIFIED');
  });

  it('verifies with a seed the operator typed instead of the revealed one', async () => {
    const { source } = fakeSource(20, undefined, null);
    const ok = await run(source, { seedOverride: SEED }).p;
    expect(ok.status).toBe('VERIFIED');
    const bad = await run(source, { seedOverride: OTHER_SEED }).p;
    expect(bad.status).toBe('FAILED');
    expect(bad.tournamentChecks.find((c) => c.check === 'SEED_COMMITMENT')!.status).toBe('FAILED');
  });

  it('can be cancelled, and reports a friendly error when the server fails', async () => {
    const { source } = fakeSource(2_000);
    const r = run(source, { yieldFn: () => new Promise((res) => setTimeout(res, 0)) });
    setTimeout(() => r.ctrl.abort(), 5);
    const s = await r.p;
    expect(s.phase).toBe('cancelled');
    expect(s.done).toBeLessThan(2_000);

    const broken: BulkSource = { ...fakeSource(10).source, bundle: () => Promise.reject(new Error('boom')) };
    const e = await run(broken).p;
    expect(e.phase).toBe('error');
    expect(e.error).toMatch(/nothing past this point was verified/);
    expect(e.error).not.toContain('boom');
    expect(IDLE_BULK.phase).toBe('idle');
  });
});

// ------------------------------------------------------------------ the screen

/**
 * The mock backend with fairness data that really verifies: every mock
 * tournament gets SEED / its commitment / ENTROPY, and hand records are
 * re-dealt from the derived deck (the mock's own cards are only plausible).
 */
function renderFairness(path: string, opts: { as?: string; reveal?: string[] } = {}) {
  const mock: MockBackend = createMockBackend({ latencyMs: [0, 0], tickMs: 0, persistSession: false, signedInAs: opts.as ?? 'director' });
  for (const t of mock.server.world.tournaments) {
    t.serverSeed = SEED;
    t.serverSeedHash = commitmentFor(SEED);
    if (t.publicEntropy !== null) t.publicEntropy = ENTROPY;
    t.seedRevealed = opts.reveal?.includes(t.id) ?? false;
  }
  const fix = (r: HandFairnessRecord): HandFairnessRecord => {
    const h = honestRecord(r.tournamentId, r.tableId, r.handNumber, { seats: r.holeCards.map((x) => x.seat), button: r.buttonSeat, board: r.board.length, maxSeats: r.maxSeats });
    return { ...h, handId: r.handId, holeCards: h.holeCards.map((x) => ({ ...x, playerId: r.holeCards.find((y) => y.seat === x.seat)!.playerId })) };
  };
  const api = mock.backend.api;
  const calls = { revealSeed: 0, handFairness: 0 };
  const backend: Backend = {
    ...mock.backend,
    api: {
      ...api,
      hands: {
        ...api.hands,
        fairness: async (id, s) => {
          calls.handFairness += 1;
          return fix(await api.hands.fairness(id, s));
        },
      },
      fairness: {
        ...api.fairness,
        bundle: async (id, q, s) => {
          const b = await api.fairness.bundle(id, q, s);
          return { ...b, entropyInputs: { clientSeeds: CLIENT_SEEDS, adminEntropy: null }, hands: b.hands.map(fix) };
        },
        revealSeed: async (id, body) => {
          calls.revealSeed += 1;
          return api.fairness.revealSeed(id, body);
        },
      },
    },
  };
  const router = createMemoryRouter(createRoutes(), { initialEntries: [path] });
  render(
    <Providers backend={backend}>
      <RouterProvider router={router} />
    </Providers>,
  );
  afterEach(() => mock.stop());
  return { mock, router, calls };
}

describe('Fairness screen', () => {
  it('shows the commitment, public entropy (+ inputs), method and seed status', async () => {
    renderFairness('/t/trn_spring/fairness');
    await screen.findByRole('heading', { name: 'Fairness & randomness audit' }, TIMEOUT);
    expect(screen.getAllByText(commitmentFor(SEED)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(ENTROPY).length).toBeGreaterThan(0);
    expect(screen.getByText('SECRET (COMMITTED)')).toBeTruthy();
    expect(screen.getByText(/Available after the tournament is completed or cancelled \(now: /)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Reveal seed…' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('heading', { name: 'Randomness method' })).toBeTruthy();
    expect(screen.getByText(/Server method id:/).textContent).toContain('HMAC-SHA256-STREAM+FISHER-YATES');
    expect(screen.getByRole('heading', { name: /Verify independently/ })).toBeTruthy();
    // Recompute the entropy from its published inputs in the browser.
    fireEvent.click(screen.getByRole('button', { name: 'Recompute in this browser' }));
    expect(await screen.findByText(/SHA-256 of the 12 published client seed\(s\) equals the public entropy/, undefined, TIMEOUT)).toBeTruthy();
  });

  it('verifies a hand in the browser after the reveal: four checks VERIFIED, derived deck shown', async () => {
    const { calls } = renderFairness('/t/trn_demo32/fairness?hand=hand_demo32_100', { reveal: ['trn_demo32'] });
    const checks = await screen.findByRole('list', { name: 'Verification checks' }, TIMEOUT);
    await waitFor(() => expect(within(checks).getAllByText('VERIFIED')).toHaveLength(4), TIMEOUT);
    for (const name of ['Seed commitment', 'Deck hash', 'Hole cards', 'Board']) expect(within(checks).getByText(name)).toBeTruthy();
    expect(screen.getByText(/Verified in this browser in .* ms with the portable fairness engine/)).toBeTruthy();
    expect(screen.getByText('Same seed commitment as the tournament')).toBeTruthy();
    expect(screen.getByText(/Deck derived in this browser/)).toBeTruthy();
    expect(calls.handFairness).toBeGreaterThan(0);
    // The commitment check of the revealed seed itself.
    expect(screen.getByText('SHA-256 of the revealed seed equals the commitment.')).toBeTruthy();
  });

  it('a seed typed by the operator that does not match the commitment FAILS every hand', async () => {
    renderFairness('/t/trn_demo32/fairness?hand=hand_demo32_100', { reveal: ['trn_demo32'] });
    const checks = await screen.findByRole('list', { name: 'Verification checks' }, TIMEOUT);
    await waitFor(() => expect(within(checks).getAllByText('VERIFIED')).toHaveLength(4), TIMEOUT);
    fireEvent.click(screen.getByRole('button', { name: /Enter a seed/ }));
    const input = screen.getByLabelText(/Server seed \(64 hex characters\)/);
    fireEvent.change(input, { target: { value: 'xyz' } });
    expect(screen.getByText(/A server seed is 64 hexadecimal characters/)).toBeTruthy();
    // Without a valid typed seed nothing is verified with a seed, and bulk verification cannot start.
    expect(await screen.findByText(/Enter a valid seed above/, undefined, TIMEOUT)).toBeTruthy();
    expect((screen.getByRole('button', { name: /^Verify \d+ hands$/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: OTHER_SEED } });
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Verification checks' })).getAllByText('FAILED')).toHaveLength(1), TIMEOUT);
    expect(screen.getByText(/using the seed you entered/)).toBeTruthy();
  });

  it('finds a hand by number (several tables share numbers) and verifies the one picked', async () => {
    const { router } = renderFairness('/t/trn_demo32/fairness', { reveal: ['trn_demo32'] });
    await screen.findByRole('heading', { name: 'Verify a hand' }, TIMEOUT);
    fireEvent.change(screen.getByLabelText('Hand number or hand id'), { target: { value: '#5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find' }));
    expect(await screen.findByText(/played a hand #5/, undefined, TIMEOUT)).toBeTruthy();
    const picks = within(screen.getByText(/played a hand #5/).parentElement!).getAllByRole('button', { name: /^Hand #5, table \d+/ });
    fireEvent.click(picks[0]!);
    await waitFor(() => expect(router.state.location.search).toMatch(/hand=hand_demo32_\d+/), TIMEOUT);
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Verification checks' })).getAllByText('VERIFIED')).toHaveLength(4), TIMEOUT);
  });

  it('bulk-verifies a sample with progress and lists nothing to fix', async () => {
    renderFairness('/t/trn_demo32/fairness', { reveal: ['trn_demo32'] });
    const panel = (await screen.findByRole('heading', { name: 'Bulk verification' }, TIMEOUT)).closest('section')!;
    fireEvent.change(within(panel).getByLabelText('Hands'), { target: { value: '12' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Verify 12 hands' }, TIMEOUT));
    expect(await screen.findByText('All 12 sampled hands verified', undefined, TIMEOUT)).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuetext')).toBe('12 / 12');
    const tchecks = screen.getByRole('list', { name: 'Tournament-level checks' });
    expect(within(tchecks).getAllByText('VERIFIED')).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Download report' })).toBeTruthy();
  });

  it('reveals the seed only through the level-2 confirmation (REVEAL + reason), then everything verifies', async () => {
    const { mock, calls } = renderFairness('/t/trn_demo32/fairness');
    const reveal = await screen.findByRole('button', { name: 'Reveal seed…' }, TIMEOUT);
    expect((reveal as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(reveal);
    const d = await screen.findByRole('dialog');
    expect(within(d).getByText(/This cannot be undone/)).toBeTruthy();
    expect(within(d).getByText('Secret (committed)')).toBeTruthy();
    const confirm = within(d).getByRole('button', { name: 'Reveal seed' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(d).getByLabelText(/Reason/), { target: { value: 'Tournament finished, publishing for audit' } });
    fireEvent.change(within(d).getByLabelText(/to confirm/), { target: { value: 'REVEAL' } });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(calls.revealSeed).toBe(1), TIMEOUT);
    expect(mock.server.tournament('trn_demo32').seedRevealed).toBe(true);
    await waitFor(() => expect(screen.getByText('REVEALED')).toBeTruthy(), TIMEOUT);
    expect(screen.getAllByText(SEED).length).toBeGreaterThan(0);
    expect(screen.getByText('SHA-256 of the revealed seed equals the commitment.')).toBeTruthy();
    // The audit log has the entry, written by the server.
    expect(mock.server.world.audit.some((a) => a.action === 'REVEAL_SEED')).toBe(true);
  });

  it('hides the reveal control from staff without FAIRNESS_REVEAL_SEED', async () => {
    renderFairness('/t/trn_demo32/fairness', { as: 'staff' });
    await screen.findByRole('heading', { name: 'Fairness & randomness audit' }, TIMEOUT);
    expect(screen.queryByRole('button', { name: 'Reveal seed…' })).toBeNull();
    expect(screen.getByText('Requires FAIRNESS_REVEAL_SEED')).toBeTruthy();
  });

  it('"Verify this hand" on the hand detail leads to the per-hand verification', async () => {
    const { router } = renderFairness('/t/trn_demo32/hands/hand_demo32_100', { reveal: ['trn_demo32'] });
    await screen.findByRole('heading', { name: /^Hand #/ }, TIMEOUT);
    // The hand detail runs the same browser check.
    await waitFor(() => expect(screen.getAllByText('VERIFIED').length).toBeGreaterThanOrEqual(4), TIMEOUT);
    fireEvent.click(screen.getAllByRole('link', { name: 'Verify this hand' })[0]!);
    await waitFor(() => expect(router.state.location.pathname).toBe('/t/trn_demo32/fairness'), TIMEOUT);
    expect(router.state.location.search).toBe('?hand=hand_demo32_100');
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Verification checks' })).getAllByText('VERIFIED')).toHaveLength(4), TIMEOUT);
  });
});
