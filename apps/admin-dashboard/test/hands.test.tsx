import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { HandDetailDto } from '@jpb/shared-types';
import { activeHandFilters, handFiltersToParams, handsQueryOf, parseHandFilters } from '../src/sections/hands/filters';
import { bbText, blindsText, parseChipInput, parseHandNumber, winnersText } from '../src/sections/hands/model';
import { actionPhrase, buildReplay, replaySeatCount, stackDifferences } from '../src/sections/hand-detail/replay';
import { renderControlRoom } from './support/renderControlRoom';

vi.setConfig({ testTimeout: 30_000 });
const TIMEOUT = { timeout: 8_000 };

// ------------------------------------------------------------------ pure helpers

describe('hand list helpers', () => {
  it('parses chip amounts typed by an operator', () => {
    expect(parseChipInput('12500')).toBe(12_500);
    expect(parseChipInput('12,500')).toBe(12_500);
    expect(parseChipInput('12.5k')).toBe(12_500);
    expect(parseChipInput('1.2M')).toBe(1_200_000);
    expect(parseChipInput('1.1k')).toBe(1_100);
    expect(parseChipInput(' 3 ')).toBe(3);
    for (const bad of ['', 'abc', '-5', '1.25', '1e5', '12.5.5k']) expect(parseChipInput(bad)).toBeNull();
  });

  it('parses hand numbers', () => {
    expect(parseHandNumber('#1,234')).toBe(1234);
    expect(parseHandNumber('7')).toBe(7);
    expect(parseHandNumber('0')).toBeNull();
    expect(parseHandNumber('hand_x')).toBeNull();
  });

  it('formats blinds, big blinds (never overstated) and winners', () => {
    expect(blindsText(300, 600)).toBe('300 / 600');
    expect(blindsText(300, 600, 75)).toBe('300 / 600 · ante 75');
    expect(bbText(12_345, 600)).toBe('20.5 BB');
    expect(bbText(1_200, 600)).toBe('2 BB');
    expect(bbText(599, 600)).toBe('0.9 BB');
    expect(bbText(100, 0)).toBe('');
    expect(winnersText([])).toBe('—');
    expect(winnersText([{ playerId: 'a', displayName: 'Ana', amount: 1 }, { playerId: 'b', displayName: 'Ben', amount: 1 }])).toBe('Ana + 1 more');
  });

  it('round-trips filters through the URL and builds the server query', () => {
    const f = parseHandFilters(new URLSearchParams('tableId=tbl_1&tn=12&playerId=p_9&pn=Ana&hand=44&minPot=25000&showdown=yes&allIn=no'));
    expect(f).toEqual({ tableId: 'tbl_1', tableNumber: 12, playerId: 'p_9', playerName: 'Ana', handNumber: 44, minPot: 25_000, showdown: 'yes', allIn: 'no' });
    expect(parseHandFilters(handFiltersToParams(f))).toEqual(f);
    expect(handsQueryOf(f)).toEqual({ tableId: 'tbl_1', playerId: 'p_9', handNumber: 44, minPot: 25_000, showdown: true, allIn: false });
    expect(activeHandFilters(f)).toBe(6);
    // Garbage in the URL is ignored, never sent to the server.
    const g = parseHandFilters(new URLSearchParams('hand=-3&minPot=abc&showdown=maybe&tn=7'));
    expect(handsQueryOf(g)).toEqual({});
    expect(g.tableNumber).toBeNull();
  });
});

// ------------------------------------------------------------------ replay model

