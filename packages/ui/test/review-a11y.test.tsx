/**
 * Review: accessibility / keyboard bugs outside the ActionPanel.
 * These tests FAIL against the current src.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectionBanner, DataTable, Modal, PlayerSeat } from '../src';

afterEach(cleanup);

describe('review: PlayerSeat', () => {
  it('an opponent’s shown cards at showdown are available to screen readers', () => {
    render(<PlayerSeat name="Ana" stack={12_000} seat={2} shownCards={['As', 'Kd']} />);
    const seat = screen.getByRole('group', { name: /^Ana/ });
    const spoken = seat.getAttribute('aria-label') ?? '';
    const exposedCard = screen.queryAllByRole('img', { name: /Ace of spades/ }).length > 0;
    expect(spoken.includes('Ace of spades') || exposedCard).toBe(true);
  });
});

describe('review: ConnectionBanner', () => {
  it('the per-second "Not live — last update Ns ago" counter is not inside a live region (no re-announcement every second)', () => {
    render(<ConnectionBanner state="offline" staleForSeconds={12} />);
    const stale = screen.getByText(/Not live/);
    expect(stale.closest('[role="alert"], [role="status"], [aria-live]:not([aria-live="off"])')).toBeNull();
  });
});

describe('review: DataTable rows with interactive cells', () => {
  const rows = [
    { id: 'a', name: 'Charlie' },
    { id: 'b', name: 'Alice' },
  ];
  function setup() {
    const onRow = vi.fn();
    const onKick = vi.fn();
    const columns = [
      { key: 'name', header: 'Name' },
      {
        key: 'act',
        header: 'Actions',
        render: (r: (typeof rows)[number]) => (
          <button type="button" onClick={() => onKick(r.id)}>
            Kick {r.name}
          </button>
        ),
      },
    ];
    render(<DataTable label="Players" columns={columns} rows={rows} rowKey={(r) => r.id} onRowActivate={onRow} />);
    return { onRow, onKick };
  }

  it('Enter on a button inside a row activates the button, not the row', () => {
    const { onRow, onKick } = setup();
    const kick = screen.getByRole('button', { name: 'Kick Alice' });
    kick.focus();
    const notPrevented = fireEvent.keyDown(kick, { key: 'Enter' });
    if (notPrevented) fireEvent.click(kick); // browser default activation
    expect(onKick).toHaveBeenCalledWith('b');
    expect(onRow).not.toHaveBeenCalled();
  });

  it('clicking a button inside a row does not also activate the row', () => {
    const { onRow, onKick } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Kick Alice' }));
    expect(onKick).toHaveBeenCalledWith('b');
    expect(onRow).not.toHaveBeenCalled();
  });
});

describe('review: Modal focus trap', () => {
  it('Shift+Tab while the dialog panel itself has focus wraps to the last control (focus cannot escape)', () => {
    render(
      <Modal open onClose={vi.fn()} title="Details">
        <button type="button">First</button>
        <button type="button">Last</button>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Details' });
    const buttons = within(dialog).getAllByRole('button');
    const last = buttons[buttons.length - 1] as HTMLElement;
    dialog.focus(); // e.g. after a click on non-interactive dialog content (tabIndex=-1)
    const notPrevented = fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    // If not prevented, the browser moves focus to whatever precedes the portal: outside the dialog.
    expect(notPrevented).toBe(false);
    expect(document.activeElement).toBe(last);
  });
});
