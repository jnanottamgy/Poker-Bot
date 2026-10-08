import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '../src/components/ConfirmDialog';

afterEach(cleanup);

function setup(extra: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <ConfirmDialog
      open
      title="Cancel tournament"
      summary="Spring Showdown · 1,204 players still seated"
      consequences={['All tables stop immediately.', 'Players are shown a cancellation notice.']}
      preview={[{ label: 'Status', before: 'RUNNING', after: 'CANCELLED' }]}
      confirmWord="CANCEL"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...extra}
    />,
  );
  const confirm = screen.getByRole('button', { name: 'Cancel tournament' }) as HTMLButtonElement;
  const word = screen.getByLabelText(/to confirm/) as HTMLInputElement;
  const reason = screen.getByLabelText(/Reason/) as HTMLTextAreaElement;
  return { onConfirm, onCancel, confirm, word, reason };
}

describe('ConfirmDialog (double confirmation)', () => {
  it('is an aria-modal dialog that shows consequences and a before/after preview', () => {
    setup();
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByText('All tables stop immediately.')).toBeTruthy();
    expect(screen.getByText('RUNNING')).toBeTruthy();
    expect(screen.getByText('CANCELLED')).toBeTruthy();
  });

  it('cannot confirm with nothing filled in', () => {
    const { confirm, onConfirm } = setup();
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('cannot confirm with only the typed word', () => {
    const { confirm, word, onConfirm } = setup();
    fireEvent.change(word, { target: { value: 'CANCEL' } });
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('cannot confirm with only a reason', () => {
    const { confirm, reason, onConfirm } = setup();
    fireEvent.change(reason, { target: { value: 'Venue power failure, cannot continue' } });
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('requires the exact word (case-sensitive) and a non-trivial reason', () => {
    const { confirm, word, reason, onConfirm } = setup();
    fireEvent.change(reason, { target: { value: 'Venue power failure' } });
    fireEvent.change(word, { target: { value: 'cancel' } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(word, { target: { value: 'CANCEL ' } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(word, { target: { value: 'CANCEL' } });
    fireEvent.change(reason, { target: { value: '   short  ' } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(reason, { target: { value: '  Venue power failure  ' } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({ reason: 'Venue power failure', requestId: expect.any(String) });
  });

  it('Enter in the form cannot bypass validation', () => {
    const { word, onConfirm } = setup();
    fireEvent.change(word, { target: { value: 'CANCEL' } });
    fireEvent.submit(word.form as HTMLFormElement);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('pending shows Submitting… and blocks dismissal', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog open title="Adjust stack" pending onConfirm={vi.fn()} onCancel={onCancel} />);
    expect(screen.getByText('Submitting…')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('Esc and "Keep as is" cancel', () => {
    const { onCancel } = setup();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Keep as is' }));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('focuses the confirmation word field first', () => {
    const { word } = setup();
    expect(document.activeElement).toBe(word);
  });
});