/** 3 players; Ben all-in pre-flop, Ana all-in over the top, Cat's uncalled 200 returned; main + side pot; run-out to the river. */
function fixture(): HandDetailDto {
  const act = (seq: number, seat: number, action: HandDetailDto['actions'][number]['action'], amount: number, toAmount: number, stackAfter: number, potAfter: number, allIn = false) => ({
    seq,
    street: 'PREFLOP' as const,
    seat,
    playerId: `p${seat}`,
    displayName: ['Ana', '', 'Ben', '', '', 'Cat'][seat]!,
    action,
    amount,
    toAmount,
    allIn,
    timeout: false,
    stackAfter,
    potAfter,
    at: 1_000 + seq,
  });
  return {
    handId: 'h1',
    tableId: 't1',
    tableNumber: 3,
    handNumber: 17,
    startedAt: 1_000,
    completedAt: 61_000,
    level: 2,
    smallBlind: 50,
    bigBlind: 100,
    totalPot: 2_400,
    players: 3,
    showdown: true,
    allIn: true,
    winners: [],
    buttonSeat: 0,
    smallBlindSeat: 2,
    bigBlindSeat: 5,
    ante: 0,
    board: ['As', 'Kd', '7c', '2h', '9s'],
    boardByStreet: { flop: ['As', 'Kd', '7c'], turn: '2h', river: '9s' },
    seats: [
      { seat: 0, playerId: 'p0', displayName: 'Ana', publicId: 'JPN-A', startingStack: 1_000, finalStack: 0, holeCards: ['Qh', 'Qs'], shown: true, finalHand: { category: 'ONE_PAIR', description: 'Pair of Queens', bestFive: ['Qh', 'Qs', 'As', 'Kd', '9s'] } },
      { seat: 2, playerId: 'p2', displayName: 'Ben', publicId: 'JPN-B', startingStack: 400, finalStack: 1_200, holeCards: ['Ah', 'Kh'], shown: true, finalHand: { category: 'TWO_PAIR', description: 'Two Pair, Aces and Kings', bestFive: ['Ah', 'As', 'Kh', 'Kd', '9s'] } },
      { seat: 5, playerId: 'p5', displayName: 'Cat', publicId: 'JPN-C', startingStack: 2_000, finalStack: 2_200, holeCards: ['7h', '7d'], shown: true, finalHand: { category: 'THREE_OF_A_KIND', description: 'Three of a Kind, Sevens', bestFive: ['7h', '7d', '7c', 'As', 'Kd'] } },
    ],
    actions: [
      act(1, 2, 'POST_SB', 50, 50, 350, 50),
      act(2, 5, 'POST_BB', 100, 100, 1_900, 150),
      act(3, 0, 'RAISE', 300, 300, 700, 450),
      act(4, 2, 'ALL_IN', 350, 400, 0, 800, true),
      act(5, 5, 'RAISE', 1_100, 1_200, 800, 1_900),
      act(6, 0, 'ALL_IN', 700, 1_000, 0, 2_600, true),
    ],
    pots: [
      { potIndex: 0, type: 'MAIN', amount: 1_200, eligibleSeats: [0, 2, 5], winners: [{ seat: 5, playerId: 'p5', amount: 1_200, oddChips: 0 }], winningHand: { category: 'THREE_OF_A_KIND', description: 'Three of a Kind, Sevens' } },
      { potIndex: 1, type: 'SIDE', amount: 1_200, eligibleSeats: [0, 5], winners: [{ seat: 5, playerId: 'p5', amount: 1_200, oddChips: 0 }], winningHand: { category: 'THREE_OF_A_KIND', description: 'Three of a Kind, Sevens' } },
    ],
    uncalledReturns: [{ seat: 5, amount: 200 }],
    randomness: { method: 'HMAC-SHA256-STREAM+FISHER-YATES', serverSeedHash: 'a'.repeat(64), publicEntropy: 'b'.repeat(64), deckHash: 'c'.repeat(64), label: 'JPB/v1/deck|trn|t1|17|' + 'b'.repeat(64) },
  };
}

