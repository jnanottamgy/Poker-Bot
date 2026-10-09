import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApiError } from '@jpb/client-sdk';
import { ToastProvider } from '@jpb/ui';
import type { PlayerApi } from '../src/api/client';
import { BackendProvider } from '../src/app/backend';
import { ReentryDialog } from '../src/play/screens/ReentryDialog';

afterEach(cleanup);

function renderDialog(reenter: PlayerApi['reenter'], onReentered = vi.fn()) {
  const api = { reenter } as unknown as PlayerApi;
  render(
    <BackendProvider backend={{ mode: 'live', api, wsUrl: 'ws://test/ws' }}>
      <ToastProvider>
        <ReentryDialog open offer={{ untilLevel: 4, entriesLeft: 1 }} startingStack={10_000} onClose={vi.fn()} onReentered={onReentered} />
      </ToastProvider>
    </BackendProvider>,
  );
  return onReentered;
}

describe('re-entry confirmation', () => {
  it('re-enters only after the explicit confirmation', async () => {
    const reenter = vi.fn(async () => ({ ok: true as const, entryId: 'ent_2', entryNumber: 2, self: null }));
    const onReentered = renderDialog(reenter);
    expect(screen.getByText(/10,000 chips/)).toBeTruthy();
    expect(screen.getByText(/1 remaining entry/)).toBeTruthy();
    expect(reenter).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm re-entry' }));
    await waitFor(() => expect(onReentered).toHaveBeenCalledTimes(1));
    expect(reenter).toHaveBeenCalledTimes(1);
  });

  it("shows the server's refusal in plain words", async () => {
    const onReentered = renderDialog(async () => {
      throw new ApiError(409, 'REENTRY_CLOSED', 'Re-entry is closed.');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm re-entry' }));
    await screen.findByText('Re-entry is closed');
    expect(onReentered).not.toHaveBeenCalled();
  });
});
