import { useState as useStateLocal } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ActivityFeed,
  AdminShell,
  AlertQueue,
  BlindClock,
  CommandPalette,
  DataTable,
  Leaderboard,
  LiveAnnouncerProvider,
  Menu,
  PlayerDrawer,
  StatTile,
  TableInspector,
  Toast,
  YourTurnBanner,
  formatAge,
  matchCommand,
  sortAlerts,
  validateBlindStructure,
  validatePayouts,
} from '../src';
import type { BlindRow, Command, InspectorSeat, QueueAlert } from '../src';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Menu', () => {
  it('opens with the keyboard, moves with arrows, runs with Enter and returns focus', () => {
    const a = vi.fn();
    const b = vi.fn();
    render(
      <Menu
        label="Actions for Ana"
        items={[
          { id: 'a', label: 'Message', onSelect: a },
          { id: 'x', label: 'Locked', disabled: true, disabledReason: 'Requires STACK_ADJUST', onSelect: vi.fn() },
          { id: 'b', label: 'Move', onSelect: b },
        ]}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Actions for Ana' });
    fireEvent.click(trigger);
    const menu = screen.getByRole('menu');
    expect(document.activeElement?.textContent).toBe('Message');
    fireEvent.keyDown(menu, { key: 'ArrowDown' }); // skips the disabled item
    expect(document.activeElement?.textContent).toBe('Move');
    fireEvent.keyDown(document.activeElement as Element, { key: 'Enter' });
    expect(b).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

describe('DataTable selection, bulk bar and row menus', () => {
  const rows = [
    { id: 'a', name: 'Ana', stack: 1200 },
    { id: 'b', name: 'Bo', stack: 900 },
  ];
  it('checks rows, shows the bulk bar with actions, and row menus do not open the row', () => {
    const onRow = vi.fn();
    const onBulk = vi.fn();
    const onMsg = vi.fn();
    function Harness() {
      const [checked, setChecked] = useStateLocal<string[]>([]);
      return (
        <DataTable
          label="Players"
          rows={rows}
          rowKey={(r) => r.id}
          rowLabel={(r) => r.name}
          columns={[
            { key: 'name', header: 'Player' },
            { key: 'stack', header: 'Stack', numeric: true },
          ]}
          onRowActivate={onRow}
          checkedKeys={checked}
          onCheckedChange={setChecked}
          bulkActions={(keys) => (
            <button type="button" onClick={() => onBulk(keys)}>
              Sit out
            </button>
          )}
          rowActions={(r) => [{ id: 'msg', label: 'Message', onSelect: () => onMsg(r.id) }]}
        />
      );
    }
    render(<Harness />);
    expect(screen.getByRole('columnheader', { name: 'Stack' }).getAttribute('data-numeric')).toBe('true');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Bo' }));
    expect(onRow).not.toHaveBeenCalled();
    const bar = screen.getByRole('region', { name: 'Bulk actions' });
    expect(within(bar).getByText(/selected/).textContent).toContain('1');
    fireEvent.click(within(bar).getByRole('button', { name: 'Sit out' }));
    expect(onBulk).toHaveBeenCalledWith(['b']);
    fireEvent.click(screen.getByRole('checkbox', { name: /Select all 2 rows/ }));
    expect(within(screen.getByRole('region', { name: 'Bulk actions' })).getByText(/selected/).textContent).toContain('2');
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Ana' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Message' }));
    expect(onMsg).toHaveBeenCalledWith('a');
    expect(onRow).not.toHaveBeenCalled();
    expect(screen.getByRole('region', { name: 'Players (scrollable)' }).getAttribute('tabindex')).toBe('0');
  });
});