describe('replay model', () => {
  const hand = fixture();
  // Ben's main pot goes to Cat in this fixture, so fix final stacks accordingly.
  hand.seats[1]!.finalStack = 0;
  hand.seats[2]!.finalStack = 3_400;
  hand.pots[0]!.winners = [{ seat: 5, playerId: 'p5', amount: 1_200, oddChips: 0 }];

  it('steps deal → every action → uncalled return → flop → turn → river → showdown → each pot', () => {
    const r = buildReplay(hand);
    expect(r.frames.map((f) => f.kind)).toEqual(['start', 'action', 'action', 'action', 'action', 'action', 'action', 'uncalled', 'street', 'street', 'street', 'showdown', 'award', 'award']);
    expect(r.stageStarts).toEqual({ START: 0, PREFLOP: 1, FLOP: 8, TURN: 9, RIVER: 10, SHOWDOWN: 11 });
    expect(r.frames.map((f) => f.board.length)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 3, 4, 5, 5, 5, 5]);
    expect(r.frameOfAction.get(4)).toBe(4);
    expect(r.differences).toEqual([]);
  });

  it('tracks stacks, bets in front, pot and all-ins exactly as recorded', () => {
    const r = buildReplay(hand);
    const seat = (i: number, s: number) => r.frames[i]!.seats.find((x) => x.seat === s)!;
    expect(r.frames[0]!.seats.map((s) => s.stack)).toEqual([1_000, 400, 2_000]);
    expect(seat(4, 2)).toMatchObject({ stack: 0, bet: 400, allIn: true, lastAction: { action: 'ALL_IN', amount: 350, toAmount: 400 } });
    expect(r.frames[6]!.pot).toBe(2_600);
    // Uncalled: Cat gets 200 back, the pot shrinks.
    expect(seat(7, 5)).toMatchObject({ stack: 1_000, bet: 1_000 });
    expect(r.frames[7]!.pot).toBe(2_400);
    // The flop sweeps every bet into the middle.
    expect(r.frames[8]!.seats.every((s) => s.bet === 0 && s.lastAction === null)).toBe(true);
    expect(r.frames[8]!.caption).toMatch(/^Flop: A♠ K♦ 7♣/);
    // Showdown turns the cards face up and lists the pots.
    expect(r.frames[11]!.seats.every((s) => s.shown)).toBe(true);
    expect(r.frames[11]!.pots).toEqual([{ amount: 1_200 }, { amount: 1_200 }]);
    const last = r.frames[13]!;
    expect(last.seats.map((s) => s.stack)).toEqual([0, 0, 3_400]);
    expect(last.pot).toBe(0);
    expect(last.caption).toContain('Side pot 1 1,200 → Cat 1,200 with Three of a Kind, Sevens');
    expect(last.winningCards).toEqual(['7h', '7d', '7c', 'As', 'Kd']);
  });

  it('reports — never hides — a recorded final stack that the chip movements do not explain', () => {
    const bad = fixture();
    bad.seats[2]!.finalStack = 3_401;
    const r = buildReplay(bad);
    expect(stackDifferences(bad).map((d) => d.seat)).toEqual(expect.arrayContaining([5]));
    expect(r.differences.length).toBeGreaterThan(0);
    // The last frame still shows what the server recorded.
    expect(r.frames.at(-1)!.seats.find((s) => s.seat === 5)!.stack).toBe(3_401);
  });

  it('phrases actions for humans and sizes the replay table', () => {
    expect(actionPhrase({ action: 'RAISE', amount: 1_100, toAmount: 1_200, allIn: false, timeout: false })).toBe('raises to 1,200');
    expect(actionPhrase({ action: 'CALL', amount: 600, toAmount: 1_200, allIn: true, timeout: true })).toBe('calls 600 (all-in) — timed out');
    expect(actionPhrase({ action: 'POST_ANTE', amount: 25, toAmount: 25, allIn: false, timeout: false })).toBe('posts an ante of 25');
    expect(replaySeatCount(hand, 9)).toBe(9);
    expect(replaySeatCount(hand, null)).toBe(6);
    expect(replaySeatCount(hand, 4)).toBe(6);
    expect(replaySeatCount({ seats: [], buttonSeat: null }, 40)).toBe(10);
  });
});

// ------------------------------------------------------------------ screens on the mock backend

