import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AdminTableView, HandActionLogEntry, TableEvent } from '@jpb/shared-types';
import { eventSummary } from '../src/sections/table-detail/EventLog';
import { logFromActionLog, logFromEvents, seatModels } from '../src/sections/table-detail/model';
import { seatLayout } from '../src/sections/table-detail/OvalTable';
import { parseStack } from '../src/sections/table-detail/AdjustStackDialog';
import { SPRING, location, renderAt } from './tables.helpers';

afterEach(() => cleanup());

// ------------------------------------------------------------------ pure helpers

describe('seat layout', () => {
  const CARD_H = 150;
  it('never overlaps two seat cards, for every table size and panel width', () => {
    for (let n = 2; n <= 10; n++) {
      for (const w of [560, 700, 900, 1200]) {
        const h = 400;
        const { points, seatWidth } = seatLayout(n, w, h);
        expect(points).toHaveLength(n);
        expect(new Set(points.map((p) => `${p.x},${p.y}`)).size).toBe(n);
        for (let i = 0; i < n; i++) {
          for (let j = i + 1; j < n; j++) {
            const a = points[i]!;
            const b = points[j]!;
            const apart = Math.abs(a.x - b.x) >= seatWidth || Math.abs(a.y - b.y) >= CARD_H;
            expect(apart, `n=${n} w=${w} seats ${i}/${j}`).toBe(true);
          }
        }
      }
    }
  });

  it('puts seat 0 at the bottom centre and goes clockwise (left first)', () => {
    const { points } = seatLayout(9, 800, 400);
    expect(points[0]).toEqual({ x: 400, y: 400 });
    expect(points[1]!.x).toBeLessThan(400);
    expect(points[2]).toEqual({ x: 0, y: 200 });
    expect(points[3]!.y).toBe(0);
    expect(points[7]).toEqual({ x: 800, y: 200 });
  });
});

const baseView = (): AdminTableView => ({
  audience: 'ADMIN',
  tableId: 't1',
  tournamentId: 'trn',
  tableNumber: 4,
  version: 10,
  lastEventSeq: 20,
  status: 'IN_HAND',
  holds: [],
  frozen: false,
  maxSeats: 3,
  buttonSeat: 0,
  blinds: { level: 3, smallBlind: 100, bigBlind: 200, ante: 0, anteType: 'NONE' } as AdminTableView['blinds'],
  hand: { handId: 'h9', handNumber: 9, phase: 'FLOP', board: ['As', 'Kd', '7c'], pots: [{ amount: 1200, eligibleSeats: [0, 2] }], totalPot: 1200, currentBet: 400, actingSeat: 2, actionDeadline: 99_000, turnVersion: 3 },
  serverTime: 1,
  seats: [
    { seat: 0, playerId: 'p0', displayName: 'Ana', publicId: 'JPN-A', stack: 5_050, connected: true, inHand: true, folded: false, allIn: false, streetContribution: 400, lastAction: { action: 'BET', amount: 400, toAmount: 400 }, isButton: true, isSmallBlind: false, isBigBlind: false, shownCards: null, away: false },
    null,
    { seat: 2, playerId: 'p2', displayName: 'Ben', publicId: 'JPN-B', stack: 900, connected: false, inHand: true, folded: false, allIn: false, streetContribution: 0, lastAction: null, isButton: false, isSmallBlind: false, isBigBlind: true, shownCards: null, away: true },
  ],
  holeCards: null,
  seatDetails: [
    { seat: 0, playerId: 'p0', displayName: 'Ana', publicId: 'JPN-A', stack: 5_050, connected: true, consecutiveTimeouts: 0, waitingForNextHand: false, pendingRemoval: null, stats: { handsDealtAtTable: 1, handsSinceBigBlind: 1, handsSinceSmallBlind: 1, handsPlayedTotal: 1 } },
    null,
    { seat: 2, playerId: 'p2', displayName: 'Ben', publicId: 'JPN-B', stack: 900, connected: false, suspended: true, consecutiveTimeouts: 2, waitingForNextHand: false, pendingRemoval: { reason: 'MOVED', moveId: 'm1' }, stats: { handsDealtAtTable: 1, handsSinceBigBlind: 0, handsSinceSmallBlind: 1, handsPlayedTotal: 1 } },
  ],
  timing: { actionTimerMs: 20_000, awayActionTimerMs: 5_000, awayAfterTimeouts: 3, actionGraceMs: 1_000, betweenHandsDelayMs: 2_000, showdownDelayMs: 3_000 },
  handForHand: false,
  pendingBlinds: null,
  lastProgressAt: 1,
  handsPlayed: 8,
});