describe('TableInspector', () => {
  const seats: Array<InspectorSeat | null> = [
    { playerId: 'p0', name: 'Ana Silva', stack: 5000, privateCards: ['As', 'Kd'] },
    null,
    { playerId: 'p2', name: 'Bo Chen', stack: 7000, sittingOut: true },
  ];
  it('seat menus request seat actions; locked actions say which permission is missing', () => {
    const onSeat = vi.fn();
    const onTable = vi.fn();
    render(<TableInspector tableNumber={7} status="ACTIVE" maxSeats={3} seats={seats} board={[]} totalPot={0} actingSeat={0} locked={{ eliminate: 'PLAYER_ELIMINATE' }} onSeatAction={onSeat} onTableAction={onTable} />);
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Bo Chen, seat 3' }));
    // Sitting-out players offer "Sit back in", not "Sit out".
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sit back in' }));
    expect(onSeat).toHaveBeenCalledWith(2, 'sit-in', 'p2');
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Ana Silva, seat 1' }));
    const elim = screen.getByRole('menuitem', { name: /Eliminate/ });
    expect(elim.getAttribute('aria-disabled')).toBe('true');
    expect(elim.textContent).toContain('Requires PLAYER_ELIMINATE');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Force timeout' }));
    expect(onSeat).toHaveBeenCalledWith(0, 'force-timeout', 'p0');
    fireEvent.click(screen.getByRole('button', { name: 'Hold after hand' }));
    expect(onTable).toHaveBeenCalledWith('hold');
  });
  it('hole cards are hidden until revealed, and the reveal is flagged as audited', () => {
    const { rerender } = render(<TableInspector tableNumber={7} status="ACTIVE" maxSeats={3} seats={seats} board={[]} totalPot={0} onSeatAction={vi.fn()} onTableAction={vi.fn()} />);
    expect(screen.queryByRole('img', { name: 'Ace of spades' })).toBeNull();
    rerender(<TableInspector tableNumber={7} status="ACTIVE" maxSeats={3} seats={seats} board={[]} totalPot={0} revealed onSeatAction={vi.fn()} onTableAction={vi.fn()} />);
    expect(screen.getByRole('group', { name: /Ana Silva.*shows Ace of spades and King of diamonds/ })).toBeTruthy();
    expect(screen.getByText(/recorded in the audit log/)).toBeTruthy();
  });
});