describe('Hands screen', () => {
  it('lists the server-paginated hand history with every column, newest first', async () => {
    renderControlRoom('/t/trn_spring/hands');
    const grid = await screen.findByRole('table', { name: /Hand history/ }, TIMEOUT);
    const headers = within(grid).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(expect.arrayContaining(['Hand', 'Table', 'Level · blinds', 'Pot', 'Players', 'Winner(s)', 'Showdown · all-in', 'Completed']));
    await waitFor(() => expect(within(grid).getAllByRole('row', { name: /^Hand \d+, table \d+/ }).length).toBeGreaterThan(5), TIMEOUT);
    // Only the rows on screen exist in the DOM (virtualized), never the ~19k hands.
    expect(within(grid).getAllByRole('row').length).toBeLessThan(80);
    expect(Number(grid.getAttribute('aria-rowcount'))).toBeGreaterThan(1_000);
    expect(screen.getByText(/hands completed/)).toBeTruthy();
  });

  it('filters by showdown and minimum pot on the server and keeps the filters in the URL', async () => {
    const { router } = renderControlRoom('/t/trn_spring/hands');
    await screen.findByRole('table', { name: /Hand history/ }, TIMEOUT);
    fireEvent.change(screen.getByLabelText('Showdown'), { target: { value: 'yes' } });
    const pot = screen.getByPlaceholderText('e.g. 25k');
    fireEvent.change(pot, { target: { value: '50k' } });
    fireEvent.keyDown(pot, { key: 'Enter' });
    await waitFor(() => expect(router.state.location.search).toContain('minPot=50000'), TIMEOUT);
    expect(router.state.location.search).toContain('showdown=yes');
    await waitFor(() => {
      const rows = screen.getAllByRole('row', { name: /^Hand \d+, table \d+/ });
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        expect(r.getAttribute('aria-label')).toContain('showdown');
        const chips = Number(/pot ([\d,]+) chips/.exec(r.getAttribute('aria-label')!)![1]!.replace(/,/g, ''));
        expect(chips).toBeGreaterThanOrEqual(50_000);
      }
    }, TIMEOUT);
    expect(screen.getByText(/match the filters/)).toBeTruthy();
    // An invalid amount is explained, not sent.
    fireEvent.change(pot, { target: { value: 'lots' } });
    fireEvent.keyDown(pot, { key: 'Enter' });
    expect(await screen.findByText('Chips, e.g. 25000 or 25k')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Clear 2 filters/ }));
    await waitFor(() => expect(router.state.location.search).toBe(''), TIMEOUT);
  });

  it('opens the hand detail from a row (Enter on the focused row)', async () => {
    const { router } = renderControlRoom('/t/trn_spring/hands');
    const grid = await screen.findByRole('table', { name: /Hand history/ }, TIMEOUT);
    const row = await waitFor(() => within(grid).getAllByRole('row', { name: /^Hand \d+, table \d+/ })[0]!, TIMEOUT);
    fireEvent.keyDown(row, { key: 'Enter' });
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/t\/trn_spring\/hands\/hand_spring_\d+$/), TIMEOUT);
    expect(await screen.findByRole('heading', { name: /^Hand #/ }, TIMEOUT)).toBeTruthy();
  });

  it('applies a table filter that arrives in a link and names the table on the chip', async () => {
    const { mock } = renderControlRoom('/t/trn_spring/hands?tableId=tbl_spring_201');
    await screen.findByRole('table', { name: /Hand history/ }, TIMEOUT);
    const tableNumber = mock.server.tournament('trn_spring').tables.find((t) => t.tableId === 'tbl_spring_201')!.tableNumber;
    await waitFor(() => expect(screen.getByRole('group', { name: 'Table filter' }).textContent).toContain(`Table ${tableNumber}`), TIMEOUT);
    await waitFor(() => {
      const rows = screen.getAllByRole('row', { name: /^Hand \d+, table \d+/ });
      for (const r of rows) expect(r.getAttribute('aria-label')).toContain(`table ${tableNumber},`);
    }, TIMEOUT);
  });
});

