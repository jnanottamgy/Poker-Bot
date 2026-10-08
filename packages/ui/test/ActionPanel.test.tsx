import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlayerActionIntent } from '@jpb/shared-types';
import { ActionPanel } from '../src/components/ActionPanel';
import { legal } from './fixtures';

afterEach(cleanup);

const facingBet = legal({ canCall: true, callAmount: 500, canRaise: true, currentBet: 500, minTo: 1000, maxTo: 10_000, canAllIn: true, allInTo: 10_000 });
const unopened = legal({ canCheck: true, canBet: true, minTo: 200, maxTo: 10_000, canAllIn: true, allInTo: 10_000 });

function setup(l = facingBet, props: Partial<Parameters<typeof ActionPanel>[0]> = {}) {
  const onAction = vi.fn<(i: PlayerActionIntent) => void>();
  const utils = render(<ActionPanel legal={l} bigBlind={200} onAction={onAction} {...props} />);
  return { onAction, ...utils };
}

const btn = (name: string | RegExp) => screen.getByRole('button', { name });
const queryBtn = (name: string | RegExp) => screen.queryByRole('button', { name });

describe('ActionPanel labels from LegalActions', () => {
  it('facing a bet: FOLD, CALL 500, RAISE (no CHECK, no BET)', () => {
    setup();
    expect(btn('FOLD')).toBeTruthy();
    expect(btn('CALL 500')).toBeTruthy();
    expect(btn('RAISE')).toBeTruthy();
    expect(queryBtn('CHECK')).toBeNull();
    expect(queryBtn('BET')).toBeNull();
  });

  it('unopened: CHECK and BET', () => {
    setup(unopened);
    expect(btn('CHECK')).toBeTruthy();
    expect(btn('BET')).toBeTruthy();
    expect(queryBtn(/^CALL/)).toBeNull();
    expect(queryBtn('RAISE')).toBeNull();
  });

  it('call that puts the player all-in is labelled ALL-IN', () => {
    setup(legal({ canCall: true, callAmount: 3000, stack: 3000, canAllIn: true, allInTo: 3000 }));
    expect(btn('CALL 3,000 ALL-IN')).toBeTruthy();
    expect(queryBtn('RAISE')).toBeNull();
  });

  it('a call that commits the whole stack shows exactly FOLD + one CALL / ALL-IN button (no duplicate ALL-IN)', () => {
    setup(legal({ canCall: true, callAmount: 4200, stack: 4200, canAllIn: true, allInTo: 4200, currentBet: 9000 }));
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(btn('CALL 4,200 ALL-IN')).toBeTruthy();
  });

  it('idle panel keeps the live footprint but exposes no buttons', () => {
    const { container } = render(<ActionPanel legal={null} bigBlind={200} onAction={vi.fn()} />);
    expect(container.querySelectorAll('.jpb-act-ghost')).toHaveLength(3);
    expect(screen.getByRole('status').textContent).toBe('Waiting for your turn…');
  });

  it('raise not allowed: no raise/bet control at all', () => {
    setup(legal({ canCall: true, callAmount: 800 }));
    expect(btn('FOLD')).toBeTruthy();
    expect(btn('CALL 800')).toBeTruthy();
    expect(queryBtn('RAISE')).toBeNull();
    expect(queryBtn('BET')).toBeNull();
    expect(queryBtn(/ALL-IN/)).toBeNull();
  });

  it('all-in only (minTo === maxTo): single ALL-IN button sends ALL_IN', () => {
    const { onAction } = setup(legal({ canCall: true, callAmount: 1200, stack: 2000, canRaise: true, minTo: 2000, maxTo: 2000, canAllIn: true, allInTo: 2000, currentBet: 1200 }));
    expect(queryBtn('RAISE')).toBeNull();
    fireEvent.click(btn('ALL-IN 2,000'));
    expect(onAction).toHaveBeenCalledWith({ type: 'ALL_IN' });
  });

  it('fold not offered when the server says canFold=false', () => {
    setup(legal({ canFold: false, canCheck: true }));
    expect(queryBtn('FOLD')).toBeNull();
    expect(btn('CHECK')).toBeTruthy();
  });

  it('shows a waiting state when legal is null', () => {
    render(<ActionPanel legal={null} bigBlind={200} onAction={vi.fn()} />);
    expect(screen.getByText('Waiting for your turn…')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

describe('ActionPanel intents', () => {
  it('fold / call / check', () => {
    const { onAction, unmount } = setup();
    fireEvent.click(btn('CALL 500'));
    expect(onAction).toHaveBeenLastCalledWith({ type: 'CALL' });
    unmount();
    const s2 = setup(unopened);
    fireEvent.click(btn('CHECK'));
    expect(s2.onAction).toHaveBeenLastCalledWith({ type: 'CHECK' });
  });

  it('raise sizer: presets clamped to [minTo, maxTo] and RAISE sends the "to" total', () => {
    const { onAction } = setup();
    fireEvent.click(btn('RAISE'));
    // base = currentBet 500 -> 2x = 1000 (min), 2.5x = 1250, 3x = 1500
    expect(btn('Min: 1,000')).toBeTruthy();
    expect(btn('2x: 1,000')).toBeTruthy();
    expect(btn('2.5x: 1,250')).toBeTruthy();
    expect(btn('3x: 1,500')).toBeTruthy();
    expect(btn('All-in: 10,000')).toBeTruthy();
    fireEvent.click(btn('3x: 1,500'));
    expect(btn('3x: 1,500').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(btn('RAISE TO 1,500'));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ type: 'RAISE', amount: 1500 });
  });

  it('bet presets use the big blind when unopened', () => {
    const { onAction } = setup(unopened);
    fireEvent.click(btn('BET'));
    expect(btn('2x: 400')).toBeTruthy();
    expect(btn('2.5x: 500')).toBeTruthy();
    fireEvent.click(btn('2.5x: 500'));
    fireEvent.click(btn('BET 500'));
    expect(onAction).toHaveBeenCalledWith({ type: 'BET', amount: 500 });
  });

  it('typed amount is clamped to the legal range', () => {
    const { onAction } = setup();
    fireEvent.click(btn('RAISE'));
    const input = screen.getByRole('textbox', { name: /Exact amount/ });
    fireEvent.change(input, { target: { value: '50' } });
    fireEvent.blur(input);
    // Formatted with separators on blur.
    expect((input as HTMLInputElement).value).toBe('1,000');
    fireEvent.change(input, { target: { value: '99,999' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    // First Enter only shows the clamped value (ALL-IN 10,000); nothing is sent unseen.
    expect(onAction).not.toHaveBeenCalled();
    expect((input as HTMLInputElement).value).toBe('10,000');
    expect(btn('ALL-IN 10,000')).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Enter' });
    // Max is all-in.
    expect(onAction).toHaveBeenCalledWith({ type: 'ALL_IN' });
  });

  it('slider snaps and stays within range', () => {
    setup();
    fireEvent.click(btn('RAISE'));
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '4049' } });
    expect(btn('RAISE TO 4,000')).toBeTruthy();
    fireEvent.change(slider, { target: { value: '9990' } });
    expect(btn('ALL-IN 10,000')).toBeTruthy();
  });

  it('confirm step for all-in when confirmAllIn is set', () => {
    const { onAction } = setup(facingBet, { confirmAllIn: true });
    fireEvent.keyDown(window, { key: 'a' });
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog', { name: 'Confirm all-in' })).toBeTruthy();
    fireEvent.click(btn('CONFIRM ALL-IN'));
    expect(onAction).toHaveBeenCalledWith({ type: 'ALL_IN' });
  });

  it('cancel in the confirm step returns to the main row', () => {
    const { onAction } = setup(facingBet, { confirmAllIn: true });
    fireEvent.keyDown(window, { key: 'a' });
    fireEvent.click(btn('Cancel'));
    expect(btn('FOLD')).toBeTruthy();
    expect(onAction).not.toHaveBeenCalled();
  });
});

describe('ActionPanel double-submit protection', () => {
  it('a double click sends exactly one intent and shows Submitting…', () => {
    const { onAction } = setup();
    const call = btn('CALL 500');
    fireEvent.click(call);
    fireEvent.click(call);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Submitting…')).toBeTruthy();
    // Other actions are locked too.
    fireEvent.click(btn('FOLD'));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect((btn('FOLD') as HTMLButtonElement).disabled).toBe(true);
  });

  it('pending disables everything and shows Submitting…', () => {
    const { onAction } = setup(facingBet, { pending: true });
    expect(screen.getByText('Submitting…')).toBeTruthy();
    for (const b of screen.getAllByRole('button')) expect((b as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(window, { key: 'f' });
    expect(onAction).not.toHaveBeenCalled();
  });

  it('unlocks when the server answers (pending true -> false) and on a new decision', () => {
    const onAction = vi.fn();
    const { rerender } = render(<ActionPanel legal={facingBet} bigBlind={200} onAction={onAction} />);
    fireEvent.click(btn('FOLD'));
    rerender(<ActionPanel legal={facingBet} bigBlind={200} onAction={onAction} pending />);
    rerender(<ActionPanel legal={facingBet} bigBlind={200} onAction={onAction} pending={false} />);
    fireEvent.click(btn('CALL 500'));
    expect(onAction).toHaveBeenCalledTimes(2);
    // Still locked: an identical re-send of the same decision is not a new decision.
    rerender(<ActionPanel legal={{ ...facingBet }} bigBlind={200} onAction={onAction} />);
    expect((btn('FOLD') as HTMLButtonElement).disabled).toBe(true);
    // A genuinely new decision (new turnVersion) unlocks.
    rerender(<ActionPanel legal={{ ...facingBet }} decisionKey={2} bigBlind={200} onAction={onAction} />);
    fireEvent.click(btn('FOLD'));
    expect(onAction).toHaveBeenCalledTimes(3);
  });
});

describe('ActionPanel keyboard shortcuts', () => {
  it('F folds, C calls', () => {
    const a = setup();
    fireEvent.keyDown(window, { key: 'f' });
    expect(a.onAction).toHaveBeenLastCalledWith({ type: 'FOLD' });
    a.unmount();
    const b = setup();
    fireEvent.keyDown(window, { key: 'C' });
    expect(b.onAction).toHaveBeenLastCalledWith({ type: 'CALL' });
  });

  it('C checks when checking is legal', () => {
    const { onAction } = setup(unopened);
    fireEvent.keyDown(window, { key: 'c' });
    expect(onAction).toHaveBeenCalledWith({ type: 'CHECK' });
  });

  it('R opens the sizer, Enter confirms, Esc cancels', () => {
    const { onAction } = setup();
    fireEvent.keyDown(window, { key: 'r' });
    expect(screen.getByRole('slider')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('slider')).toBeNull();
    fireEvent.keyDown(window, { key: 'r' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onAction).toHaveBeenCalledWith({ type: 'RAISE', amount: 1000 });
  });

  it('pending shows a spinner in the tapped button only and keeps the others dimmed', () => {
    const { container } = setup();
    fireEvent.click(btn('CALL 500'));
    expect(container.querySelectorAll('.jpb-act.is-sent')).toHaveLength(1);
    expect(btn('CALL 500').getAttribute('aria-busy')).toBe('true');
  });

  it('duplicate presets (clamped to the same amount) are disabled and say what they equal', () => {
    setup();
    fireEvent.click(btn('RAISE'));
    const dup = btn('2x: 1,000') as HTMLButtonElement;
    expect(dup.disabled).toBe(true);
    expect(dup.textContent).toContain('= Min');
  });

  it('pot percentage is a whole number', () => {
    setup();
    fireEvent.click(btn('RAISE'));
    // adds 1,000 into a 1,500 pot -> 67%
    expect(screen.getByText(/67% of pot/)).toBeTruthy();
  });

  it('A goes all-in', () => {
    const { onAction } = setup();
    fireEvent.keyDown(window, { key: 'a' });
    expect(onAction).toHaveBeenCalledWith({ type: 'ALL_IN' });
  });

  it('ignores shortcuts with modifiers, while typing, or when disabled', () => {
    const { onAction, unmount } = setup();
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'f', metaKey: true });
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    fireEvent.keyDown(outside, { key: 'f' });
    expect(onAction).not.toHaveBeenCalled();
    outside.remove();
    unmount();
    const off = setup(facingBet, { keyboardShortcuts: false });
    fireEvent.keyDown(window, { key: 'f' });
    expect(off.onAction).not.toHaveBeenCalled();
  });

  it('F is ignored when folding is not legal', () => {
    const { onAction } = setup(legal({ canFold: false, canCheck: true }));
    fireEvent.keyDown(window, { key: 'f' });
    expect(onAction).not.toHaveBeenCalled();
  });

  it('shows key hints and exposes aria-keyshortcuts', () => {
    setup();
    expect(btn('FOLD').getAttribute('aria-keyshortcuts')).toBe('F');
    expect(btn('CALL 500').getAttribute('aria-keyshortcuts')).toBe('C');
    expect(btn('RAISE').getAttribute('aria-keyshortcuts')).toBe('R');
  });
});

describe('ActionPanel timing safety', () => {
  it('does not fire twice from rapid keyboard repeats', () => {
    const { onAction } = setup();
    act(() => {
      fireEvent.keyDown(window, { key: 'c' });
      fireEvent.keyDown(window, { key: 'c' });
      fireEvent.keyDown(window, { key: 'f' });
    });
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