describe('seat models', () => {
  it('projects every admin detail of a seat with text states', () => {
    const [a, empty, b] = seatModels(baseView());
    expect(empty).toBeNull();
    expect(a).toMatchObject({ name: 'Ana', publicId: 'JPN-A', bb: 25.2, isButton: true, streetContribution: 400, acting: false, status: { text: 'Connected' } });
    expect(b).toMatchObject({ acting: true, isBigBlind: true, suspended: true, transit: 'MOVED', consecutiveTimeouts: 2, status: { text: 'Disconnected' } });
    expect(b!.flags.map((f) => f.text)).toEqual(['Suspended', 'In transit · moving to another table', '2 timeouts in a row']);
  });
});

describe('action log', () => {
  const names = (s: number) => ['Ana', 'X', 'Ben'][s]!;
  it('groups the actor log by street with all-in / timeout tags', () => {
    const log: HandActionLogEntry[] = [
      { kind: 'FORCED_BET', street: 'PREFLOP', seat: 2, playerId: 'p2', betType: 'BIG_BLIND', amount: 200, allIn: false },
      { kind: 'ACTION', street: 'PREFLOP', seat: 0, playerId: 'p0', intent: 'RAISE', action: 'RAISE', amount: 600, toAmount: 600, allIn: false, fullRaise: true, currentBetAfter: 600, timeout: false },
      { kind: 'ACTION', street: 'FLOP', seat: 2, playerId: 'p2', intent: 'FOLD', action: 'FOLD', amount: 0, toAmount: 0, allIn: false, fullRaise: null, currentBetAfter: 0, timeout: true },
    ];
    const out = logFromActionLog(log, names);
    expect(out.map((e) => `${e.kind}:${e.who ?? ''} ${e.text}`)).toEqual(['street: Pre-flop', 'forced:Ben posts big blind', 'action:Ana raises to 600', 'street: Flop', 'action:Ben folds']);
    expect(out[4]!.tags.map((t) => t.text)).toEqual(['TIMEOUT']);
  });

  it('rebuilds the current hand from live socket events', () => {
    const ev = (seq: number, event: TableEvent['event']): TableEvent => ({ tableId: 't1', tournamentId: 'trn', seq, version: seq, at: 1000 + seq, visibility: 'PUBLIC', privateTo: null, event });
    const events = [
      ev(1, { kind: 'HAND_STARTED', handId: 'old', handNumber: 8, buttonSeat: 0, smallBlindSeat: 2, bigBlindSeat: 0, smallBlind: 100, bigBlind: 200, ante: 0, anteType: 'NONE', players: [] } as never),
      ev(2, { kind: 'HAND_STARTED', handId: 'h9', handNumber: 9, buttonSeat: 0, smallBlindSeat: 2, bigBlindSeat: 0, smallBlind: 100, bigBlind: 200, ante: 0, anteType: 'NONE', players: [] } as never),
      ev(3, { kind: 'FORCED_BET_POSTED', seat: 2, betType: 'SMALL_BLIND', amount: 100, allIn: false, stack: 800, pot: 100 }),
      ev(4, { kind: 'PLAYER_ACTED', seat: 0, playerId: 'p0', action: 'CALL', amount: 100, toAmount: 200, allIn: false, stack: 4_900, pot: 300, timeout: false }),
      ev(5, { kind: 'STREET_STARTED', street: 'FLOP', board: ['As', 'Kd', '7c'], newCards: ['As', 'Kd', '7c'], pot: 400 }),
    ];
    const out = logFromEvents(events, 'h9', names);
    expect(out.map((e) => e.text)).toEqual(['Pre-flop', 'posts small blind', 'calls 100', 'Flop']);
    expect(out[3]!.cards).toEqual(['As', 'Kd', '7c']);
    expect(logFromEvents(events, 'nope', names)).toEqual([]);
  });

  it('summarises raw events in one line', () => {
    expect(eventSummary({ kind: 'STACK_ADJUSTED', seat: 3, playerId: 'p', before: 1000, after: 1500 })).toBe('Seat 4 stack 1,000 → 1,500');
    expect(eventSummary({ kind: 'TABLE_STATUS_CHANGED', status: 'HELD', holds: ['ADMIN'], frozen: true })).toBe('Status HELD · holds ADMIN · FROZEN');
  });

  it('parses typed stacks as whole chips only', () => {
    expect(parseStack('20,000')).toBe(20_000);
    expect(parseStack(' 1 500 ')).toBe(1_500);
    expect(parseStack('12.5')).toBeNull();
    expect(parseStack('-4')).toBeNull();
  });
});

