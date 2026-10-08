/**
 * Independent accessibility/correctness review of <ActionPanel> and its pure
 * logic. Every test here FAILS against the current src and documents a real
 * bug (see the review report for the exact fix).
 *
 * Browser emulation note: jsdom does not activate a focused <button> on Enter.
 * `pressEnterOn` reproduces the browser: dispatch keydown, and only if nobody
 * called preventDefault() run the button's default activation (click).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlayerActionIntent } from '@jpb/shared-types';
import { ActionPanel } from '../src/components/ActionPanel';
import { Modal } from '../src/components/Modal';
import { intentForAmount } from '../src/actionLogic';
import { legal } from './fixtures';

afterEach(cleanup);

const facingBet = legal({ canCall: true, callAmount: 500, canRaise: true, currentBet: 500, minTo: 1000, maxTo: 10_000, canAllIn: true, allInTo: 10_000 });

function setup(l = facingBet, props: Partial<Parameters<typeof ActionPanel>[0]> = {}) {
  const onAction = vi.fn<(i: PlayerActionIntent) => void>();
  const utils = render(<ActionPanel legal={l} bigBlind={200} onAction={onAction} {...props} />);
  return { onAction, ...utils };
}

const btn = (name: string | RegExp) => screen.getByRole('button', { name });

function pressEnterOn(el: HTMLElement): void {
  el.focus();
  const notPrevented = fireEvent.keyDown(el, { key: 'Enter' });
  if (notPrevented) fireEvent.click(el);
}

describe('review: Enter on a focused control activates THAT control', () => {
  it('Enter on the focused "Cancel" of the all-in confirmation cancels (does not go all-in)', () => {
    const { onAction } = setup(facingBet, { confirmAllIn: true });
    fireEvent.keyDown(window, { key: 'a' });
    pressEnterOn(btn('Cancel'));
    expect(onAction).not.toHaveBeenCalled();
    expect(btn('FOLD')).toBeTruthy();
  });

  it('Enter on a focused preset selects the preset (does not submit the current amount)', () => {
    const { onAction } = setup();
    fireEvent.click(btn('RAISE'));
    pressEnterOn(btn('3x: 1,500'));
    expect(onAction).not.toHaveBeenCalled();
    expect(btn('3x: 1,500').getAttribute('aria-pressed')).toBe('true');
  });

  it('Enter on the focused "Back" button closes the sizer (does not submit the raise)', () => {
    const { onAction } = setup();
    fireEvent.click(btn('RAISE'));
    pressEnterOn(btn('Back'));
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.queryByRole('slider')).toBeNull();
  });
});

describe('review: the all-in confirmation cannot be skipped', () => {
  it('holding A (auto-repeat keydown) does not confirm the all-in', () => {
    const { onAction } = setup(facingBet, { confirmAllIn: true });
    fireEvent.keyDown(window, { key: 'a' });
    fireEvent.keyDown(window, { key: 'a', repeat: true });
    expect(onAction).not.toHaveBeenCalled();
  });

  it('a call that commits the whole stack also asks for confirmation when confirmAllIn is set', () => {
    const { onAction } = setup(legal({ canCall: true, callAmount: 3000, stack: 3000, canAllIn: true, allInTo: 3000 }), { confirmAllIn: true });
    fireEvent.click(btn('CALL 3,000 ALL-IN'));
    expect(onAction).not.toHaveBeenCalled();
  });

  it('R (raise) never shoves silently when the only raise is all-in', () => {
    const allInOnly = legal({ canCall: true, callAmount: 1200, stack: 2000, canRaise: true, minTo: 2000, maxTo: 2000, canAllIn: true, allInTo: 2000, currentBet: 1200 });
    const { onAction } = setup(allInOnly);
    fireEvent.keyDown(window, { key: 'r' });
    expect(onAction).not.toHaveBeenCalledWith({ type: 'ALL_IN' });
  });
});

describe('review: amount entry', () => {
  it('slider keyboard steps (browser sends value ± 1) actually move the amount', () => {
    setup();
    fireEvent.click(btn('RAISE'));
    const slider = screen.getByRole('slider') as HTMLInputElement;
    // ArrowRight on a step=1 range input: 1000 -> 1001.
    fireEvent.change(slider, { target: { value: '1001' } });
    expect(Number(slider.value)).toBeGreaterThan(1000);
    // From the middle of the range: 4000 -> 4001 must not snap back to 4000.
    fireEvent.change(slider, { target: { value: '4000' } });
    fireEvent.change(slider, { target: { value: '4001' } });
    expect(Number(slider.value)).toBeGreaterThan(4000);
  });

  it('a typed decimal is not inflated (1500.50 must never become 150,050 -> ALL-IN)', () => {
    const { onAction } = setup();
    fireEvent.click(btn('RAISE'));
    const input = screen.getByRole('textbox', { name: /Exact amount/ }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '1500.50' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAction).not.toHaveBeenCalledWith({ type: 'ALL_IN' });
  });
});

describe('review: a re-sent identical LegalActions is not a new decision', () => {
  it('an unrelated table_update (same legal content, new object) does not close the sizer or lose the amount', () => {
    const onAction = vi.fn();
    const { rerender } = render(<ActionPanel legal={facingBet} bigBlind={200} onAction={onAction} />);
    fireEvent.click(btn('RAISE'));
    fireEvent.click(btn('3x: 1,500'));
    // Every server frame is JSON-parsed, so the same decision arrives as a new object.
    rerender(<ActionPanel legal={JSON.parse(JSON.stringify(facingBet))} bigBlind={200} onAction={onAction} />);
    expect(screen.queryByRole('slider')).not.toBeNull();
    expect(btn('RAISE TO 1,500')).toBeTruthy();
  });
});

describe('review: shortcuts and dialogs', () => {
  it('F does not fold while a modal dialog has focus', () => {
    const onAction = vi.fn();
    render(
      <>
        <ActionPanel legal={facingBet} bigBlind={200} onAction={onAction} />
        <Modal open onClose={vi.fn()} title="Settings">
          <button type="button">Sound</button>
        </Modal>
      </>,
    );
    const focused = document.activeElement as HTMLElement;
    expect(screen.getByRole('dialog').contains(focused)).toBe(true);
    fireEvent.keyDown(focused, { key: 'f' });
    expect(onAction).not.toHaveBeenCalled();
  });
});

describe('review: focus management', () => {
  it('opening the sizer moves focus into it (focus is not dropped to <body>)', () => {
    setup();
    const raise = btn('RAISE');
    raise.focus();
    fireEvent.click(raise);
    const sizer = screen.getByRole('group', { name: 'Raise amount' });
    expect(sizer.contains(document.activeElement)).toBe(true);
  });

  it('the all-in confirmation alertdialog receives focus and contains its buttons', () => {
    setup(facingBet, { confirmAllIn: true });
    fireEvent.keyDown(window, { key: 'a' });
    const dialog = screen.getByRole('alertdialog', { name: 'Confirm all-in' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(dialog.contains(btn('CONFIRM ALL-IN'))).toBe(true);
  });
});

describe('review: actionLogic never produces a disallowed intent', () => {
  it('intentForAmount does not return ALL_IN when canAllIn is false and no bet/raise is legal', () => {
    const callOnly = legal({ canCall: true, callAmount: 800, canAllIn: false });
    const intent = intentForAmount(callOnly, 5000);
    // Test fix: the helper now returns null ("nothing to send") here, so the
    // original `intent.type` dereference would throw instead of asserting.
    expect(intent?.type === 'ALL_IN' && !callOnly.canAllIn).toBe(false);
    expect(intent).toBeNull();
  });
});