describe('Hand detail & replay', () => {
  async function open(id = 'hand_spring_211') {
    const r = renderControlRoom(`/t/trn_spring/hands/${id}`);
    await screen.findByRole('heading', { name: /^Hand #/ }, TIMEOUT);
    return r;
  }

  it('shows dealer/blinds, players with stacks and hole cards, every action, board, pots and randomness', async () => {
    await open();
    expect(screen.getByRole('region', { name: 'Hand summary' }).textContent).toMatch(/Dealer.*Seat \d/);
    const players = screen.getByRole('table', { name: /Players of hand/ });
    expect(within(players).getAllByRole('row').length).toBeGreaterThan(3);
    expect(within(players).getAllByRole('group', { name: /hole cards:/ }).length).toBeGreaterThan(1);
    const actions = screen.getByRole('table', { name: /Actions of hand/ });
    expect(within(actions).getByText('POST SB')).toBeTruthy();
    expect(within(actions).getByText('POST BB')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Board by street' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Pots & winners' })).toBeTruthy();
    expect(screen.getByText('Server seed hash (commitment)')).toBeTruthy();
    expect(screen.getAllByText('Deck hash').length).toBeGreaterThan(0);
    const verify = screen.getAllByRole('link', { name: 'Verify this hand' })[0]!;
    expect(verify.getAttribute('href')).toContain('/t/trn_spring/fairness?hand=hand_spring_211');
    // The in-browser check runs too (seed still secret on a running tournament).
    expect(await screen.findByText(/server seed is still secret/, undefined, TIMEOUT)).toBeTruthy();
  });

  it('replays step by step with the keyboard and buttons, and plays on its own', async () => {
    await open();
    const replay = screen.getByRole('region', { name: /Replay of hand/ });
    const position = within(replay).getByRole('slider', { name: 'Replay position' }) as HTMLInputElement;
    expect(position.value).toBe('0');
    fireEvent.click(within(replay).getByRole('button', { name: 'Next step' }));
    expect(position.value).toBe('1');
    expect(position.getAttribute('aria-valuetext')).toMatch(/posts the small blind/);
    fireEvent.keyDown(replay, { key: 'End' });
    expect(position.getAttribute('aria-valuetext')).toMatch(/→/);
    expect(within(replay).getByRole('button', { name: 'Replay from the start' })).toBeTruthy();
    fireEvent.keyDown(replay, { key: 'Home' });
    expect(position.value).toBe('0');
    fireEvent.click(within(replay).getByRole('button', { name: 'Flop' }));
    expect(position.getAttribute('aria-valuetext')).toMatch(/Flop: /);
    // Selecting an action in the history shows it in the replay.
    const actions = screen.getByRole('table', { name: /Actions of hand/ });
    fireEvent.click(within(actions).getByRole('button', { name: /Show action 3 in the replay/ }));
    expect(within(actions).getAllByRole('row').find((r) => r.getAttribute('aria-current') === 'step')!.textContent).toMatch(/^3/);

    // Play advances by itself at 4×.
    vi.useFakeTimers();
    try {
      fireEvent.click(within(replay).getByRole('button', { name: '4×' }));
      const before = Number(position.value);
      fireEvent.click(within(replay).getByRole('button', { name: 'Play' }));
      await act(async () => {
        vi.advanceTimersByTime(1_000);
      });
      expect(Number(position.value)).toBeGreaterThan(before);
      fireEvent.click(within(replay).getByRole('button', { name: 'Pause' }));
      const paused = position.value;
      await act(async () => {
        vi.advanceTimersByTime(3_000);
      });
      expect(position.value).toBe(paused);
    } finally {
      vi.useRealTimers();
    }
  });

  it('hides hole cards until showdown in "as players saw it" mode', async () => {
    await open();
    const replay = screen.getByRole('region', { name: /Replay of hand/ });
    const faceUp = () => within(replay).queryAllByRole('img', { hidden: true }).filter((i) => /of (clubs|diamonds|hearts|spades)/.test(i.getAttribute('aria-label') ?? '')).length;
    expect(faceUp()).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /As players saw it/ }));
    expect(faceUp()).toBe(0);
  });

  it('explains a hand that does not exist', async () => {
    renderControlRoom('/t/trn_spring/hands/hand_nope');
    expect(await screen.findByText('This hand does not exist', undefined, TIMEOUT)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Back to all hands/ })).toBeTruthy();
  });
});
