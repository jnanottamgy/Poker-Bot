import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CANONICAL_DECK } from '@jpb/shared-types';
import type { TournamentStatus as TStatus } from '@jpb/shared-types';
import {
  Alert,
  Board,
  Button,
  CONNECTION_COPY,
  ConnectionBanner,
  DataTable,
  EliminationCard,
  HoleCards,
  LEADERBOARD_MODE_LABEL,
  Leaderboard,
  Modal,
  PlayerSeat,
  PlayingCard,
  PokerTable,
  StackDisplay,
  StatusPill,
  TABLE_STATUS_META,
  TOURNAMENT_STATUS_META,
  TableMap,
  TableMoveCard,
  TableTile,
  Tabs,
  ToastProvider,
  Toggle,
  TournamentStatusPill,
  cardLabel,
  seatLayout,
  useToast,
} from '../src';
import type { TableTileStatus, Tone } from '../src';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('PlayingCard', () => {
  it('labels every card in the deck', () => {
    for (const c of CANONICAL_DECK) {
      const { unmount } = render(<PlayingCard card={c} />);
      expect(screen.getByRole('img', { name: cardLabel(c) })).toBeTruthy();
      unmount();
    }
  });
  it('As is "Ace of spades" and shows rank 10 for T', () => {
    render(
      <>
        <PlayingCard card="As" />
        <PlayingCard card="Th" />
      </>,
    );
    expect(screen.getByRole('img', { name: 'Ace of spades' })).toBeTruthy();
    const ten = screen.getByRole('img', { name: 'Ten of hearts' });
    expect(ten.textContent).toContain('10');
  });
  it('face down never reveals the card', () => {
    render(<PlayingCard card="As" faceDown />);
    const el = screen.getByRole('img', { name: 'Face-down card' });
    expect(el.textContent).not.toContain('A');
    expect(screen.queryByRole('img', { name: 'Ace of spades' })).toBeNull();
  });
  it('winning cards say so', () => {
    render(<PlayingCard card="Kd" highlight />);
    expect(screen.getByRole('img', { name: 'King of diamonds, winning card' })).toBeTruthy();
  });
  it('applies size and animation classes from props', () => {
    render(<PlayingCard card="2c" size="xl" deal />);
    const el = screen.getByRole('img', { name: 'Two of clubs' });
    expect(el.className).toContain('jpb-card--xl');
    expect(el.className).toContain('jpb-card--deal');
  });
});

describe('Board & HoleCards', () => {
  it('always renders 5 slots and names the board', () => {
    const { container } = render(<Board cards={['Qh', 'Jd', '4h']} />);
    expect(screen.getByRole('group', { name: 'Board: Queen of hearts, Jack of diamonds, Four of hearts' })).toBeTruthy();
    expect(container.querySelectorAll('.jpb-board__slot')).toHaveLength(2);
    expect(screen.getAllByRole('img')).toHaveLength(3);
  });
  it('empty board is announced', () => {
    render(<Board cards={[]} />);
    expect(screen.getByRole('group', { name: 'Board: no cards yet' })).toBeTruthy();
  });
  it('hole cards labels', () => {
    render(<HoleCards cards={['Ah', 'Kh']} labelPrefix="Your cards" />);
    expect(screen.getByRole('group', { name: 'Your cards: Ace of hearts and King of hearts' })).toBeTruthy();
    cleanup();
    render(<HoleCards cards={null} />);
    expect(screen.getByRole('group', { name: 'Hole cards: face down' })).toBeTruthy();
  });
});