// ------------------------------------------------------------------ the screen

describe('Table detail (§2.6)', () => {
  it('shows every seat with id, stack in chips and BB, positions, connection, plus hand and internals', async () => {
    renderAt(`/t/${SPRING}/tables/tbl_spring_1`);
    expect(await screen.findByRole('heading', { name: /Table 1/ })).toBeTruthy();
    const seats = await screen.findAllByRole('article');
    expect(seats.length).toBe(9);
    expect(seats.some((s) => /dealer button/.test(s.getAttribute('aria-label') ?? ''))).toBe(true);
    expect(seats.every((s) => /JPN-[A-Z0-9]+, stack [\d,]+ chips, [\d.]+ big blinds/.test(s.getAttribute('aria-label') ?? ''))).toBe(true);
    expect(seats.every((s) => /, (connected|away|disconnected)/.test(s.getAttribute('aria-label') ?? ''))).toBe(true);
    expect(screen.getByRole('table', { name: /Pots and the seats eligible/ })).toBeTruthy();
    expect(await screen.findByText('Matches the director')).toBeTruthy();
    expect(screen.getByText('Invariant check: all invariants hold')).toBeTruthy();
    expect(screen.getByText(/^worker-/)).toBeTruthy();
    // Raw event log (paginated, newest page by default) with expandable JSON.
    expect(await screen.findByText(/Showing seq/)).toBeTruthy();
    const firstEvent = within(screen.getByRole('list', { name: 'Table events' })).getAllByRole('button')[0]!;
    fireEvent.click(firstEvent);
    expect(firstEvent.getAttribute('aria-expanded')).toBe('true');
    // Recent hands link to the replay.
    const recent = screen.getAllByRole('link', { name: /Open the replay/ });
    expect(recent.length).toBeGreaterThan(0);
  });

  it('keeps hole cards hidden by default and reveals them only through REVEAL + reason (VIEW_HOLE_CARDS)', async () => {
    renderAt(`/t/${SPRING}/tables/tbl_spring_1`, 'super');
    await screen.findAllByRole('article');
    expect(screen.getAllByRole('article').some((s) => /hole cards revealed/.test(s.getAttribute('aria-label') ?? ''))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Reveal live hole cards…' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Reveal hole cards' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'Dispute at seat 4, verifying with floor' } });
    fireEvent.change(within(dialog).getByLabelText(/to confirm/), { target: { value: 'REVEAL' } });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.getAllByRole('article').some((s) => /hole cards revealed/.test(s.getAttribute('aria-label') ?? ''))).toBe(true));
    expect(screen.getByText('Live hole cards are visible to you')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hide hole cards' }));
    await waitFor(() => expect(screen.getAllByRole('article').some((s) => /hole cards revealed/.test(s.getAttribute('aria-label') ?? ''))).toBe(false));
  });

  it('never offers the reveal without VIEW_HOLE_CARDS, and is view-only for viewers', async () => {
    renderAt(`/t/${SPRING}/tables/tbl_spring_1`);
    await screen.findAllByRole('article');
    expect(screen.queryByRole('button', { name: /Reveal live hole cards/ })).toBeNull();
    cleanup();
    renderAt(`/t/${SPRING}/tables/tbl_spring_1`, 'viewer');
    expect(await screen.findByText(/View only — your role cannot change this table/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Freeze table/ })).toBeNull();
  });

  it('force timeout is level 1 with a REQUIRED reason', async () => {
    renderAt(`/t/${SPRING}/tables/tbl_spring_37`);
    expect(await screen.findByText(/Stalled — no progress for/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: /^Force timeout/ })[0]!);
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Force timeout' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'Player left the venue' } });
    fireEvent.click(confirm);
    expect(await screen.findByText('Timeout applied')).toBeTruthy();
  });

  it('holds and releases the table with one confirmation each', async () => {
    renderAt(`/t/${SPRING}/tables/tbl_spring_1`);
    fireEvent.click(await screen.findByRole('button', { name: 'Hold after hand' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Hold after this hand' }));
    expect(await screen.findByText('Table 1 holds after the current hand')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Release hold' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Release table' }));
    expect(await screen.findByText('Table 1 released')).toBeTruthy();
  });

  it('breaks a table only after typing BREAK and a reason, with a before/after preview', async () => {
    renderAt(`/t/${SPRING}/tables/tbl_spring_2`);
    fireEvent.click(await screen.findByRole('button', { name: 'Break table…' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Players at this table')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'Consolidating the room early' } });
    fireEvent.change(within(dialog).getByLabelText(/to confirm/), { target: { value: 'BREAK' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Break this table' }));
    expect(await screen.findByText(/Table 2 is breaking/)).toBeTruthy();
  });

  it('moves a player: pick player, destination table and seat, then confirm with a reason', async () => {
    const { mock } = renderAt(`/t/${SPRING}/tables/tbl_spring_18`);
    // Free seat 4 at table 2 so it can receive a player.
    const t2 = mock.server.world.tournaments.find((t) => t.id === SPRING)!.tables.find((t) => t.tableNumber === 2)!;
    const leaving = mock.server.world.tournaments.find((t) => t.id === SPRING)!.players.find((p) => p.playerId === t2.seats[3])!;
    Object.assign(leaving, { tableId: null, seat: null });
    t2.seats[3] = null;
    fireEvent.click(await screen.findByRole('button', { name: 'Move player…' }));
    const form = await screen.findByRole('dialog', { name: 'Move a player' });
    expect((await within(form).findByRole('radio', { name: 'Table 1, 9 of 9 players, full' })).hasAttribute('disabled')).toBe(true);
    fireEvent.click(await within(form).findByRole('radio', { name: /^Table 2, 8 of 9 players/ }));
    expect(within(form).getByRole('radio', { name: /Automatic/ })).toBeTruthy();
    expect((await within(form).findByRole('radio', { name: /^Seat 1, taken by/ })).hasAttribute('disabled')).toBe(true);
    fireEvent.click(await within(form).findByRole('radio', { name: 'Seat 4, free' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Review move…' }));
    const confirm = await screen.findByRole('dialog', { name: /^Move / });
    fireEvent.change(within(confirm).getByLabelText(/Reason/), { target: { value: 'Accessibility seat request' } });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Move player' }));
    expect(await screen.findByText(/will move to table 2/)).toBeTruthy();
  });

  it('adjusts a stack only between hands, through ADJUST + reason', async () => {
    renderAt(`/t/${SPRING}/tables/tbl_spring_1`, 'super');
    fireEvent.click(await screen.findByRole('button', { name: 'Adjust stack…' }));
    let form = await screen.findByRole('dialog', { name: 'Adjust a stack' });
    expect(within(form).getByText('A hand is in progress')).toBeTruthy();
    fireEvent.change(within(form).getByLabelText(/Corrected stack/), { target: { value: '20000' } });
    expect((within(form).getByRole('button', { name: 'Review adjustment…' }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();

    renderAt(`/t/${SPRING}/tables/tbl_spring_18`, 'super');
    fireEvent.click(await screen.findByRole('button', { name: 'Adjust stack…' }));
    form = await screen.findByRole('dialog', { name: 'Adjust a stack' });
    fireEvent.change(within(form).getByLabelText(/Corrected stack/), { target: { value: '0' } });
    expect(within(form).getByText(/at least 1 chip/)).toBeTruthy();
    fireEvent.change(within(form).getByLabelText(/Corrected stack/), { target: { value: '20,000' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Review adjustment…' }));
    const confirm = await screen.findByRole('dialog', { name: /stack$/ });
    expect(within(confirm).getByText(/20,000 \(/)).toBeTruthy();
    fireEvent.change(within(confirm).getByLabelText(/Reason/), { target: { value: 'Dealer miscount verified on camera' } });
    fireEvent.change(within(confirm).getByLabelText(/to confirm/), { target: { value: 'ADJUST' } });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Adjust stack' }));
    expect(await screen.findByText(/stack set to 20,000/)).toBeTruthy();
  });

  it('sends a message to this table after one confirmation', async () => {
    renderAt(`/t/${SPRING}/tables/tbl_spring_1`);
    const box = await screen.findByLabelText(/Message to the players of table 1/);
    fireEvent.change(box, { target: { value: 'Deck change at this table.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to table…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Send a message to table 1' });
    expect(within(dialog).getByText('“Deck change at this table.”')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Message sent to table 1')).toBeTruthy();
    await waitFor(() => expect((box as HTMLTextAreaElement).value).toBe(''));
  });

  it('says so when the table does not exist', async () => {
    renderAt(`/t/${SPRING}/tables/tbl_nope`);
    expect(await screen.findByText('Table not found')).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: /Back to the table map/ }));
    await waitFor(() => expect(location.current.pathname).toBe(`/t/${SPRING}/tables`));
  });
});