describe('AlertQueue', () => {
  const now = 1_000_000;
  const alerts: QueueAlert[] = [
    { id: 'w', severity: 'warning', code: 'SLOW_TABLE', title: 'Table 12 slow', raisedAt: now - 30_000, state: 'open' },
    { id: 'c2', severity: 'critical', code: 'STALLED_TABLE', title: 'Table 37 stalled', raisedAt: now - 92_000, state: 'open', owner: 'Meera' },
    { id: 'c1', severity: 'critical', code: 'DESYNC', title: 'Node 3 desync', raisedAt: now - 5_000, state: 'open' },
    { id: 'a', severity: 'info', code: 'NOTE', title: 'Acked one', raisedAt: now - 1000, state: 'acked' },
  ];
  it('sorts most severe then oldest, shows age and owner, and acks / snoozes / assigns', () => {
    expect(sortAlerts(alerts).map((a) => a.id)).toEqual(['c2', 'c1', 'w', 'a']);
    expect(formatAge(92_000)).toBe('1m 32s');
    expect(formatAge(3_725_000)).toBe('1h 02m');
    const onAck = vi.fn();
    const onSnooze = vi.fn();
    const onAssign = vi.fn();
    render(<AlertQueue alerts={alerts} now={now} staff={[{ id: 's1', name: 'Karan' }]} onAck={onAck} onSnooze={onSnooze} onAssign={onAssign} />);
    const items = screen.getAllByRole('listitem');
    expect(items[0]?.textContent).toContain('Table 37 stalled');
    expect(items[0]?.textContent).toContain('Critical');
    expect(items[0]?.textContent).toContain('1m 32s');
    expect(items[0]?.textContent).toContain('Owner: Meera');
    expect(items[1]?.textContent).toContain('Unassigned');
    fireEvent.click(within(items[0] as HTMLElement).getByRole('button', { name: 'Ack' }));
    expect(onAck).toHaveBeenCalledWith('c2');
    fireEvent.click(within(items[1] as HTMLElement).getByRole('button', { name: /Snooze/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: '15 minutes' }));
    expect(onSnooze).toHaveBeenCalledWith('c1', 15);
    fireEvent.click(within(items[2] as HTMLElement).getByRole('button', { name: /Assign/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Karan' }));
    expect(onAssign).toHaveBeenCalledWith('w', 's1');
  });
});

describe('CommandPalette', () => {
  const run = vi.fn();
  const commands: Command[] = [
    { id: 'pause', label: 'Pause tournament after hand', group: 'Tournament', shortcut: 'P', run },
    { id: 'freeze', label: 'Emergency freeze', group: 'Tournament', danger: true, run },
    { id: 'adj', label: 'Adjust stack', group: 'Players', keywords: ['chips'], disabledReason: 'Requires STACK_ADJUST', run },
  ];
  it('filters by words and keywords, arrows + Enter run, disabled commands do not run', () => {
    expect(matchCommand(commands[2] as Command, 'chips adj')).toBe(true);
    expect(matchCommand(commands[0] as Command, 'freeze')).toBe(false);
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} commands={commands} />);
    const input = screen.getByRole('combobox', { name: 'Search commands' });
    expect(document.activeElement).toBe(input);
    expect(screen.getAllByRole('option')).toHaveLength(3);
    fireEvent.change(input, { target: { value: 'chips' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(run).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toContain('freeze');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(run).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });
});

describe('Structure editors (pure validation)', () => {
  const r = (key: string, sb: number, bb: number, ante = 0, durationMin = 20, isBreak = false): BlindRow => ({ key, smallBlind: sb, bigBlind: bb, ante, durationMin, isBreak });
  it('blind structure: per-row reasons', () => {
    const errs = validateBlindStructure([r('1', 100, 200), r('2', 200, 150), r('b', 0, 0, 0, 10, true), r('b2', 0, 0, 0, 10, true), r('3', 300, 600, 700), r('4', 300.5, 600, 0, 0)]);
    expect(errs[0]).toEqual({});
    expect(errs[1]?.smallBlind).toMatch(/below the big blind/);
    expect(errs[1]?.bigBlind).toMatch(/Lower than the previous level \(200\)/);
    expect(errs[2]).toEqual({});
    expect(errs[3]?.durationMin).toMatch(/Two breaks/);
    expect(errs[4]?.ante).toMatch(/Cannot exceed/);
    expect(errs[5]?.smallBlind).toMatch(/Whole chips/);
    expect(errs[5]?.durationMin).toBeTruthy();
    expect(validateBlindStructure([r('b', 0, 0, 0, 10, true)])[0]?.durationMin).toMatch(/first level/);
  });
  it('payouts: contiguous bands, non-increasing, exactly 100.00%', () => {
    const ok = validatePayouts([
      { key: 'a', fromPlace: 1, toPlace: 1, bpEach: 5000 },
      { key: 'b', fromPlace: 2, toPlace: 2, bpEach: 3000 },
      { key: 'c', fromPlace: 3, toPlace: 4, bpEach: 1000 },
    ]);
    expect(ok.total).toBeUndefined();
    expect(ok.totalBp).toBe(10_000);
    const bad = validatePayouts(
      [
        { key: 'a', fromPlace: 1, toPlace: 1, bpEach: 3000 },
        { key: 'b', fromPlace: 3, toPlace: 3, bpEach: 4000 },
      ],
      2,
    );
    expect(bad.rows[1]?.fromPlace).toMatch(/start at 2/);
    expect(bad.rows[1]?.bpEach).toMatch(/More than the place above/);
    expect(bad.total).toMatch(/must be exactly 100.00%/);
  });
});

describe('PlayerDrawer', () => {
  it('exact stack, grouped actions, locked actions name their permission', () => {
    const onAction = vi.fn();
    render(
      <PlayerDrawer
        inline
        open
        onClose={vi.fn()}
        player={{ name: 'Sofia Lind', publicId: 'JPN-7A42', status: 'SEATED', connected: true, stack: 23_950, bigBlind: 800, tableNumber: 12, seat: 1 }}
        locked={{ disqualify: 'PLAYER_DISQUALIFY' }}
        onAction={onAction}
      />,
    );
    expect(screen.getByText('23,950')).toBeTruthy();
    for (const name of ['Message', 'Hand history', 'Move…', 'Sit out', 'Adjust stack…', 'Revoke session', 'Suspend…']) {
      fireEvent.click(screen.getByRole('button', { name }));
    }
    expect(onAction.mock.calls.map((c) => c[0])).toEqual(['message', 'hand-history', 'move', 'sit-out', 'adjust-stack', 'revoke-session', 'suspend']);
    const dq = screen.getByRole('button', { name: /Disqualify/ }) as HTMLButtonElement;
    expect(dq.disabled).toBe(true);
    expect(dq.textContent).toContain('requires PLAYER_DISQUALIFY');
  });
});

describe('Review fixes: admin and announcements', () => {
  it('AdminShell nav buttons keep their name with a badge ("Alerts, 3 urgent items")', () => {
    render(
      <AdminShell nav={[{ id: 'alerts', label: 'Alerts', icon: 'bell', badge: 3, badgeTone: 'danger' }]} activeId="alerts" onNavigate={vi.fn()} title="Control room" user={{ name: '😀 Meera Iyer', role: 'TOURNAMENT_DIRECTOR' }}>
        <p>content</p>
      </AdminShell>,
    );
    expect(screen.getByRole('button', { name: 'Alerts, 3 urgent items' })).toBeTruthy();
    expect(screen.getByText('😀I')).toBeTruthy();
  });
  it('ActivityFeed, StatTile and Leaderboard speak severity, direction and ties', () => {
    render(
      <>
        <ActivityFeed entries={[{ id: '1', time: '21:00', actor: 'system', action: 'STALL', severity: 'critical' }]} />
        <StatTile label="Players" value="12" delta={{ text: '-3', direction: 'down' }} />
        <Leaderboard mode="stack" rows={[{ id: 'x', rank: 5, name: 'Ana', stack: 100, tied: true }]} />
      </>,
    );
    expect(screen.getByText('Critical:')).toBeTruthy();
    expect(screen.getByText(/^Down/)).toBeTruthy();
    expect(screen.getByText('Tied')).toBeTruthy();
  });
  it('BlindClock: not-started and paused break are explicit, never a fake "Clock paused 00:00"', () => {
    const lvl = { level: 1, smallBlind: 50, bigBlind: 100, ante: 0 };
    const { container, rerender } = render(<BlindClock current={lvl} levelEndsAt={null} serverOffsetMs={0} />);
    expect(container.textContent).toContain('Starts soon');
    expect(container.textContent).not.toContain('Clock paused');
    rerender(<BlindClock current={lvl} levelEndsAt={null} breakEndsAt={Date.now() + 600_000} pausedRemainingMs={125_000} serverOffsetMs={0} />);
    expect(container.textContent).toContain('Break paused');
    expect(container.textContent).toContain('02:05');
  });
  it('YourTurnBanner announces through the always-mounted live region', () => {
    const { container } = render(
      <LiveAnnouncerProvider>
        <YourTurnBanner detail="Check or bet" deadline={Date.now() + 10_000} serverOffsetMs={0} timerMs={20_000} />
      </LiveAnnouncerProvider>,
    );
    const region = container.querySelector('[data-jpb-announcer="assertive"]');
    expect(region?.textContent).toContain('Your turn. Check or bet.');
  });
  it('Toast with an action is sticky; plain toasts pause while hovered', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const { rerender } = render(<Toast id={1} title="Moved" action={{ label: 'View', onClick: vi.fn() }} onDismiss={onDismiss} />);
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    rerender(<Toast id={2} title="Saved" onDismiss={onDismiss} />);
    const toast = screen.getByRole('status');
    fireEvent.mouseEnter(toast);
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.mouseLeave(toast);
    act(() => {
      vi.advanceTimersByTime(5_100);
    });
    expect(onDismiss).toHaveBeenCalledWith(2);
  });
});