describe('StatusPill & Badge never rely on colour alone', () => {
  const tones: Tone[] = ['neutral', 'positive', 'info', 'warning', 'danger', 'gold'];
  it.each(tones)('%s renders visible text', (tone) => {
    render(<StatusPill tone={tone} label={`Label ${tone}`} />);
    expect(screen.getByText(`Label ${tone}`)).toBeTruthy();
  });
  it('icon can be hidden but text stays', () => {
    const { container } = render(<StatusPill tone="danger" label="Stalled" icon={null} />);
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.getByText('Stalled')).toBeTruthy();
  });
  it('every tournament status has a text label', () => {
    for (const s of Object.keys(TOURNAMENT_STATUS_META) as TStatus[]) {
      const { unmount } = render(<TournamentStatusPill status={s} />);
      expect(screen.getByText(TOURNAMENT_STATUS_META[s].label)).toBeTruthy();
      unmount();
    }
  });
  it('every table status has icon + text', () => {
    for (const s of Object.keys(TABLE_STATUS_META) as TableTileStatus[]) {
      const { container, unmount } = render(<TableTile id="t" tableNumber={3} players={6} maxSeats={9} status={s} health="ok" healthText="ok" />);
      expect(screen.getByText(TABLE_STATUS_META[s].label)).toBeTruthy();
      expect(container.querySelector('.jpb-ttile__status svg')).not.toBeNull();
      unmount();
    }
  });
});

