/**
 * Review: ConfirmDialog guards dangerous admin operations (stack adjust,
 * cancel tournament, disqualify...). It must not fire twice. FAILS on current src.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '../src/components/ConfirmDialog';

afterEach(cleanup);

describe('review: ConfirmDialog double submission', () => {
  it('a double click on Confirm calls onConfirm once even before the parent flips `pending`', () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog open title="Adjust stack" confirmWord="ADJUST" onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Dealer misread the pot' } });
    fireEvent.change(screen.getByLabelText(/to confirm/), { target: { value: 'ADJUST' } });
    const confirm = screen.getByRole('button', { name: 'Adjust stack' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