describe('ConnectionBanner', () => {
  it('renders nothing while connected', () => {
    const { container } = render(<ConnectionBanner state="connected" />);
    expect(container.innerHTML).toBe('');
  });
  it('reconnecting copy', () => {
    render(<ConnectionBanner state="reconnecting" />);
    expect(screen.getByText('RECONNECTING…')).toBeTruthy();
    expect(screen.getByText('Your chips are safe. Tournament continues on the server.')).toBeTruthy();
    expect(screen.getByRole('status')).toBeTruthy();
  });
  it('offline copy with retry', () => {
    const onRetry = vi.fn();
    render(<ConnectionBanner state="offline" onRetry={onRetry} />);
    expect(screen.getByText('OFFLINE')).toBeTruthy();
    expect(screen.getByText(CONNECTION_COPY.offline.body)).toBeTruthy();
    expect(CONNECTION_COPY.offline.body).toContain('Your chips are safe');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeTruthy();
  });
  it('session replaced copy with takeover', () => {
    const onTakeover = vi.fn();
    render(<ConnectionBanner state="session-replaced" onTakeover={onTakeover} />);
    expect(screen.getByText(CONNECTION_COPY['session-replaced'].title)).toBeTruthy();
    expect(screen.getByText(/not live/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use this device' }));
    expect(onTakeover).toHaveBeenCalled();
  });
  it('marks stale data as not live', () => {
    render(<ConnectionBanner state="reconnecting" staleForSeconds={12} />);
    expect(screen.getByText(/Not live — last update 12s ago/)).toBeTruthy();
  });
});

describe('Leaderboard', () => {
  const rows = [
    { id: 'a', rank: 1, name: 'Diego', stack: 1_480_000, prizeMinor: 50_000_000 },
    { id: 'b', rank: 2, name: 'Kenji', stack: 1_210_500, isYou: true },
  ];
  it('stack mode is labelled as a current ranking', () => {
    render(<Leaderboard mode="stack" rows={rows} />);
    expect(screen.getAllByText('Current stack ranking').length).toBeGreaterThan(0);
    expect(screen.queryByText('Finishing positions')).toBeNull();
    expect(screen.getByRole('table', { name: 'Current stack ranking' })).toBeTruthy();
    expect(screen.getByText('1.4M')).toBeTruthy();
    expect(screen.getByText('YOU')).toBeTruthy();
  });
  it('finish mode is labelled as finishing positions with prizes', () => {
    render(<Leaderboard mode="finish" rows={rows} currency="INR" />);
    expect(screen.getByRole('table', { name: LEADERBOARD_MODE_LABEL.finish })).toBeTruthy();
    expect(screen.getByText('₹5,00,000')).toBeTruthy();
    expect(screen.getByText('Place')).toBeTruthy();
  });
});

describe('StackDisplay', () => {
  it('compact by default, exact in title and on tap', () => {
    render(<StackDisplay amount={12_450} />);
    const b = screen.getByRole('button', { name: /Stack 12,450 chips/ });
    expect(b.textContent).toContain('12.4K');
    expect(b.getAttribute('title')).toContain('12,450');
    fireEvent.click(b);
    expect(b.textContent).toContain('12,450');
    expect(b.getAttribute('aria-pressed')).toBe('true');
  });
  it('static variant keeps the exact amount for screen readers', () => {
    render(<StackDisplay amount={999_950} interactive={false} />);
    expect(screen.getByText('Stack 999,950 chips')).toBeTruthy();
    expect(screen.getByText('999.9K')).toBeTruthy();
  });
});

describe('PlayerSeat', () => {
  it('puts every state into text', () => {
    render(<PlayerSeat name="Sofia" stack={2000} seat={2} isButton isBigBlind acting connected={false} lastAction={null} />);
    const g = screen.getByRole('group', { name: /Sofia/ });
    const label = g.getAttribute('aria-label') ?? '';
    expect(label).toContain('seat 3');
    expect(label).toContain('dealer button');
    expect(label).toContain('big blind');
    expect(label).toContain('disconnected');
    expect(label).toContain('to act');
    expect(within(g).getByText('TO ACT')).toBeTruthy();
    expect(within(g).getByText('D')).toBeTruthy();
    expect(within(g).getByText('BB')).toBeTruthy();
    expect(within(g).getByText('DISCONNECTED')).toBeTruthy();
  });
  it('folded / all-in / winner', () => {
    render(
      <>
        <PlayerSeat name="A" stack={500} folded />
        <PlayerSeat name="B" stack={0} allIn />
        <PlayerSeat name="C" stack={9000} winAmount={4000} handDescription="Flush, Ace high" />
      </>,
    );
    expect(screen.getByText('FOLDED')).toBeTruthy();
    expect(screen.getByText('ALL-IN')).toBeTruthy();
    expect(screen.getByText('WINNER +4K')).toBeTruthy();
    expect(screen.getByRole('group', { name: /C, stack 9,000 chips, winner, won 4,000 chips, Flush, Ace high/ })).toBeTruthy();
  });
});

describe('PokerTable geometry', () => {
  it('places the hero at bottom centre in both layouts', () => {
    for (let n = 2; n <= 10; n++) {
      for (const v of ['wide', 'tall'] as const) {
        const g = seatLayout(n, 3 % n, v);
        expect(g).toHaveLength(n);
        const hero = g[3 % n];
        expect(hero?.seat.x).toBeCloseTo(50, 5);
        for (const s of g) {
          expect(s.seat.x).toBeGreaterThanOrEqual(0);
          expect(s.seat.x).toBeLessThanOrEqual(100);
          expect(s.seat.y).toBeGreaterThanOrEqual(0);
          expect(s.seat.y).toBeLessThanOrEqual(100);
        }
        // hero is the lowest seat
        const maxY = Math.max(...g.map((s) => s.seat.y));
        expect(hero?.seat.y).toBe(maxY);
      }
    }
  });
  it('tall layout keeps every seat box out of the board row (y 38-54%) at the sides', () => {
    for (let n = 2; n <= 10; n++) {
      const g = seatLayout(n, 0, 'tall');
      for (const [i, s] of g.entries()) {
        if (i === 0) continue;
        const besideBoard = s.seat.y > 36 && s.seat.y < 56;
        expect(besideBoard, `n=${n} seat ${i} at y=${s.seat.y}`).toBe(false);
      }
    }
  });
  it('spectator tall layout puts seat 0 on the bottom rail', () => {
    const g = seatLayout(9, 0, 'tall', { spectator: true });
    expect(g[0]?.seat).toEqual({ x: 50, y: 92 });
  });
  it('next seat clockwise sits to the hero\'s left', () => {
    const g = seatLayout(9, 0, 'wide');
    expect(g[1]?.seat.x).toBeLessThan(50);
    expect(g[8]?.seat.x).toBeGreaterThan(50);
  });
  it('renders seats, empty seats and the hero dock', () => {
    render(
      <PokerTable
        maxSeats={3}
        heroSeat={0}
        seats={[{ name: 'Me', stack: 1000, holeCards: ['As', 'Ks'] }, null, { name: 'Them', stack: 2000, bet: 400 }]}
        board={[]}
        totalPot={600}
        tableNumber={42}
        variant="tall"
      />,
    );
    // The dock only exists in the portrait layout (it is `hidden` in the wide one, where the hero sits on the rail).
    expect(screen.getByRole('region', { name: /Table 42, 2 of 3 seats filled/ })).toBeTruthy();
    expect(screen.getByText('Seat 2 empty')).toBeTruthy();
    expect(screen.getByText('Them has 400 chips in front')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Your seat' })).toBeTruthy();
    expect(screen.getAllByRole('group', { name: 'Your cards: Ace of spades and King of spades' }).length).toBeGreaterThan(0);
  });
});

describe('Notices', () => {
  it('TableMoveCard shows 1-based seats and focuses Continue', () => {
    const onContinue = vi.fn();
    render(<TableMoveCard fromTableNumber={37} fromSeat={3} toTableNumber={42} toSeat={5} stack={12_450} onContinue={onContinue} />);
    expect(screen.getByText('TABLE 37 / SEAT 4')).toBeTruthy();
    expect(screen.getByText('TABLE 42 / SEAT 6')).toBeTruthy();
    expect(screen.getByText('12,450')).toBeTruthy();
    const btn = screen.getByRole('button', { name: 'Continue' });
    expect(document.activeElement).toBe(btn);
    fireEvent.click(btn);
    expect(onContinue).toHaveBeenCalled();
  });
  it('EliminationCard shows finish, hands and prize', () => {
    render(<EliminationCard finishPosition={184} fieldSize={2000} handsPlayed={212} onWatch={vi.fn()} />);
    expect(screen.getByText("YOU'RE OUT")).toBeTruthy();
    expect(screen.getByText('#184')).toBeTruthy();
    expect(screen.getByText('No prize')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Watch tournament' })).toBeTruthy();
    cleanup();
    render(<EliminationCard finishPosition={57} handsPlayed={388} prizeMinor={2_450_000} onWatch={vi.fn()} />);
    expect(screen.getByText('₹24,500')).toBeTruthy();
  });
});

describe('Modal', () => {
  it('traps focus, closes on Esc and restores focus', () => {
    const onClose = vi.fn();
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { rerender } = render(
      <Modal open onClose={onClose} title="Details">
        <button type="button">First</button>
        <button type="button">Last</button>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Details' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const buttons = within(dialog).getAllByRole('button');
    const first = buttons[0] as HTMLElement;
    const last = buttons[buttons.length - 1] as HTMLElement;
    // Opens on the heading (no focus ring drawn on a button for pointer users); Tab enters the controls.
    expect(document.activeElement).toBe(within(dialog).getByRole('heading', { name: 'Details' }));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(
      <Modal open={false} onClose={onClose} title="Details">
        <button type="button">First</button>
      </Modal>,
    );
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
  it('non-dismissible ignores Esc', () => {
    const onClose = vi.fn();
    render(<Modal open dismissible={false} onClose={onClose} title="Forced" />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('Button', () => {
  it('loading shows Submitting… and disables', () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const b = screen.getByRole('button', { name: 'Submitting…' }) as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    expect(b.getAttribute('aria-busy')).toBe('true');
  });
});

describe('Alert', () => {
  it('critical interrupts, others are polite; severity is text', () => {
    render(<Alert severity="CRITICAL" title="Stalled" />);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('Critical')).toBeTruthy();
    cleanup();
    render(<Alert severity="WARNING" title="Hand-for-hand" />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText('Warning')).toBeTruthy();
  });
});

describe('DataTable', () => {
  const rows = [
    { id: 'a', name: 'Charlie', stack: 300 },
    { id: 'b', name: 'Alice', stack: 900 },
    { id: 'c', name: 'Bob', stack: 100 },
  ];
  const columns = [
    { key: 'name', header: 'Name', sortValue: (r: (typeof rows)[number]) => r.name },
    { key: 'stack', header: 'Stack', numeric: true, sortValue: (r: (typeof rows)[number]) => r.stack },
  ];
  const names = () => screen.getAllByRole('row').slice(1).map((r) => r.querySelector('td')?.textContent);

  it('sorts by column with aria-sort and activates rows by keyboard', () => {
    const onRow = vi.fn();
    render(<DataTable label="Players" columns={columns} rows={rows} rowKey={(r) => r.id} onRowActivate={onRow} />);
    fireEvent.click(screen.getByRole('button', { name: /Stack/ }));
    expect(names()).toEqual(['Alice', 'Charlie', 'Bob']);
    expect(screen.getByRole('columnheader', { name: /Stack/ }).getAttribute('aria-sort')).toBe('descending');
    fireEvent.click(screen.getByRole('button', { name: /Stack/ }));
    expect(names()).toEqual(['Bob', 'Charlie', 'Alice']);
    const firstRow = screen.getAllByRole('row')[1] as HTMLElement;
    fireEvent.keyDown(firstRow, { key: 'Enter' });
    expect(onRow).toHaveBeenCalledWith(rows[2]);
  });
  it('empty state and pagination footer', () => {
    const onPage = vi.fn();
    render(<DataTable label="Players" columns={columns} rows={[]} rowKey={(r) => r.id} pagination={{ page: 0, pageSize: 10, total: 0, onPageChange: onPage }} />);
    expect(screen.getByText('Nothing here yet')).toBeTruthy();
    expect(screen.getByText('No results')).toBeTruthy();
    cleanup();
    render(<DataTable label="Players" columns={columns} rows={rows} rowKey={(r) => r.id} pagination={{ page: 0, pageSize: 3, total: 9, onPageChange: onPage }} />);
    expect(screen.getByText('1–3 of 9')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPage).toHaveBeenCalledWith(1);
    expect((screen.getByRole('button', { name: 'Previous page' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Tabs & Toggle', () => {
  it('arrow keys move selection', () => {
    const onChange = vi.fn();
    render(
      <Tabs
        label="Filters"
        value="a"
        onChange={onChange}
        tabs={[
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ]}
      />,
    );
    fireEvent.keyDown(screen.getByRole('tab', { name: 'A' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('b');
  });
  it('switch has role, state and visible ON/OFF text', () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="Sound" />);
    const sw = screen.getByRole('switch', { name: 'Sound' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('OFF')).toBeTruthy();
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('TableMap', () => {
  it('summarises counts and windows large maps', () => {
    const tables = Array.from({ length: 500 }, (_, i) => ({
      id: `t${i}`,
      tableNumber: i + 1,
      players: 9,
      maxSeats: 9,
      status: (i === 3 ? 'STALLED' : 'ACTIVE') as TableTileStatus,
      health: 'ok' as const,
      healthText: 'ok',
    }));
    const onSelect = vi.fn();
    render(<TableMap tables={tables} onSelect={onSelect} height={400} />);
    expect(screen.getByRole('region', { name: 'Table map, 500 tables' })).toBeTruthy();
    // Windowed: far fewer tiles than tables in the DOM.
    const tiles = screen.getAllByRole('button', { name: /^Table \d+/ });
    expect(tiles.length).toBeLessThan(100);
    fireEvent.click(screen.getByRole('button', { name: /^Table 4, Stalled/ }));
    expect(onSelect).toHaveBeenCalledWith('t3');
  });
});

describe('Toast', () => {
  function Pusher() {
    const t = useToast();
    return (
      <button type="button" onClick={() => t.push({ title: 'Break started', tone: 'success', durationMs: 1000 })}>
        push
      </button>
    );
  }
  it('pushes and auto-dismisses', () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Pusher />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'push' }));
    expect(screen.getByText('Break started')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(screen.queryByText('Break started')).toBeNull();
  });
});
